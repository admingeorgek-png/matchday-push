// ===== Imports =====
const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let compression;
try {
  compression = require('compression');
} catch {
  compression = null;
}

// ===== App setup =====
const app = express();
app.use(cors());
if (compression) app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// ===== Service worker (served directly so it can never go missing from the repo) =====
const SW_JS = `self.addEventListener('push',e=>{let d={title:'MATCHDAY PUSH',body:'Live match update'};try{d=JSON.parse(e.data.text())}catch{}e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAACGklEQVR4nO3TMQHAIADAsLGHGwX4VwkyOJoo6NMx1z4fRP2vA+AlA5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYg7QJ3IQK2JZYKuQAAAABJRU5ErkJggg==',badge:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAACGklEQVR4nO3TMQHAIADAsLGHGwX4VwkyOJoo6NMx1z4fRP2vA+AlA5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYg7QJ3IQK2JZYKuQAAAABJRU5ErkJggg==',data:{url:'/'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus'in c){c.focus();return c}}return clients.openWindow(e.notification.data?.url||'/')}))});`;

app.get('/sw.js', (q, r) => {
  r.set('Content-Type', 'application/javascript; charset=utf-8');
  r.set('Service-Worker-Allowed', '/');
  r.set('Cache-Control', 'no-cache');
  r.send(SW_JS);
});

// ===== Config / env vars =====
const PORT = process.env.PORT || 3000;
const FD = (process.env.FOOTBALL_DATA_API_KEY || '').trim();
const AF = (process.env.API_FOOTBALL_KEY || '').trim();
const HL = (process.env.HIGHLIGHTLY_API_KEY || '').trim();
const VP = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VR = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VE = (process.env.VAPID_CONTACT_EMAIL || 'mailto:you@example.com').trim();

// [key]: [full name, short code, football-data.org code, expected table size, api-football league id]
const L = {
  epl: ['Premier League', 'EPL', 'PL', 20, 39],
  laliga: ['La Liga', 'ESP', 'PD', 20, 140],
  seriea: ['Serie A', 'ITA', 'SA', 20, 135],
  bundesliga: ['Bundesliga', 'GER', 'BL1', 18, 78],
  ligue1: ['Ligue 1', 'FRA', 'FL1', 18, 61],
  ucl: ['Champions League', 'UCL', 'CL', 36, 2],
};

// ===== Simple JSON-file storage =====
const DATA = path.join(__dirname, 'site-data.json');
const SUB = path.join(__dirname, 'subscriptions.json');
const SCO = path.join(__dirname, 'last-scores.json');
const USR = path.join(__dirname, 'users.json');

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function write(file, value) {
  try {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}

let data = read(DATA, { leagues: {}, transfers: [], staleLeagues: Object.keys(L) });
let subs = read(SUB, []);
let scores = read(SCO, {});
let users = read(USR, {});
let lastPoll = null;
let busy = 0;

// ===== Auth helpers =====
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function findUserByToken(token) {
  for (const email in users) {
    if (users[email].token === token) return { email, ...users[email] };
  }
  return null;
}

// ===== Push notifications setup (never crashes the whole app if keys are bad) =====
let pushEnabled = false;
if (!VP || !VR) {
  console.error('Missing VAPID keys — push notifications disabled, rest of the app will still run.');
} else {
  try {
    webpush.setVapidDetails(VE, VP, VR);
    pushEnabled = true;
  } catch (e) {
    console.error(
      'Invalid VAPID keys (check for extra whitespace/newlines when pasting into Render) — push notifications disabled, rest of the app will still run:',
      e.message
    );
  }
}

// ===== Generic fetch-JSON helper =====
async function json(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const t = await r.text();
  let b;
  try {
    b = JSON.parse(t);
  } catch {
    // leave b undefined; caller decides what to do
  }
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 160)}`);
  return b;
}

// ===== Data mappers (football-data.org shapes -> our shapes) =====
const team = (t) => ({
  id: t?.id ?? null,
  name: t?.name || 'Unknown',
  shortName: t?.shortName || t?.tla || t?.name || '',
  logo: t?.crest || t?.logo || '',
});

const match = (m) => {
  const f = m.score?.fullTime || {};
  const h = m.score?.halfTime || {};
  return {
    id: m.id,
    date: m.utcDate,
    utcDate: m.utcDate,
    status: m.status,
    statusShort: m.status,
    homeTeam: team(m.homeTeam),
    awayTeam: team(m.awayTeam),
    homeScore: f.home ?? null,
    awayScore: f.away ?? null,
    halftimeHome: h.home ?? null,
    halftimeAway: h.away ?? null,
    competition: m.competition?.name || '',
    matchday: m.matchday ?? null,
    venue: m.venue || '',
  };
};

const row = (r) => ({
  position: r.position,
  team: team(r.team),
  played: r.playedGames || 0,
  won: r.won || 0,
  draw: r.draw || 0,
  lost: r.lost || 0,
  goalsFor: r.goalsFor || 0,
  goalsAgainst: r.goalsAgainst || 0,
  goalDifference: r.goalDifference || 0,
  points: r.points || 0,
});

const day = (d) => d.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ===== Throttled football-data.org fetcher (keeps us under the 10 req/min free-tier limit) =====
let fdQueue = Promise.resolve();
let fdLastCall = 0;

function fdThrottled(url, opts = {}) {
  const run = fdQueue.then(async () => {
    const wait = Math.max(0, fdLastCall + 6500 - Date.now());
    if (wait > 0) await sleep(wait);
    fdLastCall = Date.now();
    return json(url, { ...opts, headers: { 'X-Auth-Token': FD, ...(opts.headers || {}) } });
  });
  fdQueue = run.catch(() => {});
  return run;
}

const codeToKey = Object.fromEntries(Object.entries(L).map(([k, v]) => [v[2], k]));

async function fixtures(k) {
  const code = L[k][2];
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 3);
  const to = new Date(now);
  to.setDate(to.getDate() + 60);
  const x = await fdThrottled(
    `https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${day(from)}&dateTo=${day(to)}`
  );
  return (x.matches || []).map(match).sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function standings(k) {
  const x = await fdThrottled(`https://api.football-data.org/v4/competitions/${L[k][2]}/standings`);
  return ((x.standings || []).find((s) => s.type === 'TOTAL')?.table || x.standings?.[0]?.table || []).map(row);
}

async function refresh() {
  const stale = new Set(Object.keys(L));
  for (const k in L) {
    try {
      const f = await fixtures(k);
      const s = await standings(k);
      data.leagues[k] = { name: L[k][0], short: L[k][1], fixtures: f, standings: s };
      if (f.length && ((k === 'ucl' && s.length === 36) || s.length === L[k][3])) stale.delete(k);
    } catch (e) {
      console.error(k, e.message);
    }
  }
  data.staleLeagues = [...stale];
  data.lastUpdated = new Date().toISOString();
  data.fixturesLastUpdated = data.lastUpdated;
  data.standingsLastUpdated = data.lastUpdated;
  write(DATA, data);
}

const TRN = path.join(__dirname, 'seen-transfers.json');
let seenTransfers = read(TRN, null); // null = first run, don't notify on startup backlog
const CURRENTS_KEY = (process.env.CURRENTS_API_KEY || '').trim();

async function news() {
  try {
    if (!CURRENTS_KEY) {
      console.error('CURRENTS_API_KEY not set — transfer news will stay empty until it is added.');
      return;
    }
    const keywords = encodeURIComponent('football transfer');
    const url = `https://api.currentsapi.services/v1/search?keywords=${keywords}&language=en&page_size=50&apiKey=${CURRENTS_KEY}`;
    const res = await json(url);
    const transferPattern = /transfer|sign(s|ed|ing)?|deal|loan|move|joins?|medical|contract|here we go|negotiat|advanced talks|in talks|agree(s|d|ment)?|bid|fee|unveil|announce|official|confirm|target|linked|swoop|swap/i;
    const arr = (res.news || [])
      .map((a, i) => ({
        id: a.id || i,
        headline: a.title || '',
        body: a.description || '',
        link: a.url || '',
        image: a.image && a.image !== 'None' ? a.image : null,
        source: a.author || '',
        published: a.published || null,
      }))
      .filter((a) => a.headline && transferPattern.test(a.headline))
      .slice(0, 50);

    const isFirstRun = seenTransfers === null;
    const seenSet = new Set(seenTransfers || []);
    const fresh = arr.filter((a) => a.link && !seenSet.has(a.link));

    if (pushEnabled && !isFirstRun) {
      for (const item of fresh.slice(0, 5)) {
        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              sub,
              JSON.stringify({ title: '📰 Transfer News', body: item.headline })
            );
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
              subs = subs.filter((s) => s.endpoint !== sub.endpoint);
              write(SUB, subs);
            }
          }
        }
      }
    }
    seenTransfers = arr.map((a) => a.link).filter(Boolean);
    write(TRN, seenTransfers);

    data.transfers = arr;
    data.transfersLastUpdated = new Date().toISOString();
    data.lastUpdated = data.transfersLastUpdated;
    write(DATA, data);
  } catch (e) {
    console.error('news', e.message);
  }
}

async function live() {
  lastPoll = new Date().toISOString();
  try {
    const x = await fdThrottled(`https://api.football-data.org/v4/matches?status=LIVE`);
    const liveStatuses = ['IN_PLAY', 'PAUSED', 'LIVE', 'HALFTIME', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'];
    for (const m of x.matches || []) {
      const k = codeToKey[m.competition?.code];
      if (!k) continue;
      const f = match(m);
      if (!liveStatuses.includes(String(f.status).toUpperCase()) || f.homeScore == null || f.awayScore == null) continue;
      const q = k + ':' + f.id;
      const prev = scores[q] || { home: 0, away: 0 };
      if (pushEnabled && (prev.home !== f.homeScore || prev.away !== f.awayScore)) {
        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              sub,
              JSON.stringify({
                title: `⚽ ${f.homeTeam.name} ${f.homeScore}–${f.awayScore} ${f.awayTeam.name}`,
                body: L[k][0] + ' · live score update',
              })
            );
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
              subs = subs.filter((s) => s.endpoint !== sub.endpoint);
              write(SUB, subs);
            }
          }
        }
      }
      scores[q] = { home: f.homeScore, away: f.awayScore };
    }
  } catch (e) {
    console.error('live', e.message);
  }
  write(SCO, scores);
}

// ===== Core routes =====
app.get('/health', (q, r) => {
  r.json({
    ok: true,
    buildMarker: 'matchday-backend-v3',
    subscribers: subs.length,
    lastPoll,
    lastDataRefresh: data.lastUpdated,
    footballDataKeySet: !!FD,
    apiFootballKeySet: !!AF,
    highlightlyKeySet: !!HL,
    currentsKeySet: !!CURRENTS_KEY,
    currentsKeySet: !!CURRENTS_KEY,
    leaguesLoaded: Object.keys(data.leagues || {}).length,
    staleLeagues: data.staleLeagues || [],
  });
});

app.get('/api/data', (q, r) => {
  r.set('Cache-Control', 'no-store').json({
    ...data,
    serverTime: new Date().toISOString(),
    expectedTableSizes: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v[3]])),
    refreshIntervals: { liveScoresSeconds: 30, fixturesSeconds: 300, standingsSeconds: 300, transfersSeconds: 300 },
  });
});

async function handleRefreshNow(q, r) {
  if (!busy) {
    busy = 1;
    await refresh();
    await news();
    busy = 0;
  }
  r.json({ ok: true, staleLeagues: data.staleLeagues, lastUpdated: data.lastUpdated });
}
app.get('/api/refresh-now', handleRefreshNow);
app.post('/api/refresh-now', handleRefreshNow);

app.get('/vapid-public-key', (q, r) =>
  pushEnabled ? r.json({ publicKey: VP }) : r.status(503).json({ error: 'Push notifications are not configured on the server yet.' })
);
app.post('/subscribe', (q, r) => {
  if (!q.body?.endpoint) return r.status(400).json({ error: 'Invalid subscription' });
  if (!subs.some((x) => x.endpoint === q.body.endpoint)) subs.push(q.body);
  write(SUB, subs);
  r.status(201).json({ ok: true });
});
app.post('/unsubscribe', (q, r) => {
  subs = subs.filter((x) => x.endpoint !== q.body?.endpoint);
  write(SUB, subs);
  r.json({ ok: true });
});

// ===== Auth routes =====
app.post('/api/signup', (q, r) => {
  const { email, password } = q.body || {};
  if (!email || !password) return r.status(400).json({ error: 'Email and password are required.' });
  const key = String(email).toLowerCase().trim();
  if (users[key]) return r.status(409).json({ error: 'An account with this email already exists.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const token = crypto.randomBytes(24).toString('hex');
  const createdAt = new Date().toISOString();
  users[key] = { salt, passwordHash: hash(password, salt), token, createdAt, teams: [] };
  write(USR, users);
  r.status(201).json({ ok: true, token, email: key, createdAt });
});

app.post('/api/login', (q, r) => {
  const { email, password } = q.body || {};
  const key = String(email || '').toLowerCase().trim();
  const u = users[key];
  if (!u || hash(password || '', u.salt) !== u.passwordHash) return r.status(401).json({ error: 'Incorrect email or password.' });
  const token = crypto.randomBytes(24).toString('hex');
  u.token = token;
  write(USR, users);
  r.json({ ok: true, token, email: key, createdAt: u.createdAt });
});

app.get('/api/user/me', (q, r) => {
  const u = findUserByToken(q.query.token);
  if (!u) return r.status(401).json({ error: 'Not signed in.' });
  r.json({ email: u.email, createdAt: u.createdAt, teams: u.teams || [] });
});

app.post('/api/user/teams', (q, r) => {
  const { token, teams } = q.body || {};
  const u = findUserByToken(token);
  if (!u) return r.status(401).json({ error: 'Not signed in.' });
  users[u.email].teams = Array.isArray(teams) ? teams : [];
  write(USR, users);
  r.json({ ok: true, teams: users[u.email].teams });
});

// ===== Highlightly integration (match detail fallback source) =====
const HL_HOSTS = [
  { base: 'https://soccer.highlightly.net', headers: { 'x-rapidapi-key': HL } },
  {
    base: 'https://football-highlights-api.p.rapidapi.com',
    headers: { 'x-rapidapi-key': HL, 'x-rapidapi-host': 'football-highlights-api.p.rapidapi.com' },
  },
];
let hlWorkingHostIdx = null;

async function hlFetch(urlPath) {
  if (!HL) throw new Error('HIGHLIGHTLY_API_KEY not set');
  const order = hlWorkingHostIdx != null ? [HL_HOSTS[hlWorkingHostIdx], ...HL_HOSTS.filter((_, i) => i !== hlWorkingHostIdx)] : HL_HOSTS;
  let lastErr = null;
  for (const h of order) {
    try {
      const res = await json(`${h.base}${urlPath}`, { headers: h.headers });
      hlWorkingHostIdx = HL_HOSTS.indexOf(h);
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function hlNorm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const HL_LEAGUE_NAME = {
  epl: 'Premier League',
  laliga: 'La Liga',
  seriea: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue1: 'Ligue 1',
  ucl: 'UEFA Champions League',
};

function hlFuzzy(a, b) {
  a = hlNorm(a);
  b = hlNorm(b);
  if (!a || !b) return false;
  return (
    a.includes(b) ||
    b.includes(a) ||
    a.includes(b.slice(0, Math.min(6, b.length))) ||
    b.includes(a.slice(0, Math.min(6, a.length)))
  );
}

async function hlFindMatchId(home, away, isoDate, leagueKey) {
  if (!HL || !isoDate) return null;
  const dayStr = isoDate.slice(0, 10);
  const leagueName = HL_LEAGUE_NAME[leagueKey];
  const attempts = [];
  if (leagueName) attempts.push(`/matches?date=${dayStr}&leagueName=${encodeURIComponent(leagueName)}`);
  attempts.push(`/matches?date=${dayStr}`);
  const d0 = new Date(isoDate);
  const prevStr = new Date(d0.getTime() - 86400000).toISOString().slice(0, 10);
  const nextStr = new Date(d0.getTime() + 86400000).toISOString().slice(0, 10);
  if (leagueName) {
    attempts.push(`/matches?date=${prevStr}&leagueName=${encodeURIComponent(leagueName)}`);
    attempts.push(`/matches?date=${nextStr}&leagueName=${encodeURIComponent(leagueName)}`);
  }
  for (const attemptPath of attempts) {
    try {
      const res = await hlFetch(attemptPath);
      const list = Array.isArray(res) ? res : res.data || [];
      const found = list.find((m) => hlFuzzy(m.homeTeam?.name, home) && hlFuzzy(m.awayTeam?.name, away));
      if (found) return found.id;
    } catch (e) {
      console.error('hl find attempt', attemptPath, e.message);
    }
  }
  return null;
}

async function hlMatchDetail(matchId) {
  if (!HL) return null;
  try {
    const raw = await hlFetch(`/matches/${matchId}`);
    const m = Array.isArray(raw) ? raw[0] : raw.data?.[0] || raw;
    if (!m) return null;

    const goals = [];
    const bookings = [];
    const subs = [];
    for (const ev of m.events || []) {
      const timeStr = String(ev.time || '');
      const [minStr, extraStr] = timeStr.split('+');
      const minute = parseInt(minStr, 10) || null;
      const injuryTime = extraStr ? parseInt(extraStr, 10) : null;
      const teamName = ev.team?.name;
      const type = String(ev.type || '').toLowerCase();

      if (type === 'goal' || type === 'penalty') {
        goals.push({ minute, injuryTime, scorer: { name: ev.player }, assist: ev.assist ? { name: ev.assist } : null, team: { name: teamName } });
      } else if (type === 'own goal') {
        goals.push({ minute, injuryTime, scorer: { name: ev.player }, assist: null, team: { name: teamName }, ownGoal: true });
      } else if (type === 'yellow card') {
        bookings.push({ minute, card: 'YELLOW', player: { name: ev.player }, team: { name: teamName } });
      } else if (type === 'red card') {
        bookings.push({ minute, card: 'RED', player: { name: ev.player }, team: { name: teamName } });
      } else if (type === 'substitution') {
        subs.push({ minute, playerOut: { name: ev.substituted }, playerIn: { name: ev.player }, team: { name: teamName } });
      }
    }

    let lineups = [
      { team: { name: m.homeTeam?.name }, formation: null, startXI: [], bench: [], statistics: null },
      { team: { name: m.awayTeam?.name }, formation: null, startXI: [], bench: [], statistics: null },
    ];
    try {
      const lu = await hlFetch(`/lineups/${matchId}`);
      const build = (side) => {
        const flat = (side?.initialLineup || []).flat().map((p) => ({ shirtNumber: p.number || null, name: p.name }));
        const bench = (side?.substitutes || []).map((p) => ({ shirtNumber: p.number || null, name: p.name }));
        return { startXI: flat, bench, formation: side?.formation || null };
      };
      const h = build(lu.homeTeam);
      const a = build(lu.awayTeam);
      lineups = [
        { team: { name: m.homeTeam?.name }, formation: h.formation, startXI: h.startXI, bench: h.bench, statistics: null },
        { team: { name: m.awayTeam?.name }, formation: a.formation, startXI: a.startXI, bench: a.bench, statistics: null },
      ];
    } catch (e) {
      console.error('hl lineups', e.message);
    }

    const nameMap = [
      [/possession/, 'ball_possession'],
      [/shots?\s*on\s*target/, 'shots_on_goal'],
      [/total\s*shots|^shots$/, 'shots'],
      [/corner/, 'corner_kicks'],
      [/foul/, 'fouls'],
      [/yellow/, 'yellow_cards'],
      [/red/, 'red_cards'],
    ];
    const mapStats = (arr) => {
      const out = {};
      for (const it of arr || []) {
        const dn = String(it.displayName || '').toLowerCase();
        for (const [re, key] of nameMap) {
          if (re.test(dn)) {
            const n = parseFloat(String(it.value).replace('%', ''));
            out[key] = isNaN(n) ? 0 : n;
            break;
          }
        }
      }
      return Object.keys(out).length ? out : null;
    };
    if (m.statistics?.[0]) lineups[0].statistics = mapStats(m.statistics[0].statistics);
    if (m.statistics?.[1]) lineups[1].statistics = mapStats(m.statistics[1].statistics);

    const hasAny = goals.length || bookings.length || subs.length || lineups.some((t) => t.startXI.length);
    return hasAny ? { goals, bookings, substitutions: subs, lineups } : null;
  } catch (e) {
    console.error('hl detail', e.message);
    return null;
  }
}

app.get('/api/debug-highlightly', async (q, r) => {
  try {
    if (!HL) return r.json({ error: 'HIGHLIGHTLY_API_KEY is not set on the server yet.' });
    const { home, away, date, league } = q.query;
    const dayStr = (date || '').slice(0, 10);
    const leagueName = HL_LEAGUE_NAME[league];
    const listPath = leagueName
      ? `/matches?date=${dayStr}&leagueName=${encodeURIComponent(leagueName)}`
      : `/matches?date=${dayStr}`;

    let listRes;
    let authError = null;
    try {
      listRes = await hlFetch(listPath);
    } catch (e) {
      authError = e.message;
    }
    if (authError) {
      return r.json({
        authError,
        note: 'Both the Highlightly-direct and RapidAPI auth methods failed with this key — check that HIGHLIGHTLY_API_KEY is copied correctly with no extra spaces.',
      });
    }

    const list = Array.isArray(listRes) ? listRes : listRes.data || listRes;
    const sampleNames = Array.isArray(list) ? list.slice(0, 15).map((m) => `${m.homeTeam?.name} vs ${m.awayTeam?.name}`) : null;
    const matchId = await hlFindMatchId(home, away, date, league);
    const authMethod = hlWorkingHostIdx === 0 ? 'highlightly-direct' : 'rapidapi';

    if (!matchId) {
      return r.json({
        found: false,
        workingAuthMethod: authMethod,
        matchCount: Array.isArray(list) ? list.length : null,
        sampleNames,
        rawListResponse: !Array.isArray(list) ? list : undefined,
      });
    }

    const raw = await hlFetch(`/matches/${matchId}`).catch((e) => ({ error: e.message }));
    const lu = await hlFetch(`/lineups/${matchId}`).catch((e) => ({ error: e.message }));
    r.json({ found: true, workingAuthMethod: authMethod, matchId, match: raw, lineups: lu });
  } catch (e) {
    r.json({ error: e.message });
  }
});

// ===== Match detail (main endpoint) =====
app.get('/api/match-detail', async (q, r) => {
  try {
    const { id, home, away, league } = q.query;
    if (!id) return r.json({ available: false, message: 'No match id provided.' });

    // Try the already-cached fixture data first (instant, no network wait) instead of
    // going through the shared football-data.org queue, which can be busy for a while
    // during a periodic refresh cycle.
    let m = null;
    const cachedLeague = league && data.leagues[league];
    const cachedFixture = cachedLeague?.fixtures?.find((f) => String(f.id) === String(id));
    if (cachedFixture) {
      m = {
        id: cachedFixture.id,
        status: cachedFixture.status,
        utcDate: cachedFixture.utcDate,
        minute: null,
        score: { fullTime: { home: cachedFixture.homeScore, away: cachedFixture.awayScore } },
        homeTeam: { name: cachedFixture.homeTeam?.name },
        awayTeam: { name: cachedFixture.awayTeam?.name },
        goals: [],
        bookings: [],
        substitutions: [],
      };
    } else {
      // Fall back to a live lookup only if we don't already have this match cached.
      m = await fdThrottled(`https://api.football-data.org/v4/matches/${id}`, {
        headers: { 'X-Unfold-Goals': 'true', 'X-Unfold-Bookings': 'true', 'X-Unfold-Subs': 'true', 'X-Unfold-Lineups': 'true' },
      });
    }
    if (!m || !m.id) return r.json({ available: false, message: 'Match detail not found for this fixture yet.' });

    const notStarted = ['SCHEDULED', 'TIMED', 'POSTPONED', 'CANCELLED', 'SUSPENDED'].includes(String(m.status || '').toUpperCase());
    if (notStarted && !m.goals?.length && !m.homeTeam?.lineup?.length) {
      return r.json({
        available: false,
        message: 'Match details (lineups, goals, cards) become available once the match is closer to kickoff or has started.',
      });
    }

    const shouldHaveDetail = ['IN_PLAY', 'PAUSED', 'FINISHED', 'AWARDED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(
      String(m.status || '').toUpperCase()
    );
    let hasAnyDetail = !!(
      (m.goals && m.goals.length) ||
      (m.bookings && m.bookings.length) ||
      (m.homeTeam?.lineup && m.homeTeam.lineup.length) ||
      (m.awayTeam?.lineup && m.awayTeam.lineup.length)
    );

    let goalsOut = m.goals || [];
    let bookingsOut = m.bookings || [];
    let subsOut = m.substitutions || [];
    let lineupsOut = [
      {
        team: { name: m.homeTeam?.name },
        formation: m.homeTeam?.formation,
        startXI: m.homeTeam?.lineup || [],
        bench: m.homeTeam?.bench || [],
        statistics: m.homeTeam?.statistics || null,
      },
      {
        team: { name: m.awayTeam?.name },
        formation: m.awayTeam?.formation,
        startXI: m.awayTeam?.lineup || [],
        bench: m.awayTeam?.bench || [],
        statistics: m.awayTeam?.statistics || null,
      },
    ];

    if (shouldHaveDetail && !hasAnyDetail && home && away) {
      try {
        const matchId = await hlFindMatchId(home, away, m.utcDate, league);
        if (matchId) {
          const hl = await hlMatchDetail(matchId);
          if (hl) {
            goalsOut = hl.goals;
            bookingsOut = hl.bookings;
            subsOut = hl.substitutions;
            lineupsOut = hl.lineups;
            hasAnyDetail = true;
          }
        }
      } catch (e) {
        console.error('hl fallback', e.message);
      }
    }

    r.json({
      available: true,
      status: m.status,
      minute: m.minute ?? null,
      limited: shouldHaveDetail && !hasAnyDetail,
      score: { home: { total: m.score?.fullTime?.home ?? null }, away: { total: m.score?.fullTime?.away ?? null } },
      goals: goalsOut,
      bookings: bookingsOut,
      substitutions: subsOut,
      lineups: lineupsOut,
    });
  } catch (e) {
    r.json({ available: false, message: 'Could not load match details right now: ' + e.message });
  }
});

// ===== Startup =====
(async () => {
  await Promise.allSettled([refresh(), news()]);
  await live();
})();

cron.schedule('*/30 * * * * *', live);
cron.schedule('*/5 * * * *', refresh);
cron.schedule('*/10 * * * *', news);

app.listen(PORT, () => console.log('Matchday backend v3 on ' + PORT));
