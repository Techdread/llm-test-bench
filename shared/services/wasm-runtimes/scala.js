// Shared Scala runner — real scalac/scala inside the shared v86 Debian guest.
// This keeps execution web-only: v86 runs in the browser and no host service or
// local Scala toolchain is required.

import { compileAndRun } from '../debianVm.js';
import { toRunResult } from './go.js';

export async function runScalaDebian(code, options = {}) {
  const stdin = options.stdin || '';
  const main = options.mainObject || mainObject(code);
  const r = await compileAndRun({
    source: code,
    stdin,
    srcName: 'Main.scala',
    compileCmd: 'HOME=/tmp scalac Main.scala',
    runCmd: `HOME=/tmp scala ${main}`,
    timeoutMs: 480000,
    onStatus: options.onStatus,
  });
  return {
    ...toRunResult(r, 'native (Scala, Debian/v86)', stdin),
    diagnostics: parseScalaDiagnostics(r.cerr),
  };
}

// The runnable entry: an `object` extending App, else the object enclosing the
// first `def main`, else the first object. `scala <Object>` runs its main.
export function mainObject(src) {
  const app = src.match(/\bobject\s+(\w+)\s+extends\s+App\b/);
  if (app) return app[1];
  const mi = src.search(/\bdef\s+main\s*\(/);
  if (mi !== -1) {
    const re = /\bobject\s+(\w+)/g;
    let m, last;
    while ((m = re.exec(src.slice(0, mi))) !== null) last = m[1];
    if (last) return last;
  }
  const first = src.match(/\bobject\s+(\w+)/);
  return first ? first[1] : 'Main';
}

// scalac diagnostics: "Main.scala:LINE: error|warning: msg" (line only, no column).
export function parseScalaDiagnostics(text) {
  if (!text) return [];
  const re = /^(?:\.\/)?Main\.scala:(\d+):\s*(error|warning):\s*(.*)$/;
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(re);
    if (m) out.push({ line: +m[1], severity: m[2].toLowerCase(), message: m[3], source: 'scala' });
  }
  return out;
}
