(function () {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }

  function updateIcon() {
    btn.innerHTML =
      currentTheme() === "light"
        ? '<i data-lucide="moon" class="icon"></i>'
        : '<i data-lucide="sun" class="icon"></i>';
    if (window.lucide) window.lucide.createIcons();
  }

  btn.addEventListener("click", () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("typegp_theme", next);
    updateIcon();
  });

  updateIcon();
})();
