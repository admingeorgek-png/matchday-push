/* ===== MATCHDAY Extra — shared behavior ===== */

function renderFixture(f){
  const scoreShown = f.homeScore !== null;
  return `
    <div class="card fixture">
      <div class="fixture-teams">
        <div class="fixture-team"><span>${f.home}</span>${scoreShown ? `<span class="fixture-score">${f.homeScore}</span>` : ""}</div>
        <div class="fixture-team"><span>${f.away}</span>${scoreShown ? `<span class="fixture-score">${f.awayScore}</span>` : ""}</div>
      </div>
      <div class="fixture-meta">
        ${f.live ? `<span class="tag-live">${f.status}</span>` : `<span>${f.status}</span>`}
        <div>${f.competition}</div>
      </div>
    </div>`;
}

function initFixtures(){
  const strip = document.querySelector(".date-strip");
  const list = document.querySelector("#fixture-list");
  if (!strip || !list) return;

  function show(day){
    const items = MOCK.fixtures[day] || [];
    list.innerHTML = items.length
      ? items.map(renderFixture).join("")
      : `<div class="empty"><h2>No fixtures found</h2><p>Nothing scheduled for this day yet. Check back closer to kickoff.</p></div>`;
    strip.querySelectorAll("button").forEach(b => b.setAttribute("aria-current", b.dataset.day === day ? "true" : "false"));
  }

  strip.addEventListener("click", e => {
    const btn = e.target.closest("button[data-day]");
    if (!btn) return;
    show(btn.dataset.day);
  });

  show("today");
}

function initNewsFilter(){
  const row = document.querySelector(".filter-row");
  const list = document.querySelector("#news-list");
  if (!row || !list) return;

  function render(category){
    const items = category === "All"
      ? MOCK.news
      : MOCK.news.filter(n => n.category === category);
    list.innerHTML = items.length
      ? items.map(n => `
          <a class="news-item" href="article.html?id=${n.id}">
            <div class="news-thumb" aria-hidden="true"></div>
            <div>
              <h3>${n.title}</h3>
              <p class="subtle">${n.source} • ${n.time}</p>
            </div>
          </a>`).join("")
      : `<div class="empty"><h2>No stories in this category yet</h2><p>New articles appear here as they're published.</p></div>`;
    row.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.textContent.trim() === category ? "true" : "false"));
  }

  row.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    render(btn.textContent.trim());
  });

  render("All");
}

function initSearch(){
  const input = document.querySelector("#q");
  const results = document.querySelector("#results");
  if (!input || !results) return;

  function render(query){
    const v = query.trim().toLowerCase();
    if (!v){
      results.innerHTML = `<p class="subtle">Search teams, players, competitions and news.</p>`;
      return;
    }
    const matches = MOCK.searchIndex.filter(item => item.label.toLowerCase().includes(v));
    results.innerHTML = matches.length
      ? matches.map(m => `<div class="result-row"><span>${m.label}</span><span class="kind">${m.kind}</span></div>`).join("")
      : `<div class="empty"><h2>No results for "${escapeHtml(query)}"</h2><p>Try a different team, player or competition name.</p></div>`;
  }

  input.addEventListener("input", () => render(input.value));
  render("");
}

function escapeHtml(str){
  return str.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

document.addEventListener("DOMContentLoaded", () => {
  initFixtures();
  initNewsFilter();
  initSearch();
});
