const tableWrap = document.getElementById("tableWrap");
const pagination = document.getElementById("pagination");
const errorBox = document.getElementById("errorBox");
const newBtn = document.getElementById("newBtn");
const detailModal = document.getElementById("detailModal");
const detailBox = document.getElementById("detailBox");

let currentPage = 1;

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

// adminFetch (shared.js) always JSON-encodes the body, so it can't carry a
// multipart file upload — this does the same error-handling but with FormData.
async function uploadFetch(url, method, formData) {
  const res = await fetch(url, { method, body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function openEditor(character) {
  const isNew = !character;
  const c = character || { id: null, name: "", imagePath: "" };
  detailBox.innerHTML = `
    <h2>${isNew ? "Novo personagem" : `Editar personagem #${c.id}`}</h2>
    <label for="editName">Nome</label>
    <input type="text" id="editName" value="${escapeHtml(c.name)}" maxlength="40" />
    <label for="editImage" style="margin-top:12px; display:block;">Imagem</label>
    <input type="file" id="editImage" accept="image/png,image/jpeg,image/webp,image/gif" />
    <div style="margin-top:12px;">
      <img id="previewImg" src="${escapeHtml(c.imagePath)}" alt=""
        style="width:96px;height:96px;object-fit:cover;border-radius:8px;${c.imagePath ? "" : "display:none;"}" />
    </div>
    <div class="modal-actions">
      ${isNew ? "" : '<button class="btn btn-secondary" id="deleteBtn"><i data-lucide="trash-2" class="icon"></i>Excluir</button>'}
      <button class="btn btn-primary" id="saveBtn"><i data-lucide="check" class="icon"></i>Salvar</button>
    </div>
  `;
  detailModal.classList.add("show");
  safeCreateIcons();

  const previewImg = document.getElementById("previewImg");
  document.getElementById("editImage").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    previewImg.src = URL.createObjectURL(file);
    previewImg.style.display = "";
  });

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const name = document.getElementById("editName").value.trim();
    const file = document.getElementById("editImage").files[0];
    if (!name) return;
    if (isNew && !file) {
      showError("Selecione uma imagem.");
      return;
    }
    const formData = new FormData();
    formData.append("name", name);
    if (file) formData.append("image", file);

    try {
      if (isNew) {
        await uploadFetch("/api/admin/characters", "POST", formData);
      } else {
        await uploadFetch(`/api/admin/characters/${c.id}`, "PATCH", formData);
      }
      closeModal();
      load();
    } catch (err) {
      showError(err.message);
    }
  });

  if (!isNew) {
    document.getElementById("deleteBtn").addEventListener("click", async () => {
      if (!confirm(`Excluir o personagem "${c.name}"?`)) return;
      try {
        await adminFetch(`/api/admin/characters/${c.id}`, { method: "DELETE" });
        closeModal();
        load();
      } catch (err) {
        showError(err.message);
      }
    });
  }
}

async function load() {
  try {
    const data = await adminFetch(`/api/admin/characters?page=${currentPage}`);
    if (!data.rows.length) {
      tableWrap.innerHTML = '<div class="empty-msg">Nenhum personagem cadastrado.</div>';
      pagination.innerHTML = "";
      return;
    }
    let html = `<table class="admin-table">
      <thead><tr><th></th><th>#</th><th>Nome</th><th>Em uso</th><th></th></tr></thead><tbody>`;
    data.rows.forEach((c) => {
      html += `<tr data-id="${c.id}" style="cursor:pointer;">
        <td><img src="${escapeHtml(c.imagePath)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:4px;"></td>
        <td>${c.id}</td>
        <td>${escapeHtml(c.name)}</td>
        <td>${c.usageCount}</td>
        <td class="actions"><button class="icon-btn edit-btn" data-id="${c.id}" title="Editar"><i data-lucide="pencil" class="icon"></i></button></td>
      </tr>`;
    });
    html += "</tbody></table>";
    tableWrap.innerHTML = html;
    safeCreateIcons();

    const rowsById = new Map(data.rows.map((c) => [String(c.id), c]));
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

newBtn.addEventListener("click", () => openEditor(null));

load();
