import { html } from 'htm/preact';

const ROW = {
  session:   { icon: 'fa-play', cls: 'session' },
  message:   { icon: 'fa-comment', cls: 'message' },
  reasoning: { icon: 'fa-brain', cls: 'reasoning' },
  tool:      { icon: 'fa-wrench', cls: 'tool' },
  file:      { icon: 'fa-file-pen', cls: 'file' },
  shell:     { icon: 'fa-terminal', cls: 'shell' },
  usage:     { icon: 'fa-gauge-high', cls: 'usage' },
  done:      { icon: 'fa-flag-checkered', cls: 'done' },
  error:     { icon: 'fa-triangle-exclamation', cls: 'error' },
};

const LIVE_ICON = { text: 'fa-comment', reasoning: 'fa-brain', tool: 'fa-wrench' };
// Show the END of the tail: the newest tokens are the point, and a fixed-length
// window keeps the row from growing the trace out from under the reader.
const LIVE_VISIBLE_CHARS = 320;

function eventBody(event, agentLabel) {
  if (event.type === 'session') {
    return [agentLabel || 'Agent', event.model || 'CLI default', event.effort ? `${event.effort} effort` : '', event.permissionMode]
      .filter(Boolean).join(' · ');
  }
  if (event.type === 'message' || event.type === 'reasoning') return event.text || '';
  if (event.type === 'tool') return `${event.name || 'tool'} ${event.inputSummary || ''}`;
  if (event.type === 'file') return `${event.op || 'write'} ${event.path || ''}`;
  if (event.type === 'shell') return `$ ${event.command || ''}`;
  if (event.type === 'usage') {
    const usage = event.usage || event;
    return `${usage.inputTokens || usage.input_tokens || 0} in · ${usage.outputTokens || usage.output_tokens || 0} out`;
  }
  if (event.type === 'done') {
    return `${event.summary || 'Done'}${event.costUsd != null ? ` · $${Number(event.costUsd).toFixed(4)}` : ''}${event.numTurns != null ? ` · ${event.numTurns} turns` : ''}`;
  }
  if (event.type === 'error') return event.message || 'Agent error';
  return event.text || event.message || event.type || 'event';
}

/**
 * `live` is the bridge's rolling tail of the block being written right now
 * (`{ text, kind, thinkingTokens }` from `attachAgentRun`'s onLive). It renders
 * as one trailing row that grows token by token and is replaced by an ordinary
 * event row once the block completes, so the trace above stays a clean history.
 *
 * Extended thinking mostly arrives redacted — deltas with no text — so a think
 * that runs for minutes has only its size to report. Showing that count is what
 * separates "working hard" from "hung" for a reader deciding whether to stop it.
 */
export function AgentTrace({ events = [], running = false, agentLabel = 'Agent', emptyText, live = null }) {
  const liveTail = running ? (live?.text || '') : '';
  const thinking = running ? (live?.thinkingTokens || 0) : 0;
  const liveText = liveTail.length > LIVE_VISIBLE_CHARS
    ? `…${liveTail.slice(-LIVE_VISIBLE_CHARS)}`
    : liveTail;
  if (!events.length && !running) {
    return html`<div class="coding-agent-trace coding-agent-trace-empty">
      ${emptyText || 'Messages, tool calls, file writes, and shell commands will stream here.'}
    </div>`;
  }
  return html`
    <div class="coding-agent-trace" role="log" aria-live="polite">
      ${events.map((event, index) => {
        const meta = ROW[event.type] || { icon: 'fa-circle', cls: 'event' };
        return html`
          <div class=${`coding-agent-event coding-agent-event-${meta.cls}`} key=${index}>
            <i class=${`fa-solid ${meta.icon}`}></i>
            <span>${eventBody(event, agentLabel)}</span>
          </div>`;
      })}
      ${!liveText && thinking > 0 && html`
        <div class="coding-agent-event coding-agent-event-live coding-agent-live-reasoning">
          <i class="fa-solid fa-brain"></i>
          <span class="coding-agent-live-text">thinking · ${thinking.toLocaleString()} tokens</span>
        </div>`}
      ${liveText && html`
        <div class=${`coding-agent-event coding-agent-event-live coding-agent-live-${live.kind || 'text'}`}>
          <i class=${`fa-solid ${LIVE_ICON[live.kind] || 'fa-comment'}`}></i>
          <span class="coding-agent-live-text">${liveText}</span>
        </div>`}
      ${running && html`<div class="coding-agent-event coding-agent-event-running">
        <i class="fa-solid fa-spinner fa-spin"></i><span>${agentLabel} working…</span>
      </div>`}
    </div>`;
}
