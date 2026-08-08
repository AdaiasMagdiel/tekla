// Runs render-blocking in <head> so the correct theme is set before first
// paint (no flash of the wrong theme).
(function () {
  const stored = localStorage.getItem("typegp_theme");
  const theme = stored || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);
})();
