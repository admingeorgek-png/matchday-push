# MATCHDAY Production Checklist

## Before GitHub

- [ ] Do not commit `.env`
- [ ] Do not commit API keys
- [ ] Do not commit `subscriptions.json`
- [ ] Do not commit `last-scores.json`
- [ ] Do not commit `site-data.json`

## Railway backend

- [ ] `npm install`
- [ ] `npm start`
- [ ] Add VAPID public/private keys
- [ ] Add `FOOTBALL_DATA_API_KEY`
- [ ] Add `API_FOOTBALL_KEY`
- [ ] Set `SEASON=2026-2027`
- [ ] Set `ALLOWED_ORIGINS=https://verdant-lamington-273898.netlify.app`
- [ ] Confirm `/health` returns successfully
- [ ] Confirm `/api/status` shows required services configured
- [ ] Confirm `/api/data` returns leagues
- [ ] Confirm `/vapid-public-key` returns a public key

## Netlify frontend

- [ ] Deploy the `frontend/` folder
- [ ] Confirm the site loads over HTTPS
- [ ] Confirm the live data indicator changes from offline to live
- [ ] Confirm fixtures update
- [ ] Confirm standings update
- [ ] Confirm transfer/news data updates
- [ ] Confirm match details open
- [ ] Confirm signup/login works after enabling Netlify Identity
- [ ] Confirm a team can be followed
- [ ] Confirm browser notification permission works
- [ ] Confirm push subscription reaches the backend
- [ ] Confirm a test push notification arrives

## Production improvements still recommended

### Data
- [ ] Replace JSON storage with PostgreSQL
- [ ] Add retry/backoff for external APIs
- [ ] Add API response validation
- [ ] Add rate-limit handling

### Product
- [ ] Team pages
- [ ] Player pages
- [ ] Competition pages
- [ ] Search
- [ ] Better transfer database
- [ ] Notification preferences
- [ ] Mobile bottom navigation

### Reliability
- [ ] Add uptime monitoring
- [ ] Add structured logs
- [ ] Add error tracking
- [ ] Add backup strategy for user subscriptions/data
