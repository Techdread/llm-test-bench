// Tiny helpers for seeds.
export function randomSeed() {
  return (Math.random() * 0x7fffffff) | 0;
}

export function clampSeed(n) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return 1;
  return Math.abs(v) || 1;
}
