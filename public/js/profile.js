const params = new URLSearchParams(window.location.search);
const stored = JSON.parse(localStorage.getItem("tekla_user") || "null");
const username = params.get("u") || stored?.username;

const profileTitle = document.getElementById("profileTitle");
const profileSub = document.getElementById("profileSub");
const summaryStats = document.getElementById("summaryStats");
const historyWrap = document.getElementById("historyWrap");

if (!username) {
  window.location.href = "/";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

fetch(`/api/users/${encodeURIComponent(username)}/stats`)
  .then(async (r) => {
    if (!r.ok) throw new Error((await r.json()).error || "Erro ao carregar perfil.");
    return r.json();
  })
  .then((data) => {
    profileTitle.textContent = data.displayName;
    profileSub.textContent = `@${data.username}`;

    const s = data.summary;
    summaryStats.innerHTML = `
      <div class="stat"><div class="val">${s.bestWpm}</div><div class="lbl">Melhor PPM</div></div>
      <div class="stat"><div class="val">${s.avgWpm}</div><div class="lbl">PPM médio</div></div>
      <div class="stat"><div class="val">${s.avgAccuracy}%</div><div class="lbl">Precisão média</div></div>
      <div class="stat"><div class="val">${s.races}</div><div class="lbl">Corridas</div></div>
      <div class="stat"><div class="val">${s.wins}</div><div class="lbl">Vitórias</div></div>
      <div class="stat"><div class="val">${s.winRate}%</div><div class="lbl">Taxa de vitória</div></div>
    `;

    if (!data.history.length) {
      historyWrap.innerHTML = '<div class="empty-msg">Nenhuma corrida ainda.</div>';
      return;
    }

    let html = `<table class="leaderboard">
      <thead><tr><th>Quando</th><th>Sala</th><th>Posição</th><th>PPM</th><th>Precisão</th><th>Tempo</th></tr></thead><tbody>`;
    data.history.forEach((h) => {
      html += `<tr>
        <td>${formatDate(h.finishedAt)}</td>
        <td><code class="room-code" style="font-size:0.8rem;">${escapeHtml(h.roomCode)}</code></td>
        <td>${h.position}º de ${h.totalRacers}</td>
        <td>${h.wpm}</td>
        <td>${h.accuracy}%</td>
        <td>${(h.timeMs / 1000).toFixed(1)}s</td>
      </tr>`;
    });
    html += "</tbody></table>";
    historyWrap.innerHTML = html;
  })
  .catch((err) => {
    profileTitle.textContent = "Perfil não encontrado";
    profileSub.textContent = "";
    historyWrap.innerHTML = `<div class="empty-msg">${escapeHtml(err.message)}</div>`;
  });
