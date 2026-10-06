/* Applies the saved theme and language before first paint to avoid a flash. MIT License. */
(function () {
  'use strict';
  var root = document.documentElement;
  try {
    var prefs = JSON.parse(localStorage.getItem('vdw.prefs.v1') || 'null');
    if (prefs && (prefs.theme === 'light' || prefs.theme === 'dark')) root.setAttribute('data-theme', prefs.theme);
    var lang = prefs && (prefs.lang === 'en' || prefs.lang === 'ko') ? prefs.lang
      : ((navigator.language || 'ko').toLowerCase().indexOf('ko') === 0 ? 'ko' : 'en');
    root.setAttribute('data-lang', lang);
    root.lang = lang;
  } catch (e) {
    root.setAttribute('data-lang', 'ko');
  }
})();
