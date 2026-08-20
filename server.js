// MATCHDAY PUSH — backend for real push notifications + auto-refreshing site data
//
// What this does:
// 1. Lets visitors "subscribe" from the browser (stores a push subscription object)
// 2. Every 30 seconds, checks a live football score feed -> sends push notifications on changes
// 3. Every minute, refreshes fixtures; standings refresh every 5 minutes
// 4. Every 5 minutes, refreshes a transfer-news feed (filtered from BBC Sport's football RSS)
// 5. Serves everything from GET /api/data, which the frontend polls to auto-update
//
// You need to deploy this somewhere that stays running 24/7 (see README.md).

const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- CONFIG ----------
const PORT = process.env.PORT || 3000;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:you@example.com';
const LIVE_FEED_URL = 'https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer';

// TheSportsDB league IDs (free tier, used as fallback if football-data.org fails).
const LEAGUES = {
  epl:        { id: 4328, name: 'Premier League', short: 'EPL', fdCode: 'PL' },
  laliga:     { id: 4335, name: 'La Liga',         short: 'ESP', fdCode: 'PD' },
  seriea:     { id: 4332, name: 'Serie A',         short: 'ITA', fdCode: 'SA' },
  bundesliga: { id: 4331, name: 'Bundesliga',      short: 'GER', fdCode: 'BL1' },
  ligue1:     { id: 4334, name: 'Ligue 1',         short: 'FRA', fdCode: 'FL1' },
  ucl:        { id: 4480, name: 'Champions League', short: 'UCL', fdCode: 'CL' }
};
const SEASON = process.env.SEASON || '2026-2027'; // MLS uses a single-year format; see fetchStandings()
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY || '';
if (!FOOTBALL_DATA_API_KEY) {
  console.warn(
    '\nNo FOOTBALL_DATA_API_KEY set — standings/fixtures for EPL, La Liga, Serie A, ' +
    'Bundesliga and Ligue 1 will fall back to TheSportsDB (which may return partial data). ' +
    'Get a free key at https://www.football-data.org/client/register and set it as a ' +
    'Railway variable for full, reliable data.\n'
  );
}

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error(
    '\nMissing VAPID keys. Generate them with:\n  npx web-push generate-vapid-keys\n' +
    'Then set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY as environment variables.\n'
  );
  process.exit(1);
}

webpush.setVapidDetails(VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ---------- SIMPLE FILE-BASED STORAGE ----------
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
const SCORES_FILE = path.join(__dirname, 'last-scores.json');
const SITE_DATA_FILE = path.join(__dirname, 'site-data.json');

// Refresh policy: live scores stay below one minute; fixtures refresh every minute;
// standings and transfer news refresh every five minutes. The football-data.org free
// tier is limited to 10 requests/minute, so we do NOT make 12 league requests every
// minute. Six fixture requests/minute + staggered standings requests stay within the
// limit while keeping fixtures fresh.
const LIVE_SCORE_INTERVAL_MS = 30 * 1000;
const FIXTURES_INTERVAL_MS = 60 * 1000;
const STANDINGS_INTERVAL_MS = 5 * 60 * 1000;
const TRANSFERS_INTERVAL_MS = 5 * 60 * 1000;

const EXPECTED_TABLE_SIZES = {
  epl: 20,
  laliga: 20,
  seriea: 20,
  bundesliga: 18,
  ligue1: 18,
  ucl: 36
};

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let subscriptions = loadJSON(SUBS_FILE, []);
let lastScores = loadJSON(SCORES_FILE, {});
let siteData = loadJSON(SITE_DATA_FILE, {
  leagues: {},
  transfers: [],
  lastUpdated: null,
  fixturesLastUpdated: null,
  standingsLastUpdated: null,
  transfersLastUpdated: null,
  staleLeagues: [],
  expectedTableSizes: EXPECTED_TABLE_SIZES
});
siteData.expectedTableSizes = EXPECTED_TABLE_SIZES;

// ---------- ROUTES ----------
app.get('/vapid-public-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY }));

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  if (!subscriptions.some(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    saveJSON(SUBS_FILE, subscriptions);
    console.log(`New subscriber. Total: ${subscriptions.length}`);
  }
  res.status(201).json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  subscriptions = subscriptions.filter(s => s.endpoint !== req.body.endpoint);
  saveJSON(SUBS_FILE, subscriptions);
  res.json({ ok: true });
});

app.post('/test-notification', async (req, res) => {
  await notifyAll('Test alert ⚽', 'If you see this, push notifications are working.');
  res.json({ ok: true, sentTo: subscriptions.length });
});

// The frontend polls this to auto-refresh fixtures, standings, and transfer news
app.get('/api/data', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json({
    ...siteData,
    serverTime: new Date().toISOString(),
    refreshIntervals: {
      liveScoresSeconds: LIVE_SCORE_INTERVAL_MS / 1000,
      fixturesSeconds: FIXTURES_INTERVAL_MS / 1000,
      standingsSeconds: STANDINGS_INTERVAL_MS / 1000,
      transfersSeconds: TRANSFERS_INTERVAL_MS / 1000
    }
  });
});

// Secure proxy for match stats/lineups. The API-Football key lives ONLY here,
// server-side — never in the browser — so it can't be scraped from page source.
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const API_FOOTBALL_LEAGUE_IDS = { epl: 39, laliga: 140, seriea: 135, bundesliga: 78, ligue1: 61, ucl: 2 };
const matchStatsCache = {};
const MATCH_DETAIL_CACHE_TTL_MS = 60 * 1000;
let fixturesRefreshRunning = false;
let standingsRefreshRunning = false;
let transferRefreshRunning = false;

app.get('/api/match-detail', async (req, res) => {
  if (!API_FOOTBALL_KEY) return res.json({ error: 'not_configured' });
  const { leagueKey, home, away, start } = req.query;
  const leagueId = API_FOOTBALL_LEAGUE_IDS[leagueKey];
  if (!leagueId || !home || !away || !start) return res.status(400).json({ error: 'missing_params' });

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const cacheKey = `${leagueKey}|${home}|${away}|${start}`;
  const cached = matchStatsCache[cacheKey];
  if (cached && Date.now() - cached.cachedAt < MATCH_DETAIL_CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const dateStr = start.slice(0, 10);
    const season = new Date(start).getMonth() >= 6 ? new Date(start).getFullYear() : new Date(start).getFullYear() - 1;
    const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
    const findRes = await fetch(`${API_FOOTBALL_BASE}/fixtures?league=${leagueId}&season=${season}&date=${dateStr}`, { headers });
    const findData = await findRes.json();
    const norm = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
    const match = (findData.response || []).find(m =>
      norm(m.teams.home.name) === norm(home) && norm(m.teams.away.name) === norm(away)
    );
    if (!match) {
      const notFound = { stats: [], lineups: [], fixture: null, updatedAt: new Date().toISOString(), error: 'fixture_not_found' };
      return res.json(notFound);
    }

    const fixtureId = match.fixture.id;
    const [statsRes, lineupsRes, playersRes] = await Promise.all([
      fetch(`${API_FOOTBALL_BASE}/fixtures/statistics?fixture=${fixtureId}`, { headers }),
      fetch(`${API_FOOTBALL_BASE}/fixtures/lineups?fixture=${fixtureId}`, { headers }),
      fetch(`${API_FOOTBALL_BASE}/fixtures/players?fixture=${fixtureId}`, { headers })
    ]);
    const statsData = statsRes.ok ? await statsRes.json() : { response: [] };
    const lineupsData = lineupsRes.ok ? await lineupsRes.json() : { response: [] };
    const playersData = playersRes.ok ? await playersRes.json() : { response: [] };
    const result = {
      fixture: {
        id: fixtureId,
        status: match.fixture.status || null,
        teams: match.teams || null
      },
      stats: statsData.response || [],
      lineups: lineupsData.response || [],
      players: playersData.response || [],
      updatedAt: new Date().toISOString()
    };
    matchStatsCache[cacheKey] = { data: result, cachedAt: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('Match detail proxy failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Manual trigger for testing without waiting for the schedule
app.post('/api/refresh-now', async (req, res) => {
  await refreshFixturesAndStandings();
  await refreshTransferNews();
  res.json({ ok: true, lastUpdated: siteData.lastUpdated });
});

// Same as above, but reachable by just visiting the URL in a browser (GET) —
// handy for debugging from a phone with no way to send a POST request.
app.get('/api/refresh-now', async (req, res) => {
  await refreshFixturesAndStandings();
  await refreshTransferNews();
  res.json({ ok: true, lastUpdated: siteData.lastUpdated });
});

// Visit /health in a browser to see live diagnostics, including whether
// football-data.org calls are succeeding.
app.get('/health', async (req, res) => {
  const report = {
    ok: true,
    buildMarker: 'debug-merge-v1',
    subscribers: subscriptions.length,
    lastPoll: lastPollTime,
    lastDataRefresh: siteData.lastUpdated,
    footballDataKeySet: Boolean(FOOTBALL_DATA_API_KEY),
    footballDataKeyPreview: FOOTBALL_DATA_API_KEY ? `${FOOTBALL_DATA_API_KEY.slice(0, 6)}...` : null,
    testCall: null
  };
  try {
    const url = 'https://api.football-data.org/v4/competitions/PL/standings';
    const r = await fetch(url, { headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY } });
    const body = await r.text();
    report.testCall = {
      url,
      httpStatus: r.status,
      ok: r.ok,
      bodyPreview: body.slice(0, 300)
    };
  } catch (err) {
    report.testCall = { error: err.message };
  }
  res.json(report);
});

// ---------- PUSH SENDING ----------
async function notifyAll(title, body) {
  const payload = JSON.stringify({ title, body });
  const stillValid = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      stillValid.push(sub);
    } catch (err) {
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        console.error('Push error:', err.statusCode, err.body);
        stillValid.push(sub);
      }
    }
  }
  if (stillValid.length !== subscriptions.length) {
    subscriptions = stillValid;
    saveJSON(SUBS_FILE, subscriptions);
  }
}

// ---------- LIVE SCORE POLLING (every 30s, drives push notifications) ----------
let lastPollTime = null;

async function pollLiveScores() {
  lastPollTime = new Date().toISOString();
  try {
    const res = await fetch(LIVE_FEED_URL);
    if (!res.ok) throw new Error(`Feed responded ${res.status}`);
    const data = await res.json();
    const events = data && data.events ? data.events : [];

    for (const ev of events) {
      const home = ev.strHomeTeam, away = ev.strAwayTeam;
      const hs = parseInt(ev.intHomeScore, 10), as = parseInt(ev.intAwayScore, 10);
      if (!home || !away || isNaN(hs) || isNaN(as)) continue;

      const key = `${home} vs ${away}`;
      const prev = lastScores[key];
      if (!prev) { lastScores[key] = { hs, as }; continue; }

      if (prev.hs !== hs || prev.as !== as) {
        lastScores[key] = { hs, as };
        console.log(`Score change: ${key} now ${hs}-${as}`);
        await notifyAll(`⚽ ${home} ${hs}–${as} ${away}`, `${ev.strLeague || 'Live match'} · score just updated`);
      }
    }
    saveJSON(SCORES_FILE, lastScores);
  } catch (err) {
    console.error('Live score poll failed:', err.message);
  }
}

// ---------- FIXTURES + STANDINGS POLLING ----------

function validateStandings(key, standings) {
  const expected = EXPECTED_TABLE_SIZES[key];
  if (!expected) return standings.length > 0;

  // UCL 2026/27 has 36 clubs in the league phase, but the draw is not until
  // 27 August 2026. Before the league phase exists, an empty table is valid.
  if (key === 'ucl' && standings.length === 0) return true;

  if (standings.length !== expected) {
    console.warn(`Rejected ${key} standings: received ${standings.length}, expected ${expected}`);
    return false;
  }
  return true;
}

async function refreshFixturesOnly() {
  if (fixturesRefreshRunning) return;
  fixturesRefreshRunning = true;
  try {
    const staleLeagues = new Set(siteData.staleLeagues || []);

  // Six fixture requests per minute are safe under the football-data.org free
  // 10 requests/minute limit. Fetch them concurrently so one slow league does
  // not delay all the others.
  await Promise.all(Object.entries(LEAGUES).map(async ([key, league]) => {
    const useFD = FOOTBALL_DATA_API_KEY && league.fdCode;
    let fresh = false;

    try {
      const fixtures = useFD
        ? await fetchFixturesFD(league.fdCode)
        : await fetchFixtures(league.id);
      if (fixtures.length > 0) {
        siteData.leagues[key] = siteData.leagues[key] || {};
        siteData.leagues[key].name = league.name;
        siteData.leagues[key].short = league.short;
        siteData.leagues[key].fixtures = fixtures;
        fresh = true;
      }
    } catch (err) {
      console.error(`Fixtures refresh failed for ${league.name}:`, err.message);
      if (useFD) {
        try {
          const fixtures = await fetchFixtures(league.id);
          if (fixtures.length > 0) {
            siteData.leagues[key] = siteData.leagues[key] || {};
            siteData.leagues[key].name = league.name;
            siteData.leagues[key].short = league.short;
            siteData.leagues[key].fixtures = fixtures;
            fresh = true;
          }
        } catch (err2) {
          console.error(`Fallback fixtures failed for ${league.name}:`, err2.message);
        }
      }
    }

    if (fresh) staleLeagues.delete(key);
    else staleLeagues.add(key);
  }));

  siteData.staleLeagues = [...staleLeagues];
  siteData.fixturesLastUpdated = new Date().toISOString();
  siteData.lastUpdated = siteData.fixturesLastUpdated;
  siteData.expectedTableSizes = EXPECTED_TABLE_SIZES;
    saveJSON(SITE_DATA_FILE, siteData);
    console.log(`Fixtures refreshed at ${siteData.fixturesLastUpdated}`);
  } finally {
    fixturesRefreshRunning = false;
  }
}

async function refreshStandingsOnly() {
  if (standingsRefreshRunning) return;
  standingsRefreshRunning = true;
  try {
    const staleLeagues = new Set(siteData.staleLeagues || []);

  // Six standings requests every five minutes = well below the free API's
  // 10 requests/minute limit. This prevents rate-limit failures while still
  // keeping the tables current.
  for (const [key, league] of Object.entries(LEAGUES)) {
    const useFD = FOOTBALL_DATA_API_KEY && league.fdCode;
    let fresh = false;

    try {
      const standings = useFD
        ? await fetchStandingsFD(league.fdCode)
        : await fetchStandings(league.id);
      if (validateStandings(key, standings)) {
        if (standings.length > 0) {
          siteData.leagues[key] = siteData.leagues[key] || {};
          siteData.leagues[key].name = league.name;
          siteData.leagues[key].short = league.short;
          siteData.leagues[key].standings = standings;
        }
        fresh = standings.length > 0 || key === 'ucl';
      }
    } catch (err) {
      console.error(`Standings refresh failed for ${league.name}:`, err.message);
      if (useFD) {
        try {
          const standings = await fetchStandings(league.id);
          if (validateStandings(key, standings) && standings.length > 0) {
            siteData.leagues[key] = siteData.leagues[key] || {};
            siteData.leagues[key].name = league.name;
            siteData.leagues[key].short = league.short;
            siteData.leagues[key].standings = standings;
            fresh = true;
          }
        } catch (err2) {
          console.error(`Fallback standings failed for ${league.name}:`, err2.message);
        }
      }
    }

    if (fresh) staleLeagues.delete(key);
    else staleLeagues.add(key);
  }

  siteData.staleLeagues = [...staleLeagues];
  siteData.standingsLastUpdated = new Date().toISOString();
  siteData.lastUpdated = siteData.standingsLastUpdated;
  siteData.expectedTableSizes = EXPECTED_TABLE_SIZES;
    saveJSON(SITE_DATA_FILE, siteData);
    console.log(`Standings refreshed at ${siteData.standingsLastUpdated}`);
  } finally {
    standingsRefreshRunning = false;
  }
}

async function refreshFixturesAndStandings() {
  await refreshFixturesOnly();
  await refreshStandingsOnly();
}

// ---------- TRANSFER NEWS POLLING (every 20 min) ----------
// Pulls BBC Sport's football RSS feed and keeps only headlines that look like transfer news.
// This is a free, keyless approach — for guaranteed structured transfer data, a paid
// football data API would be more precise, but this keeps things genuinely automatic and free.
const TRANSFER_KEYWORDS = /\b(sign|signs|signing|transfer|joins|joining|loan|deal|move|completes move|agree(s)? (a )?deal)\b/i;

async function refreshTransferNews() {
  if (transferRefreshRunning) return;
  transferRefreshRunning = true;
  try {
    const res = await fetch('https://feeds.bbci.co.uk/sport/football/rss.xml');
    if (!res.ok) throw new Error(`RSS ${res.status}`);
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
    const parsed = items.map(item => {
      const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const desc = (item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
      const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const clean = s => s.replace('<![CDATA[', '').replace(']]>', '').trim();
      return { title: clean(title), body: clean(desc), link: clean(link) };
    });

    const transferItems = parsed
      .filter(item => TRANSFER_KEYWORDS.test(item.title))
      .slice(0, 12)
      .map(item => ({
        league: 'Football', // BBC's general feed doesn't tag league — shown generically
        tag: 'news',
        headline: item.title,
        body: item.body,
        link: item.link
      }));

    if (transferItems.length > 0) {
      siteData.transfers = transferItems;
      siteData.transfersLastUpdated = new Date().toISOString();
      siteData.lastUpdated = siteData.transfersLastUpdated;
      saveJSON(SITE_DATA_FILE, siteData);
      console.log(`Transfer news refreshed: ${transferItems.length} items`);
    }
  } catch (err) {
    console.error('Transfer news refresh failed:', err.message);
  } finally {
    transferRefreshRunning = false;
  }
}

// ---------- SCHEDULES ----------
// Live scores: every 30 seconds (always under one minute).
cron.schedule('*/30 * * * * *', pollLiveScores);
// Fixtures: every minute.
cron.schedule('*/1 * * * *', refreshFixturesOnly);
// Standings: every five minutes to respect the football-data.org free API limit.
cron.schedule('*/5 * * * *', refreshStandingsOnly);
// Transfer/news feed: every five minutes.
cron.schedule('*/5 * * * *', refreshTransferNews);

// Run everything once at startup too, so data is not empty while waiting for a tick.
(async () => {
  await Promise.allSettled([
    pollLiveScores(),
    refreshFixturesOnly(),
    refreshStandingsOnly(),
    refreshTransferNews()
  ]);
})();

app.listen(PORT, () => {
  console.log(`Matchday push server running on port ${PORT}`);
});
