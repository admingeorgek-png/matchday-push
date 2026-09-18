# MATCHDAY Extra

A self-contained addition to MATCHDAY. Nothing here replaces or edits existing MATCHDAY files — drop this folder in alongside the main app and link to it from your existing navigation.

## Pages
- `index.html` — Yesterday / Today / Tomorrow fixtures, with live-match indicator
- `lineup.html` — visual pitch lineup with numbered players and substitutes
- `player.html` — player profile with season stats and recent matches
- `news.html` — in-app news list with category filtering
- `article.html` — full article view (stays inside MATCHDAY, no external redirects)
- `search.html` — global search across teams, players, competitions, news

## Structure
- `css/styles.css` — single shared stylesheet (pitch-green / scoreboard theme)
- `js/data.js` — **placeholder data only.** Replace the arrays in this file with real calls to your existing football-data.org / api-football integration. The shape of each object (`fixtures`, `news`, `players`, `searchIndex`) is what `app.js` expects, so keep the same fields if you swap in live data.
- `js/app.js` — shared interactivity: date-strip switching, news filtering, live search-as-you-type

## Rules this add-on follows
- Official lineups are only shown once released (typically ~1 hour before kickoff); until then, show the empty state rather than a guess.
- News stays inside MATCHDAY: no redirecting users to outside sites. Articles must be either originally reported and attributed to MATCHDAY, or content MATCHDAY is licensed to display.
- Every page has a working empty state so it never looks broken when there's no data yet.

## Wiring it to real data
`js/data.js` is intentionally isolated so you can:
1. Replace `MOCK.fixtures` with a fetch to your existing `/api/fixtures` (or equivalent) endpoint, grouped by day.
2. Replace `MOCK.news` and `MOCK.players` the same way.
3. Leave `js/app.js` as-is unless you change field names — it only reads from the `MOCK` object.

## Accessibility & responsiveness
- Semantic headings, `aria-current` / `aria-pressed` state on toggles, visible focus states, skip-to-content link
- Layout is responsive down to small phone widths (fixtures, stat grid, and nav all reflow)
- Fonts: Oswald (headings) + Inter (body) via Google Fonts, both with system fallbacks if the request fails
