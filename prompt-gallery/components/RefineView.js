import { html } from 'htm/preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { runHtmlSandbox, runStatusLabel } from '../services/sandboxRunner.js';
import * as refine from '../services/refine.js';

// Same trick as the gallery's ViewIframe: apply srcdoc only after layout so
// pages that capture window size at boot (THREE.js etc.) don't start at 0x0.
const RESIZE_SHIM = `<script>
(function(){
  function kick(){
    if (window.innerWidth > 0 && window.innerHeight > 0) {
      try { window.dispatchEvent(new Event('resize')); } catch(e){}
      return true;
    }
    return false;
  }
  if (!kick()) {
    var tries = 0;
    var iv = setInterval(function(){ tries++; if (kick() || tries > 30) clearInterval(iv); }, 50);
  }
  window.addEventListener('load', function(){ setTimeout(kick, 50); });
})();
<\/script>`;

function withResizeShim(htmlContent) {
  if (!htmlContent) return htmlContent;
  const headMatch = htmlContent.match(/<head[^>]*>/i);
  if (headMatch) {
    const idx = headMatch.index + headMatch[0].length;
    return htmlContent.slice(0, idx) + RESIZE_SHIM + htmlContent.slice(idx);
  }
  return RESIZE_SHIM + htmlContent;
}

function LiveHtmlFrame({ frameKey, html: htmlContent }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled || !node.isConnected) return;
      if (node.offsetWidth > 0 && node.offsetHeight > 0) {
        node.srcdoc = withResizeShim(htmlContent);
      } else {
        requestAnimationFrame(apply);
      }
    };
    requestAnimationFrame(apply);
    return () => { cancelled = true; };
  }, [frameKey, htmlContent]);
  return html`<iframe ref=${ref} sandbox="allow-scripts" title="Refine preview" />`;
}

const STEP_ICONS = { original: 'fa-file-code', heal: 'fa-kit-medical', improve: 'fa-wand-magic-sparkles' };

function statusDotClass(status) {
  if (!status) return 'refine-dot-pending';
  if (status.timedOut || status.errors.length > 0) return 'refine-dot-error';
  if (status.warnings.length > 0) return 'refine-dot-warn';
  return 'refine-dot-ok';
}

export function RefineView({
  session,
  onSessionChange,
  hasModel,
  providerId,
  modelId,
  hasDirectory,
  onSaveStep,
  addToast,
}) {
  const [attempts, setAttempts] = useState(1);
  const [errorsOpen, setErrorsOpen] = useState(false);

  const steps = session?.steps || [];
  const activeIndex = Math.min(session?.activeIndex || 0, steps.length - 1);
  const activeStep = steps[activeIndex] || null;
  const busy = session?.busy || null;

  // ── session update helpers (always functional — async ops outlive renders) ──

  const patchSession = useCallback((patch) => {
    onSessionChange(prev => prev ? { ...prev, ...patch } : prev);
  }, [onSessionChange]);

  const patchStep = useCallback((index, patch) => {
    onSessionChange(prev => {
      if (!prev) return prev;
      const next = [...prev.steps];
      if (!next[index]) return prev;
      next[index] = { ...next[index], ...patch };
      return { ...prev, steps: next };
    });
  }, [onSessionChange]);

  // Append a step and make it active. The caller computes the new step's
  // index itself (busy-guarding means only the running operation appends, so
  // indices are deterministic — state updaters may not run synchronously).
  const appendStep = useCallback((step) => {
    onSessionChange(prev => {
      if (!prev) return prev;
      return { ...prev, steps: [...prev.steps, step], activeIndex: prev.steps.length };
    });
  }, [onSessionChange]);

  // ── sandbox runs ──

  const runStep = useCallback(async (index, htmlContent) => {
    patchStep(index, { runStatus: null, running: true });
    const status = await runHtmlSandbox(htmlContent);
    patchStep(index, { runStatus: status, running: false });
    return status;
  }, [patchStep]);

  // Auto-run the active step once when it has no result yet.
  useEffect(() => {
    if (!activeStep || activeStep.runStatus || activeStep.running || busy) return;
    runStep(activeIndex, activeStep.html);
  }, [activeStep, activeIndex, busy, runStep]);

  // ── heal ──

  const handleHeal = useCallback(async () => {
    if (!activeStep || busy) return;
    if (!hasModel) { addToast('Select a model first', 'error'); return; }
    const startStatus = activeStep.runStatus;
    if (!startStatus || startStatus.errors.length === 0) {
      addToast('No captured errors to heal', 'info');
      return;
    }
    patchSession({ busy: 'heal', streamBytes: 0 });
    try {
      const baseLen = steps.length;
      let currentHtml = activeStep.html;
      let currentErrors = startStatus.errors;
      for (let n = 1; n <= attempts; n++) {
        const healed = await refine.healHtml({
          providerId, modelId,
          prompt: session.prompt,
          html: currentHtml,
          errors: currentErrors,
          onChunk: (text) => patchSession({ streamBytes: text.length }),
        });
        if (!healed || !healed.trim()) throw new Error('Model returned an empty document');
        const stepIndex = baseLen + (n - 1);
        appendStep({
          kind: 'heal',
          label: attempts > 1 ? `Heal attempt ${n}` : 'Healed',
          summary: `Heal: ${currentErrors.length} error${currentErrors.length === 1 ? '' : 's'} addressed`,
          html: healed,
          runStatus: null,
        });
        const status = await runStep(stepIndex, healed);
        if (status.ok) {
          addToast(`Healed — sandbox run is clean (attempt ${n})`, 'success');
          patchStep(stepIndex, { summary: `Heal: ${currentErrors.length} error${currentErrors.length === 1 ? '' : 's'} → clean` });
          return;
        }
        currentHtml = healed;
        currentErrors = status.errors;
      }
      addToast(`Still ${currentErrors.length} error${currentErrors.length === 1 ? '' : 's'} after ${attempts} attempt${attempts === 1 ? '' : 's'}`, 'error');
    } catch (e) {
      addToast('Heal failed: ' + e.message, 'error');
    } finally {
      patchSession({ busy: null, streamBytes: 0 });
    }
  }, [activeStep, busy, hasModel, attempts, providerId, modelId, session?.prompt, steps.length, patchSession, patchStep, appendStep, runStep, addToast]);

  // ── suggest / apply ──

  const handleSuggest = useCallback(async () => {
    if (!activeStep || busy) return;
    if (!hasModel) { addToast('Select a model first', 'error'); return; }
    patchSession({ busy: 'suggest', suggestions: '' });
    try {
      const out = await refine.suggestImprovements({
        providerId, modelId,
        prompt: session.prompt,
        html: activeStep.html,
        onChunk: (text) => patchSession({ suggestions: text }),
      });
      if (!out) throw new Error('Model returned no suggestions');
      patchSession({ suggestions: out });
      addToast('Suggestions ready — edit the list, then Apply', 'success');
    } catch (e) {
      addToast('Suggest failed: ' + e.message, 'error');
    } finally {
      patchSession({ busy: null });
    }
  }, [activeStep, busy, hasModel, providerId, modelId, session?.prompt, patchSession, addToast]);

  const handleApply = useCallback(async () => {
    if (!activeStep || busy) return;
    if (!hasModel) { addToast('Select a model first', 'error'); return; }
    const instructions = (session.suggestions || '').trim();
    if (!instructions) { addToast('No improvement instructions to apply', 'error'); return; }
    patchSession({ busy: 'apply', streamBytes: 0 });
    try {
      const improved = await refine.applyImprovements({
        providerId, modelId,
        prompt: session.prompt,
        html: activeStep.html,
        instructions,
        onChunk: (text) => patchSession({ streamBytes: text.length }),
      });
      if (!improved || !improved.trim()) throw new Error('Model returned an empty document');
      const stepIndex = steps.length;
      appendStep({
        kind: 'improve',
        label: 'Improvements applied',
        summary: `Improve: ${instructions.split('\n').filter(l => l.trim()).length} instruction(s)\n${instructions}`,
        html: improved,
        runStatus: null,
      });
      patchSession({ suggestions: '' });
      await runStep(stepIndex, improved);
      addToast('Improvements applied', 'success');
    } catch (e) {
      addToast('Apply failed: ' + e.message, 'error');
    } finally {
      patchSession({ busy: null, streamBytes: 0 });
    }
  }, [activeStep, busy, hasModel, providerId, modelId, session?.prompt, session?.suggestions, steps.length, patchSession, appendStep, runStep, addToast]);

  // ── empty state ──

  if (!session) {
    return html`
      <div class="refine-view">
        <div class="gallery-empty">
          <i class="fa-solid fa-screwdriver-wrench"></i>
          <p>Nothing loaded to refine yet</p>
          <p class="refine-empty-hint">
            Open a generation from the Gallery and click <strong>Refine</strong>,
            or generate something in Create and click <strong>Refine</strong> above the preview.
          </p>
        </div>
      </div>
    `;
  }

  const status = activeStep?.runStatus;
  const hasErrors = !!status && status.errors.length > 0;
  const streamKb = ((session.streamBytes || 0) / 1024).toFixed(1);
  const alreadySaved = activeStep?.kind === 'original' && !!session.variantKey;

  return html`
    <div class="refine-view">
      <div class="refine-left">
        <div class="refine-header">
          <div class="refine-title" title=${session.title}>
            <i class="fa-solid fa-screwdriver-wrench"></i> ${session.title}
          </div>
          <div class="refine-source">
            ${session.model && html`<span class="model-badge"><i class="fa-solid fa-robot"></i> ${session.model}</span>`}
            ${session.folderId && html`<span class="refine-source-folder">${session.folderId}</span>`}
          </div>
        </div>

        <!-- Run status -->
        <div class=${`refine-status ${!status ? 'pending' : hasErrors || status.timedOut ? 'error' : 'ok'}`}>
          <span class="refine-status-label">
            ${activeStep?.running || (!status && !busy)
              ? html`<i class="fa-solid fa-spinner fa-spin"></i> running sandbox...`
              : html`
                  <i class=${`fa-solid ${hasErrors || status?.timedOut ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
                  ${runStatusLabel(status)}
                `
            }
          </span>
          <button
            class="btn-icon"
            onClick=${() => activeStep && runStep(activeIndex, activeStep.html)}
            disabled=${!!busy || activeStep?.running}
            title="Re-run sandbox check"
          >
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          ${status && (status.errors.length > 0 || status.warnings.length > 0) && html`
            <button class="btn-icon" onClick=${() => setErrorsOpen(o => !o)} title=${errorsOpen ? 'Hide details' : 'Show details'}>
              <i class=${`fa-solid ${errorsOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            </button>
          `}
        </div>
        ${errorsOpen && status && html`
          <div class="refine-error-list">
            ${status.errors.map((e, i) => html`<div class="refine-error-item" key=${'e' + i}><i class="fa-solid fa-circle-xmark"></i> ${e}</div>`)}
            ${status.warnings.map((w, i) => html`<div class="refine-warn-item" key=${'w' + i}><i class="fa-solid fa-triangle-exclamation"></i> ${w}</div>`)}
          </div>
        `}

        <!-- Actions -->
        <div class="refine-actions">
          <button
            class="btn btn-primary"
            onClick=${handleHeal}
            disabled=${!!busy || !hasErrors}
            title=${hasErrors ? 'Send the errors to the model for a fix' : 'Enabled when the sandbox captures errors'}
          >
            <i class=${`fa-solid ${busy === 'heal' ? 'fa-spinner fa-spin' : 'fa-kit-medical'}`}></i>
            ${busy === 'heal' ? `Healing... ${streamKb} KB` : 'Heal'}
          </button>
          <select
            class="form-input refine-attempts"
            value=${attempts}
            onChange=${(e) => setAttempts(parseInt(e.target.value, 10))}
            disabled=${!!busy}
            title="Auto-retry attempts if still broken"
          >
            <option value="1">1 attempt</option>
            <option value="2">2 attempts</option>
            <option value="3">3 attempts</option>
          </select>
          <span class="library-card-actions-spacer"></span>
          <button
            class="btn"
            onClick=${handleSuggest}
            disabled=${!!busy}
            title="Ask the model for improvement ideas"
          >
            <i class=${`fa-solid ${busy === 'suggest' ? 'fa-spinner fa-spin' : 'fa-lightbulb'}`}></i>
            Suggest improvements
          </button>
        </div>

        <!-- Improvements editor: type your own instructions, or let
             "Suggest improvements" fill it in — either way, edit then Apply. -->
        <div class="refine-suggestions">
          <div class="section-header">
            <span><i class=${`fa-solid ${busy === 'suggest' ? 'fa-spinner fa-spin' : 'fa-lightbulb'}`}></i> Improvements (edit before applying)</span>
            <div class="section-header-actions">
              <button class="btn-icon" onClick=${() => patchSession({ suggestions: '' })} title="Clear instructions" disabled=${!!busy || !session.suggestions}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
          <textarea
            class="refine-suggestions-input"
            value=${session.suggestions}
            placeholder="Describe the changes you want (one per line), or click Suggest improvements above..."
            onInput=${(e) => patchSession({ suggestions: e.target.value })}
            disabled=${busy === 'apply' || busy === 'suggest'}
          ></textarea>
          <button
            class="btn btn-primary refine-apply-btn"
            onClick=${handleApply}
            disabled=${!!busy || !(session.suggestions || '').trim()}
            title=${(session.suggestions || '').trim() ? 'Send the instructions to the model and add the result as a new step' : 'Type or generate improvement instructions first'}
          >
            <i class=${`fa-solid ${busy === 'apply' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
            ${busy === 'apply' ? `Applying... ${streamKb} KB` : 'Apply to generation'}
          </button>
        </div>

        <!-- Step timeline -->
        <div class="refine-timeline">
          <div class="section-header"><span><i class="fa-solid fa-timeline"></i> Steps</span></div>
          ${steps.map((step, i) => html`
            <div
              class=${`refine-step ${i === activeIndex ? 'active' : ''}`}
              key=${i}
              onClick=${() => !busy && patchSession({ activeIndex: i })}
              title=${step.summary || step.label}
            >
              <span class=${`refine-dot ${statusDotClass(step.runStatus)}`}></span>
              <i class=${`fa-solid ${STEP_ICONS[step.kind] || 'fa-file'}`}></i>
              <span class="refine-step-label">${step.label}</span>
              <span class="refine-step-size">${(step.html.length / 1024).toFixed(1)} KB</span>
            </div>
          `)}
        </div>

        <!-- Save -->
        <div class="refine-save">
          <button
            class="btn btn-primary"
            onClick=${() => onSaveStep(activeIndex)}
            disabled=${!!busy || !activeStep || alreadySaved || !hasDirectory}
            title=${!hasDirectory
              ? 'Connect a directory first'
              : alreadySaved
                ? 'This is the saved original — heal or improve it first'
                : 'Save this step as a new variant in the generation folder (the original is never overwritten)'}
          >
            <i class="fa-solid fa-floppy-disk"></i> Save step as new variant
          </button>
        </div>
      </div>

      <div class="refine-preview">
        ${activeStep
          ? html`<${LiveHtmlFrame} frameKey=${`${activeIndex}-${steps.length}`} html=${activeStep.html} />`
          : html`<div class="gallery-empty"><i class="fa-solid fa-eye"></i><p>No step selected</p></div>`
        }
        ${(busy === 'heal' || busy === 'apply') && html`
          <div class="refine-stream-overlay">
            <i class="fa-solid fa-spinner fa-spin"></i> Receiving ${streamKb} KB...
          </div>
        `}
      </div>
    </div>
  `;
}
