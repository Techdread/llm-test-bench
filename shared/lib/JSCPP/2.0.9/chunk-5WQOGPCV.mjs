// Minimal browser shim re-supplying the unenv node:stream base classes
// (Readable / Writable / Duplex) that JSCPP 2.0.9's `stream.mjs` imports as
// `{ a, b, c }`. The vendored JSCPP bundle shipped WITHOUT this chunk file, so
// `import "./stream.mjs"` (and therefore the whole C runner in
// shared/services/wasm-runtimes/c.js) failed to load. JSCPP drives stdio through
// a custom config object, so these are import-time base classes that aren't
// exercised on the normal run path — a lightweight stub restores loading.
//
// NOTE: this is a hand-written gap-filler. Re-vendoring JSCPP 2.0.9 with its real
// `chunk-*.mjs` via tools/vendor-shared-lib.mjs is the proper long-term fix.
import { EventEmitter } from './events.mjs';

class Readable extends EventEmitter {
  read() { return null; }
  pipe(dest) { return dest; }
  push() { return false; }
  unshift() {}
  setEncoding() { return this; }
  resume() { return this; }
  pause() { return this; }
  isPaused() { return false; }
  destroy() { return this; }
}

class Writable extends EventEmitter {
  write() { return true; }
  end() { return this; }
  cork() {}
  uncork() {}
  destroy() { return this; }
}

class Duplex extends Writable {
  read() { return null; }
  pipe(dest) { return dest; }
  push() { return false; }
  setEncoding() { return this; }
  resume() { return this; }
  pause() { return this; }
}

export { Readable as a, Writable as b, Duplex as c };
