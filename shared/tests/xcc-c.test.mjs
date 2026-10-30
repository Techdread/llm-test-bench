// xcc C runtime tests — compile and run real C with the vendored WebAssembly
// compiler (shared/lib/xcc) through wasi.js, as c-xcc.worker.js does, and
// check <nb.h>. No browser, no network: node runs the same wasm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MemFs, runWasi } from '../services/wasm-runtimes/wasi.js';
import { NB_FUNCTIONS, NB_HEADER, nbImports } from '../services/wasm-runtimes/xcc-nb.js';

const XCC = new URL('../lib/xcc/0.1.13-631e318/', import.meta.url);
const cc = await WebAssembly.compile(fs.readFileSync(new URL('cc.wasm', XCC)));
const sysroot = JSON.parse(fs.readFileSync(new URL('sysroot.json', XCC), 'utf8'));

async function compileAndRun(code, { values = {}, stdin = '' } = {}) {
  const memfs = new MemFs();
  for (const [p, b64] of Object.entries(sysroot)) memfs.write(p, Buffer.from(b64, 'base64'));
  memfs.write('/usr/include/nb.h', NB_HEADER);
  memfs.write('/tmp/main.c', code);
  const compiled = await runWasi(cc, { args: ['cc', '-Wl,--allow-undefined', '-o', '/tmp/a.wasm', '/tmp/main.c'], fs: memfs, cwd: '/tmp' });
  if (compiled.exitCode !== 0) return { compiled: false, log: compiled.stderr + compiled.stdout };
  const program = await WebAssembly.compile(memfs.read('/tmp/a.wasm'));
  const sets = [];
  const ran = await runWasi(program, { args: ['main'], fs: memfs, stdin, cwd: '/tmp', env: (getMemory) => nbImports(getMemory, values, sets) });
  return { compiled: true, ...ran, sets };
}

test('real C: structs, qsort with a function pointer, C99 division', async () => {
  const r = await compileAndRun(`#include <stdio.h>
#include <stdlib.h>
struct P { const char *name; double g; };
int cmp(const void *a, const void *b) { double d = ((const struct P *)a)->g - ((const struct P *)b)->g; return (d > 0) - (d < 0); }
int main(void) {
  struct P p[] = { {"Jupiter", 2.53}, {"Mars", 0.38}, {"Earth", 1.0} };
  qsort(p, 3, sizeof p[0], cmp);
  for (int i = 0; i < 3; i++) printf("%s ", p[i].name);
  printf("| %d %d\\n", -7 / 2, -7 % 2);
  return 0;
}`);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'Mars Earth Jupiter | -3 -1\n');
});

test('printf formats floats as glibc does (the vendored patch)', async () => {
  const r = await compileAndRun(`#include <stdio.h>
int main(void) { printf("[%8.2f][%-6.1f][%08.2f][%.0f][%5.1f][%e][%g][%.1f]\\n", 3.14159, 2.5, -3.14159, 2.5, -0.05, 12345.678, 0.0001234, 0.15); return 0; }`);
  assert.equal(r.stdout, '[    3.14][2.5   ][-0003.14][2][ -0.1][1.234568e+04][0.0001234][0.1]\n');
});

test('stdin, clock() and exit codes', async () => {
  const r = await compileAndRun(`#include <stdio.h>
#include <time.h>
int main(void) { int a, b; clock_t t = clock(); scanf("%d %d", &a, &b); printf("%d %d\\n", a + b, clock() >= t); return a > 0 ? 3 : 0; }`, { stdin: '20 22' });
  assert.equal(r.stdout, '42 1\n');
  assert.equal(r.exitCode, 3);
});

test('compile errors name main.c lines', async () => {
  const r = await compileAndRun('int main(void) { return nope; }');
  assert.equal(r.compiled, false);
  assert.match(r.log, /main\.c\(1\): `nope' undeclared/);
});

test('<nb.h> reads a snapshot of nb and collects writes', async () => {
  const values = { prices: [3.2, 2.5, 4.1], shop: 'Corner shop', discount: 10, grid: [1, 2, 3, 4] };
  const r = await compileAndRun(`#include <stdio.h>
#include <nb.h>
int main(void) {
  double p[8]; int n = nb_get_doubles("prices", p, 8);
  int g[2]; int gn = nb_get_ints("grid", g, 2);
  char shop[8]; int len = nb_get_string("shop", shop, sizeof shop);
  char json[64]; nb_get_json("prices", json, sizeof json);
  printf("%d %.1f | %d %d %d | %d %s | %s | %g %lld %d %d\\n", n, p[0] + p[1] + p[2], gn, g[0], g[1], len, shop, json,
         nb_get_number("discount", 0), nb_get_int("discount", 0), nb_has("shop"), nb_has("nope"));
  nb_set_number("total", 9.8);
  nb_set_int("count", 3);
  nb_set_string("note", "from C");
  double d[2] = { 1.5, 2.5 }; nb_set_doubles("pair", d, 2);
  int sq[3] = { 1, 4, 9 }; nb_set_ints("squares", sq, 3);
  nb_set_json("obj", "{\\"ok\\":true}");
  printf("%g\\n", nb_get_number("total", 0));   /* a write is visible to later reads */
  return 0;
}`, { values });
  assert.equal(r.exitCode, 0, r.log || r.stderr);
  // The string is cut to fit the buffer (7 characters and a NUL), but the full length comes back.
  assert.equal(r.stdout, '3 9.8 | 4 1 2 | 11 Corner  | [3.2,2.5,4.1] | 10 10 1 0\n9.8\n');
  assert.deepEqual(Object.fromEntries(r.sets), { total: 9.8, count: 3, note: 'from C', pair: [1.5, 2.5], squares: [1, 4, 9], obj: { ok: true } });
});

test('the header declares exactly the functions supplied', () => {
  for (const name of NB_FUNCTIONS) assert.match(NB_HEADER, new RegExp(`\\b${name}\\(`), name);
  assert.equal((NB_HEADER.match(/\bnb_\w+\(/g) || []).length, NB_FUNCTIONS.size);
});
