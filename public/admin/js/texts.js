const tableWrap = document.getElementById("tableWrap");
const pagination = document.getElementById("pagination");
const errorBox = document.getElementById("errorBox");
const langFilter = document.getElementById("langFilter");
const newBtn = document.getElementById("newBtn");
const detailModal = document.getElementById("detailModal");
const detailBox = document.getElementById("detailBox");

let currentPage = 1;
let currentLang = "";

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

function openEditor(text) {
  const isNew = !text;
  const t = text || { id: null, content: "", lang: currentLang || "pt" };
  detailBox.innerHTML = `
    <h2>${isNew ? "Novo texto" : `Editar texto #${t.id}`}</h2>
    <label for="editLang">Idioma</label>
    <select id="editLang">
      <option value="pt" ${t.lang === "pt" ? "selected" : ""}>PT</option>
      <option value="en" ${t.lang === "en" ? "selected" : ""}>EN</option>
    </select>
    <label for="editContent" style="margin-top:12px; display:block;">Conteúdo</label>
    <textarea id="editContent" rows="6" style="width:100%; resize:vertical;">${escapeHtml(t.content)}</textarea>
    <div class="modal-actions">
      ${isNew ? "" : '<button class="btn btn-secondary" id="deleteBtn"><i data-lucide="trash-2" class="icon"></i>Excluir</button>'}
      <button class="btn btn-primary" id="saveBtn"><i data-lucide="check" class="icon"></i>Salvar</button>
    </div>
  `;
  detailModal.classList.add("show");
  safeCreateIcons();

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const content = document.getElementById("editContent").value.trim();
    const lang = document.getElementById("editLang").value;
    if (!content) return;
    try {
      if (isNew) {
        await adminFetch("/api/admin/texts", { method: "POST", body: JSON.stringify({ content, lang }) });
      } else {
        await adminFetch(`/api/admin/texts/${t.id}`, {
          method: "PATCH",
          body: JSON.stringify({ content, lang }),
        });
      }
      closeModal();
      load();
    } catch (err) {
      showError(err.message);
    }
  });

  if (!isNew) {
    document.getElementById("deleteBtn").addEventListener("click", async () => {
      if (!confirm(`Excluir o texto #${t.id}?`)) return;
      try {
        await adminFetch(`/api/admin/texts/${t.id}`, { method: "DELETE" });
        closeModal();
        load();
      } catch (err) {
        showError(
          err.message === "in_use"
            ? "Não é possível excluir: este texto está em uso por uma sala."
            : err.message
        );
      }
    });
  }
}

async function load() {
  try {
    const data = await adminFetch(
      `/api/admin/texts?page=${currentPage}${currentLang ? `&lang=${encodeURIComponent(currentLang)}` : ""}`
    );
    if (!data.rows.length) {
      tableWrap.innerHTML = '<div class="empty-msg">Nenhum texto cadastrado.</div>';
      pagination.innerHTML = "";
      return;
    }
    let html = `<table class="admin-table">
      <thead><tr><th>#</th><th>Idioma</th><th>Conteúdo</th><th></th></tr></thead><tbody>`;
    data.rows.forEach((t) => {
      const preview = t.content.length > 90 ? t.content.slice(0, 90) + "…" : t.content;
      html += `<tr data-id="${t.id}" style="cursor:pointer;">
        <td>${t.id}</td>
        <td>${t.lang.toUpperCase()}</td>
        <td>${escapeHtml(preview)}</td>
        <td class="actions"><button class="icon-btn edit-btn" data-id="${t.id}" title="Editar"><i data-lucide="pencil" class="icon"></i></button></td>
      </tr>`;
    });
    html += "</tbody></table>";
    tableWrap.innerHTML = html;
    safeCreateIcons();

    const rowsById = new Map(data.rows.map((t) => [String(t.id), t]));
    tableWrap.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest(".edit-btn")) return;
        openEditor(rowsById.get(tr.dataset.id));
      });
    });
    tableWrap.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => openEditor(rowsById.get(btn.dataset.id)));
    });

    renderPagination(pagination, data, (page) => {
      currentPage = page;
      load();
    });
  } catch (err) {
    showError(err.message);
  }
}

langFilter.addEventListener("change", () => {
  currentLang = langFilter.value;
  currentPage = 1;
  load();
});

newBtn.addEventListener("click", () => openEditor(null));

load();
