/*
 * Theme bootstrap: must run before first paint to prevent FOUC.
 * Resolution order: saved preference -> prefers-color-scheme -> light.
 * Kept in sync with src/context/ThemeContext.jsx (storage key 'hcw-theme').
 * Served as an external script so the CSP can drop 'unsafe-inline' from
 * script-src (OWASP A05 — Security Misconfiguration).
 */
(function () {
  try {
    const saved = window.localStorage && window.localStorage.getItem('hcw-theme');
    let theme;
    if (saved === 'light' || saved === 'dark') {
      theme = saved;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    } else {
      theme = 'light';
    }
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
