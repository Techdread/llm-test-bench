import { html } from 'htm/preact';
import { useState, useMemo } from 'preact/hooks';

// Raw wire-level inspector for the in-app build loop. Reads straight off the trace
// `steps` (each carries a request snapshot + raw model response), so you can see
// exactly what was sent and what came back on any turn — the fastest way to work
// out *why* a local model's tool calling is failing (bad JSON, wrong role, 400s…).
const TABS = [
  { id: 'messages', label: 'Messages', icon: 'fa-comments' },
  { id: 'request', label: 'Request', icon: 'fa-arrow-up' },
  { id: 'response', label: 'Response', icon: 'fa-arrow-down' },
  { id: 'export', label: 'Export trace', icon: 'fa-file-export' },
];

export function WireInspector({ steps }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('messages');
  const [turn, setTurn] = useState(0); // 0 = latest

  const withReq = useMemo(() => steps.filter(s => s.request), [steps]);
  const sel = withReq.length ? (turn > 0 ? withReq.find(s => s.turn === turn) || withReq[withReq.length - 1] : withReq[withReq.length - 1]) : null;

  const data = useMemo(() => {
    if (!sel) return null;
    switch (tab) {
      case 'messages': return sel.request?.messages || [];
      case 'request': return sel.request || null;
      case 'response': return sel.response || null;
      case 'export': return steps;
      default: return null;
    }
  }, [tab, sel, steps]);

  const jsonStr = data ? safeStringify(data) : 'No data yet — run a build.';

  const copy = () => navigator.clipboard?.writeText(jsonStr).catch(() => {});
  const download = () => {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `game-forge-v2-${tab}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return html`
    <div class="gf-wire">
      <button class="gf-wire-toggle" onClick=${() => setOpen(o => !o)}>
        <i class=${`fas fa-chevron-${open ? 'down' : 'right'}`}></i>
        <i class="fas fa-network-wired"></i> Wire inspector
        <span class="gf-wire-hint">raw request / response JSON${withReq.length ? ` · ${withReq.length} turns` : ''}</span>
      </button>
      ${open && html`
        <div class="gf-wire-body">
          <div class="gf-wire-tabs">
            ${TABS.map(t => html`
              <button key=${t.id} class=${`gf-wire-tab ${tab === t.id ? 'active' : ''}`} onClick=${() => setTab(t.id)}>
                <i class=${`fas ${t.icon}`}></i> ${t.label}
              </button>`)}
            <div style=${{ flex: 1 }}></div>
            ${tab !== 'export' && withReq.length > 1 && html`
              <select class="gf-wire-turn" value=${turn} onChange=${e => setTurn(+e.target.value)} title="Which turn to inspect">
                <option value=${0}>latest (turn ${withReq[withReq.length - 1].turn})</option>
                ${withReq.map(s => html`<option key=${s.turn} value=${s.turn}>turn ${s.turn}</option>`)}
              </select>`}
            <button class="gf-icon-btn" onClick=${copy} title="Copy JSON"><i class="fas fa-copy"></i></button>
            <button class="gf-icon-btn" onClick=${download} title="Download JSON"><i class="fas fa-download"></i></button>
          </div>
          <pre class="gf-wire-json">${jsonStr}</pre>
        </div>`}
    </div>`;
}

// Tool-call argument strings are JSON-in-a-string; pretty-print them inline so the
// Response tab is readable instead of a wall of escaped quotes.
function safeStringify(data) {
  try {
    return JSON.stringify(data, (k, v) => {
      if (k === 'arguments' && typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
      return v;
    }, 2);
  } catch { return String(data); }
}
