MATCHDAY BACKEND V2
====================
Replace the existing server.js in the GitHub repository with this file and let Render redeploy.

Required Render environment variables:
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_CONTACT_EMAIL
FOOTBALL_DATA_API_KEY
API_FOOTBALL_KEY
SEASON=2026/2027

Important:
- No API key preview is exposed by /health.
- Football-data.org is used for fixtures/standings/live polling.
- API-Football is used on-demand for match detail pages.
- The backend validates table sizes and does not invent a Champions League 2026/27 table before the league phase is populated.
- /api/data should return non-empty leagues when provider data is available.
- /api/refresh-now can be opened in a browser to force a refresh.
