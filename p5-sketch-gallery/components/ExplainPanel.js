import { html } from 'htm/preact';

export function ExplainPanel({ text, busy, onClose }) {
  if (!text && !busy) return null;
  // Render markdown lazily — use marked if available, else plain text fallback.
  let rendered = text || '';
  if (window.marked && text) {
    try { rendered = window.marked.parse(text); } catch (e) { /* fallback */ }
  }
  const isMd = !!window.marked && !!text;
  return html`
    <div class="explain-panel">
      <div class="panel-title">
        <span><i class="fa-solid fa-lightbulb"></i> Explanation ${busy && html`<i class="fa-solid fa-spinner fa-spin"></i>`}</span>
        <button class="btn-icon" onClick=${onClose} title="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      ${isMd
        ? html`<div class="explain-content" dangerouslySetInnerHTML=${{ __html: rendered }} />`
        : html`<pre class="explain-content">${text}</pre>`}
    </div>
  `;
}
