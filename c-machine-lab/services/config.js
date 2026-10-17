export const STORAGE_KEY = 'c-machine-lab-config';

export function defaultConfig() {
  return {
    memorySize: 64 * 1024,
    segments: {
      text: { start: 0x0000, end: 0x1fff },
      data: { start: 0x2000, end: 0x2fff },
      io: { start: 0x3000, end: 0x3fff },
      heap: { start: 0x4000, end: 0x9fff },
      stack: { start: 0xa000, end: 0xffff },
    },
    stackSize: 0x6000,
    heapSize: 0x6000,
    maxStepsBeforeAutoPause: 500,
    defaultRunSpeed: 8,
    traceRetentionLimit: 1000,
    snapshotInterval: 12,
    maxStdoutLength: 20000,
    maxVirtualFileSize: 64 * 1024,
    heapAllocatorStrategy: 'first-fit',
    enableBlockHeaders: true,
    enableTimerInterrupts: false,
    timerInterruptInterval: 20,
    pointerSafetyStrictness: 'teaching',
    signedIntegerOverflowBehavior: 'wrap-and-flag',
  };
}

export function validateConfig(cfg) {
  const errors = [];
  const numberAt = (path) => {
    const value = path.split('.').reduce((obj, key) => obj == null ? undefined : obj[key], cfg);
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path} must be a finite number`);
    return value;
  };

  const memorySize = numberAt('memorySize');
  for (const segment of ['text', 'data', 'io', 'heap', 'stack']) {
    const start = numberAt(`segments.${segment}.start`);
    const end = numberAt(`segments.${segment}.end`);
    if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
      errors.push(`segments.${segment}.start must be lower than segments.${segment}.end`);
    }
    if (Number.isFinite(end) && Number.isFinite(memorySize) && end >= memorySize) {
      errors.push(`segments.${segment}.end must fit inside memorySize`);
    }
  }

  for (const key of [
    'stackSize',
    'heapSize',
    'maxStepsBeforeAutoPause',
    'defaultRunSpeed',
    'traceRetentionLimit',
    'snapshotInterval',
    'maxStdoutLength',
    'maxVirtualFileSize',
    'timerInterruptInterval',
  ]) {
    numberAt(key);
  }

  if (cfg.memorySize < 4096 || cfg.memorySize > 1024 * 1024) errors.push('memorySize must be between 4 KiB and 1 MiB');
  if (cfg.maxStepsBeforeAutoPause < 1) errors.push('maxStepsBeforeAutoPause must be at least 1');
  if (cfg.defaultRunSpeed < 1 || cfg.defaultRunSpeed > 120) errors.push('defaultRunSpeed must be between 1 and 120');
  if (!['first-fit', 'bump'].includes(cfg.heapAllocatorStrategy)) errors.push('heapAllocatorStrategy must be "first-fit" or "bump"');
  if (!['off', 'teaching', 'strict'].includes(cfg.pointerSafetyStrictness)) errors.push('pointerSafetyStrictness must be off, teaching, or strict');
  if (!['wrap-and-flag', 'trap'].includes(cfg.signedIntegerOverflowBehavior)) errors.push('signedIntegerOverflowBehavior must be wrap-and-flag or trap');

  return errors;
}

export function mergeConfig(overrides) {
  return deepMerge(defaultConfig(), overrides || {});
}

function deepMerge(base, patch) {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    if (
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key]) &&
      patch[key] &&
      typeof patch[key] === 'object' &&
      !Array.isArray(patch[key])
    ) {
      out[key] = deepMerge(base[key], patch[key]);
    } else {
      out[key] = patch[key];
    }
  }
  return out;
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig();
    const merged = mergeConfig(JSON.parse(raw));
    const errors = validateConfig(merged);
    if (errors.length) {
      console.warn('c-machine-lab: stored config invalid, using defaults', errors);
      return defaultConfig();
    }
    return merged;
  } catch (err) {
    console.warn('c-machine-lab: failed to load config', err);
    return defaultConfig();
  }
}

export function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
