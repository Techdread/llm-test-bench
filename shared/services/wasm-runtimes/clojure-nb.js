// clojure-nb — the `nb` namespace for Clojure on the JVM (the Debian backend),
// with the same functions as the browser backend (clojure-scittle.worker.js):
//   (nb/get :key default)  a copy, as Clojure data (keys become keywords)
//   (nb/set :key value)    shared when the run ends
//   (nb/has? :key)  (nb/keys)
//
// The run gets two files beside main.cljc: nb.clj (below), loaded first with
// `clojure -i nb.clj`, and nb.edn, the notebook's values when the cell started.
// nb/set prints a __NB_SET__ line, which the notebook applies when the run ends.
// It starts with a record separator (\u001e) so the page can put the marker on
// a line of its own even after a `print` without a newline (nbMarkerLines).

export const NB_CLJ = `(ns nb
  (:refer-clojure :exclude [get set keys])
  (:require [clojure.edn :as edn]
            [clojure.string :as str]
            [clojure.walk :as walk]))

;; nb.edn is [[name value] ...], in the notebook's order.
(def ^:private pairs (edn/read-string (slurp "nb.edn")))
(def ^:private values (atom (into {} pairs)))
(def ^:private order (atom (mapv first pairs)))

;; Clojure data as the notebook stores it, as the browser's clj->js does: maps
;; with text keys, keywords as their names, lists and sets as vectors.
(defn- plain [x]
  (cond
    (nil? x) nil
    (or (string? x) (boolean? x)) x
    (keyword? x) (name x)
    (symbol? x) (str x)
    (ratio? x) (double x)
    (number? x) (if (and (double? x) (or (Double/isNaN x) (Double/isInfinite x))) nil x)
    (map? x) (into {} (for [[k v] x] [(if (keyword? k) (name k) (str k)) (plain v)]))
    (or (sequential? x) (set? x)) (mapv plain x)
    (.isArray (class x)) (mapv plain x)
    :else (str x)))

(defn- json-text [s]
  (str "\\"" (str/escape s (fn [c] (case c
                                    \\" "\\\\\\""
                                    \\\\ "\\\\\\\\"
                                    \\newline "\\\\n"
                                    \\return "\\\\r"
                                    \\tab "\\\\t"
                                    (when (< (int c) 32) (format "\\\\u%04x" (int c))))))
       "\\""))

(defn- to-json [x]
  (cond
    (nil? x) "null"
    (string? x) (json-text x)
    (map? x) (str "{" (str/join "," (for [[k v] x] (str (json-text k) ":" (to-json v)))) "}")
    (vector? x) (str "[" (str/join "," (map to-json x)) "]")
    :else (str x)))

(defn get
  ([k] (get k nil))
  ([k default]
   (let [m @values, key (name k)]
     (if (contains? m key) (walk/keywordize-keys (clojure.core/get m key)) default))))

(defn set [k v]
  (let [key (name k), value (plain v)]
    (swap! values assoc key value)
    (when-not (some #{key} @order) (swap! order conj key))
    (print (str "\\u001e__NB_SET__ {\\"key\\":" (json-text key) ",\\"value\\":" (to-json value) "}\\n"))
    (flush)
    v))

(defn has? [k] (contains? @values (name k)))

(defn keys [] @order)

;; print holds its text until a newline; flush it at exit too, so what was
;; printed just before an error still shows.
(let [out *out*]
  (.addShutdownHook (Runtime/getRuntime) (Thread. (fn [] (.flush ^java.io.Writer out)))))

(in-ns 'user)
`;

/** A JSON-safe value as EDN, which Clojure reads with clojure.edn. */
export function toEdn(value) {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return String(value);
  // Not-a-number has no JSON form either; the notebook would hold null.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'nil';
  // JSON's string escapes (\n, \", \\, \uXXXX) are ones Clojure reads too.
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toEdn).join(' ')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)} ${toEdn(v)}`).join(' ')}}`;
  return 'nil';
}

/** The files a JVM Clojure run needs for `nb`, from the notebook's values. */
export function nbFiles(snapshot = {}) {
  const pairs = Object.entries(snapshot).filter(([, value]) => value !== undefined);
  return [
    { name: 'nb.clj', text: NB_CLJ },
    { name: 'nb.edn', text: `[${pairs.map(([key, value]) => `[${JSON.stringify(key)} ${toEdn(value)}]`).join('\n ')}]\n` },
  ];
}

/**
 * Puts each __NB_SET__ marker on a line of its own: the record separator nb/set
 * prints before it becomes a line break, unless the output was already at the
 * start of a line.
 */
export const nbMarkerLines = (stdout) => String(stdout || '').replace(/\n?\u001e/g, '\n').replace(/^\n(?=__NB_SET__)/, '');
