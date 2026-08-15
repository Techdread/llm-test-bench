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

export function AgentTrace({ events = [], running = false, agentLabel = 'Agent', emptyText }) {
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
      ${running && html`<div class="coding-agent-event coding-agent-event-running">
        <i class="fa-solid fa-spinner fa-spin"></i><span>${agentLabel} working…</span>
      </div>`}
    </div>`;
}
