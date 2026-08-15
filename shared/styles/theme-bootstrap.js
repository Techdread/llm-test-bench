/*
 * Theme bootstrap — single-script include.
 *
 * Usage (once per app, in <head> BEFORE any stylesheet link):
 *   <script src="../shared/styles/theme-bootstrap.js"></script>
 *
 * This is a CLASSIC (non-module) script so the browser runs it synchronously
 * before paint. That avoids the FOUC an ES module would cause (deferred load).
 *
 * Role in the disk-first persistence model:
 *   The data root on disk is authoritative for theme + theme-pack, but disk
 *   reads are async and require a directory handle that may not have
 *   permission yet. To keep first paint correct, app-prefs / suite-prefs
 *   mirror every theme write back into localStorage as a synchronous scratch
 *   (the same keys this script reads). On the next page load, this bootstrap
 *   pulls the scratch values and applies them instantly — by the time the
 *   ES-module hydrate completes, disk and LS already agree. This script is
 *   therefore a *reader* of the scratch, never the writer.
 *
 * What it does:
 *   1. Sets [data-theme] on <html> from localStorage["devtools-hub-theme"]
 *      (default: "dark").
 *   2. Sets [data-theme-pack] on <html> from the cascade:
 *        localStorage["<appKey>-theme-pack"]       (per-app override)
 *        ↳ localStorage["devtools-hub-theme-pack"] (global default)
 *        ↳ none.
 *   3. Listens for `storage` events so changes made in the Settings tab
 *      are reflected live in other open app tabs.
 *
 * The <appKey> is derived from the URL path. Hub (root or /index.html) → "hub".
 * Anything else uses its last directory segment.
 *
 * The picker UI in settings/app.js still imports shared/services/theme-pack.js
 * (the ES module) — that exports setters/getters and the pack registry, both
 * backed by suite-prefs / app-prefs. Regular apps do NOT need to import that
 * module; this bootstrap is enough.
 */
(function () {
  var GLOBAL_THEME = 'devtools-hub-theme';
  var GLOBAL_PACK  = 'devtools-hub-theme-pack';
  var GLOBAL_FONT  = 'devtools-hub-font';
  var PACK_SUFFIX  = '-theme-pack';

  function getAppKey() {
    var segs = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (segs.length === 0) return 'hub';
    var last = segs[segs.length - 1];
    if (/\.html?$/i.test(last)) {
      return segs.length > 1 ? segs[segs.length - 2] : 'hub';
    }
    return last;
  }

  function applyTheme() {
    var t = localStorage.getItem(GLOBAL_THEME) || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  }

  function applyPack() {
    var key = getAppKey();
    var pack = localStorage.getItem(key + PACK_SUFFIX)
            || localStorage.getItem(GLOBAL_PACK)
            || '';
    if (pack) document.documentElement.setAttribute('data-theme-pack', pack);
    else document.documentElement.removeAttribute('data-theme-pack');
  }

  function applyFont() {
    var f = localStorage.getItem(GLOBAL_FONT) || 'system';
    document.documentElement.setAttribute('data-font', f);
  }

  applyTheme();
  applyPack();
  applyFont();

  window.addEventListener('storage', function (e) {
    if (!e.key) return;
    if (e.key === GLOBAL_THEME) applyTheme();
    else if (e.key === GLOBAL_PACK || e.key.endsWith(PACK_SUFFIX)) applyPack();
    else if (e.key === GLOBAL_FONT) applyFont();
  });
})();
