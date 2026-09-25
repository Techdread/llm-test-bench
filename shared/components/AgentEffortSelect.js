// Reasoning-effort ("thinking level") dropdown for a local CLI agent model.
//
// The level is saved per agent + model by agent-backend.js, and every run path
// reads it back from there: coding-agent runs, Forge builds and the cli-agent
// provider adapter (which falls back to the saved level when the caller passes
// no `reasoning_effort`). So a host only has to render this next to its model
// picker — nothing to thread through its generate call.

import { html } from 'htm/preact';
import { useMemo, useState } from 'preact/hooks';
import {
  getAgentModelEffort,
  resolveAgentModelSelection,
  saveAgentModelEffort,
} from '../services/agent-backend.js';

export const EFFORT_LABELS = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra',
};

/**
 * @param {Object} props
 * @param {string} props.agentId
 * @param {string} props.modelId    Agent model id ('' = the CLI's default model).
 * @param {Array}  props.choices    `groupAgentModelOptions(listAgentModelOptions(agentId))`.
 * @param {boolean} [props.disabled]
 */
export function AgentEffortSelect({ agentId, modelId = '', choices = [], disabled = false }) {
  const [revision, setRevision] = useState(0);
  const storedEffort = useMemo(
    () => getAgentModelEffort(agentId, modelId),
    [agentId, modelId, revision],
  );
  const selection = resolveAgentModelSelection(modelId, storedEffort, choices);
  const choice = choices.find(item => item.id === selection.modelId);
  const effortOptions = choice?.efforts || [];
  const fixedEffort = choice?.fixedEffort || '';
  if (!effortOptions.length && !fixedEffort) return null;

  const selectedEffort = effortOptions.includes(selection.effort)
    ? selection.effort
    : (choice?.defaultEffort || effortOptions[0] || '');
  const description = choice?.effortDescriptions?.[selectedEffort] || '';

  const handleChange = (event) => {
    if (!saveAgentModelEffort(agentId, selection.modelId, event.target.value)) return;
    setRevision(value => value + 1);
  };

  return html`
    <label class="executor-effort" title=${description || 'Reasoning effort (thinking level)'}>
      <span class="sr-only">Reasoning effort</span>
      ${fixedEffort
        ? html`<select value=${fixedEffort} disabled><option value=${fixedEffort}>Thinking (fixed)</option></select>`
        : html`<select value=${selectedEffort} onChange=${handleChange} disabled=${disabled || effortOptions.length === 1}>
            ${effortOptions.map(level => html`
              <option value=${level}>${EFFORT_LABELS[level] || level}${level === choice?.defaultEffort ? ' (default)' : ''}${effortOptions.length === 1 ? ' (fixed)' : ''}</option>`)}
          </select>`}
    </label>
  `;
}

/**
 * Persist the model's default level when a model is first picked, so the level
 * the dropdown shows is the level a run actually sends.
 */
export function seedAgentModelEffort(agentId, modelId, choices = []) {
  if (!agentId || !modelId) return;
  const choice = choices.find(item => item.id === modelId);
  const effort = getAgentModelEffort(agentId, modelId, choice?.defaultEffort || '');
  if (effort) saveAgentModelEffort(agentId, modelId, effort);
}
