const usernameEl = document.getElementById("username");
const displayNameEl = document.getElementById("displayName");
const roomCodeEl = document.getElementById("roomCode");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const errorBox = document.getElementById("errorBox");

const stored = JSON.parse(localStorage.getItem("typegp_user") || "null");
if (stored) {
  usernameEl.value = stored.username;
  displayNameEl.value = stored.displayName;
  document.getElementById("profileLink").style.display = "inline-flex";
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
}
function clearError() {
  errorBox.classList.remove("show");
  errorBox.textContent = "";
}

async function ensureUser() {
  clearError();
  const username = usernameEl.value.trim();
  const displayName = displayNameEl.value.trim();

  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
    showError("Username inválido. Use 3-16 caracteres: letras, números ou _.");
    return null;
  }
  if (!displayName) {
    showError("Informe seu nome.");
    return null;
  }

  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, displayName }),
  });
  const data = await res.json();
  if (!res.ok) {
    showError(data.error || "Erro ao criar usuário.");
    return null;
  }
  localStorage.setItem("typegp_user", JSON.stringify(data));
  return data;
}

createBtn.addEventListener("click", async () => {
  createBtn.disabled = true;
  const user = await ensureUser();
  if (!user) { createBtn.disabled = false; return; }

  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: user.id }),
  });
  const data = await res.json();
  createBtn.disabled = false;
  if (!res.ok) return showError(data.error || "Erro ao criar sala.");
  window.location.href = `/room.html?code=${data.code}`;
});

joinBtn.addEventListener("click", async () => {
  joinBtn.disabled = true;
  const user = await ensureUser();
  if (!user) { joinBtn.disabled = false; return; }

  const code = roomCodeEl.value.trim().toUpperCase();
  if (code.length < 4) {
    showError("Informe um código de sala válido.");
    joinBtn.disabled = false;
    return;
  }

  const res = await fetch(`/api/rooms/${code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: user.id }),
  });
  const data = await res.json();
  joinBtn.disabled = false;
  if (!res.ok) return showError(data.error || "Erro ao entrar na sala.");
  window.location.href = `/room.html?code=${code}`;
});

roomCodeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
