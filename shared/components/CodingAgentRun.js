// Inline CLI coding-agent runner.
//
// A local CLI agent is just another executor: apps call `start()` from the same
// handler that would call `streamChatCompletion()`, and render `AgentRunTrace`
// wherever the model's stream would normally appear. There is no modal, no
// opt-in step, and no second model picker.

import { html } from 'htm/preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import { AGENTS } from '../services/agent-backend.js';
import { runCodingAgentTask } from '../services/coding-agent.js';
import { AgentTrace } from './AgentTrace.js';

export function agentLabel(agentId) {
  return AGENTS.find(item => item.id === agentId)?.label || agentId || 'Agent';
}

/**
 * Drive one CLI agent run at a time for `appId`.
 *
 * @returns {{
 *   start: (options: Object) => Promise<Object>,
 *   cancel: () => void,
 *   reset: () => void,
 *   events: Array, running: boolean, cancelling: boolean, agentId: string,
 * }}
 */
export function useCodingAgentRun({ appId } = {}) {
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [agentId, setAgentId] = useState('');
  const controllerRef = useRef(null);
  // Read synchronously in catch blocks, where the `cancelling` state update
  // has not landed yet, to tell a user abort from a real failure.
  const cancelledRef = useRef(false);

  const reset = useCallback(() => {
    setEvents([]);
    setCancelling(false);
  }, []);

  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    cancelledRef.current = true;
    setCancelling(true);
    controllerRef.current.abort();
  }, []);

  const start = useCallback(async ({
    agentId: runAgentId,
    modelId = '',
    effort = '',
    task,
    outputFile,
    initialFiles = [],
    budgets,
    onWorkspace,
    onStart,
    onOutput,
  }) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    cancelledRef.current = false;
    setAgentId(runAgentId);
    setEvents([]);
    setCancelling(false);
    setRunning(true);
    try {
      return await runCodingAgentTask({
        appId,
        agentId: runAgentId,
        modelId,
        effort,
        task,
        outputFile,
        initialFiles,
        budgets,
        signal: controller.signal,
        onWorkspace,
        onStart,
        onEvent: event => setEvents(current => [...current, event]),
        onOutput,
      });
    } finally {
      controllerRef.current = null;
      setRunning(false);
      setCancelling(false);
    }
  }, [appId]);

  /** True when the last run ended because the user cancelled it. */
  const wasCancelled = useCallback(() => cancelledRef.current, []);

  return { start, cancel, reset, wasCancelled, events, running, cancelling, agentId };
}

/** Inline trace for a `useCodingAgentRun` handle. Renders nothing when idle. */
export function AgentRunTrace({ run, emptyText, class: className = '' }) {
  if (!run || (!run.running && !run.events.length)) return null;
  return html`
    <div class=${`coding-agent-inline ${className}`.trim()}>
      <${AgentTrace}
        events=${run.events}
        running=${run.running}
        agentLabel=${agentLabel(run.agentId)}
        emptyText=${emptyText}
      />
    </div>`;
}
