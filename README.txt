MATCHDAY PUSH — UPDATED FRONTEND + BACKEND

Deploy the whole folder/package as the Render Node web service.
The frontend is live-data driven and does not intentionally display a built-in snapshot warning while the backend is reachable.

UI updates:
- Four separate status cards: Live Sync, Live Data Status, Live Alerts, My Teams.
- Live Alerts requests browser notification permission and subscribes through /subscribe.
- My Teams opens /my-teams.html.
- All six competition cards are displayed two per row on larger screens and one per row on small phones.
- Every league has Match Fixtures | League Table | Transfer News tabs.
- Fixtures include team logos from the backend data.
- Animated top match ticker.

Backend environment variables required on Render:
FOOTBALL_DATA_API_KEY
API_FOOTBALL_KEY (for match detail proxy)
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_CONTACT_EMAIL (optional)
SEASON=2026/2027 (recommended)
