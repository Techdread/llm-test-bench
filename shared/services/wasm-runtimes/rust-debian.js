// Debian-Rust runner — real rustc in the v86 Debian guest. Alternative to the
// remote Rust Playground; selected via the toolbar runtimes dialog. Offline,
// stdin works, but compiles take tens of seconds under emulation. The shared
// Debian VM is the same one Polyglot Forge's Rust module uses.

import { compileAndRun } from '../debianVm.js';
import { toRunResult } from './go.js';

export async function runRustDebian(code, options = {}) {
  const stdin = options.stdin || '';
  const r = await compileAndRun({
    source: code, stdin, srcName: 'main.rs',
    // Debug build — under emulation, -O is dramatically slower for negligible
    // runtime win on these short programs.
    compileCmd: 'rustc main.rs -o prog', runCmd: './prog',
    timeoutMs: 360000, onStatus: options.onStatus,
  });
  return toRunResult(r, 'native (rustc, Debian/v86)', stdin);
}
