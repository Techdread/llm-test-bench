import { html } from 'htm/preact';
import { useState, useMemo } from 'preact/hooks';
import { GoalStrip } from './GoalStrip.js';
import { WorkspacePanel } from './WorkspacePanel.js';
import { IterationTimeline } from './IterationTimeline.js';
import { HtmlPreview } from './HtmlPreview.js';
import { OutputInspector } from './OutputInspector.js';

/**
 * @param {Object} props
 * @param {Object} props.session - {id, goal, language, maxIterations, status, ...}
 * @param {Array}  props.iterations
 * @param {number} props.currentIteration
 * @param {boolean} props.running
 * @param {Object} props.liveSnapshot - current workspace snapshot {name: content}
 * @param {Object|null} props.latestRunResult
 * @param {Object|null} props.latestErrorInfo
 */
export function MorphView({
  session, iterations, currentIteration, running,
  liveSnapshot, liveModelStream, latestRunResult, latestErrorInfo, readOnly, onFork, onExport,
  onSendBack, onSendToNotebook, sourceLabel,
  previewFullscreen, onTogglePreviewFullscreen,
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [pinnedIteration, setPinnedIteration] = useState(null);
  const [outputCollapsed, setOutputCollapsed] = useState(false);

  const pinnedSnapshot = useMemo(() => {
    if (pinnedIteration == null) return null;
    const found = iterations.find(it => it.number === pinnedIteration);
    return found?.snapshot || null;
  }, [pinnedIteration, iterations]);

  const displaySnapshot = useMemo(() => {
    const base = pinnedSnapshot || liveSnapshot || {};
    if (!running || pinnedSnapshot || !liveModelStream) return base;
    return { 'model-stream.md': liveModelStream, ...base };
  }, [pinnedSnapshot, liveSnapshot, liveModelStream, running]);
  const files = Object.keys(displaySnapshot || {}).sort((a, b) => {
    if (a === 'model-stream.md') return -1;
    if (b === 'model-stream.md') return 1;
    return a.localeCompare(b);
  });

  const effectiveSelected = selectedFile && files.includes(selectedFile)
    ? selectedFile
    : (files[0] || null);

  const runResult = latestRunResult;
  const errorInfo = latestErrorInfo;
  const previewDataUrl = runResult?.previewDataUrl || null;

  const actions = !running ? html`
    ${onSendToNotebook && html`
      <button class="btn btn-primary" onClick=${onSendToNotebook} title="Save this prompt and output as a Notebook Lab notebook">
        <i class="fa-solid fa-book"></i> Notebook
      </button>
    `}
    ${onSendBack && html`
      <button class="btn" onClick=${onSendBack} title=${`Send final files back to ${sourceLabel || 'the source app'}`}>
        <i class="fa-solid fa-reply"></i> Send back${sourceLabel ? ` to ${sourceLabel}` : ''}
      </button>
    `}
    ${onFork && html`
      <button class="btn" onClick=${onFork} title="Fork this session">
        <i class="fa-solid fa-code-branch"></i> ${session.status === 'success' ? 'Fork' : 'Retry from here'}
      </button>
    `}
    ${onExport && html`
      <button class="btn" onClick=${onExport} title="Export session as JSON">
        <i class="fa-solid fa-file-export"></i> Export
      </button>
    `}
  ` : null;

  const canFullscreenPreview = session.language === 'html';
  const fullscreenActive = !!previewFullscreen && canFullscreenPreview;

  return html`
    <div class=${`morph-view ${fullscreenActive ? 'morph-view--preview-fullscreen' : ''} ${outputCollapsed ? 'morph-view--output-collapsed' : ''}`}>
      ${readOnly && html`
        <div class="readonly-banner">
          <i class="fa-solid fa-lock"></i> Viewing past session (read-only)
        </div>
      `}
      <${GoalStrip}
        goal=${session.goal}
        language=${session.language}
        maxIterations=${session.maxIterations}
        currentIteration=${currentIteration}
        status=${session.status}
        duration=${iterations.reduce((s, it) => s + it.duration, 0)}
        actions=${actions}
      />
      <div class="morph-body">
        <section class="morph-left morph-pane">
          <div class="section-header">
            <span><i class="fa-solid fa-file-code"></i> Workspace</span>
            ${effectiveSelected && html`<span class="section-meta">${effectiveSelected}</span>`}
          </div>
          <${WorkspacePanel}
            files=${files}
            selectedFile=${effectiveSelected}
            onSelectFile=${setSelectedFile}
            snapshot=${displaySnapshot}
            readOnly=${true}
          />
        </section>
        <div class="morph-right">
          <section class="morph-right-top morph-pane">
            <${IterationTimeline}
              iterations=${iterations}
              currentIteration=${currentIteration}
              pinnedIteration=${pinnedIteration}
              onPin=${setPinnedIteration}
              running=${running}
            />
          </section>
          <section class="morph-right-mid morph-pane">
            <div class="section-header">
              ${canFullscreenPreview && onTogglePreviewFullscreen
                ? html`
                  <button
                    class="section-header-button"
                    onClick=${onTogglePreviewFullscreen}
                    title=${fullscreenActive ? 'Exit fullscreen preview' : 'Fullscreen preview'}
                  >
                    <i class="fa-solid fa-eye"></i> Preview
                  </button>
                `
                : html`<span><i class="fa-solid fa-eye"></i> ${session.language === 'html' ? 'Preview' : 'Run summary'}</span>`}
              ${canFullscreenPreview && onTogglePreviewFullscreen && html`
                <button
                  class="btn-icon btn-sm"
                  onClick=${onTogglePreviewFullscreen}
                  title=${fullscreenActive ? 'Exit fullscreen preview' : 'Fullscreen preview'}
                  aria-label=${fullscreenActive ? 'Exit fullscreen preview' : 'Fullscreen preview'}
                >
                  <i class=${`fa-solid ${fullscreenActive ? 'fa-compress' : 'fa-expand'}`}></i>
                </button>
              `}
            </div>
            ${session.language === 'html'
              ? html`<${HtmlPreview} dataUrl=${previewDataUrl} />`
              : html`<${OutputInspector} runResult=${runResult} errorInfo=${errorInfo} language=${session.language} />`}
          </section>
          <section class=${`morph-right-bottom morph-pane ${outputCollapsed ? 'morph-pane--collapsed' : ''}`}>
            <div class="section-header">
              <button
                class="section-header-button"
                onClick=${() => setOutputCollapsed(v => !v)}
                title=${outputCollapsed ? 'Expand output' : 'Collapse output'}
              >
                <i class="fa-solid fa-terminal"></i> Output
              </button>
              <button
                class="btn-icon btn-sm"
                onClick=${() => setOutputCollapsed(v => !v)}
                title=${outputCollapsed ? 'Expand output' : 'Collapse output'}
                aria-label=${outputCollapsed ? 'Expand output' : 'Collapse output'}
              >
                <i class=${`fa-solid ${outputCollapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
              </button>
            </div>
            ${!outputCollapsed && html`
              <${OutputInspector} runResult=${runResult} errorInfo=${errorInfo} language=${session.language} />
            `}
          </section>
        </div>
      </div>
    </div>
  `;
}
