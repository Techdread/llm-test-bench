export function completionTokenCount(stats) {
  const value = stats?.completionTokens ?? stats?.responseTokens ?? stats?.outputTokens;
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : null;
}

export function estimatedTokenCount(text) {
  return Math.max(0, Math.round(String(text || '').length / 4));
}

/** Prefer provider telemetry; otherwise estimate speed from the live stream. */
export function tokensPerSecond(stats, tokenCount, timing, now = Date.now()) {
  const reportedValue = stats?.tokensPerSecond;
  const reported = Number(reportedValue);
  if (reportedValue != null && reportedValue !== '' && Number.isFinite(reported) && reported >= 0) {
    return reported;
  }

  const startedAt = Number(timing?.startedAt);
  const endedAt = Number(timing?.endedAt);
  const tokens = Number(tokenCount);
  if (!Number.isFinite(startedAt) || startedAt <= 0 || !Number.isFinite(tokens) || tokens <= 0) return null;
  const effectiveEnd = Number.isFinite(endedAt) && endedAt >= startedAt ? endedAt : Number(now);
  const elapsedMs = effectiveEnd - startedAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  return Number((tokens / (elapsedMs / 1000)).toFixed(1));
}

export function formatTokensPerSecond(value) {
  if (!Number.isFinite(value)) return '— tokens/s';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} tokens/s`;
}
