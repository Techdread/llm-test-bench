// What a settings write is about to destroy.
//
// Every config write is a shallow merge of whole fields, so one stale writer
// can replace a list of ensembles, providers or API keys with a shorter one —
// silently, because a write "succeeded". (It did: an ensemble was lost that
// way.) app-config asks this module what a write removes; anything it reports
// makes the previous file a keep-both backup before the new one lands.
//
// Pure, so the rule is testable without a data root.

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function size(v) {
  if (Array.isArray(v)) return v.length;
  if (isPlainObject(v)) return Object.keys(v).length;
  return null;
}

function isEmpty(v) {
  if (v === null || v === undefined || v === '') return true;
  const n = size(v);
  return n === 0;
}

/**
 * Human-readable list of what `next` drops relative to `previous`.
 * Empty array = the write only adds or changes values.
 */
export function describeLoss(previous, next) {
  if (!isPlainObject(previous) || !isPlainObject(next)) return [];
  const losses = [];
  for (const [key, before] of Object.entries(previous)) {
    if (isEmpty(before)) continue;
    if (!(key in next)) {
      losses.push(`${key}: removed`);
      continue;
    }
    
    const after = next[key];
    if (isEmpty(after)) {
      losses.push(`${key}: emptied`);
      continue;
    }
    const wasSize = size(before);
    const isSize = size(after);
    // Only a shrink counts. A same-size list with different contents is an
    // ordinary edit — reporting those would back up on every keystroke.
    if (wasSize !== null && isSize !== null && isSize < wasSize) {
      losses.push(`${key}: ${wasSize} → ${isSize} ${Array.isArray(before) ? 'entries' : 'keys'}`);
    }
  }
  return losses;
}

/** A sortable backup name beside the original: `providers.json.20260920T101500.bak`. */
export function backupName(fileName, at = new Date()) {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', 'T');
  return `${fileName}.${stamp}.bak`;
}
