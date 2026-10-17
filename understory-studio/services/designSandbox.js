// Where model-written code runs — and the only place it ever runs.
//
// Generated JavaScript produces DATA, inside a disposable worker, inside an
// opaque-origin iframe, behind a CSP that permits no network at all. It has no
// DOM, no credentials, no access to the project or the data root, and it cannot
// reach three: the design it returns is plain JSON that the trusted builder
// then interprets. Nothing generated is ever evaluated on the main thread.
//
// `Math.random` is replaced with the seeded generator so a design that uses it
// out of habit is still reproducible.

const MAX_CODE_LENGTH = 150_000;
const MAX_JSON_LENGTH = 12_000_000;
const EXEC_TIMEOUT_MS = 8000;

export function evaluateDesign(code, seed = 73519, signal) {
  if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) {
    return Promise.reject(new Error('Generated code is too large.'));
  }
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts';
    frame.hidden = true;
    const nonce = crypto.randomUUID();

    const workerCode = `onmessage = async e => {
      try {
        let seed = e.data.seed;
        const api = Object.freeze({random: () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }});
        Math.random = api.random;
        const result = await new Function('api', '"use strict";\\n' + e.data.code)(api);
        const json = JSON.stringify(result);
        if (!json || json.length > ${MAX_JSON_LENGTH}) throw Error('Design output exceeds budget.');
        postMessage({json});
      } catch (e) { postMessage({error: String(e.message || e)}); }
    };`;

    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script>
      const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerCode)}], {type:'text/javascript'})));
      onmessage = e => { if(e.source === parent) worker.postMessage(e.data); };
      worker.onmessage = e => parent.postMessage({nonce:${JSON.stringify(nonce)},...e.data}, '*');
      worker.onerror = () => parent.postMessage({nonce:${JSON.stringify(nonce)},error:'Design worker failed.'}, '*');
      parent.postMessage({nonce:${JSON.stringify(nonce)},ready:true}, '*');
    <\/script>`;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      signal?.removeEventListener('abort', abort);
      frame.remove();
    };
    const fail = error => { cleanup(); reject(error); };
    const abort = () => fail(signal.reason ?? new DOMException('Cancelled', 'AbortError'));

    const receive = event => {
      if (event.source !== frame.contentWindow || event.data?.nonce !== nonce) return;
      if (event.data.ready) { frame.contentWindow.postMessage({ code, seed }, '*'); return; }
      if (event.data.error) { fail(new Error(event.data.error)); return; }
      try {
        const result = JSON.parse(event.data.json);
        cleanup();
        resolve(result);
      } catch (error) { fail(error); }
    };

    const timer = setTimeout(() => fail(new Error('Design execution exceeded 8 seconds.')), EXEC_TIMEOUT_MS);
    window.addEventListener('message', receive);
    signal?.addEventListener('abort', abort, { once: true });
    document.body.append(frame);
  });
}
