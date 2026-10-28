import { html } from 'htm/preact';
import { useRef, useEffect, useState } from 'preact/hooks';
import {
  completionTokenCount,
  estimatedTokenCount,
  formatTokensPerSecond,
  tokensPerSecond,
} from '../services/batchMetrics.js';
import { consoleCounts, entryLine, formatConsoleForCopy } from '../services/previewConsole.js';

export function PromptEditor({
  prompt,
  onPromptChange,
  response,
  onResponseChange,
  responseStats,
  responseTiming,
  isGenerating,
  theme,
  onMorph,
  onSavePromptToLibrary,
  consoleEntries = [],
  checkStatus = null,
  responseView = 'code',
  onResponseViewChange,
  onClearConsole,
}) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const silentUpdate = useRef(false);
  const copyTimerRef = useRef(null);
  const [showFullscreenPreview, setShowFullscreenPreview] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState('');
  const [rateClock, setRateClock] = useState(Date.now());

  const responseCharacters = String(response || '').length;
  const reportedTokens = completionTokenCount(responseStats);
  const responseTokens = reportedTokens ?? estimatedTokenCount(response);
  const responseTokenRate = tokensPerSecond(responseStats, responseTokens, responseTiming, rateClock);
  // A half-written page throws on its unfinished scripts, so nothing is
  // counted until the generation ends.
  const liveEntries = isGenerating ? [] : consoleEntries;
  const liveCounts = consoleCounts(liveEntries);
  const checkErrors = checkStatus && !checkStatus.running
    ? (checkStatus.timedOut ? ['The automatic check timed out — possible infinite loop or blocked load'] : (checkStatus.errors || []))
    : [];
  const errorTotal = liveCounts.errors + checkErrors.length;
  const showErrors = responseView === 'errors';
  const pendingJumpRef = useRef(null);

  useEffect(() => {
    if (!isGenerating || !responseCharacters || !responseTiming?.startedAt) return undefined;
    setRateClock(Date.now());
    const timer = window.setInterval(() => setRateClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating, responseCharacters, responseTiming?.startedAt]);

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
    // Ace's hidden textarea is what screen readers and axe see.
    editor.textInput.getElement().setAttribute('aria-label', 'HTML code editor');

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

  // "line N" in the errors list: back to the code, then to that line.
  useEffect(() => {
    const editor = editorRef.current;
    const jump = pendingJumpRef.current;
    if (showErrors || !editor || !jump) return;
    pendingJumpRef.current = null;
    editor.resize(true);
    editor.gotoLine(jump.line, Math.max(0, jump.col - 1), true);
    editor.scrollToLine(jump.line, true, true, () => {});
    editor.focus();
  }, [showErrors]);

  const jumpToLine = (at) => {
    pendingJumpRef.current = at;
    onResponseViewChange?.('code');
  };

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
          ${showErrors
            ? html`<span><i class="fa-solid fa-bug"></i> Errors</span>`
            : html`<span><i class="fa-solid fa-code"></i> HTML Response</span>`}
          <div class="section-header-actions">
            ${responseCharacters > 0 && html`
              <div class="response-metrics" aria-label="HTML response generation metrics">
                <span>${responseCharacters.toLocaleString()} characters streamed</span>
                <span class="response-metric-divider">·</span>
                <span>${responseTokens.toLocaleString()} tokens generated</span>
                <span class="response-metric-divider">·</span>
                <span>${formatTokensPerSecond(responseTokenRate)}</span>
              </div>
            `}
            <button
              class=${`btn-icon response-view-toggle ${showErrors ? 'active' : ''} ${errorTotal ? 'has-errors' : liveCounts.warnings ? 'has-warnings' : ''}`}
              onClick=${() => onResponseViewChange?.(showErrors ? 'code' : 'errors')}
              title=${showErrors
                ? 'Show the generated code'
                : errorTotal
                  ? `Show errors (${errorTotal})`
                  : liveCounts.warnings ? `Show warnings (${liveCounts.warnings})` : 'Show errors (none so far)'}
              aria-pressed=${showErrors}
              style=${{ fontSize: '12px' }}
            >
              <i class=${`fa-solid ${showErrors ? 'fa-code' : 'fa-bug'}`}></i>
              ${!showErrors && (errorTotal || liveCounts.warnings) ? html`
                <span class="response-view-badge">${errorTotal || liveCounts.warnings}</span>
              ` : null}
            </button>
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
        <div class="editor-container" ref=${containerRef} hidden=${showErrors}></div>
        ${showErrors && html`
          <div class="response-errors" aria-label="Errors from the generated page">
            <div class="response-errors-bar">
              <span>
                ${isGenerating
                  ? 'Errors appear once the generation finishes.'
                  : `Preview: ${liveCounts.errors} error${liveCounts.errors === 1 ? '' : 's'}, ${liveCounts.warnings} warning${liveCounts.warnings === 1 ? '' : 's'}`}
              </span>
              <span class="library-card-actions-spacer"></span>
              <button
                class=${`btn btn-sm ${copiedTarget === 'errors' ? 'copied' : ''}`}
                onClick=${() => copyText([
                  formatConsoleForCopy(liveEntries),
                  checkErrors.length ? `Automatic check:\n${checkErrors.join('\n')}` : '',
                ].filter(Boolean).join('\n\n'), 'errors')}
                disabled=${!liveEntries.length && !checkErrors.length}
                title="Copy every error and warning as text"
              >
                <i class=${`fa-solid ${copiedTarget === 'errors' ? 'fa-check' : 'fa-copy'}`}></i> Copy
              </button>
              <button class="btn btn-sm" onClick=${onClearConsole} disabled=${!liveEntries.length} title="Clear the preview's list (it refills as the page runs)">
                <i class="fa-solid fa-eraser"></i> Clear
              </button>
            </div>
            <div class="response-errors-list">
              ${!isGenerating && !liveEntries.length && !checkErrors.length && html`
                <div class="response-errors-empty">
                  <i class="fa-solid fa-circle-check"></i>
                  ${response
                    ? 'No errors or warnings from the preview so far. Anything it reports while you use it appears here.'
                    : 'Generate or paste HTML; its errors appear here.'}
                </div>
              `}
              ${liveEntries.map(entry => {
                const at = entryLine(entry);
                return html`
                  <div class=${`response-error ${entry.level}`} key=${entry.key}>
                    <i class=${`fa-solid ${entry.level === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-xmark'}`}></i>
                    <div class="response-error-body">
                      <div class="response-error-message">${entry.message}</div>
                      <div class="response-error-meta">
                        ${at && html`
                          <button class="response-error-line" onClick=${() => jumpToLine(at)} title="Show this line in the code">
                            line ${at.line}${at.col ? `:${at.col}` : ''}
                          </button>
                        `}
                        ${entry.count > 1 && html`<span class="response-error-count">×${entry.count.toLocaleString()}</span>`}
                      </div>
                      ${entry.stack && entry.stack !== entry.message && html`
                        <details class="response-error-stack">
                          <summary>Stack</summary>
                          <pre>${entry.stack}</pre>
                        </details>
                      `}
                    </div>
                  </div>
                `;
              })}
              ${checkErrors.length > 0 && html`
                <div class="response-errors-heading">Automatic check (hidden run after generating)</div>
                ${checkErrors.map((message, i) => html`
                  <div class="response-error error" key=${`check-${i}`}>
                    <i class="fa-solid fa-circle-xmark"></i>
                    <div class="response-error-body">
                      <div class="response-error-message">${message}</div>
                    </div>
                  </div>
                `)}
              `}
            </div>
          </div>
        `}
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
