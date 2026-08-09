const { t } = window.i18n;

const params = new URLSearchParams(window.location.search);
const roomCode = (params.get("code") || "").toUpperCase();
const user = JSON.parse(localStorage.getItem("tekla_user") || "null");

if (!roomCode || !user) {
  window.location.href = "/";
}

document.getElementById("roomCodeLabel").textContent = roomCode;
document.getElementById("mirrorLink").href = `/mirror.html?code=${roomCode}`;

const track = document.getElementById("track");
const startBtn = document.getElementById("startBtn");
const waitingHostMsg = document.getElementById("waitingHostMsg");
const raceArea = document.getElementById("raceArea");
const textPanel = document.getElementById("textPanel");
const textChars = document.getElementById("textChars");
const caret = document.getElementById("caret");
const typingInput = document.getElementById("typingInput");
const statWpm = document.getElementById("statWpm");
const statAcc = document.getElementById("statAcc");
const statProgress = document.getElementById("statProgress");
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownNum = document.getElementById("countdownNum");
const resultsArea = document.getElementById("resultsArea");
const resultsList = document.getElementById("resultsList");
const copyHint = document.getElementById("copyHint");
const copyHintText = document.getElementById("copyHintText");

let targetText = null;
let startedAt = null;
let keystrokes = 0;
let correctKeystrokes = 0;
let finished = false;
let latestState = null;
let raceStarted = false;
let statsTicker = null;

copyHint.addEventListener("click", () => {
  const url = `${window.location.origin}/room.html?code=${roomCode}`;
  navigator.clipboard.writeText(url).then(() => {
    copyHintText.textContent = t("room.copyHintCopied");
    setTimeout(() => (copyHintText.textContent = t("room.copyHint")), 1500);
  });
});

const proto = window.location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${proto}://${window.location.host}/ws?room=${roomCode}&userId=${user.id}`);

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === "error") {
    alert(t(`errors.${msg.error}`));
    window.location.href = "/";
  } else if (msg.type === "state") {
    latestState = msg.room;
    renderState(msg.room);
  } else if (msg.type === "countdown") {
    showCountdown(msg.n);
  } else if (msg.type === "go") {
    targetText = msg.text;
    startedAt = Date.now();
    countdownOverlay.classList.remove("show");
    beginRace();
  } else if (msg.type === "progress") {
    latestState = msg.room;
    renderState(msg.room);
  } else if (msg.type === "finish") {
    latestState = msg.room;
    renderState(msg.room);
    showResults(msg.room);
  }
});

ws.addEventListener("close", () => {
  if (latestState && latestState.status !== "finished") {
    waitingHostMsg.textContent = t("room.connectionLost");
    waitingHostMsg.style.display = "block";
  }
});

startBtn.addEventListener("click", () => {
  ws.send(JSON.stringify({ type: "start" }));
});

function renderState(room) {
  const isHost = room.hostUserId === user.id;

  if (room.status === "waiting") {
    startBtn.style.display = isHost ? "inline-flex" : "none";
    waitingHostMsg.style.display = isHost ? "none" : "block";
    if (!isHost) waitingHostMsg.textContent = t("room.waitingHost");
  } else {
    startBtn.style.display = "none";
    waitingHostMsg.style.display = "none";
  }

  if (room.text && !raceStarted) {
    targetText = room.text;
    textPanel.style.display = "block";
    textPanel.classList.add("blurred");
    renderTextPanel("");
  }

  renderTrack(room);
}

function renderTrack(room) {
  track.innerHTML = "";
  const carSize = 40;

  room.participants
    .slice()
    .sort((a, b) => (a.userId === user.id ? -1 : b.userId === user.id ? 1 : 0))
    .forEach((p) => {
      const lane = document.createElement("div");
      lane.className = "lane" + (p.userId === user.id ? " me" : "");

      const statusBadge = p.connected
        ? ""
        : `<span class="badge-pill waiting">${escapeHtml(t("room.offline"))}</span>`;
      const label = document.createElement("div");
      label.className = "label";
      label.innerHTML = `<span class="dot" style="background:${p.carColor}"></span>${escapeHtml(p.displayName)}${p.userId === user.id ? escapeHtml(t("room.you")) : ""} ${statusBadge}`;
      lane.appendChild(label);

      const car = document.createElement("div");
      car.className = "car" + (p.finished ? " finished" : "");
      car.textContent = "🏎️";
      const pct = Math.min(1, p.progress || 0);
      car.style.left = `calc(${pct * 100}% - ${pct * carSize}px)`;
      lane.appendChild(car);

      if (p.finished) {
        const badge = document.createElement("div");
        badge.className = "badge";
        const secs = (p.finishTimeMs / 1000).toFixed(1);
        badge.textContent = `#${p.position} · ${secs}s`;
        lane.appendChild(badge);
      }

      track.appendChild(lane);
    });
}

function showCountdown(n) {
  countdownOverlay.classList.add("show");
  countdownNum.textContent = n > 0 ? n : t("countdown.go");
  countdownNum.classList.remove("c-red", "c-yellow", "c-green");
  countdownNum.classList.add(n >= 4 ? "c-red" : n >= 2 ? "c-yellow" : "c-green");
  countdownNum.style.animation = "none";
  void countdownNum.offsetWidth;
  countdownNum.style.animation = "pop 0.5s ease";
  if (n <= 0) {
    setTimeout(() => countdownOverlay.classList.remove("show"), 500);
  }
}

function beginRace() {
  raceStarted = true;
  raceArea.style.display = "block";
  textPanel.style.display = "block";
  textPanel.classList.remove("blurred");
  renderTextPanel("");
  typingInput.disabled = false;
  typingInput.value = "";
  typingInput.dataset.prevLen = 0;
  typingInput.placeholder = t("room.typingPlaceholderActive");
  typingInput.focus();

  // Keep PPM/precisão ticking even while the user pauses without typing,
  // since elapsed time (and thus PPM) keeps moving regardless of keystrokes.
  clearInterval(statsTicker);
  statsTicker = setInterval(() => updateStats(typingInput.value), 250);
}

function renderTextPanel(typed) {
  const target = targetText || "";
  let html = "";
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    let cls = "ch";
    if (i < typed.length) {
      cls += typed[i] === ch ? " correct" : " wrong";
    }
    html += `<span class="${cls}">${escapeHtml(ch)}</span>`;
  }
  textChars.innerHTML = html;
  updateCaret(typed.length);
}

// Moves the caret to the next character's position instead of rebuilding it,
// so it can glide there (transform transition) rather than jumping.
function updateCaret(index) {
  const target = targetText || "";
  if (!target.length) return;
  const span = textChars.children[Math.min(index, target.length - 1)];
  if (!span) return;

  const panelRect = textPanel.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const atEnd = index >= target.length;
  const x = spanRect.left - panelRect.left + (atEnd ? spanRect.width : 0);
  const y = spanRect.top - panelRect.top;

  caret.style.height = `${spanRect.height}px`;
  caret.style.transform = `translate(${x}px, ${y}px)`;
  caret.classList.add("show");
}

function correctPrefixLen(target, typed) {
  let i = 0;
  const max = Math.min(target.length, typed.length);
  while (i < max && typed[i] === target[i]) i++;
  return i;
}

// Ctrl/Cmd/Alt+Backspace deletes exactly ONE word (back to the previous
// space), never further — otherwise it's easy to wipe out several words at
// once and dodge the "fix your typo char by char" cost. Any other multi-char
// deletion (select-all+delete, cut, forward word/line delete) is capped to a
// single character so corrections always cost one keystroke per character.
function deleteOneWordBackward(el) {
  const pos = el.selectionStart;
  if (pos === 0) return;
  const value = el.value;
  let i = pos;
  while (i > 0 && value[i - 1] === " ") i--;
  while (i > 0 && value[i - 1] !== " ") i--;
  el.value = value.slice(0, i) + value.slice(pos);
  el.setSelectionRange(i, i);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function deleteOneChar(el) {
  const pos = el.selectionStart;
  if (pos === 0) return;
  el.value = el.value.slice(0, pos - 1) + el.value.slice(pos);
  el.setSelectionRange(pos - 1, pos - 1);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

typingInput.addEventListener("keydown", (e) => {
  if (e.key === "Backspace" && (e.ctrlKey || e.metaKey || e.altKey)) {
    e.preventDefault();
    deleteOneWordBackward(e.target);
  }
});

const MULTI_CHAR_DELETE_TYPES = new Set([
  "deleteWordForward",
  "deleteHardLineBackward",
  "deleteHardLineForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteEntireSoftLine",
  "deleteByCut",
]);

typingInput.addEventListener("beforeinput", (e) => {
  const el = e.target;
  const selLen = (el.selectionEnd ?? 0) - (el.selectionStart ?? 0);

  if (e.inputType === "deleteWordBackward") {
    e.preventDefault();
    deleteOneWordBackward(el);
    return;
  }

  const isMultiCharDelete = MULTI_CHAR_DELETE_TYPES.has(e.inputType) || selLen > 1;
  if (!isMultiCharDelete) return;

  e.preventDefault();
  deleteOneChar(el);
});

typingInput.addEventListener("input", (e) => {
  if (!targetText || finished) return;
  const value = e.target.value;
  const prevLen = typingInput.dataset.prevLen ? Number(typingInput.dataset.prevLen) : 0;

  if (value.length > prevLen) {
    for (let i = prevLen; i < value.length; i++) {
      keystrokes++;
      if (targetText[i] === value[i]) correctKeystrokes++;
    }
  }
  typingInput.dataset.prevLen = value.length;

  renderTextPanel(value);
  updateStats(value);

  ws.send(JSON.stringify({ type: "typing", value }));

  const cLen = correctPrefixLen(targetText, value);
  if (cLen === targetText.length) {
    finished = true;
    typingInput.disabled = true;
  }
});

function updateStats(typed) {
  const cLen = correctPrefixLen(targetText, typed);
  const elapsedMin = startedAt ? (Date.now() - startedAt) / 60000 : 0;
  const wpm = elapsedMin > 0 ? Math.round(cLen / 5 / elapsedMin) : 0;
  const acc = keystrokes > 0 ? Math.round((correctKeystrokes / keystrokes) * 100) : 100;
  const progress = targetText ? Math.round((cLen / targetText.length) * 100) : 0;

  statWpm.textContent = wpm;
  statAcc.textContent = `${acc}%`;
  statProgress.textContent = `${progress}%`;
}

function showResults(room) {
  clearInterval(statsTicker);
  raceArea.style.display = "none";
  resultsArea.style.display = "block";
  resultsList.innerHTML = "";

  const finishers = room.participants
    .filter((p) => p.finished)
    .sort((a, b) => a.position - b.position);
  const unfinished = room.participants.filter((p) => !p.finished);

  [...finishers, ...unfinished].forEach((p) => {
    const li = document.createElement("li");
    const posClass = p.position === 1 ? "gold" : p.position === 2 ? "silver" : p.position === 3 ? "bronze" : "";
    const posLabel = p.finished ? `#${p.position}` : "—";
    const meta = p.finished
      ? t("room.finishSummary", { time: (p.finishTimeMs / 1000).toFixed(1), wpm: p.wpm, accuracy: p.accuracy })
      : t("room.notFinished");
    li.innerHTML = `
      <div class="pos-badge ${posClass}">${posLabel}</div>
      <div class="results-name"><a href="/profile.html?u=${encodeURIComponent(p.username)}" style="color:inherit; text-decoration:none;">${escapeHtml(p.displayName)}</a>${p.userId === user.id ? escapeHtml(t("room.you")) : ""}</div>
      <div class="results-meta">${escapeHtml(meta)}</div>
    `;
    resultsList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.addEventListener("resize", () => {
  if (latestState) renderTrack(latestState);
  if (targetText) updateCaret(Number(typingInput.dataset.prevLen || 0));
});
