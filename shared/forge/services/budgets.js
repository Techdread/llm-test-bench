// Explicit resource policy shared by the Forge family. The same normalized
// object is persisted with every run and sent to the local agent bridge.
//
// Each Forge owns its own localStorage key: pass one to loadBudgets/saveBudgets,
// or bind a pair once with createBudgetStorage().

export const BUDGET_STORAGE_KEY = 'forge-budgets';

export function defaultBudgets() {
  return {
    maxTurns: 40,
    maxAgentSeconds: 900,
    idleTimeoutSeconds: 180,
    maxFiles: 100,
    maxTotalBytes: 8 * 1024 * 1024,
    maxFileBytes: 1024 * 1024,
    maxImages: 6,
    maxImagePixels: 12 * 1024 * 1024,
    maxTokens: 2_000_000,
    maxCostUsd: null,
    maxNativeSeconds: 60,
  };
}

// Time budgets that accept 0 as "no limit at all". A slow local model can take
// many minutes to produce its first token on a long context, and no wall-clock
// number is honest for that — the user's hard-stop button is the real bound.
export const UNLIMITED_KEYS = ['maxAgentSeconds', 'idleTimeoutSeconds'];

// Count / size budgets that can be switched off entirely. 0 already MEANS
// something for some of them (maxImages 0 = "no images allowed"), so "no limit"
// is Infinity in memory instead. JSON has no Infinity: it is written as null and
// read back as Infinity, and the agent bridge treats an explicit null the same.
export const OPEN_ENDED_KEYS = [
  'maxTurns', 'maxFiles', 'maxTotalBytes', 'maxFileBytes', 'maxImages',
  'maxImagePixels', 'maxTokens', 'maxNativeSeconds',
];

// Floors only. There are no ceilings: the user decides how big a run may get,
// and anything they want uncapped is Infinity (or 0 for the time budgets).
const MINIMUMS = {
  maxTurns: 1,
  maxAgentSeconds: 10,
  idleTimeoutSeconds: 10,
  maxFiles: 1,
  maxTotalBytes: 1024,
  maxFileBytes: 256,
  maxImages: 0,
  maxImagePixels: 0,
  maxTokens: 1,
  maxNativeSeconds: 1,
};

/** True when this budget is switched off (0 time budget, Infinity/null count, null cost). */
export function isUnlimitedBudget(key, value) {
  if (key === 'maxCostUsd') return value === null || value === undefined || value === '';
  if (UNLIMITED_KEYS.includes(key)) return Number(value) === 0 || value === null || value === Infinity;
  return value === null || value === Infinity;
}

/** Display helper: '∞' for an unlimited (or JSON-reloaded null) value, else format(n). */
export function formatBudget(value, format = n => n.toLocaleString()) {
  const n = value === null || value === undefined ? Infinity : Number(value);
  return Number.isFinite(n) ? format(n) : '∞';
}

export function normalizeBudgets(value = {}, base = defaultBudgets()) {
  const out = { ...defaultBudgets(), ...base };
  for (const [key, min] of Object.entries(MINIMUMS)) {
    const raw = value[key];
    if (UNLIMITED_KEYS.includes(key)) {
      if (raw === null || raw === Infinity) { out[key] = 0; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      out[key] = Math.round(n) === 0 ? 0 : Math.max(min, Math.round(n));
      continue;
    }
    if (raw === null || raw === Infinity) { out[key] = Infinity; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    out[key] = Math.max(min, Math.round(n));
  }
  if (value.maxCostUsd === null || value.maxCostUsd === '' || value.maxCostUsd === undefined) {
    out.maxCostUsd = null;
  } else {
    const n = Number(value.maxCostUsd);
    out.maxCostUsd = Number.isFinite(n) && n >= 0 ? n : null;
  }
  // A single file can never be allowed to exceed the whole-project budget.
  out.maxFileBytes = Math.min(out.maxFileBytes, out.maxTotalBytes);
  if (Array.isArray(value.reservedFiles)) {
    out.reservedFiles = value.reservedFiles
      .map(entry => ({
        path: String(entry?.path || '').replace(/^\/+/, ''),
        bytes: Math.max(0, Math.round(Number(entry?.bytes) || 0)),
      }))
      .filter(entry => entry.path);
  }
  return out;
}

export function validateBudgets(value) {
  const errors = [];
  for (const [key, min] of Object.entries(MINIMUMS)) {
    const raw = value?.[key];
    if (isUnlimitedBudget(key, raw)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min) {
      errors.push(`${key} must be at least ${min}, or "No limit"`);
    }
  }
  if (value?.maxCostUsd !== null && value?.maxCostUsd !== '' &&
      (!Number.isFinite(Number(value.maxCostUsd)) || Number(value.maxCostUsd) < 0)) {
    errors.push('maxCostUsd must be blank or zero-or-greater');
  }
  return errors;
}

export function loadBudgets(storageKey = BUDGET_STORAGE_KEY, storage = globalThis.localStorage, base = defaultBudgets()) {
  try {
    return normalizeBudgets(JSON.parse(storage?.getItem(storageKey) || '{}'), base);
  } catch {
    return normalizeBudgets({}, base);
  }
}

export function saveBudgets(value, storageKey = BUDGET_STORAGE_KEY, storage = globalThis.localStorage, base = defaultBudgets()) {
  const next = normalizeBudgets(value, base);
  storage?.setItem(storageKey, JSON.stringify(next));
  return next;
}

/** Bind one Forge's storage key so callers keep the original two-arg shape. */
export function createBudgetStorage(storageKey, base = defaultBudgets()) {
  return {
    BUDGET_STORAGE_KEY: storageKey,
    loadBudgets: (storage = globalThis.localStorage) => loadBudgets(storageKey, storage, base),
    saveBudgets: (value, storage = globalThis.localStorage) => saveBudgets(value, storageKey, storage, base),
  };
}

/**
 * Everything a Forge's budgets.js shim needs, bound to its storage key and its
 * own defaults (older Forges default to a 200k token budget, not 2M).
 */
export function createBudgetKit(storageKey, overrides = {}) {
  const defaults = () => ({ ...defaultBudgets(), ...overrides });
  return {
    ...createBudgetStorage(storageKey, defaults()),
    defaultBudgets: defaults,
    normalizeBudgets: (value = {}) => normalizeBudgets(value, defaults()),
    createBudgetLedger: (policy = {}) => createBudgetLedger(policy, defaults()),
  };
}

export function utf8Bytes(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Stateful, pure budget ledger for the in-app tool loop.
 * Failed checks never mutate usage.
 */
export function createBudgetLedger(policy = {}, base = defaultBudgets()) {
  const limits = normalizeBudgets(policy, base);
  const files = new Map();
  const usage = {
    files: 0, totalBytes: 0, images: 0, imagePixels: 0,
    promptTokens: 0, completionTokens: 0, costUsd: null,
  };
  let decision = { allowed: true, reason: null, code: null, at: null };

  for (const entry of limits.reservedFiles || []) {
    files.set(entry.path, entry.bytes);
    usage.totalBytes += entry.bytes;
  }
  usage.files = files.size;

  const deny = (code, reason) => {
    decision = { allowed: false, code, reason, at: new Date().toISOString() };
    return { ok: false, ...decision };
  };

  return {
    limits,
    usage,
    get decision() { return decision; },

    recordTokens(prompt = 0, completion = 0, costUsd = null) {
      usage.promptTokens += Number(prompt) || 0;
      usage.completionTokens += Number(completion) || 0;
      if (Number.isFinite(Number(costUsd))) usage.costUsd = (usage.costUsd || 0) + Number(costUsd);
      const totalTokens = usage.promptTokens + usage.completionTokens;
      if (totalTokens > limits.maxTokens) {
        return deny('max_tokens', `Token budget exceeded (${totalTokens.toLocaleString()} > ${limits.maxTokens.toLocaleString()})`);
      }
      if (limits.maxCostUsd !== null && usage.costUsd !== null && usage.costUsd > limits.maxCostUsd) {
        return deny('max_cost', `Cost budget exceeded ($${usage.costUsd.toFixed(4)} > $${limits.maxCostUsd.toFixed(4)})`);
      }
      return { ok: true };
    },

    beforeFileWrite(path, bytes, { image = false, pixels = 0 } = {}) {
      const cleanPath = String(path || '');
      const nextBytes = Math.max(0, Number(bytes) || 0);
      const previous = files.get(cleanPath);
      const nextFiles = files.size + (previous === undefined ? 1 : 0);
      const nextTotal = usage.totalBytes - (previous || 0) + nextBytes;
      const nextImages = usage.images + (image && previous === undefined ? 1 : 0);
      const nextPixels = usage.imagePixels + (image && previous === undefined ? Math.max(0, Number(pixels) || 0) : 0);

      if (!cleanPath) return deny('invalid_path', 'A generated file must have a path');
      if (nextBytes > limits.maxFileBytes) {
        return deny('max_file_bytes', `${cleanPath} is ${(nextBytes / 1024).toFixed(1)} KB; the single-file limit is ${(limits.maxFileBytes / 1024).toFixed(1)} KB`);
      }
      if (nextFiles > limits.maxFiles) {
        return deny('max_files', `File-count budget exceeded (${nextFiles} > ${limits.maxFiles})`);
      }
      if (nextTotal > limits.maxTotalBytes) {
        return deny('max_total_bytes', `Project-size budget exceeded (${(nextTotal / 1024 / 1024).toFixed(2)} MB > ${(limits.maxTotalBytes / 1024 / 1024).toFixed(2)} MB)`);
      }
      if (nextImages > limits.maxImages) {
        return deny('max_images', `Image budget exceeded (${nextImages} > ${limits.maxImages})`);
      }
      if (nextPixels > limits.maxImagePixels) {
        return deny('max_image_pixels', `Image-pixel budget exceeded (${nextPixels.toLocaleString()} > ${limits.maxImagePixels.toLocaleString()})`);
      }

      files.set(cleanPath, nextBytes);
      usage.files = files.size;
      usage.totalBytes = nextTotal;
      usage.images = nextImages;
      usage.imagePixels = nextPixels;
      return { ok: true };
    },

    snapshot() {
      return {
        limits: { ...limits },
        usage: { ...usage, totalTokens: usage.promptTokens + usage.completionTokens },
        decision: { ...decision },
        remaining: {
          turns: limits.maxTurns,
          files: Math.max(0, limits.maxFiles - usage.files),
          bytes: Math.max(0, limits.maxTotalBytes - usage.totalBytes),
          images: Math.max(0, limits.maxImages - usage.images),
          imagePixels: Math.max(0, limits.maxImagePixels - usage.imagePixels),
          tokens: Math.max(0, limits.maxTokens - usage.promptTokens - usage.completionTokens),
          costUsd: limits.maxCostUsd === null || usage.costUsd === null
            ? null : Math.max(0, limits.maxCostUsd - usage.costUsd),
        },
      };
    },
  };
}
