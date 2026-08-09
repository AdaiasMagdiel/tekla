const { t } = window.i18n;

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
      tableWrap.innerHTML = `<div class="empty-msg">${escapeHtml(t("ranking.empty"))}</div>`;
      return;
    }
    let html = `<table class="leaderboard">
      <thead><tr><th>${escapeHtml(t("ranking.thPosition"))}</th><th>${escapeHtml(t("ranking.thPilot"))}</th><th>${escapeHtml(t("ranking.thBestWpm"))}</th><th>${escapeHtml(t("ranking.thAvgAccuracy"))}</th><th>${escapeHtml(t("ranking.thRaces"))}</th><th>${escapeHtml(t("ranking.thWins"))}</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      html += `<tr>
        <td>${i + 1}</td>
        <td><a href="/profile/${encodeURIComponent(r.username)}" style="color:inherit; text-decoration:none;">${escapeHtml(r.displayName)} <span style="color:var(--text-dim)">@${escapeHtml(r.username)}</span></a></td>
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
    tableWrap.innerHTML = `<div class="empty-msg">${escapeHtml(t("ranking.loadError"))}</div>`;
  });
