const { t, lang, SUPPORTED_LANGS } = window.i18n;

function langPrefix() {
  const seg = window.location.pathname.split("/")[1];
  return SUPPORTED_LANGS.includes(seg) ? `/${seg}` : "";
}

const authPanel = document.getElementById("authPanel");
const appPanel = document.getElementById("appPanel");
const usernameEl = document.getElementById("username");
const displayNameEl = document.getElementById("displayName");
const displayNameField = document.getElementById("displayNameField");
const passwordEl = document.getElementById("password");
const loginTabBtn = document.getElementById("loginTabBtn");
const registerTabBtn = document.getElementById("registerTabBtn");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const errorBox = document.getElementById("errorBox");
const appErrorBox = document.getElementById("appErrorBox");
const welcomeMsg = document.getElementById("welcomeMsg");
const logoutBtn = document.getElementById("logoutBtn");
const roomCodeEl = document.getElementById("roomCode");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const characterPicker = document.getElementById("characterPicker");

let currentUser = null;
let authMode = "register"; // "register" | "login"
let characters = [];

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
function showAppError(msg) {
  appErrorBox.textContent = msg;
  appErrorBox.classList.add("show");
}
function showAppErrorCode(code) {
  showAppError(t(`errors.${code}`));
}
function clearAppError() {
  appErrorBox.classList.remove("show");
  appErrorBox.textContent = "";
}

function setAuthMode(mode) {
  authMode = mode;
  clearError();
  const isRegister = mode === "register";
  displayNameField.style.display = isRegister ? "" : "none";
  passwordEl.setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
  authSubmitBtn.textContent = t(isRegister ? "index.registerButton" : "index.loginButton");
  loginTabBtn.classList.toggle("btn-primary", !isRegister);
  loginTabBtn.classList.toggle("btn-secondary", isRegister);
  registerTabBtn.classList.toggle("btn-primary", isRegister);
  registerTabBtn.classList.toggle("btn-secondary", !isRegister);
}

function showLoggedIn(user) {
  currentUser = user;
  authPanel.style.display = "none";
  appPanel.style.display = "";
  logoutBtn.style.display = "";
  const profileLink = document.getElementById("profileLink");
  profileLink.style.display = "inline-flex";
  profileLink.href = `${langPrefix()}/profile/${encodeURIComponent(user.username)}`;
  welcomeMsg.textContent = t("index.welcome", { name: user.displayName });
  loadCharacterPicker();
}

function showLoggedOut() {
  currentUser = null;
  authPanel.style.display = "";
  appPanel.style.display = "none";
  logoutBtn.style.display = "none";
  document.getElementById("profileLink").style.display = "none";
}

async function loadCharacterPicker() {
  const res = await fetch("/api/characters");
  characters = await res.json();
  characterPicker.innerHTML = "";

  const selectedId = currentUser ? currentUser.characterId : null;

  if (characters.length === 0) {
    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className = "character-option none-option" + (selectedId == null ? " selected" : "");
    noneBtn.textContent = "🏎️";
    noneBtn.title = t("index.noCharacter");
    noneBtn.addEventListener("click", () => selectCharacter(null));
    characterPicker.appendChild(noneBtn);
  }

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
  if (!currentUser) return;
  clearAppError();

  const res = await fetch("/api/me/character", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId }),
  });
  const data = await res.json();
  if (!res.ok) return showAppErrorCode(data.error || "create_user_failed");

  currentUser = { ...currentUser, characterId: data.characterId, characterImagePath: data.characterImagePath ?? null };

  const hasNoneBtn = characters.length === 0;
  [...characterPicker.children].forEach((el, i) => {
    el.classList.toggle(
      "selected",
      hasNoneBtn && i === 0 ? characterId == null : characters[hasNoneBtn ? i - 1 : i]?.id === characterId,
    );
  });
}

loginTabBtn.addEventListener("click", () => setAuthMode("login"));
registerTabBtn.addEventListener("click", () => setAuthMode("register"));

authSubmitBtn.addEventListener("click", async () => {
  clearError();
  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (!/^[a-zA-Z0-9_.]{3,16}$/.test(username)) {
    return showErrorCode("invalid_username");
  }
  if (!password || password.length < 8) {
    return showErrorCode("invalid_password");
  }

  authSubmitBtn.disabled = true;
  try {
    let res, data;
    if (authMode === "register") {
      const displayName = displayNameEl.value.trim();
      if (!displayName) return showErrorCode("missing_display_name");
      res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName, password }),
      });
    } else {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    }
    data = await res.json();
    if (!res.ok) {
      return showError(data.error ? t(`errors.${data.error}`) : t("errors.create_user_failed"));
    }
    passwordEl.value = "";
    showLoggedIn(data);
  } finally {
    authSubmitBtn.disabled = false;
  }
});

passwordEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") authSubmitBtn.click();
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  showLoggedOut();
  setAuthMode("login");
});

createBtn.addEventListener("click", async () => {
  clearAppError();
  createBtn.disabled = true;
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang }),
  });
  const data = await res.json();
  createBtn.disabled = false;
  if (!res.ok) return showAppError(data.error ? t(`errors.${data.error}`) : t("errors.create_room_failed"));
  window.location.href = `${langPrefix()}/room/${data.code}`;
});

joinBtn.addEventListener("click", async () => {
  clearAppError();
  const code = roomCodeEl.value.trim().toUpperCase();
  if (code.length < 4) {
    return showAppErrorCode("invalid_room_code");
  }

  joinBtn.disabled = true;
  const res = await fetch(`/api/rooms/${code}/join`, { method: "POST" });
  const data = await res.json();
  joinBtn.disabled = false;
  if (!res.ok) return showAppError(data.error ? t(`errors.${data.error}`) : t("errors.join_room_failed"));
  window.location.href = `${langPrefix()}/room/${code}`;
});

roomCodeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});

setAuthMode("register");

fetch("/api/auth/me")
  .then((r) => (r.ok ? r.json() : null))
  .then((user) => {
    if (user) showLoggedIn(user);
    else showLoggedOut();
  })
  .catch(() => showLoggedOut());
