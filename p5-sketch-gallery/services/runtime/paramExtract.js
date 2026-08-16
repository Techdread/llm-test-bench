// Derive the parameter panel from the sketch source.
//
// A sketch declares its controls implicitly, by reading them:
//
//   const n = ctx.params.count ?? 80;
//   const { speed = 1.2, glow = true } = ctx.params;
//
// Nothing else in the app knows which knobs a sketch actually has, so we
// recover them from the code. Without this the panel keeps whatever keys were
// there before — sliders that move but drive nothing.

const LITERAL = String.raw`(-?\d+(?:\.\d+)?|true|false|'[^'\n]*'|"[^"\n]*")`;

// ctx.params.NAME ?? 80   |   ctx.params.NAME || 80
const DOT_WITH_DEFAULT = new RegExp(
  String.raw`ctx\s*\.\s*params\s*\.\s*([A-Za-z_$][\w$]*)\s*(?:\?\?|\|\|)\s*` + LITERAL,
  'g',
);

// ctx.params['NAME'] ?? 80
const INDEX_WITH_DEFAULT = new RegExp(
  String.raw`ctx\s*\.\s*params\s*\[\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]\s*(?:\?\?|\|\|)\s*` + LITERAL,
  'g',
);

// Any mention at all, with or without a default.
const ANY_REFERENCE = /ctx\s*\.\s*params\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*['"][A-Za-z_$][\w$]*['"]\s*\])/g;

// const { speed = 1.2, glow = true, count } = ctx.params;
const DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*ctx\s*\.\s*params\b/g;

function parseLiteral(raw) {
  if (raw === undefined) return undefined;
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^['"]/.test(s)) return s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// Strip line/block comments and string bodies so commented-out or quoted
// "ctx.params.foo" text doesn't invent a control.
function stripNoise(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * @returns {{ params: Object, names: string[], referenced: boolean }}
 *   params     — { name: default } for every control the sketch reads
 *   names      — declaration order, so the panel matches the code
 *   referenced — whether the code touches ctx.params at all. When true but
 *                params is empty, the reads are in a shape we can't parse and
 *                the caller should keep what it has rather than blanking.
 */
export function extractParams(code) {
  const src = stripNoise(code);
  const params = {};
  const names = [];

  // A read with no default gets 1, not 0: the knob still appears, but a
  // sketch that multiplies by it isn't silently zeroed out.
  const NO_DEFAULT = 1;

  const record = (name, value) => {
    if (!name) return;
    const known = name in params;
    if (!known) names.push(name);
    // First literal default wins; a later bare read must not clobber it.
    if (!known) params[name] = value === undefined ? NO_DEFAULT : value;
    else if (value !== undefined && params[name] === NO_DEFAULT) params[name] = value;
  };

  for (const re of [DOT_WITH_DEFAULT, INDEX_WITH_DEFAULT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) record(m[1], parseLiteral(m[2]));
  }

  DESTRUCTURE.lastIndex = 0;
  let d;
  while ((d = DESTRUCTURE.exec(src)) !== null) {
    for (const part of d[1].split(',')) {
      const [lhs, rhs] = part.split('=');
      const name = (lhs || '').trim().replace(/^\.\.\./, '');
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
      record(name, parseLiteral(rhs));
    }
  }

  // Reads with no default at all — surface them so the knob exists, at 0.
  ANY_REFERENCE.lastIndex = 0;
  let a;
  while ((a = ANY_REFERENCE.exec(src)) !== null) {
    const name = a[0].replace(/.*?params\s*/, '')
      .replace(/^\.\s*/, '')
      .replace(/^\[\s*['"]|['"]\s*\]$/g, '');
    record(name, undefined);
  }

  const referenced = /ctx\s*\.\s*params\b/.test(src);

  const ordered = {};
  for (const n of names) ordered[n] = params[n];
  return { params: ordered, names, referenced };
}

/**
 * Rebuild the parameter set from the code.
 *
 * @param {string} code
 * @param {Object} currentParams  what the panel shows now
 * @param {Object} [opts]
 * @param {boolean} [opts.keepValues=false]  keep the author's current value for
 *   any knob that survived, instead of resetting to the code's default. Right
 *   for a manual re-sync while tuning; wrong after a fresh generation, where
 *   the new sketch's own defaults are the ones tuned to it.
 * @returns {{ params: Object, changed: boolean, unparsed: boolean }}
 *   unparsed — the code touches ctx.params but in a shape we can't read, so the
 *   caller should leave the panel alone rather than blank it.
 */
export function syncParamsWithCode(code, currentParams = {}, { keepValues = false } = {}) {
  const { params, referenced } = extractParams(code);
  if (!referenced) {
    // No ctx.params at all — the sketch genuinely has no controls.
    const changed = Object.keys(currentParams).length > 0;
    return { params: {}, changed, unparsed: false };
  }
  if (!Object.keys(params).length) return { params: currentParams, changed: false, unparsed: true };

  const next = {};
  for (const [k, v] of Object.entries(params)) {
    const kept = currentParams[k];
    next[k] = (keepValues && kept !== undefined && typeof kept === typeof v) ? kept : v;
  }
  const changed = JSON.stringify(next) !== JSON.stringify(currentParams);
  return { params: next, changed, unparsed: false };
}
