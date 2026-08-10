const liveWrap = document.getElementById("liveWrap");
const historyWrap = document.getElementById("historyWrap");
const pagination = document.getElementById("pagination");
const errorBox = document.getElementById("errorBox");

let historyPage = 1;
let liveTimer = null;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
  setTimeout(() => errorBox.classList.remove("show"), 4000);
}

function statusBadge(status) {
  const labels = { waiting: "aguardando", countdown: "contagem", racing: "correndo", finished: "finalizada" };
  return `<span class="badge-status ${status}">${labels[status] || status}</span>`;
}

async function closeRoom(code) {
  if (!confirm(`Encerrar a sala ${code} agora? Todos os participantes verão a corrida terminar.`)) return;
  try {
    await adminFetch(`/api/admin/rooms/live/${encodeURIComponent(code)}/close`, { method: "POST" });
    loadLive();
  } catch (err) {
    showError(err.message);
  }
}

async function kickParticipant(code, userId, displayName) {
  if (!confirm(`Remover ${displayName} da sala ${code}?`)) return;
  try {
    await adminFetch(`/api/admin/rooms/live/${encodeURIComponent(code)}/kick/${encodeURIComponent(userId)}`, {
      method: "POST",
    });
    loadLive();
  } catch (err) {
    showError(err.message);
  }
}

// For rooms stuck at a non-final status with no live entry to reach them
// from (e.g. the process restarted mid-race) — works from the history table
// even when the room no longer exists in memory.
async function forceCloseRoom(id, code) {
  if (!confirm(`Forçar o encerramento da sala ${code}? Use isso quando ela ficou travada (ex: após um restart do servidor).`))
    return;
  try {
    await adminFetch(`/api/admin/rooms/${encodeURIComponent(id)}/force-close`, { method: "POST" });
    loadLive();
    loadHistory();
  } catch (err) {
    showError(err.message);
  }
}

async function loadLive() {
  try {
    const rooms = await adminFetch("/api/admin/rooms/live");
    if (!rooms.length) {
      liveWrap.innerHTML = '<div class="empty-msg">Nenhuma sala ativa no momento.</div>';
      return;
    }
    liveWrap.innerHTML = rooms
      .map((r) => {
        const rows = r.participants
          .map(
            (p) => `<tr>
              <td>${escapeHtml(p.displayName)} <span style="color:var(--text-dim)">@${escapeHtml(p.username)}</span></td>
              <td>${p.connected ? "🟢" : "⚪"}</td>
              <td>${Math.round(p.progress * 100)}%</td>
              <td>${p.wpm}</td>
              <td>${p.accuracy}%</td>
              <td>${p.finished ? "✅" : "—"}</td>
              <td class="actions"><button class="icon-btn danger kick-btn" data-code="${escapeHtml(r.code)}" data-user-id="${escapeHtml(p.userId)}" data-name="${escapeHtml(p.displayName)}" title="Remover da sala"><i data-lucide="user-x" class="icon"></i></button></td>
            </tr>`
          )
          .join("");
        return `
          <div class="panel" style="margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div>
                <code class="room-code">${escapeHtml(r.code)}</code>
                ${statusBadge(r.status)}
                <span class="room-code-display">host: @${escapeHtml(r.hostUsername)} · ${r.participantCount} corredor(es) · ${r.spectatorCount} espectador(es) · criada ${formatDateTime(r.createdAt)}</span>
              </div>
              <button class="btn btn-secondary" data-code="${escapeHtml(r.code)}"><i data-lucide="square" class="icon"></i>Encerrar</button>
            </div>
            <table class="admin-table" style="margin-top:14px;">
              <thead><tr><th>Corredor</th><th>Online</th><th>Progresso</th><th>PPM</th><th>Precisão</th><th>Terminou</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
      })
      .join("");
    safeCreateIcons();
    liveWrap.querySelectorAll("button.btn-secondary[data-code]").forEach((btn) => {
      btn.addEventListener("click", () => closeRoom(btn.dataset.code));
    });
    liveWrap.querySelectorAll(".kick-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        kickParticipant(btn.dataset.code, btn.dataset.userId, btn.dataset.name)
      );
    });
  } catch (err) {
    showError(err.message);
  }
}

async function loadHistory() {
  try {
    const data = await adminFetch(`/api/admin/rooms/history?page=${historyPage}`);
    if (!data.rows.length) {
      historyWrap.innerHTML = '<div class="empty-msg">Nenhuma sala registrada ainda.</div>';
      pagination.innerHTML = "";
      return;
    }
    let html = `<table class="admin-table">
      <thead><tr><th>Código</th><th>Host</th><th>Status</th><th>Idioma</th><th>Criada</th><th>Iniciada</th><th>Finalizada</th><th></th></tr></thead><tbody>`;
    data.rows.forEach((r) => {
      const forceCloseBtn =
        r.status === "finished"
          ? ""
          : `<button class="icon-btn danger force-close-btn" data-id="${escapeHtml(r.id)}" data-code="${escapeHtml(r.code)}" title="Forçar encerramento"><i data-lucide="square" class="icon"></i></button>`;
      html += `<tr>
        <td><code class="room-code" style="font-size:0.75rem;">${escapeHtml(r.code)}</code></td>
        <td>@${escapeHtml(r.hostUsername)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.textLang ? r.textLang.toUpperCase() : "—"}</td>
        <td>${formatDateTime(r.createdAt)}</td>
        <td>${formatDateTime(r.startedAt)}</td>
        <td>${formatDateTime(r.finishedAt)}</td>
        <td class="actions">${forceCloseBtn}</td>
      </tr>`;
    });
    html += "</tbody></table>";
    historyWrap.innerHTML = html;
    safeCreateIcons();
    historyWrap.querySelectorAll(".force-close-btn").forEach((btn) => {
      btn.addEventListener("click", () => forceCloseRoom(btn.dataset.id, btn.dataset.code));
    });
    renderPagination(pagination, data, (page) => {
      historyPage = page;
      loadHistory();
    });
  } catch (err) {
    showError(err.message);
  }
}

loadLive();
loadHistory();
liveTimer = setInterval(loadLive, 4000);
window.addEventListener("beforeunload", () => clearInterval(liveTimer));
