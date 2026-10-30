// Clojure runner using Scittle: ClojureScript, interpreted in the browser.
//
// Runs happen in clojure-scittle.worker.js, kept warm between runs and
// terminated, then replaced, when a program runs past its time limit, so an
// endless loop can't freeze the page. Returns the runtimeManager RunResult
// shape. Pass `options.nb` ({ snapshot(), set(key, value) }) to give the
// program nb/get and nb/set.

const DEFAULT_TIMEOUT_MS = 10000;

let worker = null;
let nextId = 0;
const pending = new Map();   // id -> settle(message)

function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./clojure-scittle.worker.js', import.meta.url));
  worker.onmessage = ({ data }) => {
    const settle = pending.get(data.id);
    pending.delete(data.id);
    settle?.(data);
  };
  worker.onerror = (event) => {
    const message = event.message || 'The Clojure worker failed to start.';
    stopWorker();
    for (const [id, settle] of pending) {
      pending.delete(id);
      settle({ id, ok: false, stdout: '', error: message, sets: [] });
    }
  };
  return worker;
}

function stopWorker() {
  worker?.terminate();
  worker = null;
}

const seconds = (ms) => `${Math.round(ms / 100) / 10} s`;

export function runClojureScittle(code, options = {}) {
  // Stop a little before runtimeManager's own ceiling, so this message wins.
  const limit = Math.max(1000, (options.timeout || DEFAULT_TIMEOUT_MS) - 250);
  const snapshot = options.nb ? options.nb.snapshot() : {};
  return new Promise((resolve) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      stopWorker();
      resolve(result({ ok: false, stdout: '', error: `Timed out after ${seconds(limit)}: the program was still running. Is there a loop that never ends?` }));
    }, limit);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (options.nb) for (const [key, value] of message.sets || []) options.nb.set(key, value);
      resolve(result(message));
    });
    startWorker().postMessage({ id, code, snapshot });
  });
}

function result(message) {
  const stdout = message.stdout ? `${message.stdout}\n` : '';
  return {
    runtimeKind: 'browser (Scittle)',
    compileSucceeded: null,
    runSucceeded: !!message.ok,
    stdout,
    // A failed cell shows only its error, so lead it with what was printed first.
    stderr: message.ok ? '' : [message.stdout, message.error].filter(Boolean).join('\n'),
    compileLog: '',
  };
}
