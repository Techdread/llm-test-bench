// Client for serve.py's `/__blender/*` bridge.
//
// Two capabilities that look similar in the toolbar and are not the same thing:
//
//   FBX   needs a `blender` binary on PATH. Detectable, so the button is
//         disabled with a reason when it is missing.
//   Send  needs a Blender ALREADY OPEN with the MCP add-on's server started.
//         Nothing can detect that without connecting to it, which would be a
//         side effect on the user's session — so the button stays enabled and
//         reports for itself.
//
// FBX is not a second exporter. It is a conversion of the same GLB the app
// already built, so the two files cannot describe different geometry.

const PREFIX = '/__blender';

let statusPromise = null;

/** Probe the bridge once per page. Never throws: an absent bridge is a state,
 *  not an error — the hub runs under plain http.server too. */
export function blenderStatus({ refresh = false } = {}) {
  if (!statusPromise || refresh) {
    statusPromise = fetch(`${PREFIX}/status`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => ({
        bridge: Boolean(data),
        convert: data?.convert?.available === true,
        version: data?.convert?.version || '',
        reason: data ? (data.convert?.error || '') : 'The Blender bridge needs serve.py — a plain static server has no /__blender endpoints.',
        importEndpoint: data?.importEndpoint || null,
      }))
      .catch(() => ({
        bridge: false, convert: false, version: '',
        reason: 'The Blender bridge needs serve.py — a plain static server has no /__blender endpoints.',
        importEndpoint: null,
      }));
  }
  return statusPromise;
}

async function post(path, blob, signal) {
  const response = await fetch(`${PREFIX}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
    signal,
  }).catch(error => {
    if (error.name === 'AbortError') throw error;
    throw new Error(`The Blender bridge is unreachable — run the hub with serve.py (${error.message})`);
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Blender bridge error (${response.status})`);
  }
  return response;
}

/** Convert a GLB blob to FBX. Returns { blob, summary }. */
export async function convertToFBX(glb, signal) {
  const response = await post('/convert', glb, signal);
  const summary = (() => {
    try { return JSON.parse(response.headers.get('X-Blender-Summary') || '{}'); } catch { return {}; }
  })();
  return { blob: await response.blob(), summary };
}

/** Add a GLB to the scene already open in Blender. Returns what was added. */
export async function sendToBlender(glb, signal) {
  const response = await post('/import', glb, signal);
  return response.json();
}
