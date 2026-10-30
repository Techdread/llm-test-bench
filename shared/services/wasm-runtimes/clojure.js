// Shared Clojure runner — evaluates a single-file program with the real Clojure
// on the JDK in the Debian guest (spec 278), the same backend the Polyglot Forge
// `clojure` module uses. `clojure <file>` loads + runs in one step. Returns the
// runtimeManager RunResult shape so Notebook Lab can run `clojure` cells.

import { compileAndRun } from '../debianVm.js';
import { toRunResult } from './go.js';

export async function runClojure(code, options = {}) {
  const stdin = options.stdin || '';
  // .cljc, so reader conditionals (#?(:clj … :cljs …)) work: the same cell can
  // then run here and in the browser backend (Scittle, ClojureScript).
  const r = await compileAndRun({
    source: code, stdin, srcName: 'main.cljc',
    compileCmd: 'true', runCmd: 'HOME=/tmp clojure main.cljc',
    timeoutMs: 360000, onStatus: options.onStatus,
  });
  // One-step: syntax/runtime errors all land on stderr (rerr).
  return toRunResult(r, 'native (Clojure, Debian/v86)', stdin);
}
