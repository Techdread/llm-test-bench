// Client for the Meta Quest bridge in serve.py (`/__quest/*`), spec 334.
//
// The bridge is a thin wrapper over the adb commands documented by hand in
// prompt-gallery/QUEST-VR-ACCESS.md: report what the headset connection looks
// like, open one hub URL in Quest Browser, and re-establish the port reverse
// that a sleeping headset quietly drops.
//
// Everything here fails soft. A hub served by `python3 -m http.server` has no
// bridge at all, and an app must show that as "no headset route", never as an
// error the user has to clear.

const UNREACHABLE = Object.freeze({
  reachable: false, adb: false, connected: false, devices: [],
  target: null, reverseActive: false, reversePort: null, features: [],
});

/**
 * Poll the headset situation.
 *
 * @returns {Promise<{reachable, adb, connected, devices, target, reverseActive,
 *                    reversePort, baseUrl?, features}>}
 * `reachable` false means this server has no Quest bridge (old serve.py, or a
 * plain static server); `adb` false means the bridge is there but adb is not.
 */
export async function questStatus() {
  try {
    const res = await fetch('/__quest/status');
    if (!res.ok) return { ...UNREACHABLE };
    const payload = await res.json();
    return { ...payload, reachable: true };
  } catch {
    return { ...UNREACHABLE };
  }
}

/** Whether this server can open a URL on the headset at all. */
export async function questBridgeAvailable() {
  return (await questStatus()).reachable;
}

/**
 * Open one hub URL in Quest Browser.
 *
 * The server refuses anything but a loopback URL on its own port, so a caller
 * builds the URL from `location.origin` and the run's data-root path rather
 * than from anything a model wrote.
 */
export async function openOnQuest(url) {
  const res = await fetch('/__quest/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).catch((error) => { throw new Error(`Quest bridge unreachable (${error.message})`); });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Quest bridge error (${res.status})`);
  return payload;
}

/** Re-establish `adb reverse tcp:<port> tcp:<port>` after a sleep or a drop. */
export async function restoreQuestReverse() {
  const res = await fetch('/__quest/reverse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch((error) => { throw new Error(`Quest bridge unreachable (${error.message})`); });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Quest bridge error (${res.status})`);
  return payload;
}

/**
 * The URL the headset should open for a run's project directory.
 *
 * `/_data` is the hub's data-root route, so a project that has been written to
 * disk is already reachable — nothing is copied to the headset. Built from the
 * page's own origin so it matches the port the bridge will accept.
 */
export function questProjectUrl(projectDir, { entry = 'index.html', origin = null } = {}) {
  const base = origin || (typeof location !== 'undefined' ? location.origin : 'http://localhost:8084');
  const clean = String(projectDir || '').replace(/^\/+|\/+$/g, '');
  const file = String(entry || 'index.html').replace(/^\/+/, '');
  const host = base.replace(/^https?:\/\/[^/]+/, (match) => match.replace(/\/\/[^:/]+/, '//localhost'));
  return `${host}/_data/${clean}/${file}`;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** 100.64.0.0/10 — the range Tailscale hands out. */
function isTailnetAddress(hostname) {
  const parts = String(hostname).split('.').map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

/**
 * The wireless route to a run: no adb, the headset opens the hub's own network
 * address. Pure, so the pane only renders what this decides.
 *
 * Opening is never the problem — any device that can load the hub can load the
 * run. Entering VR is: a browser exposes WebXR only on a secure address, and
 * `http://<lan-ip>` is not one (`http://localhost` is, which is the whole reason
 * the adb reverse works). So this reports, honestly, which of the two it is.
 *
 * @param {object} input
 * @param {string} input.projectDir Data-root path of the run's project.
 * @param {string} [input.entry]
 * @param {{shared?: boolean, httpPort?: number, httpsPort?: number, addresses?: string[]}} [input.network]
 *   `network` from `questStatus()`; absent on an older serve.py.
 * @param {{origin: string, secureContext?: boolean, hasXr?: boolean}} input.page
 *   The browser this pane is running in.
 * @returns {{available: boolean, here: boolean, url: string, secure: boolean,
 *            vrReady: boolean|null, secureUrl: string, trusted: boolean, flagOrigin: string, reason: string}}
 *   `here`: this browser is already on the network address (it is, in practice,
 *   the headset). `vrReady`: true/false when measured in this browser, null
 *   when it can only be known on the headset. `secureUrl`: an HTTPS address to
 *   move to when the current one is plain HTTP. `trusted`: that address has a
 *   real certificate (the hub's Tailscale name), so no warning. `flagOrigin`: the origin to
 *   allow in the browser's "insecure origins treated as secure" flag instead.
 */
export function questWirelessRoute({ projectDir, entry = 'index.html', network = null, page } = {}) {
  const none = {
    available: false, here: false, url: '', secure: false, vrReady: null,
    secureUrl: '', trusted: false, flagOrigin: '', reason: '',
  };
  const clean = String(projectDir || '').replace(/^\/+|\/+$/g, '');
  if (!clean) return { ...none, reason: 'no-project' };
  const path = `/_data/${clean}/${String(entry || 'index.html').replace(/^\/+/, '')}`;
  let origin;
  try { origin = new URL(page?.origin || ''); } catch { return { ...none, reason: 'no-origin' }; }
  const httpsPort = Number(network?.httpsPort) || 0;

  if (!LOOPBACK_HOSTS.has(origin.hostname)) {
    // Already on the network address: the run is one tab away, same origin.
    const secure = page.secureContext ?? origin.protocol === 'https:';
    // Over Tailscale the hub has a name with a real certificate. It is another
    // host, so the hub's own /__secure does the move — it can carry the access
    // token across, which this page cannot read.
    const trusted = !secure && !!httpsPort && !!network?.secureHost && isTailnetAddress(origin.hostname);
    if (trusted) {
      return {
        ...none,
        available: true,
        here: true,
        url: `${origin.origin}${path}`,
        secure,
        vrReady: false,
        secureUrl: `${origin.origin}/__secure?to=${encodeURIComponent(path)}`,
        trusted: true,
        flagOrigin: origin.origin,
      };
    }
    return {
      ...none,
      available: true,
      here: true,
      url: `${origin.origin}${path}`,
      secure,
      vrReady: secure && !!page.hasXr,
      secureUrl: !secure && httpsPort ? `https://${origin.hostname}:${httpsPort}${path}` : '',
      flagOrigin: secure ? '' : origin.origin,
    };
  }

  // On the hub machine itself: say what the headset should open.
  const address = (network?.addresses || [])[0];
  if (!address) return { ...none, reason: network ? 'loopback-only' : 'no-network-info' };
  const httpPort = Number(network.httpPort) || Number(origin.port) || 80;
  const plain = `http://${address}:${httpPort}`;
  return {
    ...none,
    available: true,
    url: httpsPort ? `https://${address}:${httpsPort}${path}` : `${plain}${path}`,
    secure: !!httpsPort,
    flagOrigin: httpsPort ? '' : plain,
  };
}

