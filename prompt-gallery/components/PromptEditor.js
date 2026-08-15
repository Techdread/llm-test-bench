import { html } from 'htm/preact';
import { useRef, useEffect, useState } from 'preact/hooks';

export function PromptEditor({ prompt, onPromptChange, response, onResponseChange, theme, onMorph, onSavePromptToLibrary }) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const silentUpdate = useRef(false);
  const copyTimerRef = useRef(null);
  const [showFullscreenPreview, setShowFullscreenPreview] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState('');

  // Initialize Ace Editor for HTML response
  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    const editor = window.ace.edit(containerRef.current, {
      mode: 'ace/mode/html',
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      wrap: true,
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      scrollPastEnd: 0.5,
    });

    editor.setValue(response, -1);

    editor.session.on('change', () => {
      if (silentUpdate.current) return;
      onResponseChange(editor.getValue());
    });

    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // Sync response value from parent
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== response) {
      silentUpdate.current = true;
      const pos = editor.getCursorPosition();
      editor.setValue(response, -1);
      editor.moveCursorToPosition(pos);
      editor.clearSelection();
      silentUpdate.current = false;
    }
  }, [response]);

  // Sync theme
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setTheme(theme === 'dark' ? 'ace/theme/monokai' : 'ace/theme/chrome');
  }, [theme]);

  // Resize on container changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new ResizeObserver(() => editor.resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showFullscreenPreview) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setShowFullscreenPreview(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFullscreenPreview]);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const copyText = async (text, target) => {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopiedTarget(target);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedTarget(''), 1200);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  };

  return html`
    <div class="create-left">
      <!-- Prompt Section -->
      <div class="prompt-section">
        <div class="section-header">
          <span><i class="fa-solid fa-comment-dots"></i> Prompt</span>
          <div class="section-header-actions">
            <button
              class=${`btn-icon copy-btn ${copiedTarget === 'prompt' ? 'copied' : ''}`}
              onClick=${() => copyText(prompt, 'prompt')}
              title=${copiedTarget === 'prompt' ? 'Copied prompt' : 'Copy prompt'}
              disabled=${!prompt}
              style=${{ fontSize: '12px' }}
            >
              <i class=${`fa-solid ${copiedTarget === 'prompt' ? 'fa-check' : 'fa-copy'}`}></i>
            </button>
            ${onSavePromptToLibrary && html`
              <button
                class="btn-icon"
                onClick=${onSavePromptToLibrary}
                title="Save this prompt to the library"
                disabled=${!prompt}
                style=${{ fontSize: '12px' }}
              >
                <i class="fa-solid fa-bookmark"></i>
              </button>
            `}
          </div>
        </div>
        <textarea
          class="prompt-textarea"
          value=${prompt}
          onInput=${(e) => onPromptChange(e.target.value)}
          placeholder="Enter your prompt here (supports Markdown)..."
        ></textarea>
      </div>
      <!-- Response Section -->
      <div class="response-section">
        <div class="section-header">
          <span><i class="fa-solid fa-code"></i> HTML Response</span>
          <div class="section-header-actions">
            <button
              class=${`btn-icon copy-btn ${copiedTarget === 'response' ? 'copied' : ''}`}
              onClick=${() => copyText(response, 'response')}
              title=${copiedTarget === 'response' ? 'Copied HTML response' : 'Copy HTML response'}
              disabled=${!response}
              style=${{ fontSize: '12px' }}
            >
              <i class=${`fa-solid ${copiedTarget === 'response' ? 'fa-check' : 'fa-copy'}`}></i>
            </button>
            <button
              class=${`btn-icon ${showFullscreenPreview ? 'active' : ''}`}
              onClick=${() => setShowFullscreenPreview(true)}
              title="Preview rendered HTML"
              disabled=${!response}
              style=${{ fontSize: '12px' }}
            >
              <i class="fa-solid fa-eye"></i>
            </button>
            ${onMorph && html`
              <button
                class="btn-icon"
                onClick=${onMorph}
                title="Send to Code Morph Lab"
                disabled=${!response}
                style=${{ fontSize: '12px' }}
              >
                <i class="fa-solid fa-wand-magic-sparkles"></i>
              </button>
            `}
          </div>
        </div>
        <div class="editor-container" ref=${containerRef}></div>
      </div>
      ${showFullscreenPreview && html`
        <div class="html-fullscreen-preview" role="dialog" aria-modal="true" aria-label="Rendered HTML preview">
          <div class="html-fullscreen-toolbar">
            <span><i class="fa-solid fa-eye"></i> Rendered HTML</span>
            <button
              class="btn"
              onClick=${() => setShowFullscreenPreview(false)}
              title="Back to editor"
            >
              <i class="fa-solid fa-arrow-left"></i>
              Back
            </button>
          </div>
          <div class="html-fullscreen-frame">
            ${response
              ? html`<iframe
                  srcdoc=${response}
                  sandbox="allow-scripts allow-modals allow-pointer-lock"
                  title="Rendered HTML full screen preview"
                />`
              : html`
                  <div class="gallery-empty" style=${{ background: 'var(--bg-primary)' }}>
                    <i class="fa-solid fa-eye"></i>
                    <p>Paste or type HTML in the response editor to see a live preview</p>
                  </div>
                `
            }
          </div>
        </div>
      `}
    </div>
  `;
}
