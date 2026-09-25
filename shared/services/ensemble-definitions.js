// Model ensemble definitions — spec 341. Pure: no storage, no network.
//
// An ensemble is a named recipe that any hub app can pick from its model
// dropdown as if it were one model:
//
//   best-of-n   every member answers; a judge (or the app's own scorer) picks
//               the best draft, which is returned unchanged
//   synthesize  every member drafts; a synthesizer merges them into one answer
//
// The stored list keeps every version of every ensemble. Editing appends a
// version; deleting hides. Nothing here ever drops a definition.

export const ENSEMBLE_PROVIDER_ID = 'ensemble';
export const STRATEGIES = Object.freeze(['best-of-n', 'synthesize']);
export const MAX_MEMBERS = 6;
export const GATES = Object.freeze(['non-empty', 'not-truncated', 'json', 'html', 'svg']);
export const DEFAULT_GATES = Object.freeze(['non-empty', 'not-truncated']);
export const DEFAULT_RUBRIC = 'Follows every instruction in the prompt; correct; complete; output is in exactly the requested format.';

function slug(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'ensemble';
}

function modelRef(value) {
  if (!value || typeof value !== 'object') return null;
  const providerId = String(value.providerId || '').trim();
  const modelId = String(value.modelId || '').trim();
  if (!providerId || !modelId) return null;
  const out = { providerId, modelId };
  if (value.label) out.label = String(value.label);
  if (value.params && typeof value.params === 'object' && Object.keys(value.params).length) out.params = { ...value.params };
  return out;
}

/** Normalize one definition (the body of a version). */
export function normalizeDefinition(input = {}) {
  const strategy = STRATEGIES.includes(input.strategy) ? input.strategy : 'best-of-n';
  const members = (Array.isArray(input.members) ? input.members : []).map(modelRef).filter(Boolean);
  const judge = modelRef(input.judge);
  const synthesizer = modelRef(input.synthesizer);
  const gates = [...new Set((Array.isArray(input.gates) ? input.gates : DEFAULT_GATES).filter(g => GATES.includes(g)))];
  const grace = input.quorum?.graceAfterQuorumMs;
  const minDrafts = Math.max(1, Math.round(Number(input.quorum?.minDrafts) || Math.min(2, Math.max(1, members.length))));
  const maxUsd = input.caps?.maxUsdPerCall;
  return {
    name: String(input.name || '').trim() || 'Untitled ensemble',
    strategy,
    members,
    judge: judge ? { ...judge, rubric: String(input.judge?.rubric || '').trim() || DEFAULT_RUBRIC } : null,
    synthesizer,
    gates,
    quorum: {
      minDrafts,
      graceAfterQuorumMs: grace === 'auto' || grace === undefined || grace === null || grace === ''
        ? 'auto' : Math.max(0, Math.round(Number(grace) || 0)),
    },
    caps: {
      maxConcurrentCli: Math.max(1, Math.round(Number(input.caps?.maxConcurrentCli) || 2)),
      maxUsdPerCall: maxUsd === null || maxUsd === undefined || maxUsd === '' || !Number.isFinite(Number(maxUsd))
        ? null : Math.max(0, Number(maxUsd)),
    },
    notes: String(input.notes || ''),
  };
}

/**
 * Problems that make a definition unrunnable (errors) or questionable
 * (warnings). The editor shows both; only errors block saving.
 */
export function validateDefinition(input) {
  const def = normalizeDefinition(input);
  const errors = [];
  const warnings = [];
  if (!def.members.length) errors.push('Add at least one member.');
  if (def.members.length > MAX_MEMBERS) errors.push(`At most ${MAX_MEMBERS} members.`);
  const refs = [...def.members, def.judge, def.synthesizer].filter(Boolean);
  if (refs.some(r => r.providerId === ENSEMBLE_PROVIDER_ID)) errors.push('An ensemble cannot contain another ensemble.');
  if (def.strategy === 'synthesize' && !def.synthesizer) errors.push('Synthesize needs a synthesizer model.');
  if (def.quorum.minDrafts > def.members.length && def.members.length) {
    errors.push(`Minimum drafts (${def.quorum.minDrafts}) is more than the number of members (${def.members.length}).`);
  }
  if (def.strategy === 'best-of-n' && !def.judge && def.members.length > 1) {
    warnings.push('No judge: without an app scorer the longest passing draft wins.');
  }
  const key = (r) => `${r.providerId}::${r.modelId}`;
  if (def.judge && def.members.some(m => key(m) === key(def.judge))) {
    warnings.push('The judge is also a member; models tend to prefer their own writing.');
  }
  if (new Set(def.members.map(key)).size < def.members.length) {
    warnings.push('The same model appears twice; its drafts will be similar.');
  }
  return { errors, warnings, definition: def };
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

/** Current version body of a stored record. */
export function currentVersion(record) {
  if (!record?.versions?.length) return null;
  return record.versions.find(v => v.version === record.currentVersion) || record.versions.at(-1);
}

/** The runnable view of a record: its current definition plus id and version. */
export function resolveRecord(record) {
  const version = currentVersion(record);
  if (!version) return null;
  return { id: record.id, version: version.version, hidden: !!record.hidden, ...normalizeDefinition(version) };
}

/**
 * Save a definition: a new record, or a new version of an existing one.
 * Returns { list, record }. Throws on validation errors.
 */
export function saveDefinition(list, input, { id = null, now = () => Date.now() } = {}) {
  const { errors, definition } = validateDefinition(input);
  if (errors.length) throw new Error(errors.join(' '));
  const records = Array.isArray(list) ? list.map(r => ({ ...r, versions: [...(r.versions || [])] })) : [];
  const at = nowIso(now);
  let record = id ? records.find(r => r.id === id) : null;
  if (record) {
    const version = Math.max(0, ...record.versions.map(v => v.version)) + 1;
    record.versions.push({ version, createdAt: at, ...definition });
    record.currentVersion = version;
    record.updatedAt = at;
  } else {
    let newId = slug(definition.name);
    const taken = new Set(records.map(r => r.id));
    for (let n = 2; taken.has(newId); n++) newId = `${slug(definition.name)}-${n}`;
    record = { id: newId, createdAt: at, updatedAt: at, hidden: false, currentVersion: 1, versions: [{ version: 1, createdAt: at, ...definition }] };
    records.push(record);
  }
  return { list: records, record };
}

export function setHidden(list, id, hidden, { now = () => Date.now() } = {}) {
  return (Array.isArray(list) ? list : []).map(r => (r.id === id ? { ...r, hidden: !!hidden, updatedAt: nowIso(now) } : r));
}

/**
 * Union two stored lists by id, keeping the newer version of each record.
 *
 * Every write sends the WHOLE list, so a snapshot that is stale or empty — a
 * second tab, a browser that could not read the file, a reload before hydrate —
 * would otherwise delete records it never knew about. (It did: "First Test"
 * vanished when the next ensemble was saved.) Deletion here is soft (a hidden
 * flag), so nothing legitimate is ever removed from the list and a union is
 * always the safe merge.
 */
export function mergeRecordLists(mine, stored) {
  const ours = Array.isArray(mine) ? mine : [];
  const theirs = Array.isArray(stored) ? stored : [];
  if (!theirs.length) return ours;
  const out = new Map(theirs.map(r => [r?.id, r]).filter(([id]) => id));
  for (const record of ours) {
    if (!record?.id) continue;
    const other = out.get(record.id);
    // Same record from two sessions: the later edit wins. A record only one
    // side has is kept either way.
    out.set(record.id, other && (other.updatedAt || '') > (record.updatedAt || '') ? other : record);
  }
  return [...out.values()];
}

/** Runnable ensembles, newest first; hidden ones only on request. */
export function listDefinitions(list, { includeHidden = false } = {}) {
  return (Array.isArray(list) ? list : [])
    .filter(r => includeHidden || !r.hidden)
    .map(resolveRecord)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}
