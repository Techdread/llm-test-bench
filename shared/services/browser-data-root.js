// The browser's own storage, shaped like a picked data folder.
//
// The public site cannot ask a first-time visitor to pick a folder before
// anything works. Firefox and Safari have no folder picker at all, and on Chrome
// it is a permission prompt before you have seen the app. So on the public
// distribution, a browser that has never picked a folder saves into the Origin
// Private File System (OPFS): real directories and files, private to this site,
// in every current browser. Picking a folder in Settings takes over from then on.
//
// OPFS hands back genuine FileSystemDirectoryHandles, so the ~250 call sites
// that use getDirectoryHandle / getFileHandle / createWritable need no change.
// Only the root is wrapped, for three reasons: OPFS names its root '' (apps
// show the root's name), Firefox's handles have no queryPermission (the data-
// root code asks it), and callers need a way to tell this root from a folder.

export const BROWSER_ROOT_NAME = 'Browser storage';

export function browserRootSupported(nav = globalThis.navigator) {
  return typeof nav?.storage?.getDirectory === 'function';
}

let cached = null;

/** Wrap an OPFS root so it reads as the data root. Exported for tests. */
export function wrapBrowserRoot(native, name = BROWSER_ROOT_NAME) {
  const unwrap = other => (other && other.native) || other;
  return {
    kind: 'directory',
    name,
    browser: true,
    native,
    getDirectoryHandle: (child, options) => native.getDirectoryHandle(child, options),
    getFileHandle: (child, options) => native.getFileHandle(child, options),
    removeEntry: (child, options) => native.removeEntry(child, options),
    resolve: possible => native.resolve(unwrap(possible)),
    isSameEntry: other => (typeof native.isSameEntry === 'function'
      ? native.isSameEntry(unwrap(other))
      : Promise.resolve(unwrap(other) === native)),
    entries: () => native.entries(),
    keys: () => native.keys(),
    values: () => native.values(),
    [Symbol.asyncIterator]: () => native.entries(),
    // Storage this site owns needs no permission and can never lose one.
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  };
}

/** The OPFS root, wrapped, or null where the browser has none (or refuses it,
 *  as some private-browsing modes do). */
export async function browserRoot(nav = globalThis.navigator) {
  if (!browserRootSupported(nav)) return null;
  if (!cached) {
    cached = (async () => {
      try {
        const native = await nav.storage.getDirectory();
        // Ask the browser not to evict the visitor's work under storage
        // pressure. Granted or not, it is only a request.
        nav.storage.persist?.().catch?.(() => {});
        return wrapBrowserRoot(native);
      } catch {
        return null;
      }
    })();
  }
  const root = await cached;
  if (!root) cached = null;
  return root;
}

export function isBrowserRoot(root) {
  return Boolean(root && root.browser === true);
}

/** Forget the cached root. Tests only. */
export function _resetBrowserRoot() { cached = null; }
