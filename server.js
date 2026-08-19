// MATCHDAY PUSH — backend for real push notifications + auto-refreshing site data
//
// What this does:
// 1. Lets visitors "subscribe" from the browser (stores a push subscription object)
// 2. Every 45 seconds, checks a live football score feed -> sends push notifications on changes
// 3. Every 30 minutes, refreshes fixtures + standings for 6 leagues
// 4. Every 20 minutes, refreshes a transfer-news feed (filtered from BBC Sport's football RSS)
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

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let subscriptions = loadJSON(SUBS_FILE, []);
let lastScores = loadJSON(SCORES_FILE, {});
let siteData = loadJSON(SITE_DATA_FILE, {
  leagues: {},
  transfers: [],
  lastUpdated: null
});

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
app.get('/api/data', (req, res) => res.json(siteData));

// Manual trigger for testing without waiting for the schedule
app.post('/api/refresh-now', async (req, res) => {
  await refreshFixturesAndStandings();
  await refreshTransferNews();
  res.json({ ok: true, lastUpdated: siteData.lastUpdated });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, subscribers: subscriptions.length, lastPoll: lastPollTime, lastDataRefresh: siteData.lastUpdated });
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

// ---------- LIVE SCORE POLLING (every 45s, drives push notifications) ----------
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

// ---------- FIXTURES + STANDINGS POLLING (every 30 min) ----------

// football-data.org — free tier, no card required, covers EPL/La Liga/Serie A/
// Bundesliga/Ligue 1/Champions League with full, reliable standings and fixtures.
// Get a key at https://www.football-data.org/client/register
async function fetchFixturesFD(fdCode) {
  const url = `https://api.football-data.org/v4/competitions/${fdCode}/matches?status=SCHEDULED`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY } });
  if (!res.ok) throw new Error(`fd fixtures ${res.status}`);
  const data = await res.json();
  const matches = data && data.matches ? data.matches : [];
  return matches.map(m => ({
    home: m.homeTeam && m.homeTeam.name,
    away: m.awayTeam && m.awayTeam.name,
    hs: (m.score && m.score.fullTime && m.score.fullTime.home) || 0,
    as: (m.score && m.score.fullTime && m.score.fullTime.away) || 0,
    start: m.utcDate,
    status: 'scheduled'
  })).filter(f => f.home && f.away);
}

async function fetchStandingsFD(fdCode) {
  const url = `https://api.football-data.org/v4/competitions/${fdCode}/standings`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY } });
  if (!res.ok) throw new Error(`fd standings ${res.status}`);
  const data = await res.json();
  const totalTable = (data.standings || []).find(s => s.type === 'TOTAL');
  const table = totalTable ? totalTable.table : [];
  return table.map(t => ({
    team: t.team && t.team.name,
    w: t.won || 0,
    d: t.draw || 0,
    l: t.lost || 0,
    pts: t.points || 0
  })).filter(t => t.team);
}

// TheSportsDB — used as a fallback if football-data.org is unavailable.
async function fetchFixtures(leagueId) {
  const url = `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${leagueId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fixtures ${res.status}`);
  const data = await res.json();
  const events = data && data.events ? data.events : [];
  return events.map(ev => ({
    home: ev.strHomeTeam,
    away: ev.strAwayTeam,
    hs: parseInt(ev.intHomeScore, 10) || 0,
    as: parseInt(ev.intAwayScore, 10) || 0,
    start: ev.strTimestamp || `${ev.dateEvent}T${ev.strTime || '00:00:00'}Z`,
    status: 'scheduled'
  })).filter(f => f.home && f.away);
}

async function fetchStandings(leagueId) {
  const url = `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${leagueId}&s=${SEASON}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`standings ${res.status}`);
  const data = await res.json();
  const table = data && data.table ? data.table : [];
  return table.map(t => ({
    team: t.strTeam,
    w: parseInt(t.intWin, 10) || 0,
    d: parseInt(t.intDraw, 10) || 0,
    l: parseInt(t.intLoss, 10) || 0,
    pts: parseInt(t.intPoints, 10) || 0
  })).filter(t => t.team);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function refreshFixturesAndStandings() {
  for (const [key, league] of Object.entries(LEAGUES)) {
    const useFD = FOOTBALL_DATA_API_KEY && league.fdCode;

    try {
      const fixtures = useFD
        ? await fetchFixturesFD(league.fdCode)
        : await fetchFixtures(league.id);
      // Only overwrite if we actually got something back — never wipe good data with an empty response
      if (fixtures.length > 0) {
        siteData.leagues[key] = siteData.leagues[key] || {};
        siteData.leagues[key].name = league.name;
        siteData.leagues[key].short = league.short;
        siteData.leagues[key].fixtures = fixtures;
      }
    } catch (err) {
      console.error(`Fixtures refresh failed for ${league.name}:`, err.message);
      // If football-data.org failed (e.g. rate limit), try the fallback source once.
      if (useFD) {
        try {
          const fixtures = await fetchFixtures(league.id);
          if (fixtures.length > 0) {
            siteData.leagues[key] = siteData.leagues[key] || {};
            siteData.leagues[key].fixtures = fixtures;
          }
        } catch (err2) { /* keep last known good data */ }
      }
    }

    try {
      const standings = useFD
        ? await fetchStandingsFD(league.fdCode)
        : await fetchStandings(league.id);
      if (standings.length > 0) {
        siteData.leagues[key] = siteData.leagues[key] || {};
        siteData.leagues[key].standings = standings;
      }
    } catch (err) {
      console.error(`Standings refresh failed for ${league.name}:`, err.message);
      if (useFD) {
        try {
          const standings = await fetchStandings(league.id);
          if (standings.length > 0) {
            siteData.leagues[key] = siteData.leagues[key] || {};
            siteData.leagues[key].standings = standings;
          }
        } catch (err2) { /* keep last known good data */ }
      }
    }

    // football-data.org's free tier allows 10 requests/minute — pace ourselves
    // since we make up to 2 calls per league across 6 leagues.
    if (useFD) await sleep(6500);
  }
  siteData.lastUpdated = new Date().toISOString();
  saveJSON(SITE_DATA_FILE, siteData);
  console.log(`Fixtures/standings refreshed at ${siteData.lastUpdated}`);
}

// ---------- TRANSFER NEWS POLLING (every 20 min) ----------
// Pulls BBC Sport's football RSS feed and keeps only headlines that look like transfer news.
// This is a free, keyless approach — for guaranteed structured transfer data, a paid
// football data API would be more precise, but this keeps things genuinely automatic and free.
const TRANSFER_KEYWORDS = /\b(sign|signs|signing|transfer|joins|joining|loan|deal|move|completes move|agree(s)? (a )?deal)\b/i;

async function refreshTransferNews() {
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
      siteData.lastUpdated = new Date().toISOString();
      saveJSON(SITE_DATA_FILE, siteData);
      console.log(`Transfer news refreshed: ${transferItems.length} items`);
    }
  } catch (err) {
    console.error('Transfer news refresh failed:', err.message);
  }
}

// ---------- SCHEDULES ----------
cron.schedule('*/45 * * * * *', pollLiveScores);          // every 45 seconds
cron.schedule('*/30 * * * *', refreshFixturesAndStandings); // every 30 minutes
cron.schedule('*/20 * * * *', refreshTransferNews);          // every 20 minutes

// Run everything once at startup too, so data isn't empty while waiting for the first schedule tick
pollLiveScores();
refreshFixturesAndStandings();
refreshTransferNews();

app.listen(PORT, () => {
  console.log(`Matchday push server running on port ${PORT}`);
});
