import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';

const ICON = {
  write_file: 'fa-file-pen', edit_file: 'fa-pen', read_file: 'fa-file-lines',
  list_files: 'fa-folder-tree', report_done: 'fa-flag-checkered', generate_image: 'fa-image',
};

// One expandable step. Collapsed: turn #, tool summary, per-call OK/FAIL badges.
// Expanded: the assistant's text, and for every tool call its full Arguments JSON
// and full Result/Error — so you can see exactly what the model produced and why
// a call failed.
function Step({ step, defaultOpen, onExplain }) {
  const [open, setOpen] = useState(defaultOpen);
  const calls = step.toolCalls || [];
  const hostManaged = step.hostManagedWrites === true;
  const failed = (step.toolResults || []).filter(r => r?.error).length;
  const argErrs = calls.filter(c => c.parseError).length;

  return html`
    <div class=${`gf-step ${step.pending ? 'pending' : ''} ${failed || argErrs ? 'has-err' : ''}`}>
      <div class="gf-step-head" onClick=${() => setOpen(o => !o)}>
        <span class="gf-step-num">${step.turn}</span>
        <span class="gf-step-role">
          <i class=${`fas ${calls.length ? (hostManaged ? 'fa-file-arrow-down' : 'fa-wrench') : 'fa-robot'}`}></i>
          ${step.pending
            ? (hostManaged ? 'calling model once…' : 'calling model…')
            : calls.length
              ? hostManaged
                ? `${calls.length} app-managed file write${calls.length > 1 ? 's' : ''}`
                : `${calls.length} tool call${calls.length > 1 ? 's' : ''}`
              : 'assistant'}
        </span>
        ${calls.map((c, i) => {
          const err = step.toolResults?.[i]?.error || c.parseError;
          return html`<span class=${`gf-tc-chip ${err ? 'err' : 'ok'}`} key=${i}>
            <i class=${`fas ${ICON[c.name] || 'fa-wrench'}`}></i>${c.name}${c.arguments?.path ? html` <span class="gf-tc-arg">${c.arguments.path}</span>` : ''}
          </span>`;
        })}
        ${!step.pending && !calls.length && step.content && html`<span class="gf-step-preview">${step.content.slice(0, 70)}${step.content.length > 70 ? '…' : ''}</span>`}
        ${step.unproductive && html`<span class="gf-badge warn" title="This turn made no progress — redundant/identical tool calls">no progress</span>`}
        ${step.finishReason && step.finishReason !== 'tool_calls' && step.finishReason !== 'stop' && html`<span class="gf-badge warn">${step.finishReason}</span>`}
        ${!step.pending && html`<i class=${`fas fa-chevron-${open ? 'down' : 'right'} gf-step-caret`}></i>`}
      </div>
      ${step.note && html`<div class="gf-step-note"><i class="fas fa-arrows-rotate"></i> ${step.note}</div>`}
      ${step.status && html`<div class="gf-step-status"><i class="fas fa-spinner fa-spin"></i> ${step.status}</div>`}
      ${open && !step.pending && html`
        <div class="gf-step-detail">
          ${step.content && html`
            <div class="gf-detail-block">
              <div class="gf-detail-label">Assistant text</div>
              <pre class="gf-detail-pre">${step.content}</pre>
            </div>`}
          ${!step.content && !calls.length && html`<div class="gf-detail-empty">No text and no tool calls — the model stopped here.</div>`}
          ${calls.map((c, i) => {
            const res = step.toolResults?.[i];
            const err = res?.error || c.parseError;
            return html`
              <div class=${`gf-detail-call ${err ? 'err' : ''}`} key=${i}>
                <div class="gf-detail-label">
                  <i class=${`fas ${ICON[c.name] || 'fa-wrench'}`}></i> ${hostManaged ? 'Game Forge save' : c.name}
                  ${err ? html`<span class="gf-badge err">FAILED</span>` : res ? html`<span class="gf-badge ok">OK</span>` : ''}
                  ${err && onExplain && html`
                    <button class="gf-btn gf-explain-btn" onClick=${event => {
                      event.stopPropagation();
                      onExplain({
                        turn: step.turn, tool: c.name, arguments: c.arguments,
                        error: res?.error || c.parseError, rawArguments: c.argsRaw,
                      });
                    }}><i class="fas fa-robot"></i> Explain failure</button>`}
                </div>
                ${c.parseError && html`
                  <div class="gf-detail-sub">
                    <div class="gf-detail-sublabel">⚠ malformed argument JSON — ${c.parseError}. Raw text the model emitted:</div>
                    <pre class="gf-detail-pre gf-detail-err">${c.argsRaw}</pre>
                  </div>`}
                <div class="gf-detail-sub">
                  <div class="gf-detail-sublabel">Arguments</div>
                  <pre class="gf-detail-pre">${prettyArgs(c)}</pre>
                </div>
                ${res && html`
                  <div class="gf-detail-sub">
                    <div class="gf-detail-sublabel">Result</div>
                    <pre class=${`gf-detail-pre ${res.error ? 'gf-detail-err' : ''}`}>${res.error || asText(res.result) || '(empty)'}</pre>
                  </div>`}
              </div>`;
          })}
        </div>`}
    </div>`;
}

function prettyArgs(c) {
  if (c.parseError) return c.argsRaw || '(none)';
  try { return JSON.stringify(c.arguments, null, 2); } catch { return String(c.arguments); }
}
function asText(v) { return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2); }

export function TraceView({ steps, running, onExplain }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [steps.length]);

  if (!steps.length && !running) {
    return html`<div class="gf-trace gf-trace-empty">The build trace will stream here — expand any step to see the tool call's arguments and result.</div>`;
  }
  const lastTurn = steps.length ? steps[steps.length - 1].turn : 0;
  return html`
    <div class="gf-trace">
      ${steps.map(step => html`<${Step} key=${step.turn} step=${step} onExplain=${onExplain} defaultOpen=${step.turn === lastTurn && !!(step.toolResults || []).some(r => r?.error)} />`)}
      ${running && !steps.some(s => s.pending) && html`<div class="gf-step gf-running"><i class="fas fa-spinner fa-spin"></i> Building…</div>`}
      <div ref=${bottomRef}></div>
    </div>`;
}
