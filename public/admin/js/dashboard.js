const statGrid = document.getElementById("statGrid");
const errorBox = document.getElementById("errorBox");

// Colors validated with the dataviz skill's palette validator
// (node scripts/validate_palette.js) for categorical CVD-safety — brand
// red/orange are too close in hue for a 2-series chart, so this pair (not
// the app's own brand tokens) is used specifically here.
const isDark = () => (document.documentElement.getAttribute("data-theme") || "dark") !== "light";
const seriesColor = () => (isDark() ? "#e66767" : "#e34948"); // single-series: app's own brand red
const categorical = () =>
  isDark() ? ["#3987e5", "#d95926", "#199e70", "#c98500"] : ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const gridColor = () => (isDark() ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)");
const textColor = () => (isDark() ? "#9ca3af" : "#64748b");

function statCard(value, label) {
  const div = document.createElement("div");
  div.className = "stat";
  div.innerHTML = `<div class="val">${value}</div><div class="lbl">${escapeHtml(label)}</div>`;
  return div;
}

let racesChart, langChart;

function renderCharts(stats) {
  const ctxRaces = document.getElementById("racesChart");
  const ctxLang = document.getElementById("langChart");

  if (racesChart) racesChart.destroy();
  if (langChart) langChart.destroy();

  racesChart = new Chart(ctxRaces, {
    type: "bar",
    data: {
      labels: stats.racesPerDay.map((d) => d.date.slice(5)),
      datasets: [
        {
          label: "Corridas",
          data: stats.racesPerDay.map((d) => d.count),
          backgroundColor: seriesColor(),
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: textColor() }, grid: { color: gridColor() } },
        x: { ticks: { color: textColor() }, grid: { display: false } },
      },
    },
  });

  const langColors = categorical();
  langChart = new Chart(ctxLang, {
    type: "bar",
    data: {
      labels: stats.textsByLang.map((l) => l.lang.toUpperCase()),
      datasets: [
        {
          label: "Textos",
          data: stats.textsByLang.map((l) => l.count),
          backgroundColor: stats.textsByLang.map((_, i) => langColors[i % langColors.length]),
          borderRadius: 4,
          maxBarThickness: 40,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: textColor() }, grid: { color: gridColor() } },
        x: { ticks: { color: textColor() }, grid: { display: false } },
      },
    },
  });
}

async function load() {
  try {
    const stats = await adminFetch("/api/admin/stats");
    statGrid.innerHTML = "";
    statGrid.append(
      statCard(stats.totalUsers, "Usuários"),
      statCard(stats.totalRoomsEver, "Salas (total)"),
      statCard(stats.totalRaces, "Corridas concluídas"),
      statCard(stats.liveRoomsCount, "Salas ao vivo"),
      statCard(stats.liveParticipants, "Corredores ao vivo"),
      statCard(stats.liveSpectators, "Espectadores (telão)")
    );
    renderCharts(stats);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add("show");
  }
}

load();
// Re-render with the new mode's chart colors after a theme switch.
document.getElementById("themeToggle").addEventListener("click", () => setTimeout(load, 50));
