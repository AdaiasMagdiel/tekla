const params = new URLSearchParams(window.location.search);
let roomCode = (params.get("code") || "").toUpperCase();

const mirrorStatus = document.getElementById("mirrorStatus");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const codeForm = document.getElementById("codeForm");
const codeInput = document.getElementById("codeInput");
const codeSubmit = document.getElementById("codeSubmit");
const errorBox = document.getElementById("errorBox");
const mirrorMain = document.getElementById("mirrorMain");
const mirrorTrack = document.getElementById("mirrorTrack");
const mirrorTextPanel = document.getElementById("mirrorTextPanel");
const mirrorResults = document.getElementById("mirrorResults");
const mirrorResultsList = document.getElementById("mirrorResultsList");
const countdownOverlay = document.getElementById("countdownOverlay");
const countdownNum = document.getElementById("countdownNum");

let ws = null;
let raceStarted = false;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
}

function connect(code) {
  roomCode = code;
  roomCodeLabel.textContent = code;
  roomCodeLabel.style.display = "inline";
  mirrorStatus.style.display = "inline";
  codeForm.style.display = "none";
  mirrorMain.style.display = "block";
  mirrorStatus.textContent = "conectando…";

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${window.location.host}/ws?room=${code}&spectator=1`);

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "error") {
      mirrorMain.style.display = "none";
      codeForm.style.display = "block";
      roomCodeLabel.style.display = "none";
      mirrorStatus.style.display = "none";
      showError(msg.message);
      history.replaceState(null, "", "/mirror.html");
    } else if (msg.type === "state") {
      mirrorStatus.textContent = statusLabel(msg.room.status);
      render(msg.room);
    } else if (msg.type === "countdown") {
      showCountdown(msg.n);
    } else if (msg.type === "go") {
      countdownOverlay.classList.remove("show");
      raceStarted = true;
      mirrorTextPanel.textContent = msg.text;
      mirrorTextPanel.classList.remove("blurred");
      mirrorStatus.textContent = "corrida em andamento";
    } else if (msg.type === "progress") {
      render(msg.room);
    } else if (msg.type === "finish") {
      mirrorStatus.textContent = "corrida finalizada";
      render(msg.room);
      showResults(msg.room);
    }
  });

  ws.addEventListener("close", () => {
    mirrorStatus.textContent = "conexão perdida";
  });
}

function statusLabel(status) {
  return { waiting: "aguardando início", countdown: "preparando…", racing: "corrida em andamento", finished: "corrida finalizada" }[status] || status;
}

function render(room) {
  if (room.text && !raceStarted) {
    mirrorTextPanel.textContent = room.text;
    mirrorTextPanel.classList.add("blurred");
  }

  mirrorTrack.innerHTML = "";
  const carSize = 46;

  room.participants
    .slice()
    .sort((a, b) => (b.progress || 0) - (a.progress || 0))
    .forEach((p) => {
      const lane = document.createElement("div");
      lane.className = "mirror-lane";

      const nameRow = document.createElement("div");
      nameRow.className = "name-row";
      nameRow.innerHTML = `<span class="dot" style="background:${p.carColor}"></span>${escapeHtml(p.displayName)} ${!p.connected ? '<span class="badge-pill waiting">offline</span>' : ""}`;
      lane.appendChild(nameRow);

      const metrics = document.createElement("div");
      metrics.className = "metrics";
      const secs = ((p.elapsedMs || 0) / 1000).toFixed(1);
      metrics.innerHTML = `
        <div class="metric"><div class="val">${p.wpm || 0}</div><div class="lbl">PPM</div></div>
        <div class="metric"><div class="val">${p.accuracy ?? 100}%</div><div class="lbl">Precisão</div></div>
        <div class="metric ${p.finished ? "finish-badge" : ""}"><div class="val">${secs}s</div><div class="lbl">${p.finished ? `#${p.position}` : "Tempo"}</div></div>
      `;
      lane.appendChild(metrics);

      const trackRow = document.createElement("div");
      trackRow.className = "track-row";
      const car = document.createElement("div");
      car.className = "car" + (p.finished ? " finished" : "");
      car.textContent = "🏎️";
      const pct = Math.min(1, p.progress || 0);
      car.style.left = `calc(${pct * 100}% - ${pct * carSize}px)`;
      trackRow.appendChild(car);
      lane.appendChild(trackRow);

      mirrorTrack.appendChild(lane);
    });
}

function showCountdown(n) {
  countdownOverlay.classList.add("show");
  countdownNum.textContent = n > 0 ? n : "Vai!";
  countdownNum.classList.remove("c-red", "c-yellow", "c-green");
  countdownNum.classList.add(n >= 4 ? "c-red" : n >= 2 ? "c-yellow" : "c-green");
  countdownNum.style.animation = "none";
  void countdownNum.offsetWidth;
  countdownNum.style.animation = "pop 0.5s ease";
  if (n <= 0) {
    setTimeout(() => countdownOverlay.classList.remove("show"), 500);
  }
}

function showResults(room) {
  mirrorResults.style.display = "block";
  mirrorResultsList.innerHTML = "";

  const finishers = room.participants.filter((p) => p.finished).sort((a, b) => a.position - b.position);
  const unfinished = room.participants.filter((p) => !p.finished);

  [...finishers, ...unfinished].forEach((p) => {
    const li = document.createElement("li");
    const posClass = p.position === 1 ? "gold" : p.position === 2 ? "silver" : p.position === 3 ? "bronze" : "";
    const posLabel = p.finished ? `#${p.position}` : "—";
    const meta = p.finished ? `${(p.finishTimeMs / 1000).toFixed(1)}s · ${p.wpm} PPM · ${p.accuracy}% precisão` : "não terminou";
    li.innerHTML = `
      <div class="pos-badge ${posClass}">${posLabel}</div>
      <div class="results-name">${escapeHtml(p.displayName)}</div>
      <div class="results-meta">${meta}</div>
    `;
    mirrorResultsList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

codeSubmit.addEventListener("click", () => {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 4) return showError("Informe um código de sala válido.");
  history.replaceState(null, "", `/mirror.html?code=${code}`);
  connect(code);
});
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") codeSubmit.click();
});

if (roomCode) {
  connect(roomCode);
} else {
  codeForm.style.display = "block";
}
