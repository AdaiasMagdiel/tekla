const rankingWrap = document.getElementById("rankingWrap");
const resultsWrap = document.getElementById("resultsWrap");
const pagination = document.getElementById("pagination");
const errorBox = document.getElementById("errorBox");

let resultsPage = 1;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
  setTimeout(() => errorBox.classList.remove("show"), 4000);
}

async function loadRanking() {
  try {
    const rows = await adminFetch("/api/admin/rankings");
    if (!rows.length) {
      rankingWrap.innerHTML = '<div class="empty-msg">Nenhuma corrida registrada ainda.</div>';
      return;
    }
    let html = `<table class="admin-table">
      <thead><tr><th>#</th><th>Corredor</th><th>Melhor PPM</th><th>Precisão média</th><th>Corridas</th><th>Vitórias</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      html += `<tr>
        <td>${i + 1}</td>
        <td><a href="/profile/${encodeURIComponent(r.username)}" target="_blank">${escapeHtml(r.displayName)}</a> <span style="color:var(--text-dim)">@${escapeHtml(r.username)}</span></td>
        <td>${r.bestWpm}</td>
        <td>${r.avgAccuracy}%</td>
        <td>${r.races}</td>
        <td>${r.wins}</td>
      </tr>`;
    });
    html += "</tbody></table>";
    rankingWrap.innerHTML = html;
  } catch (err) {
    showError(err.message);
  }
}

async function deleteResult(id) {
  if (!confirm("Excluir este resultado de corrida? Isso afeta o ranking e o histórico do usuário.")) return;
  try {
    await adminFetch(`/api/admin/results/${encodeURIComponent(id)}`, { method: "DELETE" });
    loadResults();
    loadRanking();
  } catch (err) {
    showError(err.message);
  }
}

async function loadResults() {
  try {
    const data = await adminFetch(`/api/admin/results?page=${resultsPage}`);
    if (!data.rows.length) {
      resultsWrap.innerHTML = '<div class="empty-msg">Nenhum resultado registrado.</div>';
      pagination.innerHTML = "";
      return;
    }
    let html = `<table class="admin-table">
      <thead><tr><th>Sala</th><th>Usuário</th><th>Pos.</th><th>PPM</th><th>Precisão</th><th>Tempo</th><th>Quando</th><th></th></tr></thead><tbody>`;
    data.rows.forEach((r) => {
      html += `<tr>
        <td><code class="room-code" style="font-size:0.75rem;">${escapeHtml(r.roomCode)}</code></td>
        <td>@${escapeHtml(r.username)}</td>
        <td>${r.position}</td>
        <td>${r.wpm}</td>
        <td>${r.accuracy}%</td>
        <td>${(r.timeMs / 1000).toFixed(1)}s</td>
        <td>${formatDateTime(r.finishedAt)}</td>
        <td class="actions"><button class="icon-btn" data-id="${r.id}" title="Excluir resultado"><i data-lucide="trash-2" class="icon"></i></button></td>
      </tr>`;
    });
    html += "</tbody></table>";
    resultsWrap.innerHTML = html;
    lucide.createIcons();
    resultsWrap.querySelectorAll("button[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => deleteResult(btn.dataset.id));
    });
    renderPagination(pagination, data, (page) => {
      resultsPage = page;
      loadResults();
    });
  } catch (err) {
    showError(err.message);
  }
}

loadRanking();
loadResults();
