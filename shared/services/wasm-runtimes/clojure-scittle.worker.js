// clojure-scittle.worker — runs Clojure with Scittle (the Small Clojure
// Interpreter, ClojureScript) off the page's thread, so a program that never
// stops can be ended by terminating this worker. A classic worker: Scittle is
// a plain script, loaded with importScripts.
//
// Message in:  { id, code, snapshot }     snapshot = the nb values to read
// Message out: { id, ok, stdout, error, sets, ms }
//
// Clojure reaches nb through the `nb` namespace defined below:
//   (nb/get :key default)  a copy, as Clojure data (keys become keywords)
//   (nb/set :key value)    shared when the run ends
//   (nb/has? :key)  (nb/keys)
// and `format` / `printf` are provided (ClojureScript has neither), Java-style.

self.window = self;   // Scittle looks for `window`
importScripts('../../lib/scittle/0.8.33/scittle.js');

// Printed text, as one stream: print, printf and println write to it through
// *print-fn* (set in the prelude), and a stray js/console.log adds a line.
let stdout = '';
self.__nbWrite = (text) => { stdout += text; };
console.log = (...args) => { stdout += `${args.join(' ')}\n`; };
console.info = console.log;

// Scittle resolves js/... when a function is defined, not when it runs, so
// these stay the same functions for the worker's life and read whichever run
// is current.
let values = {};
let sets = [];
const own = (key) => Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined;
self.__nbGet = (key) => (own(key) ? values[key] : undefined);
self.__nbHas = (key) => own(key);
self.__nbKeys = () => Object.keys(values).filter(own);
self.__nbSet = (key, value) => {
  const plain = JSON.parse(JSON.stringify(value === undefined ? null : value));
  values[key] = plain;
  sets.push([key, plain]);
};

// Clojure's format is Java's String.format; this does the common part of it the
// same way: %s %S %d %f %e %E %x %X %o %c %b %% %n, with the flags - + space 0 ,
// a width and a precision. JavaScript has one kind of number, so 2.0 passes for
// %d (Java would refuse it) but 2.5 doesn't.
function javaFormat(fmt, args) {
  let next = 0;
  return String(fmt).replace(/%([-+ 0,#]*)(\d+)?(?:\.(\d+))?([a-zA-Z%])/g, (spec, flags, width, precision, conv) => {
    if (conv === '%') return pad('%', flags, width);
    if (conv === 'n') return '\n';
    if (next >= args.length) throw new Error(`format: no value for ${spec}`);
    const arg = args[next++];
    const p = precision === undefined ? undefined : Number(precision);
    const number = (kind) => {
      if (typeof arg !== 'number') throw new Error(`format: ${spec} needs a number, got ${arg === null ? 'nil' : JSON.stringify(arg)}`);
      if (kind === 'whole' && !Number.isInteger(arg)) throw new Error(`format: ${spec} needs a whole number, got ${arg}`);
      return arg;
    };
    let text;
    switch (conv) {
      case 's': case 'S': text = arg === null ? 'null' : String(arg); if (p !== undefined) text = text.slice(0, p); break;
      case 'b': case 'B': text = String(arg !== null && arg !== false); break;
      case 'c': text = typeof arg === 'number' ? String.fromCodePoint(arg) : String(arg).slice(0, 1); break;
      case 'd': return signed(number('whole'), (n) => String(n), flags, width);
      case 'f': return signed(number(), (n) => n.toFixed(p ?? 6), flags, width);
      case 'e': case 'E':
        return signed(number(), (n) => n.toExponential(p ?? 6).replace(/e([+-])(\d)$/, (_, sign, digit) => `e${sign}0${digit}`), flags, width, conv === 'E');
      case 'x': case 'X': case 'o': {
        const n = number('whole');
        // Negative numbers print as Java's 32-bit two's complement, as for an int.
        text = (n < 0 ? n + 2 ** 32 : n).toString(conv === 'o' ? 8 : 16);
        if (flags.includes('0') && width) text = text.padStart(Number(width), '0');
        break;
      }
      default: throw new Error(`format: %${conv} isn't supported here`);
    }
    return pad(conv === 'S' || conv === 'B' || conv === 'X' ? text.toUpperCase() : text, flags, width);
  });
}

function pad(text, flags, width) {
  if (!width || text.length >= Number(width)) return text;
  return flags.includes('-') ? text.padEnd(Number(width)) : text.padStart(Number(width));
}

// Sign, grouping and zero-padding for %d %f %e: "-003.500", "+5", "1,234,567".
function signed(n, digits, flags, width, upper = false) {
  let body = digits(Math.abs(n));
  if (flags.includes(',')) body = body.replace(/^\d+/, (whole) => whole.replace(/\B(?=(\d{3})+$)/g, ','));
  if (upper) body = body.toUpperCase();
  const sign = n < 0 || Object.is(n, -0) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  if (flags.includes('0') && width && !flags.includes('-')) body = body.padStart(Number(width) - sign.length, '0');
  return pad(sign + body, flags, width);
}
self.__nbFormat = (fmt, args) => javaFormat(fmt, args);

const PRELUDE = `
(ns nb)
(defn get
  ([k] (get k nil))
  ([k default]
   (let [v (js/__nbGet (name k))]
     (if (undefined? v) default (js->clj v :keywordize-keys true)))))
(defn set [k v] (js/__nbSet (name k) (clj->js v)) v)
(defn has? [k] (js/__nbHas (name k)))
(defn keys [] (js->clj (js/__nbKeys)))
(set! *print-newline* true)
(set! *print-fn* js/__nbWrite)
(set! *print-err-fn* js/__nbWrite)
(ns user)
(defn format [fmt & args]
  (js/__nbFormat fmt (to-array (map #(if (or (nil? %) (number? %) (string? %) (boolean? %)) % (str %)) args))))
(defn printf [fmt & args] (print (apply format fmt args)))
`;
self.scittle.core.eval_string(PRELUDE);

// "Unable to resolve symbol: foo" plus where, from the error's data. Lines are
// counted from the user's first line (each run is prefixed with one line).
function describe(error) {
  const message = String((error && error.message) || error);
  const data = error && error.data ? String(error.data) : '';
  const line = data.match(/:line (\d+)/);
  const column = data.match(/:column (\d+)/);
  return line ? `Line ${Math.max(1, Number(line[1]) - 1)}${column ? `, column ${column[1]}` : ''}: ${message}` : message;
}

self.onmessage = ({ data }) => {
  const { id, code, snapshot = {} } = data;
  stdout = '';
  values = snapshot;
  sets = [];
  const t = performance.now();
  try {
    // Each run starts in the user namespace, whatever the last one switched to.
    self.scittle.core.eval_string(`(ns user)\n${code}`);
    self.postMessage({ id, ok: true, stdout: stdout.replace(/\n$/, ''), sets, ms: performance.now() - t });
  } catch (error) {
    self.postMessage({ id, ok: false, stdout: stdout.replace(/\n$/, ''), error: describe(error), sets, ms: performance.now() - t });
  }
};
