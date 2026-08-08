const tableWrap = document.getElementById("tableWrap");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

fetch("/api/leaderboard")
  .then((r) => r.json())
  .then((rows) => {
    if (!rows.length) {
      tableWrap.innerHTML = '<div class="empty-msg">Ninguém correu ainda. Seja o primeiro!</div>';
      return;
    }
    let html = `<table class="leaderboard">
      <thead><tr><th>#</th><th>Piloto</th><th>Melhor PPM</th><th>Precisão média</th><th>Corridas</th><th>Vitórias</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      html += `<tr>
        <td>${i + 1}</td>
        <td><a href="/profile.html?u=${encodeURIComponent(r.username)}" style="color:inherit; text-decoration:none;">${escapeHtml(r.displayName)} <span style="color:var(--text-dim)">@${escapeHtml(r.username)}</span></a></td>
        <td>${r.bestWpm}</td>
        <td>${r.avgAccuracy}%</td>
        <td>${r.races}</td>
        <td>${r.wins}</td>
      </tr>`;
    });
    html += "</tbody></table>";
    tableWrap.innerHTML = html;
  })
  .catch(() => {
    tableWrap.innerHTML = '<div class="empty-msg">Erro ao carregar o ranking.</div>';
  });
