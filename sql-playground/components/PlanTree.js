// EXPLAIN QUERY PLAN as a nested tree.

import { html } from 'htm/preact';

function Node({ node, depth }) {
  return html`
    <li class="plan-node" key=${node.id}>
      <div class="plan-row" style=${{ paddingLeft: (depth * 16) + 'px' }}>
        <i class="fa-solid fa-diagram-project"></i>
        <span class="plan-detail">${node.detail}</span>
      </div>
      ${node.children.length > 0 && html`
        <ul>
          ${node.children.map(c => html`<${Node} node=${c} depth=${depth + 1} />`)}
        </ul>
      `}
    </li>
  `;
}

export function PlanTree({ plan }) {
  if (!plan || plan.length === 0) {
    return html`<div class="muted side-empty">Run "Plan" to see the query execution tree.</div>`;
  }
  return html`
    <ul class="plan-tree">
      ${plan.map(n => html`<${Node} node=${n} depth=${0} />`)}
    </ul>
  `;
}
