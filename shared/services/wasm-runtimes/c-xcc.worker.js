// c-xcc.worker — compiles a C program with xcc (cc.wasm, a C compiler built
// for WebAssembly) and runs the result, off the page's thread, so a program
// that never stops can be ended by terminating this worker.
//
// Message in:  { id, code, stdin, snapshot }   snapshot = the nb values to read
// Message out: { id, compiled, compileLog, stdout, stderr, exitCode, trap, sets, compileMs, runMs }
//
// C cells reach nb through <nb.h>: the nb_* functions (xcc-nb.js) are supplied as
// the program's `env` imports. Reads see the snapshot; writes are collected in
// `sets` and applied by the page when the run ends.

import { MemFs, runWasi } from './wasi.js';
import { NB_FUNCTIONS, NB_HEADER, nbImports } from './xcc-nb.js';

// Named file by file so the public-site builder sees (and ships) both.
const XCC_FILES = {
  'cc.wasm': new URL('../../lib/xcc/0.1.13-631e318/cc.wasm', import.meta.url),
  'sysroot.json': new URL('../../lib/xcc/0.1.13-631e318/sysroot.json', import.meta.url),
};
const encoder = new TextEncoder();

let toolchain = null;

function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function loadToolchain() {
  if (toolchain) return toolchain;
  const fetchOk = async (name) => {
    const response = await fetch(XCC_FILES[name]);
    if (!response.ok) throw new Error(`Could not load the C compiler (${name}: ${response.status})`);
    return response;
  };
  const [ccBytes, sysroot] = await Promise.all([
    fetchOk('cc.wasm').then((r) => r.arrayBuffer()),
    fetchOk('sysroot.json').then((r) => r.json()),
  ]);
  const files = new Map(Object.entries(sysroot).map(([p, b64]) => [p, fromBase64(b64)]));
  files.set('/usr/include/nb.h', encoder.encode(NB_HEADER));
  toolchain = { cc: await WebAssembly.compile(ccBytes), files };
  return toolchain;
}

// Error messages name the file the user never sees; call it main.c.
const tidy = (text) => String(text || '').replaceAll('/tmp/main.c', 'main.c').trimEnd();

self.onmessage = async ({ data }) => {
  const { id, code, stdin = '', snapshot = {} } = data;
  try {
    const { cc, files } = await loadToolchain();
    const fs = new MemFs();
    for (const [p, bytes] of files) fs.files.set(p, { data: bytes });
    fs.write('/tmp/main.c', code);

    let t = performance.now();
    // --allow-undefined lets nb_* become imports; anything else undefined is reported below.
    const compiled = await runWasi(cc, { args: ['cc', '-Wl,--allow-undefined', '-o', '/tmp/a.wasm', '/tmp/main.c'], fs, cwd: '/tmp' });
    const compileMs = performance.now() - t;
    if (compiled.exitCode !== 0) {
      const log = tidy(`${compiled.stderr}\n${compiled.stdout}`) || (compiled.trap ? `The compiler crashed: ${compiled.trap.message}` : 'Compilation failed.');
      self.postMessage({ id, compiled: false, compileLog: log, compileMs });
      return;
    }
    const program = await WebAssembly.compile(fs.read('/tmp/a.wasm'));
    const missing = WebAssembly.Module.imports(program).filter((i) => i.module === 'env' && !NB_FUNCTIONS.has(i.name)).map((i) => i.name);
    if (missing.length) {
      self.postMessage({ id, compiled: false, compileMs, compileLog: missing.map((name) => `main.c: undefined function '${name}' (is it misspelt, or missing its #include?)`).join('\n') });
      return;
    }

    const sets = [];
    const values = snapshot;
    t = performance.now();
    const ran = await runWasi(program, { args: ['main'], fs, stdin, cwd: '/tmp', env: (getMemory) => nbImports(getMemory, values, sets) });
    self.postMessage({
      id,
      compiled: true,
      stdout: ran.stdout,
      stderr: ran.stderr,
      exitCode: ran.exitCode,
      trap: ran.trap ? (ran.trap.message || String(ran.trap)) : null,
      sets,
      compileMs,
      runMs: performance.now() - t,
    });
  } catch (error) {
    self.postMessage({ id, compiled: false, compileLog: error.message || String(error) });
  }
};
