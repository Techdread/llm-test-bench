// Read + clear the cml:handoff payload on app boot.
const KEY = 'cml:handoff';

export function readHandoff() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const parsed = JSON.parse(raw);
    if (parsed.v !== 1) {
      console.warn('Unknown handoff version', parsed.v);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn('Handoff read failed', e);
    try { localStorage.removeItem(KEY); } catch {}
    return null;
  }
}

/**
 * Peek at a pending handoff without consuming it. Used by the welcome gate
 * to show "an import from X is waiting" before the user picks a folder.
 */
export function peekHandoff() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}
