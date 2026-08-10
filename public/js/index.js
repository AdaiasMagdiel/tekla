const { t, lang, SUPPORTED_LANGS } = window.i18n;

function langPrefix() {
  const seg = window.location.pathname.split("/")[1];
  return SUPPORTED_LANGS.includes(seg) ? `/${seg}` : "";
}

const usernameEl = document.getElementById("username");
const displayNameEl = document.getElementById("displayName");
const roomCodeEl = document.getElementById("roomCode");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const errorBox = document.getElementById("errorBox");
const characterPicker = document.getElementById("characterPicker");

let stored = JSON.parse(localStorage.getItem("tekla_user") || "null");
if (stored) {
  usernameEl.value = stored.username;
  displayNameEl.value = stored.displayName;
  document.getElementById("profileLink").style.display = "inline-flex";
}

let characters = [];

async function loadCharacterPicker() {
  const res = await fetch("/api/characters");
  characters = await res.json();
  characterPicker.innerHTML = "";

  const selectedId = stored ? stored.characterId : null;

  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "character-option none-option" + (selectedId == null ? " selected" : "");
  noneBtn.textContent = "🏎️";
  noneBtn.title = t("index.noCharacter");
  noneBtn.addEventListener("click", () => selectCharacter(null));
  characterPicker.appendChild(noneBtn);

  characters.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "character-option" + (selectedId === c.id ? " selected" : "");
    btn.title = c.name;
    const img = document.createElement("img");
    img.src = c.imagePath;
    img.alt = c.name;
    btn.appendChild(img);
    btn.addEventListener("click", () => selectCharacter(c.id));
    characterPicker.appendChild(btn);
  });
}

async function selectCharacter(characterId) {
  const user = await ensureUser();
  if (!user) return;

  const res = await fetch(`/api/users/${user.id}/character`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId }),
  });
  const data = await res.json();
  if (!res.ok) return;

  stored = { ...user, characterId: data.characterId, characterImagePath: data.characterImagePath ?? null };
  localStorage.setItem("tekla_user", JSON.stringify(stored));

  [...characterPicker.children].forEach((el, i) => {
    el.classList.toggle("selected", i === 0 ? characterId == null : characters[i - 1]?.id === characterId);
  });
}

loadCharacterPicker();

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
}
function showErrorCode(code) {
  showError(t(`errors.${code}`));
}
function clearError() {
  errorBox.classList.remove("show");
  errorBox.textContent = "";
}

async function ensureUser() {
  clearError();
  const username = usernameEl.value.trim();
  const displayName = displayNameEl.value.trim();

  if (!/^[a-zA-Z0-9_.]{3,16}$/.test(username)) {
    showErrorCode("invalid_username");
    return null;
  }
  if (!displayName) {
    showErrorCode("missing_display_name");
    return null;
  }

  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, displayName }),
  });
  const data = await res.json();
  if (!res.ok) {
    showError(data.error ? t(`errors.${data.error}`) : t("errors.create_user_failed"));
    return null;
  }
  localStorage.setItem("tekla_user", JSON.stringify(data));
  return data;
}

createBtn.addEventListener("click", async () => {
  createBtn.disabled = true;
  const user = await ensureUser();
  if (!user) { createBtn.disabled = false; return; }

  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: user.id, lang }),
  });
  const data = await res.json();
  createBtn.disabled = false;
  if (!res.ok) return showError(data.error ? t(`errors.${data.error}`) : t("errors.create_room_failed"));
  window.location.href = `${langPrefix()}/room/${data.code}`;
});

joinBtn.addEventListener("click", async () => {
  joinBtn.disabled = true;
  const user = await ensureUser();
  if (!user) { joinBtn.disabled = false; return; }

  const code = roomCodeEl.value.trim().toUpperCase();
  if (code.length < 4) {
    showErrorCode("invalid_room_code");
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
  if (!res.ok) return showError(data.error ? t(`errors.${data.error}`) : t("errors.join_room_failed"));
  window.location.href = `${langPrefix()}/room/${code}`;
});

roomCodeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
