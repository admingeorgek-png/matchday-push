// MATCHDAY PUSH — LIVE FOOTBALL BACKEND
//
// This backend:
// 1. Connects to football-data.org for fixtures + standings.
// 2. Automatically selects the current/future matchweek.
// 3. Polls live football data frequently.
// 4. Updates live scores/statuses in /api/data.
// 5. Sends push notifications when scores change.
// 6. Refreshes standings automatically.
// 7. Refreshes transfer news automatically.
// 8. Keeps API keys on the Railway backend.
// 9. Provides /health diagnostics.
// 10. Keeps existing Matchday routes compatible.
//
// DEPLOY THIS SERVER ON RAILWAY.
// NETLIFY SHOULD HOST THE FRONTEND.
//
// Required Railway variables:
//
// FOOTBALL_DATA_API_KEY
// VAPID_PUBLIC_KEY
// VAPID_PRIVATE_KEY
// VAPID_CONTACT_EMAIL
// SEASON=2026-2027
//
// Node.js 18+ is required because this file uses the built-in fetch().

const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    maxAge: 0
  })
);

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 3000;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL =
  process.env.VAPID_CONTACT_EMAIL || 'mailto:you@example.com';

const FOOTBALL_DATA_API_KEY =
  process.env.FOOTBALL_DATA_API_KEY || '';

const SEASON =
  process.env.SEASON || '2026-2027';

const LIVE_FEED_URL =
  'https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer';

// How often the backend checks live scores.
const LIVE_POLL_MS = 45 * 1000;

// How often normal fixtures/standings are refreshed.
const DATA_REFRESH_MINUTES = 15;

// ============================================================
// LEAGUES
// ============================================================

const LEAGUES = {
  epl: {
    id: 4328,
    name: 'Premier League',
    short: 'EPL',
    fdCode: 'PL'
  },

  laliga: {
    id: 4335,
    name: 'La Liga',
    short: 'ESP',
    fdCode: 'PD'
  },

  seriea: {
    id: 4332,
    name: 'Serie A',
    short: 'ITA',
    fdCode: 'SA'
  },

  bundesliga: {
    id: 4331,
    name: 'Bundesliga',
    short: 'GER',
    fdCode: 'BL1'
  },

  ligue1: {
    id: 4334,
    name: 'Ligue 1',
    short: 'FRA',
    fdCode: 'FL1'
  },

  ucl: {
    id: 4480,
    name: 'Champions League',
    short: 'UCL',
    fdCode: 'CL'
  }
};

// ============================================================
// STARTUP VALIDATION
// ============================================================

if (!FOOTBALL_DATA_API_KEY) {
  console.warn(
    '\nWARNING: FOOTBALL_DATA_API_KEY is missing.\n' +
    'Live football-data.org fixtures and standings will not work.\n'
  );
}

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error(
    '\nERROR: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is missing.\n' +
    'Push notifications cannot work without them.\n'
  );
} else {
  webpush.setVapidDetails(
    VAPID_CONTACT_EMAIL,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// ============================================================
// FILE STORAGE
// ============================================================

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
const SCORES_FILE = path.join(__dirname, 'last-scores.json');
const SITE_DATA_FILE = path.join(__dirname, 'site-data.json');

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2)
    );
  } catch (err) {
    console.error(`Could not save ${file}:`, err.message);
  }
}

let subscriptions = loadJSON(
  SUBS_FILE,
  []
);

let lastScores = loadJSON(
  SCORES_FILE,
  {}
);

let siteData = loadJSON(
  SITE_DATA_FILE,
  {
    leagues: {},
    transfers: [],
    lastUpdated: null,
    liveSync: false,
    liveSyncLastSuccess: null,
    apiStatus: 'unknown'
  }
);

// ============================================================
// STATE
// ============================================================

let lastPollTime = null;
let lastLiveSuccess = null;
let lastFixtureRefresh = null;
let lastStandingsRefresh = null;
let lastTransferRefresh = null;

let liveSyncOK = false;
let fixtureSyncOK = false;
let standingsSyncOK = false;

let refreshInProgress = false;
let livePollInProgress = false;

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchKey(home, away) {
  return `${cleanName(home)}__${cleanName(away)}`;
}

function parseScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getStatusLabel(status) {
  const s = String(status || '').toUpperCase();

  if (s === 'IN_PLAY' || s === 'LIVE') return 'live';
  if (s === 'PAUSED') return 'half-time';
  if (s === 'FINISHED') return 'finished';
  if (s === 'POSTPONED') return 'postponed';
  if (s === 'CANCELLED') return 'cancelled';

  return 'scheduled';
}

function getMatchdayNumber(match) {
  const n = Number(match?.matchday);
  return Number.isFinite(n) ? n : null;
}

function isFutureDate(date) {
  const t = new Date(date).getTime();
  return Number.isFinite(t) && t >= Date.now();
}

function isSameTeamPair(aHome, aAway, bHome, bAway) {
  return (
    cleanName(aHome) === cleanName(bHome) &&
    cleanName(aAway) === cleanName(bAway)
  );
}

// ============================================================
// ROUTES
// ============================================================

app.get('/vapid-public-key', (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    publicKey: VAPID_PUBLIC_KEY || null
  });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;

  if (!sub || !sub.endpoint) {
    return res
      .status(400)
      .json({
        error: 'Invalid subscription'
      });
  }

  if (
    !subscriptions.some(
      s => s.endpoint === sub.endpoint
    )
  ) {
    subscriptions.push(sub);

    saveJSON(
      SUBS_FILE,
      subscriptions
    );

    console.log(
      `New subscriber. Total: ${subscriptions.length}`
    );
  }

  res.status(201).json({
    ok: true
  });
});

app.post('/unsubscribe', (req, res) => {
  if (req.body?.endpoint) {
    subscriptions =
      subscriptions.filter(
        s => s.endpoint !== req.body.endpoint
      );

    saveJSON(
      SUBS_FILE,
      subscriptions
    );
  }

  res.json({
    ok: true
  });
});

app.post('/test-notification', async (req, res) => {
  try {
    await notifyAll(
      'Test alert ⚽',
      'If you see this, push notifications are working.'
    );

    res.json({
      ok: true,
      sentTo: subscriptions.length
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// ============================================================
// MAIN DATA ENDPOINT
// ============================================================

app.get('/api/data', (req, res) => {
  res.set({
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });

  res.json({
    ...siteData,

    liveSync: liveSyncOK,

    sync: {
      live: liveSyncOK,
      fixtures: fixtureSyncOK,
      standings: standingsSyncOK
    },

    timestamps: {
      lastPoll: lastPollTime,
      lastLiveSuccess,
      lastFixtureRefresh,
      lastStandingsRefresh,
      lastTransferRefresh
    }
  });
});

// ============================================================
// MANUAL REFRESH
// ============================================================

app.get('/api/refresh-now', async (req, res) => {
  try {
    await refreshFixturesAndStandings();
    await refreshTransferNews();
    await pollLiveScores();

    res.json({
      ok: true,
      lastUpdated: siteData.lastUpdated
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.post('/api/refresh-now', async (req, res) => {
  try {
    await refreshFixturesAndStandings();
    await refreshTransferNews();
    await pollLiveScores();

    res.json({
      ok: true,
      lastUpdated: siteData.lastUpdated
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', async (req, res) => {
  const report = {
    ok: true,

    backend: 'running',

    footballDataKeySet:
      Boolean(FOOTBALL_DATA_API_KEY),

    liveSync: liveSyncOK,

    fixtureSync: fixtureSyncOK,

    standingsSync:
      standingsSyncOK,

    subscribers:
      subscriptions.length,

    timestamps: {
      lastPoll: lastPollTime,
      lastLiveSuccess,
      lastFixtureRefresh,
      lastStandingsRefresh,
      lastTransferRefresh,
      lastDataUpdate:
        siteData.lastUpdated
    },

    footballDataTest: null
  };

  if (!FOOTBALL_DATA_API_KEY) {
    report.footballDataTest = {
      ok: false,
      error: 'FOOTBALL_DATA_API_KEY is not configured'
    };

    return res.json(report);
  }

  try {
    const url =
      'https://api.football-data.org/v4/competitions/PL/standings';

    const response =
      await fetch(url, {
        headers: {
          'X-Auth-Token':
            FOOTBALL_DATA_API_KEY
        }
      });

    const text =
      await response.text();

    report.footballDataTest = {
      ok: response.ok,
      httpStatus: response.status,
      bodyPreview:
        text.slice(0, 300)
    };
  } catch (err) {
    report.footballDataTest = {
      ok: false,
      error: err.message
    };
  }

  res.json(report);
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================

async function notifyAll(title, body) {
  if (
    !VAPID_PUBLIC_KEY ||
    !VAPID_PRIVATE_KEY
  ) {
    return;
  }

  const payload =
    JSON.stringify({
      title,
      body
    });

  const stillValid = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        sub,
        payload
      );

      stillValid.push(sub);
    } catch (err) {
      if (
        err.statusCode !== 410 &&
        err.statusCode !== 404
      ) {
        console.error(
          'Push error:',
          err.statusCode,
          err.body || err.message
        );

        stillValid.push(sub);
      }
    }
  }

  if (
    stillValid.length !==
    subscriptions.length
  ) {
    subscriptions = stillValid;

    saveJSON(
      SUBS_FILE,
      subscriptions
    );
  }
}

// ============================================================
// FOOTBALL-DATA.ORG API
// ============================================================

async function footballDataFetch(
  url
) {
  if (!FOOTBALL_DATA_API_KEY) {
    throw new Error(
      'FOOTBALL_DATA_API_KEY is missing'
    );
  }

  const response =
    await fetch(url, {
      headers: {
        'X-Auth-Token':
          FOOTBALL_DATA_API_KEY,
        Accept:
          'application/json'
      }
    });

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `football-data.org ${response.status}: ${body.slice(
        0,
        200
      )}`
    );
  }

  return response.json();
}

// ============================================================
// FETCH ALL MATCHES FOR A COMPETITION
// ============================================================

async function fetchCompetitionMatches(
  fdCode
) {
  const url =
    `https://api.football-data.org/v4/competitions/${fdCode}/matches`;

  const data =
    await footballDataFetch(url);

  return Array.isArray(data.matches)
    ? data.matches
    : [];
}

// ============================================================
// CONVERT API MATCH
// ============================================================

function convertFDMatch(
  m
) {
  const score =
    m.score || {};

  const fullTime =
    score.fullTime || {};

  const regularTime =
    score.regularTime || {};

  const homeScore =
    fullTime.home ??
    regularTime.home ??
    0;

  const awayScore =
    fullTime.away ??
    regularTime.away ??
    0;

  return {
    id: m.id,

    matchday:
      getMatchdayNumber(m),

    home:
      m.homeTeam?.name || '',

    away:
      m.awayTeam?.name || '',

    homeShort:
      m.homeTeam?.shortName ||
      m.homeTeam?.tla ||
      '',

    awayShort:
      m.awayTeam?.shortName ||
      m.awayTeam?.tla ||
      '',

    hs:
      parseScore(homeScore),

    as:
      parseScore(awayScore),

    start:
      m.utcDate,

    status:
      getStatusLabel(m.status),

    apiStatus:
      m.status || 'SCHEDULED',

    minute:
      score.duration ||
      null,

    minuteDisplay:
      null,

    stage:
      m.stage || null,

    group:
      m.group || null,

    season:
      m.season?.startDate
        ? m.season.startDate.slice(
            0,
            10
          )
        : SEASON,

    lastUpdated:
      m.lastUpdated ||
      null
  };
}

// ============================================================
// SELECT CURRENT MATCHWEEK
// ============================================================

function selectCurrentMatchweek(
  matches
) {
  if (!matches.length) {
    return {
      matchday: null,
      fixtures: []
    };
  }

  const normalized =
    matches
      .map(convertFDMatch)
      .filter(
        m =>
          m.home &&
          m.away &&
          m.start
      );

  if (!normalized.length) {
    return {
      matchday: null,
      fixtures: []
    };
  }

  // Matchdays that contain currently live/paused matches.
  const liveMatchdays =
    normalized
      .filter(
        m =>
          m.status === 'live' ||
          m.status === 'half-time'
      )
      .map(m => m.matchday)
      .filter(Boolean);

  if (liveMatchdays.length) {
    const matchday =
      Math.min(...liveMatchdays);

    return {
      matchday,
      fixtures:
        normalized.filter(
          m =>
            m.matchday === matchday
        )
    };
  }

  // Find the first future matchday.
  const future =
    normalized
      .filter(
        m =>
          m.matchday &&
          isFutureDate(m.start)
      )
      .sort(
        (a, b) =>
          new Date(a.start) -
          new Date(b.start)
      );

  if (future.length) {
    const matchday =
      future[0].matchday;

    return {
      matchday,

      fixtures:
        normalized.filter(
          m =>
            m.matchday === matchday
        )
    };
  }

  // If the season has no future matches,
  // show the latest matchday.
  const completed =
    normalized
      .filter(m => m.matchday)
      .sort(
        (a, b) =>
          new Date(b.start) -
          new Date(a.start)
      );

  const matchday =
    completed.length
      ? completed[0].matchday
      : null;

  return {
    matchday,

    fixtures:
      matchday
        ? normalized.filter(
            m =>
              m.matchday ===
              matchday
          )
        : normalized
  };
}

// ============================================================
// FETCH CURRENT-WEEK FIXTURES
// ============================================================

async function fetchCurrentWeekFixtures(
  fdCode
) {
  const matches =
    await fetchCompetitionMatches(
      fdCode
    );

  const result =
    selectCurrentMatchweek(
      matches
    );

  return {
    matchday:
      result.matchday,

    fixtures:
      result.fixtures
        .sort(
          (a, b) =>
            new Date(a.start) -
            new Date(b.start)
        )
  };
}

// ============================================================
// FETCH STANDINGS
// ============================================================

async function fetchStandingsFD(
  fdCode
) {
  const url =
    `https://api.football-data.org/v4/competitions/${fdCode}/standings`;

  const data =
    await footballDataFetch(url);

  const totalTable =
    (data.standings || [])
      .find(
        s =>
          s.type === 'TOTAL'
      );

  const table =
    totalTable
      ? totalTable.table
      : [];

  return table
    .map(t => ({
      position:
        t.position || null,

      team:
        t.team?.name || '',

      teamShort:
        t.team?.shortName ||
        t.team?.tla ||
        '',

      played:
        t.playedGames || 0,

      w:
        t.won || 0,

      d:
        t.draw || 0,

      l:
        t.lost || 0,

      gf:
        t.goalsFor || 0,

      ga:
        t.goalsAgainst || 0,

      gd:
        t.goalDifference || 0,

      pts:
        t.points || 0
    }))
    .filter(
      t => t.team
    );
}

// ============================================================
// THE SPORTSDb FALLBACK
// ============================================================

async function fetchFallbackFixtures(
  leagueId
) {
  const url =
    `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${leagueId}`;

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `TheSportsDB fixtures ${response.status}`
    );
  }

  const data =
    await response.json();

  const events =
    Array.isArray(data.events)
      ? data.events
      : [];

  return events
    .map(ev => ({
      id:
        ev.idEvent ||
        null,

      home:
        ev.strHomeTeam,

      away:
        ev.strAwayTeam,

      hs:
        parseScore(
          ev.intHomeScore
        ),

      as:
        parseScore(
          ev.intAwayScore
        ),

      start:
        ev.strTimestamp ||
        `${ev.dateEvent}T${
          ev.strTime ||
          '00:00:00'
        }Z`,

      status:
        'scheduled',

      matchday:
        null
    }))
    .filter(
      f =>
        f.home &&
        f.away
    );
}

async function fetchFallbackStandings(
  leagueId
) {
  const url =
    `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${leagueId}&s=${SEASON}`;

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `TheSportsDB standings ${response.status}`
    );
  }

  const data =
    await response.json();

  const table =
    Array.isArray(data.table)
      ? data.table
      : [];

  return table.map(
    (t, index) => ({
      position:
        index + 1,

      team:
        t.strTeam,

      played:
        parseInt(
          t.intPlayed,
          10
        ) || 0,

      w:
        parseInt(
          t.intWin,
          10
        ) || 0,

      d:
        parseInt(
          t.intDraw,
          10
        ) || 0,

      l:
        parseInt(
          t.intLoss,
          10
        ) || 0,

      gf: 0,
      ga: 0,
      gd: 0,

      pts:
        parseInt(
          t.intPoints,
          10
        ) || 0
    })
  );
}

// ============================================================
// REFRESH FIXTURES + STANDINGS
// ============================================================

async function refreshFixturesAndStandings() {
  if (refreshInProgress) {
    console.log(
      'Fixture refresh already running.'
    );

    return;
  }

  refreshInProgress = true;

  let anyFixtureSuccess = false;
  let anyStandingsSuccess = false;

  try {
    for (
      const [key, league]
      of Object.entries(LEAGUES)
    ) {
      
