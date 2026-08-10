const tableWrap = document.getElementById("tableWrap");
const pagination = document.getElementById("pagination");
const errorBox = document.getElementById("errorBox");
const langFilter = document.getElementById("langFilter");
const newBtn = document.getElementById("newBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const deleteAllBtn = document.getElementById("deleteAllBtn");
const detailModal = document.getElementById("detailModal");
const detailBox = document.getElementById("detailBox");

let currentPage = 1;
let currentLang = "";
// Only tracks the current page's selection — cleared on every load(), since
// a fresh page of rows means the checkboxes on screen no longer match it.
let selectedIds = new Set();

function reportDeleteResult(result) {
  const skippedInUse = result.skipped.filter((s) => s.reason === "in_use").length;
  if (skippedInUse > 0) {
    showError(
      `${result.deleted.length} excluído(s). ${skippedInUse} não puderam ser excluídos: em uso por uma sala.`
    );
  }
}

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

function updateDeleteSelectedBtn() {
  deleteSelectedBtn.disabled = selectedIds.size === 0;
  deleteSelectedBtn.textContent = "";
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", "trash-2");
  icon.className = "icon";
  deleteSelectedBtn.appendChild(icon);
  deleteSelectedBtn.append(
    selectedIds.size > 0 ? `Excluir selecionados (${selectedIds.size})` : "Excluir selecionados"
  );
  safeCreateIcons();
}

async function load() {
  selectedIds = new Set();
  updateDeleteSelectedBtn();
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
      <thead><tr><th><input type="checkbox" id="selectAllCheckbox" /></th><th>#</th><th>Idioma</th><th>Conteúdo</th><th></th></tr></thead><tbody>`;
    data.rows.forEach((t) => {
      const preview = t.content.length > 90 ? t.content.slice(0, 90) + "…" : t.content;
      html += `<tr data-id="${t.id}">
        <td><input type="checkbox" class="row-checkbox" data-id="${t.id}" /></td>
        <td style="cursor:pointer;">${t.id}</td>
        <td style="cursor:pointer;">${t.lang.toUpperCase()}</td>
        <td style="cursor:pointer;">${escapeHtml(preview)}</td>
        <td class="actions"><button class="icon-btn edit-btn" data-id="${t.id}" title="Editar"><i data-lucide="pencil" class="icon"></i></button></td>
      </tr>`;
    });
    html += "</tbody></table>";
    tableWrap.innerHTML = html;
    safeCreateIcons();

    const rowsById = new Map(data.rows.map((t) => [String(t.id), t]));
    tableWrap.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest(".edit-btn") || e.target.closest(".row-checkbox")) return;
        openEditor(rowsById.get(tr.dataset.id));
      });
    });
    tableWrap.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => openEditor(rowsById.get(btn.dataset.id)));
    });

    const selectAllCheckbox = document.getElementById("selectAllCheckbox");
    const rowCheckboxes = tableWrap.querySelectorAll(".row-checkbox");
    rowCheckboxes.forEach((cb) => {
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) selectedIds.add(Number(cb.dataset.id));
        else selectedIds.delete(Number(cb.dataset.id));
        selectAllCheckbox.checked = selectedIds.size === rowCheckboxes.length;
        selectAllCheckbox.indeterminate = selectedIds.size > 0 && selectedIds.size < rowCheckboxes.length;
        updateDeleteSelectedBtn();
      });
    });
    selectAllCheckbox.addEventListener("change", () => {
      selectedIds = new Set();
      rowCheckboxes.forEach((cb) => {
        cb.checked = selectAllCheckbox.checked;
        if (cb.checked) selectedIds.add(Number(cb.dataset.id));
      });
      updateDeleteSelectedBtn();
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

deleteSelectedBtn.addEventListener("click", async () => {
  if (selectedIds.size === 0) return;
  if (!confirm(`Excluir ${selectedIds.size} texto(s) selecionado(s)?`)) return;
  try {
    const result = await adminFetch("/api/admin/texts", {
      method: "DELETE",
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    reportDeleteResult(result);
    load();
  } catch (err) {
    showError(err.message);
  }
});

deleteAllBtn.addEventListener("click", async () => {
  const scope = currentLang ? ` (idioma ${currentLang.toUpperCase()})` : "";
  if (!confirm(`Excluir TODOS os textos${scope}? Esta ação não pode ser desfeita.`)) return;
  try {
    const result = await adminFetch("/api/admin/texts", {
      method: "DELETE",
      body: JSON.stringify({ all: true, lang: currentLang || undefined }),
    });
    reportDeleteResult(result);
    currentPage = 1;
    load();
  } catch (err) {
    showError(err.message);
  }
});

load();
