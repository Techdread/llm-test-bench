// Debian-C runner — real gcc / g++ in the v86 Debian guest. Mirrors the
// detection heuristic in polyglot-forge/modules/cpp.js: extension wins, but a
// C-ish file with C++-only constructs (std::, templates, iostream …) gets
// promoted to g++ so users don't have to rename the cell.

import { compileAndRun } from '../debianVm.js';
import { toRunResult } from './go.js';

const CPP_HINT = /#include\s*<(iostream|vector|string|map|set|algorithm|memory|functional|sstream)>|\bstd::|using\s+namespace\s+std\b|\btemplate\s*<|\bclass\s+\w/;

export async function runCDebian(code, options = {}) {
  const stdin = options.stdin || '';
  const isCpp = CPP_HINT.test(code);
  const cc      = isCpp ? 'g++'      : 'gcc';
  const srcName = isCpp ? 'main.cpp' : 'main.c';
  const r = await compileAndRun({
    source: code, stdin, srcName,
    compileCmd: `${cc} -O0 ${srcName} -o prog`, runCmd: './prog',
    timeoutMs: 360000, onStatus: options.onStatus,
  });
  return toRunResult(r, `native (${cc}, Debian/v86)`, stdin);
}
