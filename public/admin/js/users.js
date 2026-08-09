const tableWrap = document.getElementById("tableWrap");
const pagination = document.getElementById("pagination");
const errorBox = document.getElementById("errorBox");
const searchInput = document.getElementById("searchInput");
const detailModal = document.getElementById("detailModal");
const detailBox = document.getElementById("detailBox");

let currentPage = 1;
let currentSearch = "";
let searchDebounce;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
  setTimeout(() => errorBox.classList.remove("show"), 4000);
}

function closeModal() {
  detailModal.classList.remove("show");
  detailBox.innerHTML = "";
}
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) closeModal();
});

async function openDetail(id) {
  try {
    const u = await adminFetch(`/api/admin/users/${encodeURIComponent(id)}`);
    detailBox.innerHTML = `
      <h2>${escapeHtml(u.displayName)}</h2>
      <p class="sub">@${escapeHtml(u.username)}</p>
      <ul class="detail-list">
        <li><span>Criado em</span><span>${formatDateTime(u.createdAt)}</span></li>
        <li><span>Corridas</span><span>${u.summary.races}</span></li>
        <li><span>Melhor PPM</span><span>${u.summary.bestWpm}</span></li>
        <li><span>PPM médio</span><span>${u.summary.avgWpm}</span></li>
        <li><span>Precisão média</span><span>${u.summary.avgAccuracy}%</span></li>
        <li><span>Vitórias</span><span>${u.summary.wins}</span></li>
      </ul>
      <label for="editName">Renomear (nome de exibição)</label>
      <input type="text" id="editName" value="${escapeHtml(u.displayName)}" maxlength="40" />
      ${
        u.history.length
          ? `<h2 style="margin-top:20px; font-size:0.95rem;">Histórico recente</h2>
             <table class="admin-table">
               <thead><tr><th>Quando</th><th>Sala</th><th>Pos.</th><th>PPM</th><th>Precisão</th></tr></thead>
               <tbody>${u.history
                 .map(
                   (h) =>
                     `<tr><td>${formatDateTime(h.finishedAt)}</td><td><code class="room-code" style="font-size:0.75rem;">${escapeHtml(h.roomCode)}</code></td><td>${h.position}</td><td>${h.wpm}</td><td>${h.accuracy}%</td></tr>`
                 )
                 .join("")}</tbody>
             </table>`
          : `<p class="empty-msg">Nenhuma corrida ainda.</p>`
      }
      <div class="modal-actions">
        <button class="btn btn-secondary" id="deleteBtn"><i data-lucide="trash-2" class="icon"></i>Excluir</button>
        <button class="btn btn-primary" id="saveBtn"><i data-lucide="check" class="icon"></i>Salvar nome</button>
      </div>
    `;
    detailModal.classList.add("show");
    safeCreateIcons();

    document.getElementById("saveBtn").addEventListener("click", async () => {
      const displayName = document.getElementById("editName").value.trim();
      if (!displayName) return;
      try {
        await adminFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ displayName }),
        });
        closeModal();
        load();
      } catch (err) {
        showError(err.message);
      }
    });

    document.getElementById("deleteBtn").addEventListener("click", async () => {
      if (!confirm(`Excluir ${u.username}? Só é possível se não houver histórico de corridas.`)) return;
      try {
        await adminFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
        closeModal();
        load();
      } catch (err) {
        showError(
          err.message === "has_history"
            ? "Não é possível excluir: usuário tem corridas registradas."
            : err.message
        );
      }
    });
  } catch (err) {
    showError(err.message);
  }
}

async function load() {
  try {
    const data = await adminFetch(
      `/api/admin/users?page=${currentPage}&search=${encodeURIComponent(currentSearch)}`
    );
    if (!data.rows.length) {
      tableWrap.innerHTML = '<div class="empty-msg">Nenhum usuário encontrado.</div>';
      pagination.innerHTML = "";
      return;
    }
    let html = `<table class="admin-table">
      <thead><tr><th>Username</th><th>Nome</th><th>Criado em</th><th>Corridas</th><th></th></tr></thead><tbody>`;
    data.rows.forEach((u) => {
      html += `<tr data-id="${escapeHtml(u.id)}" style="cursor:pointer;">
        <td>@${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.displayName)}</td>
        <td>${formatDateTime(u.createdAt)}</td>
        <td>${u.races}</td>
        <td class="actions"><button class="icon-btn view-btn" data-id="${escapeHtml(u.id)}" title="Ver detalhes"><i data-lucide="eye" class="icon"></i></button></td>
      </tr>`;
    });
    html += "</tbody></table>";
    tableWrap.innerHTML = html;
    safeCreateIcons();

    tableWrap.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest(".view-btn")) return;
        openDetail(tr.dataset.id);
      });
    });
    tableWrap.querySelectorAll(".view-btn").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.id));
    });

    renderPagination(pagination, data, (page) => {
      currentPage = page;
      load();
    });
  } catch (err) {
    showError(err.message);
  }
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentSearch = searchInput.value;
    currentPage = 1;
    load();
  }, 300);
});

load();
