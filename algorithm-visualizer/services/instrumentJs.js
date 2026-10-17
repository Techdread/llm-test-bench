// Thin wrapper around shared/js-instrument. Given a JS source it returns a
// flat chronological trace list plus a per-variable timeline (useful for the
// sidebar) and an error if execution threw.

import { instrument, runInstrumented } from '../../shared/services/js-instrument.js';

export function traceJs(source, { maxEvents = 50000, timeoutMs = 10000 } = {}) {
  let transformed;
  try {
    transformed = instrument(source);
  } catch (err) {
    return {
      error: `Parse error: ${err && err.message ? err.message : String(err)}`,
      events: [],
      vars: [],
      code: '',
      overrun: false,
    };
  }
  const { code } = transformed;
  const result = runInstrumented(code, { maxEvents, timeoutMs });
  const vars = uniqueVarNames(result.events);
  return {
    error: result.error,
    events: result.events,
    vars,
    code,
    overrun: result.overrun,
    stats: { ...transformed.stats, ...result.stats },
  };
}

function uniqueVarNames(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (e.var && !seen.has(e.var)) { seen.add(e.var); out.push(e.var); }
  }
  return out;
}

/**
 * Build per-frame variable snapshots. Each snapshot is a map of varName → latest
 * value at event index `t`. We pre-compute the full series so stepping back is
 * O(1) instead of re-running the program.
 */
export function buildSnapshots(events) {
  const snapshots = [];
  const state = new Map();
  let currentLine = null;
  for (const e of events) {
    if (e.kind === 'iter') {
      currentLine = e.line;
    } else {
      state.set(e.var, e.value);
      currentLine = e.line;
    }
    snapshots.push({ t: e.t, line: currentLine, vars: new Map(state) });
  }
  return snapshots;
}
