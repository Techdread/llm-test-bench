// Single source of truth for the shared 'devtools-hub' IndexedDB.
//
// Multiple pages open this database (currently: shared/services/storage.js
// for the directory handle, and hub-pattern-atlas's corpus cache). When two
// pages disagree on the version number, the lower-version page throws
// VersionError on every open — that was the silent failure mode that
// motivated the Data Warden spec. All callers go through openDevtoolsHubDB();
// the version constant and the full store list live here and only here.

export const DB_NAME = 'devtools-hub';

// Bump only when adding a new object store. The upgrade handler below is
// additive — existing stores are never dropped — so this can grow safely.
export const DB_VERSION = 2;

// Every object store any page in the suite needs in this DB. onupgradeneeded
// creates them all in one pass, regardless of which page first opens the DB,
// so a freshly-installed app never crashes because some other app's store
// hasn't been initialised yet.
const STORES = ['handles', 'hub-pattern-atlas'];

function openAtVersion(version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(
      'IndexedDB upgrade blocked — close other tabs of this app and reload.'
    ));
  });
}

// Open without specifying a version → returns the DB at whatever version
// it currently is. Used for the VersionError fallback below; never triggers
// onupgradeneeded.
function openAtCurrentVersion() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Open the shared 'devtools-hub' DB. Self-healing across version skew:
 * if a future page bumped the version higher than DB_VERSION, IDB rejects
 * our open with VersionError. We catch it and re-open without a version,
 * yielding the DB at its current (higher) version. Our object stores survive
 * any future upgrade because the upgrade handler is additive.
 *
 * Pre-fix this was a permanent failure that wedged every app's data-root
 * load. Now it is recoverable without a source patch on the lower-version
 * page — though the user may still want to refresh open tabs.
 */
export async function openDevtoolsHubDB() {
  try {
    return await openAtVersion(DB_VERSION);
  } catch (e) {
    if (!e || e.name !== 'VersionError') throw e;
    console.warn(
      `[idb] VersionError opening '${DB_NAME}' at v=${DB_VERSION}; ` +
      `another tab/page upgraded past us. Falling back to current DB version.`
    );
    return openAtCurrentVersion();
  }
}
