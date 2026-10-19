// Tracks live Vega views so rerenders and runtime resets can finalize them.

const activeViews = new Set();

export function trackVegaView(embedResult) {
  if (!embedResult) return () => {};
  activeViews.add(embedResult);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeViews.delete(embedResult);
    try { embedResult.finalize?.(); } catch { /* best-effort library cleanup */ }
  };
}

export function activeVegaViewCount() {
  return activeViews.size;
}

export function finalizeAllVegaViews() {
  const views = [...activeViews];
  activeViews.clear();
  for (const result of views) {
    try { result.finalize?.(); } catch { /* continue releasing other views */ }
  }
  return views.length;
}
