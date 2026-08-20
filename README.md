# MATCHDAY PUSH — live scores, minute-level fixtures and push notifications

This backend powers the MATCHDAY football site.

## Refresh behaviour

- **Live scores:** every 30 seconds.
- **Fixtures:** every 60 seconds for all six supported competitions.
- **Standings:** every 5 minutes. This is intentionally slower because the free football-data.org API is limited to 10 requests/minute; forcing all 12 fixture+standings requests every minute would exceed that limit and cause stale/failed data.
- **Transfer/news feed:** every 5 minutes.
- **Match stats + line-ups:** fetched through the secure server proxy and refreshed with a 60-second cache.
- `/api/data` is sent with `Cache-Control: no-store` so browsers/proxies do not keep an old snapshot.

The API response now includes:

- `serverTime`
- `fixturesLastUpdated`
- `standingsLastUpdated`
- `transfersLastUpdated`
- `expectedTableSizes`
- `staleLeagues`
- refresh interval values

## Verified competition table sizes for 2026/27

- Premier League: **20**
- La Liga: **20**
- Serie A: **20**
- Bundesliga: **18**
- Ligue 1: **18**
- UEFA Champions League league phase: **36**

The backend rejects a domestic standings response when it contains the wrong number of teams instead of silently replacing a good table with a partial one. The Champions League is allowed to have no table before the 2026/27 league phase is formed.

## Match details

Set `API_FOOTBALL_KEY` on the server. The `/api/match-detail` endpoint keeps the API key server-side and returns:

- fixture status
- match stats
- line-ups
- player-level match statistics when the competition provides them
- an `updatedAt` timestamp

The endpoint never caches a match detail response for longer than 60 seconds, so line-ups/stats can update during a match.

## Environment variables

Required:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_CONTACT_EMAIL` (optional)

Recommended for complete fixtures/standings and live match details:

- `FOOTBALL_DATA_API_KEY`
- `API_FOOTBALL_KEY` for line-ups and match stats

## Deployment

Deploy this backend to a service that stays running 24/7, such as Railway, Render, or Fly.io. Set the environment variables in the host dashboard.

The MATCHDAY frontend must point `PUSH_SERVER_URL` at the deployed backend and poll `/api/data` at about 60 seconds or use the refresh interval returned by the API.

## Important email note

The confirmation-email appearance is not controlled by this backend. If Netlify Identity is generating the confirmation email and the URL is displayed as quoted text, that must be changed in the Netlify email-template/Identity settings. The frontend/backend ZIP cannot change a Netlify-managed email template.
