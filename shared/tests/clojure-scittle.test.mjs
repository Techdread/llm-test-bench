// Scittle Clojure runtime tests — load clojure-scittle.worker.js and the
// vendored Scittle into a node vm context, as a worker would, and check the nb
// prelude, Java-style format, printing and error lines. No browser, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const RUNTIMES = new URL('../services/wasm-runtimes/', import.meta.url);
const posted = [];
const worker = {
  console: { log() {}, info() {}, warn() {}, error() {} },
  performance,
  importScripts: (rel) => vm.runInContext(fs.readFileSync(new URL(rel, RUNTIMES), 'utf8'), worker),
  postMessage: (message) => posted.push(message),
};
worker.self = worker;
vm.createContext(worker);
vm.runInContext(fs.readFileSync(new URL('clojure-scittle.worker.js', RUNTIMES), 'utf8'), worker);

// The snapshot is made inside the context, as structured clone makes it in the worker's realm.
function run(code, values = {}) {
  const snapshot = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(values))})`, worker);
  worker.onmessage({ data: { id: posted.length, code, snapshot } });
  const result = posted.at(-1);
  return { ...result, sets: Object.fromEntries(JSON.parse(JSON.stringify(result.sets))) };
}

test('core Clojure runs, and println output is captured', () => {
  const r = run(`(def trips [{:from "A" :minutes 10} {:from "B" :minutes 20} {:from "A" :minutes 6}])
(println (frequencies (map :from trips)))
(println (->> trips (map :minutes) (reduce +)))`);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.stdout, '{A 2, B 1}\n36');
});

test('nb/get reads Clojure data with keyword keys; nb/set shares plain data', () => {
  const r = run(`(let [{:keys [rate items]} (nb/get :cfg)]
  (println (* rate (count items)) (nb/has? :cfg) (nb/has? :nope) (nb/get :nope :fallback))
  (nb/set :out {:total (reduce + items) :tags [:a :b] :per-item (map inc items)}))`, { cfg: { rate: 2, items: [1, 2, 3] } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.stdout, '6 true false :fallback');
  assert.deepEqual(r.sets, { out: { total: 6, tags: ['a', 'b'], 'per-item': [2, 3, 4] } });
});

test('a value set in a run can be read back in the same run', () => {
  const r = run('(nb/set :n 41) (println (inc (nb/get :n)))');
  assert.equal(r.stdout, '42');
});

test('format follows Java', () => {
  const r = run(`(doseq [s [(format "%,d|%05.1f|%-4s|%3d" 1234567 3.14159 "ab" -3)
           (format "%x|%X|%o|%e|%.2E" 255 255 8 12345.678 0.000123)
           (format "%s|%s|%s|%b|%c|%.3s|%S" nil :kw [1 2] nil 65 "abcdef" "hi")
           (format "%+d|% d|%08.3f|%5.1f%%|a%nb" 5 5 -3.5 12.34)]]
  (println s))`);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.stdout, [
    '1,234,567|003.1|ab  | -3',
    'ff|FF|10|1.234568e+04|1.23E-04',
    'null|:kw|[1 2]|false|A|abc|HI',
    '+5| 5|-003.500| 12.3%|a',
    'b',
  ].join('\n'));
});

test('format refuses what Java would refuse, with a plain message', () => {
  assert.match(run('(format "%d" 2.5)').error, /%d needs a whole number, got 2.5/);
  assert.match(run('(format "%d %d" 1)').error, /no value for %d/);
  assert.match(run('(format "%f" "x")').error, /%f needs a number/);
});

test('print, printf and println write one stream, as in Clojure', () => {
  const r = run('(print "a") (print "b") (println "c") (printf "%d%%" 5) (println) (prn {:x 1}) (js/console.log "raw")');
  assert.equal(r.stdout, 'abc\n5%\n{:x 1}\nraw');
});

test('errors name the line in the cell, and output so far is kept', () => {
  const r = run('(println "first")\n(def x 1)\n(undefined-thing x)');
  assert.equal(r.ok, false);
  assert.equal(r.stdout, 'first');
  assert.match(r.error, /^Line 3, column 1: .*undefined-thing/);
});

test('each run starts in the user namespace with nothing left set', () => {
  run('(ns other) (nb/set :leak 1)');
  const r = run('(println (str *ns*))');
  assert.equal(r.stdout, 'user');
  assert.deepEqual(r.sets, {});
});

test('reader conditionals take the :cljs branch', () => {
  assert.equal(run('(println #?(:clj "jvm" :cljs "cljs"))').stdout, 'cljs');
});
