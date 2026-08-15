// Settings Sync — persists localStorage settings to cookies so they survive
// port changes.
//
// DEPRECATION NOTE (2026-05-07):
//   This module exists to work around localStorage's per-origin scoping —
//   switching from localhost:8080 to localhost:3000 loses LS state. Once
//   every shared service and app reads/writes through app-prefs / suite-prefs,
//   the data root on disk becomes the single source of truth, port-changes
//   stop mattering, and the LS keys this module syncs become an empty set.
//   At that point delete this file. The cookie fallback is harmless until
//   then — it just maintains parity for in-flight LS scratch values.
//
// Behaviour:
//   1. On import: restores missing localStorage entries from cookies.
//   2. On unload / visibility-hidden: backs up localStorage entries to cookies.
//
// Import this module BEFORE any code that reads localStorage (e.g. the
// OpenRouter consolidation IIFE) so that settings are restored first.

const COOKIE_PREFIX = 'dh__';
const MAX_AGE = 365 * 24 * 60 * 60; // 1 year
const MAX_COOKIE_VALUE_LEN = 3500;   // leave headroom within 4KB cookie limit

// Large caches that should NOT be synced (transient, too big for cookies)
const SKIP_KEYS = new Set([
  'devtools-hub-openrouter-models',
  'devtools-hub-model-cache',
]);

// Known app prefixes whose preferences should be synced
const APP_PREFIXES = [
  'devtools-hub-',
  'prompt-gallery-',
  'code-arena-',
  'svg-benchmark-',
  'html-viewer-',
  'component-playground-',
  'css-grader-',
  'doc-writer-',
  'email-tester-',
  'figma-clone-',
  'figma-v2-',
  'markdown-workshop-',
  'portfolio-gen-',
  'regex-tester-',
  'slide-builder-',
  'api-viewer-',
  'three-prompt-lab-',
];

function shouldSync(key) {
  if (SKIP_KEYS.has(key)) return false;
  return APP_PREFIXES.some(p => key.startsWith(p));
}

// ── Cookie helpers ──

function setCookie(name, value) {
  const encoded = encodeURIComponent(value);
  if (encoded.length > MAX_COOKIE_VALUE_LEN) {
    // Value too large for a single cookie — skip silently
    return;
  }
  document.cookie = `${name}=${encoded}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}

function deleteCookie(name) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

function getAllCookies() {
  const result = {};
  for (const part of document.cookie.split('; ')) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const name = part.substring(0, eqIdx);
    const value = part.substring(eqIdx + 1);
    result[name] = decodeURIComponent(value);
  }
  return result;
}

// ── Restore: cookies → localStorage (on import) ──

function restoreFromCookies() {
  let restored = 0;
  const cookies = getAllCookies();
  for (const [cookieName, value] of Object.entries(cookies)) {
    if (!cookieName.startsWith(COOKIE_PREFIX)) continue;
    const key = cookieName.substring(COOKIE_PREFIX.length);
    // Only restore if localStorage is empty for this key
    if (localStorage.getItem(key) === null && value) {
      localStorage.setItem(key, value);
      restored++;
    }
  }
  if (restored > 0) {
    console.log(`[settings-sync] Restored ${restored} setting(s) from cookies`);
  }
}

// ── Backup: localStorage → cookies (on unload) ──

function backupToCookies() {
  let backed = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!shouldSync(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) {
      setCookie(COOKIE_PREFIX + key, value);
      backed++;
    }
  }
  // Clean up cookies for keys that were removed from localStorage
  const cookies = getAllCookies();
  for (const cookieName of Object.keys(cookies)) {
    if (!cookieName.startsWith(COOKIE_PREFIX)) continue;
    const key = cookieName.substring(COOKIE_PREFIX.length);
    if (shouldSync(key) && localStorage.getItem(key) === null) {
      deleteCookie(cookieName);
    }
  }
}

// ── Auto-initialize ──

// Step 1: Restore immediately (before any other module code runs)
restoreFromCookies();

// Step 2: Back up when leaving the page or switching tabs
window.addEventListener('beforeunload', backupToCookies);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') backupToCookies();
});

// Step 3: Also back up shortly after load (catches initial settings writes)
setTimeout(backupToCookies, 3000);
