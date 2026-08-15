import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { AGENTS, cancelAgentRun, listAgentRuns } from '../services/agent-backend.js';

const POLL_MS = 5000;

function formatDuration(ms) {
  const seconds = Math.floor((ms || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function agentLabel(id) {
  return AGENTS.find(agent => agent.id === id)?.label || id || 'Agent';
}

export function CodingAgentActivity({ appId = '' }) {
  const [runs, setRuns] = useState([]);
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(() => new Set());

  useEffect(() => {
    let live = true;
    const poll = async () => {
      const result = await listAgentRuns();
      const prefix = appId ? `${appId}/` : '';
      const active = (result.runs || []).filter(run => !run.done && (!prefix || run.projectDir?.startsWith(prefix)));
      if (live) setRuns(active);
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [appId]);

  if (!runs.length) return null;

  const stop = async (runId) => {
    setStopping(current => new Set(current).add(runId));
    await cancelAgentRun(runId).catch(() => {});
  };

  return html`
    <div class="coding-agent-activity">
      <button class=${`btn coding-agent-activity-pill${runs.some(run => !run.alive) ? ' stale' : ''}`}
        title="CLI coding work is running on this machine" onClick=${() => setOpen(value => !value)}>
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        ${runs.length} agent${runs.length === 1 ? '' : 's'}
        <span>${formatDuration(Math.max(...runs.map(run => run.elapsedMs || 0)))}</span>
      </button>
      ${open && html`
        <div class="coding-agent-activity-panel">
          ${runs.map(run => html`
            <div class="coding-agent-activity-row" key=${run.runId}>
              <div>
                <strong>${agentLabel(run.agent)}${run.model ? ` · ${run.model}` : ''}</strong>
                <small>${formatDuration(run.elapsedMs)} · ${run.events || 0} events · ${run.projectDir || 'unknown folder'}</small>
              </div>
              <button class="btn" disabled=${stopping.has(run.runId)} onClick=${() => stop(run.runId)}>
                <i class="fa-solid fa-stop"></i> ${stopping.has(run.runId) ? 'Stopping…' : 'Stop'}
              </button>
            </div>`)}
          <p>Runs continue if their starting tab reloads or closes.</p>
        </div>`}
    </div>`;
}
