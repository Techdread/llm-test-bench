// Live generation status chip — spec 340.
//
// Shows what the model call(s) in flight on this page are doing right now:
//
//   ⏳ Starting · Codex CLI · 4s
//   🧠 Thinking · 3.1k tokens · 58s   usually 40s–1m 30s
//   ✍️ Writing · 12.4k chars · 1m 12s
//
// It reads generation-telemetry's in-flight registry, which every provider
// call already feeds, so an app only has to render it — as a component in its
// own toolbar, or floating via mountGenerationStatus() with one line of code.
// The "usually" range is this model's p25–p75 over the last 30 days, from
// serve.py; it is simply absent without serve.py or history.

import { html, render } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { subscribeInFlight, fetchTypical } from '../services/generation-telemetry.js';

const ICONS = {
  queued: 'fa-hourglass-start',
  dispatched: 'fa-paper-plane',
  spawned: 'fa-power-off',
  firstOutput: 'fa-power-off',
  sessionReady: 'fa-hourglass-half',
  firstThought: 'fa-brain',
  firstToken: 'fa-pen-nib',
  firstTool: 'fa-screwdriver-wrench',
};

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatCount(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function modelLabel(snapshot) {
  const provider = snapshot.providerName || snapshot.providerId;
  const model = snapshot.modelId && !['default', '__cli_default__'].includes(snapshot.modelId)
    ? snapshot.modelId.split('/').pop() : '';
  return model ? `${provider} · ${model}` : provider;
}

/** The p25–p75 hint relevant to the phase a call is in, if any. */
export function typicalHint(snapshot, typical) {
  if (!typical) return '';
  const range = (stat) => (stat && stat.n >= 3 ? `usually ${formatDuration(stat.p25)}–${formatDuration(stat.p75)}` : '');
  if (snapshot.phase === 'firstThought') return range(typical.think);
  if (snapshot.phase === 'firstToken' || snapshot.phase === 'firstTool') return range(typical.total);
  return range(typical.waitFirstWord);
}

function useInFlight() {
  const [calls, setCalls] = useState([]);
  const [, setTick] = useState(0);
  useEffect(() => subscribeInFlight(setCalls), []);
  // Elapsed times move even when no event arrives (a long redacted think).
  useEffect(() => {
    if (!calls.length) return undefined;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [calls.length]);
  return calls;
}

function useTypical(snapshot) {
  const [typical, setTypical] = useState(null);
  const key = snapshot ? `${snapshot.providerId}::${snapshot.modelId}` : '';
  useEffect(() => {
    if (!snapshot) return undefined;
    let live = true;
    fetchTypical(snapshot.providerId, snapshot.modelId).then(v => { if (live) setTypical(v); });
    return () => { live = false; };
  }, [key]);
  return typical;
}

/**
 * The chip. Renders nothing while no call is in flight.
 * `filter(snapshot)` narrows which calls it follows (default: all on the page).
 */
export function GenerationStatus({ filter = null, className = '' }) {
  ensureStyles();
  const all = useInFlight();
  const calls = filter ? all.filter(filter) : all;
  const current = calls.length ? calls.reduce((a, b) => (b.startedAt > a.startedAt ? b : a)) : null;
  const typical = useTypical(current);
  if (!current) return null;

  // Snapshots are only taken when an event arrives; the clock keeps moving.
  const elapsed = Math.max(current.elapsedMs, Date.now() - current.startedAt);
  const detail = current.note ? current.note : current.phase === 'firstThought' && current.thinkingTokens
    ? `${formatCount(current.thinkingTokens)} tokens`
    : (current.phase === 'firstToken' && current.outputChars ? `${formatCount(current.outputChars)} chars` : '');
  const hint = typicalHint(current, typical);
  const title = [
    `${current.label} — ${modelLabel(current)}`,
    `Started ${formatDuration(elapsed)} ago (${current.entry || 'call'})`,
    hint,
    calls.length > 1 ? `${calls.length} calls in flight on this page` : '',
    'Open Generation Observatory for the history.',
  ].filter(Boolean).join('\n');

  return html`
    <a class=${`gen-status gen-status-${current.phase} ${className}`} href="../generation-observatory/"
      target="_blank" rel="noopener" title=${title}>
      <i class=${`fa-solid ${ICONS[current.phase] || 'fa-circle-notch'}`}></i>
      <span class="gen-status-label">${current.label}</span>
      <span class="gen-status-model">${modelLabel(current)}</span>
      ${detail && html`<span class="gen-status-detail">${detail}</span>`}
      <span class="gen-status-time">${formatDuration(elapsed)}</span>
      ${hint && html`<span class="gen-status-hint">${hint}</span>`}
      ${calls.length > 1 && html`<span class="gen-status-more">+${calls.length - 1}</span>`}
    </a>
  `;
}

/**
 * Float the chip in a page corner — the one-line adoption path:
 *   mountGenerationStatus();                     // bottom-left
 *   mountGenerationStatus({ corner: 'bottom-right' });
 * Returns an unmount function.
 */
export function mountGenerationStatus({ corner = 'bottom-left', filter = null } = {}) {
  if (typeof document === 'undefined') return () => {};
  const host = document.createElement('div');
  host.className = `gen-status-host gen-status-host-${corner}`;
  document.body.appendChild(host);
  render(html`<${GenerationStatus} filter=${filter} />`, host);
  return () => { render(null, host); host.remove(); };
}

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.dataset.owner = 'generation-status';
  style.textContent = `
.gen-status { display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 3px 10px; border-radius: 999px; font-size: 12px; line-height: 18px;
  background: var(--bg-tertiary, #2a2a2a); color: var(--text-primary, #eee);
  border: 1px solid var(--border-color, #444); text-decoration: none; white-space: nowrap;
  overflow: hidden; }
.gen-status:hover { border-color: var(--accent, #60a5fa); }
.gen-status i { color: var(--accent, #60a5fa); }
.gen-status-firstThought i { animation: gen-status-pulse 1.6s ease-in-out infinite; }
.gen-status-label { font-weight: 600; }
.gen-status-model { color: var(--text-secondary, #bbb); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.gen-status-detail, .gen-status-time { font-variant-numeric: tabular-nums; }
.gen-status-hint { color: var(--text-muted, #888); }
.gen-status-more { color: var(--text-muted, #888); }
.gen-status-host { position: fixed; z-index: 9000; max-width: calc(100vw - 24px); pointer-events: none; }
.gen-status-host .gen-status { pointer-events: auto; box-shadow: var(--shadow, 0 2px 8px rgba(0,0,0,.3)); }
.gen-status-host-bottom-left { left: 12px; bottom: 12px; }
.gen-status-host-bottom-right { right: 12px; bottom: 12px; }
.gen-status-host-top-right { right: 12px; top: 56px; }
@keyframes gen-status-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .gen-status-firstThought i { animation: none; } }
`;
  document.head.appendChild(style);
}
