// runnerJs — executes a JS cell. Captures console output, returns value, and
// exposes `nb` (the cross-cell variable bridge) to user code.

import { makeNbProxy } from './nbBridge.js';

/** @returns {Promise<{ok:boolean, outputs:Array, error?:string}>} */
export async function runJs(code) {
  const outputs = [];
  const logs = [];

  const mkLog = (level) => (...args) => {
    const msg = args.map(a => {
      if (a === undefined) return 'undefined';
      if (a === null) return 'null';
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }).join(' ');
    logs.push({ level, msg });
  };

  const fakeConsole = {
    log: mkLog('log'),
    info: mkLog('info'),
    warn: mkLog('warn'),
    error: mkLog('error'),
  };

  const nb = makeNbProxy();

  try {
    // Wrap in async IIFE so `await` works at top level.
    const fn = new Function('nb', 'console', `return (async () => {\n${code}\n})();`);
    const result = await fn(nb, fakeConsole);

    if (logs.length > 0) {
      outputs.push({ type: 'text', value: logs.map(l => l.msg).join('\n') });
    }
    if (result !== undefined) {
      outputs.push({ type: 'value', value: result });
    }
    return { ok: true, outputs };
  } catch (err) {
    if (logs.length > 0) {
      outputs.push({ type: 'text', value: logs.map(l => l.msg).join('\n') });
    }
    return { ok: false, outputs, error: err.message || String(err) };
  }
}
