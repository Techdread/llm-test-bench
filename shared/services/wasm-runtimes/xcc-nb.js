// xcc-nb — how a C cell reaches the notebook's nb store: the <nb.h> header,
// and the nb_* functions the page supplies as the program's `env` imports.
// Reads see a snapshot of nb taken when the cell starts; writes are collected
// and applied by the page when it ends. DOM-free, so node tests can use it.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const NB_HEADER = `// nb.h: the notebook's shared values, from a C cell.
// Reads see nb as it was when the cell started; writes are shared when it ends.
#pragma once

int nb_has(const char *key);
double nb_get_number(const char *key, double fallback);
long long nb_get_int(const char *key, long long fallback);
// The next four copy into your buffer and return the full length, or -1 if
// the value is missing or the wrong kind.
int nb_get_string(const char *key, char *buf, int size);
int nb_get_doubles(const char *key, double *out, int max);
int nb_get_ints(const char *key, int *out, int max);
int nb_get_json(const char *key, char *buf, int size);

void nb_set_number(const char *key, double value);
void nb_set_int(const char *key, long long value);
void nb_set_string(const char *key, const char *text);
void nb_set_doubles(const char *key, const double *values, int count);
void nb_set_ints(const char *key, const int *values, int count);
void nb_set_json(const char *key, const char *json);
`;

/** The nb_* functions, reading `values` and recording writes in `sets`. */
export function nbImports(getMemory, values, sets) {
  const mem = () => new Uint8Array(getMemory().buffer);
  const view = () => new DataView(getMemory().buffer);
  const cstr = (ptr) => {
    const bytes = mem();
    let end = ptr;
    while (bytes[end] !== 0) end++;
    return decoder.decode(bytes.subarray(ptr, end));
  };
  const has = (key) => Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined;
  const copyOut = (text, ptr, size) => {
    const bytes = encoder.encode(text);
    if (size > 0) {
      const n = Math.min(bytes.length, size - 1);
      mem().set(bytes.subarray(0, n), ptr);
      mem()[ptr + n] = 0;
    }
    return bytes.length;
  };
  const set = (key, value) => {
    values[key] = value;
    sets.push([key, value]);
  };
  const asNumber = (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    nb_has: (k) => (has(cstr(k)) ? 1 : 0),
    nb_get_number: (k, fallback) => asNumber(values[cstr(k)]) ?? fallback,
    nb_get_int: (k, fallback) => {
      const n = asNumber(values[cstr(k)]);
      return n === null ? fallback : BigInt(Math.trunc(n));
    },
    nb_get_string: (k, ptr, size) => {
      const v = values[cstr(k)];
      return typeof v === 'string' ? copyOut(v, ptr, size) : -1;
    },
    nb_get_doubles: (k, ptr, max) => {
      const v = values[cstr(k)];
      if (!Array.isArray(v)) return -1;
      const dv = view();
      for (let i = 0; i < Math.min(max, v.length); i++) dv.setFloat64(ptr + i * 8, asNumber(v[i]) ?? NaN, true);
      return v.length;
    },
    nb_get_ints: (k, ptr, max) => {
      const v = values[cstr(k)];
      if (!Array.isArray(v)) return -1;
      const dv = view();
      for (let i = 0; i < Math.min(max, v.length); i++) dv.setInt32(ptr + i * 4, Math.trunc(asNumber(v[i]) ?? 0), true);
      return v.length;
    },
    nb_get_json: (k, ptr, size) => {
      const key = cstr(k);
      return has(key) ? copyOut(JSON.stringify(values[key]), ptr, size) : -1;
    },
    nb_set_number: (k, value) => set(cstr(k), Number.isFinite(value) ? value : null),
    nb_set_int: (k, value) => set(cstr(k), Number(value)),
    nb_set_string: (k, ptr) => set(cstr(k), cstr(ptr)),
    nb_set_doubles: (k, ptr, count) => {
      const dv = view();
      set(cstr(k), Array.from({ length: Math.max(0, count) }, (_, i) => { const x = dv.getFloat64(ptr + i * 8, true); return Number.isFinite(x) ? x : null; }));
    },
    nb_set_ints: (k, ptr, count) => {
      const dv = view();
      set(cstr(k), Array.from({ length: Math.max(0, count) }, (_, i) => dv.getInt32(ptr + i * 4, true)));
    },
    nb_set_json: (k, ptr) => {
      const key = cstr(k);
      const text = cstr(ptr);
      try {
        set(key, JSON.parse(text));
      } catch {
        throw new Error(`nb_set_json("${key}", …): that isn't valid JSON: ${text.slice(0, 80)}`);
      }
    },
  };
}


/** The names of the functions <nb.h> declares. */
export const NB_FUNCTIONS = new Set(Object.keys(nbImports(() => null, {}, [])));
