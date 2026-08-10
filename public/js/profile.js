const { t, lang } = window.i18n;

function usernameFromPath() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  const idx = segments.indexOf("profile");
  return idx !== -1 && segments[idx + 1] ? decodeURIComponent(segments[idx + 1]) : null;
}

const profileTitle = document.getElementById("profileTitle");
const profileSub = document.getElementById("profileSub");
const summaryStats = document.getElementById("summaryStats");
const historyWrap = document.getElementById("historyWrap");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const DATE_LOCALES = { pt: "pt-BR", en: "en-US" };

function formatDate(ts) {
  return new Date(ts).toLocaleString(DATE_LOCALES[lang] || "en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function resolveUsername() {
  const fromPath = usernameFromPath();
  if (fromPath) return fromPath;
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  const me = await res.json();
  return me.username;
}

resolveUsername().then((username) => {
  if (!username) {
    window.location.href = "/";
    return;
  }
  loadProfile(username);
});

function loadProfile(username) {
  fetch(`/api/users/${encodeURIComponent(username)}/stats`)
  .then(async (r) => {
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error ? t(`errors.${data.error}`) : t("errors.load_profile_failed"));
    }
    return r.json();
  })
  .then((data) => {
    profileTitle.textContent = data.displayName;
    profileSub.textContent = `@${data.username}`;

    const s = data.summary;
    summaryStats.innerHTML = `
      <div class="stat"><div class="val">${s.bestWpm}</div><div class="lbl">${escapeHtml(t("profile.statBestWpm"))}</div></div>
      <div class="stat"><div class="val">${s.avgWpm}</div><div class="lbl">${escapeHtml(t("profile.statAvgWpm"))}</div></div>
      <div class="stat"><div class="val">${s.avgAccuracy}%</div><div class="lbl">${escapeHtml(t("profile.statAvgAccuracy"))}</div></div>
      <div class="stat"><div class="val">${s.races}</div><div class="lbl">${escapeHtml(t("profile.statRaces"))}</div></div>
      <div class="stat"><div class="val">${s.wins}</div><div class="lbl">${escapeHtml(t("profile.statWins"))}</div></div>
      <div class="stat"><div class="val">${s.winRate}%</div><div class="lbl">${escapeHtml(t("profile.statWinRate"))}</div></div>
    `;

    if (!data.history.length) {
      historyWrap.innerHTML = `<div class="empty-msg">${escapeHtml(t("profile.noRaces"))}</div>`;
      return;
    }

    let html = `<table class="leaderboard">
      <thead><tr><th>${escapeHtml(t("profile.thWhen"))}</th><th>${escapeHtml(t("profile.thRoom"))}</th><th>${escapeHtml(t("profile.thPosition"))}</th><th>${escapeHtml(t("profile.thWpm"))}</th><th>${escapeHtml(t("profile.thAccuracy"))}</th><th>${escapeHtml(t("profile.thTime"))}</th></tr></thead><tbody>`;
    data.history.forEach((h) => {
      html += `<tr>
        <td>${formatDate(h.finishedAt)}</td>
        <td><code class="room-code" style="font-size:0.8rem;">${escapeHtml(h.roomCode)}</code></td>
        <td>${escapeHtml(t("profile.positionOf", { position: h.position, total: h.totalRacers }))}</td>
        <td>${h.wpm}</td>
        <td>${h.accuracy}%</td>
        <td>${(h.timeMs / 1000).toFixed(1)}s</td>
      </tr>`;
    });
    html += "</tbody></table>";
    historyWrap.innerHTML = html;
  })
  .catch((err) => {
    profileTitle.textContent = t("profile.notFound");
    profileSub.textContent = "";
    historyWrap.innerHTML = `<div class="empty-msg">${escapeHtml(err.message)}</div>`;
  });
}
