import { html } from 'htm/preact';
import { useCallback } from 'preact/hooks';

export function PromptPanel({ prompt, onPromptChange, onGenerate, isGenerating }) {
  const handleKeyDown = useCallback((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (onGenerate && !isGenerating) onGenerate();
    }
  }, [onGenerate, isGenerating]);

  return html`
    <div class="prompt-panel">
      <div class="section-header">
        <span><i class="fa-solid fa-comment-dots"></i> Prompt</span>
        <span class="prompt-hint">Ctrl+Enter to generate</span>
      </div>
      <textarea
        class="prompt-textarea"
        value=${prompt}
        onInput=${(e) => onPromptChange(e.target.value)}
        onKeyDown=${handleKeyDown}
        placeholder="Describe the SVG you want... e.g. 'A red circle centered inside a blue square'"
        spellcheck="false"
      />
    </div>
  `;
}
