// Runs render-blocking, before every other page script, so the page is
// already in the right language by the time anything else touches the DOM.
// Language is NOT a visible picker: it's the browser's language unless the
// URL explicitly starts with /pt or /en, in which case that choice sticks
// (stored in localStorage) for future navigation without a prefix too.
(function () {
  const SUPPORTED_LANGS = ["pt", "en"];
  const DEFAULT_LANG = "pt";
  const STORAGE_KEY = "tekla_lang";

  function langFromPath() {
    const segment = window.location.pathname.split("/")[1];
    return SUPPORTED_LANGS.includes(segment) ? segment : null;
  }

  function langFromBrowser() {
    const candidates = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (const candidate of candidates) {
      const base = String(candidate).slice(0, 2).toLowerCase();
      if (SUPPORTED_LANGS.includes(base)) return base;
    }
    return null;
  }

  function resolveLang() {
    const pathLang = langFromPath();
    if (pathLang) {
      localStorage.setItem(STORAGE_KEY, pathLang);
      return pathLang;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored;

    const lang = langFromBrowser() || DEFAULT_LANG;
    localStorage.setItem(STORAGE_KEY, lang);
    return lang;
  }

  const lang = resolveLang();
  let dict = {};
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/i18n/${lang}.json`, false); // sync: must be ready before other scripts run
    xhr.send(null);
    if (xhr.status === 200) dict = JSON.parse(xhr.responseText);
  } catch (err) {
    console.error("i18n: failed to load dictionary for", lang, err);
  }

  function t(key, vars) {
    let value = dict;
    for (const part of key.split(".")) {
      value = value && typeof value === "object" ? value[part] : undefined;
    }
    if (typeof value !== "string") return key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) value = value.replaceAll(`{${k}}`, v);
    }
    return value;
  }

  function applyStaticTranslations() {
    document.documentElement.setAttribute("lang", lang === "pt" ? "pt-BR" : "en");
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
    });
    document.querySelectorAll("[data-i18n-content]").forEach((el) => {
      el.setAttribute("content", t(el.getAttribute("data-i18n-content")));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyStaticTranslations);
  } else {
    applyStaticTranslations();
  }

  window.i18n = { t, lang, SUPPORTED_LANGS };
})();
