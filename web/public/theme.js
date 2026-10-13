// Theme (Auto / Light / Dark) shared by every page, plus the guide-language helper.
// Loaded as a classic script in <head> so the theme is applied before the page paints.
(function () {
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const ORDER = ['auto', 'light', 'dark'];
  const LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
  const TIP = { auto: 'Theme follows your system - click for Light', light: 'Light theme - click for Dark', dark: 'Dark theme - click for Auto' };

  function apply(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    for (const b of document.querySelectorAll('.theme-btn')) { b.textContent = LABEL[mode]; b.title = TIP[mode]; }
  }
  let mode = ORDER.includes(get('theme')) ? get('theme') : 'auto';
  apply(mode);

  window.cycleTheme = function () {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    set('theme', mode);
    apply(mode);
  };

  // Guide in the reader's language: remembered choice, else the browser language.
  window.guideHref = function () {
    const lang = get('guideLang') || ((navigator.language || '').toLowerCase().startsWith('th') ? 'th' : 'en');
    return lang === 'th' ? 'guide-th.html' : 'guide.html';
  };
  window.setGuideLang = (lang) => set('guideLang', lang);

  document.addEventListener('DOMContentLoaded', () => {
    apply(mode);
    for (const b of document.querySelectorAll('.theme-btn')) b.addEventListener('click', window.cycleTheme);
    for (const a of document.querySelectorAll('a[data-guide]')) a.href = window.guideHref();
  });
})();
