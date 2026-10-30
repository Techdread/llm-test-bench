// C runner using xcc: real C, compiled to WebAssembly and run in the browser.
//
// Compiling and running happen in c-xcc.worker.js, which is kept warm between
// runs (the compiler is prepared once) and terminated, then replaced, when a
// program runs past its time limit, so an endless loop can't freeze the page.
// Returns the runtimeManager RunResult shape. Pass `options.nb`
// ({ snapshot(), set(key, value) }) to give the program <nb.h>.

const DEFAULT_TIMEOUT_MS = 10000;

let worker = null;
let nextId = 0;
const pending = new Map();   // id -> settle(message)

function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./c-xcc.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const settle = pending.get(data.id);
    pending.delete(data.id);
    settle?.(data);
  };
  worker.onerror = (event) => {
    const message = event.message || 'The C compiler worker failed to start.';
    stopWorker();
    for (const [id, settle] of pending) {
      pending.delete(id);
      settle({ id, compiled: false, compileLog: message });
    }
  };
  return worker;
}

function stopWorker() {
  worker?.terminate();
  worker = null;
}

const seconds = (ms) => `${Math.round(ms / 100) / 10} s`;

export function runCXcc(code, options = {}) {
  // Stop a little before runtimeManager's own ceiling, so this message wins.
  const limit = Math.max(1000, (options.timeout || DEFAULT_TIMEOUT_MS) - 250);
  const snapshot = options.nb ? options.nb.snapshot() : {};
  return new Promise((resolve) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      stopWorker();
      resolve(result({
        compiled: true,
        stdout: '',
        stderr: `Timed out after ${seconds(limit)}: the program was still running. Is there a loop that never ends?`,
        failed: true,
      }));
    }, limit);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.compiled && options.nb) {
        for (const [key, value] of message.sets || []) options.nb.set(key, value);
      }
      resolve(result(message));
    });
    startWorker().postMessage({ id, code, stdin: options.stdin || '', snapshot });
  });
}

function result(message) {
  if (!message.compiled) {
    return {
      runtimeKind: 'wasm (xcc)',
      compileSucceeded: false,
      runSucceeded: false,
      stdout: '',
      stderr: '',
      compileLog: message.compileLog || 'Compilation failed.',
    };
  }
  let stderr = message.stderr || '';
  let ok = !message.failed;
  let problem = '';
  if (message.trap) problem = `Runtime error: ${message.trap}`;
  else if (message.exitCode !== 0 && message.exitCode !== undefined && message.exitCode !== null) problem = `The program exited with code ${message.exitCode}.`;
  if (problem) {
    ok = false;
    // A failed cell shows only its error, so lead it with what the program printed first.
    stderr = [message.stdout, stderr, problem].filter(Boolean).join('\n').replace(/\n{2,}/g, '\n');
  }
  return {
    runtimeKind: 'wasm (xcc)',
    compileSucceeded: true,
    runSucceeded: ok,
    stdout: message.stdout || '',
    stderr,
    compileLog: '',
  };
}
