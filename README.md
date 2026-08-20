# MATCHDAY — Football Live Scores

A football scores and matchday web app with live fixtures, standings, transfers/news, match details, accounts, and web push notifications.

## Project structure

- `frontend/` — static Netlify site
- `backend/` — Node/Express service for live data and push notifications
- `docs/PRODUCTION-CHECKLIST.md` — deployment and testing checklist

## Current architecture

Netlify frontend
→ Matchday Railway backend
→ football-data.org / TheSportsDB / API-Football / BBC RSS

The frontend has a built-in snapshot as a fallback. The backend is the source for automatic refreshes.

## Deploy the frontend

Upload the contents of `frontend/` to Netlify.

Current frontend backend URL:
`https://matchday-push-production.up.railway.app`

If you move the backend, update `PUSH_SERVER_URL` in `frontend/index.html`.

## Deploy the backend

Deploy the `backend/` directory to Railway, Render, Fly.io, or another always-on Node host.

Required environment variables:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Recommended:

- `FOOTBALL_DATA_API_KEY`
- `API_FOOTBALL_KEY`
- `VAPID_CONTACT_EMAIL`
- `SEASON=2026-2027`
- `ALLOWED_ORIGINS=https://verdant-lamington-273898.netlify.app`

Generate VAPID keys with:

`npx web-push generate-vapid-keys`

Never commit real API keys or `.env` files.

## Health checks

After deployment, open:

- `/health` — backend diagnostics and football-data connectivity
- `/api/status` — public non-secret service status
- `/api/data` — live site data
- `/vapid-public-key` — public push key

## Important production note

The backend currently uses JSON files for subscriptions and cached site data. This is suitable for testing/small deployments but should eventually be replaced with persistent database storage such as PostgreSQL.

## Features already included

- Fixtures and scores
- Live score polling
- League tables
- Transfer/news feed
- Where-to-watch section
- Match detail stats/lineups/player stats
- Accounts through Netlify Identity
- Favourite/followed teams
- Web push notifications
- PWA/service worker
- Automatic backend refresh
- Fallback snapshot when the backend is unavailable

## Next product upgrades

1. Dedicated team pages
2. Dedicated player pages
3. Dedicated competition pages
4. Global search
5. Richer transfer cards with player/from/to/fee/status
6. Persistent database storage
7. User notification preferences
8. Improved mobile bottom navigation
9. More club/competition imagery and badges
10. Production monitoring and error logging
