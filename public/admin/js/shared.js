function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// lucide.createIcons() runs in the middle of every render function, right
// before the event listeners for that render get wired up. If it throws for
// any reason (e.g. the unpkg CDN didn't load), the exception was aborting
// the rest of the function — so buttons rendered after it (delete, close,
// save...) silently never got their click handlers attached.
function safeCreateIcons() {
  try {
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error("lucide.createIcons failed:", err);
  }
}

async function adminFetch(url, opts) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function renderPagination(container, { page, pageSize, total }, onChange) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  container.innerHTML = "";
  if (totalPages <= 1) return;

  const prev = document.createElement("button");
  prev.className = "btn btn-secondary";
  prev.textContent = "Anterior";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => onChange(page - 1));

  const next = document.createElement("button");
  next.className = "btn btn-secondary";
  next.textContent = "Próxima";
  next.disabled = page >= totalPages;
  next.addEventListener("click", () => onChange(page + 1));

  const label = document.createElement("span");
  label.textContent = `Página ${page} de ${totalPages} (${total} no total)`;

  container.append(prev, label, next);
}

document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  document.querySelectorAll(".admin-nav a").forEach((a) => {
    if (a.getAttribute("href") === path) a.classList.add("active");
  });
});
