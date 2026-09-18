/*
 * MATCHDAY Extra — placeholder data
 * -----------------------------------------------------------------
 * Everything in this file is sample data so the pages have something
 * to render. Replace MOCK.fixtures / MOCK.news / MOCK.players with
 * real calls to the existing Matchday backend (football-data.org /
 * api-football), keeping the same shape so the render functions in
 * app.js keep working unchanged.
 */
const MOCK = {
  fixtures: {
    yesterday: [
      { home: "Arsenal", away: "Brighton", homeScore: 2, awayScore: 1, status: "FT", competition: "Premier League" }
    ],
    today: [
      { home: "Chelsea", away: "Everton", homeScore: 1, awayScore: 1, status: "LIVE 63'", competition: "Premier League", live: true },
      { home: "Real Madrid", away: "Sevilla", homeScore: null, awayScore: null, status: "20:00", competition: "La Liga" }
    ],
    tomorrow: [
      { home: "Bayern Munich", away: "Dortmund", homeScore: null, awayScore: null, status: "18:30", competition: "Bundesliga" }
    ]
  },
  news: [
    { id: 1, category: "Transfers", title: "Midfielder linked with January move", source: "MATCHDAY Reports", time: "2h ago" },
    { id: 2, category: "Latest News", title: "Manager previews weekend fixture", source: "MATCHDAY Reports", time: "5h ago" },
    { id: 3, category: "Rumours", title: "Club reportedly scouting young winger", source: "MATCHDAY Reports", time: "1d ago" }
  ],
  players: [
    { name: "M. Rashford", club: "Manchester United", position: "Forward", apps: 28, goals: 14, assists: 6, cards: 3 }
  ],
  searchIndex: [
    { kind: "Team", label: "Chelsea" },
    { kind: "Team", label: "Real Madrid" },
    { kind: "Player", label: "M. Rashford" },
    { kind: "Competition", label: "Premier League" },
    { kind: "Competition", label: "La Liga" },
    { kind: "News", label: "Midfielder linked with January move" }
  ]
};
