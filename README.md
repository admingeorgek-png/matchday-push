# Matchday Push — real push notifications + auto-refreshing site data

This backend does two jobs:

1. **Push notifications** — checks live scores every 45 seconds, notifies subscribers
   even when their browser is closed.
2. **Auto-refresh** — keeps fixtures, standings, and a transfer-news feed up to date on
   a schedule, and serves it all from `GET /api/data`. Your `index.html` polls this
   endpoint every 5 minutes and updates itself — no manual re-generation needed.

## How it fits together

```
This server (server.js)
  |
  |-- every 45s:  poll live scores -> push notifications to subscribers
  |-- every 30m:  poll fixtures + standings for 6 leagues
  |-- every 20m:  poll BBC Sport football RSS, filter for transfer-shaped headlines
  |
  v
GET /api/data  (fixtures, standings, transfers, lastUpdated)
  |
  v
Your Matchday site polls this every 5 minutes and re-renders itself
```

## 1. Local setup

```bash
cd matchday-push
npm install
npx web-push generate-vapid-keys
cp .env.example .env   # paste the keys in
node server.js
```

Check it's pulling real data:

```bash
curl http://localhost:3000/api/data
curl -X POST http://localhost:3000/test-notification
```

## 2. Deploy it somewhere that stays running 24/7

Render.com, Railway.app, or Fly.io — same as before. Build command `npm install`,
start command `npm start`, and set your `.env` variables in their dashboard.

## 3. Connect your site

In `index.html`, set:

```js
const PUSH_SERVER_URL = 'https://your-deployed-backend-url.com';
```

That single line now powers **both** push notifications and auto-refreshing data —
nothing else in `index.html` needs to change. Once deployed, the footer will show
"Data last refreshed [time]" instead of the static-snapshot message.

Also copy `public/sw.js` to your site's root (`yoursite.com/sw.js`) for push to work.

## Important honesty notes — please read these

**Fixtures & standings**: pulled from TheSportsDB's free public API. It's reliable for
fixtures. The standings endpoint (`lookuptable.php`) is sometimes restricted on the
free tier depending on your API key — if you see standings not updating, check your
server logs for `"Standings refresh failed"`. The safest fix is a paid key from
[thesportsdb.com](https://www.thesportsdb.com/) or a dedicated provider like
[api-football.com](https://www.api-football.com/) if you need guaranteed reliability.
The code is written so a failed standings fetch never wipes existing data — it just
keeps the last good version until the next successful refresh.

**Transfer news**: there's no good free, keyless, structured "transfer news" API. This
uses BBC Sport's general football RSS feed and keeps only headlines that look
transfer-related (contain words like "signs," "joins," "deal," etc.). That means:
- It's genuinely live and automatic, no manual updates from anyone
- It won't be as clean or exhaustively curated as a proper transfer-tracking service
- It only shows league as "Football" generically, since the feed doesn't tag leagues

If you want tighter, more accurate transfer coverage later, the right move is a paid
sports news API — I can wire that in if you get an API key from one.

**Data storage**: subscriptions and cached data live in plain JSON files on the
server's disk. Fine for personal use. On some hosts (like Render's free tier), the
disk can reset on redeploy — if that matters to you, ask about adding a small
database.

## Notes

- iOS requires the site to be "installed" (Add to Home Screen) before push
  notifications work, due to Safari's rules around web push.
- All the polling intervals (45s / 30m / 20m) are adjustable in `server.js` if you
  want faster or slower refreshes.
