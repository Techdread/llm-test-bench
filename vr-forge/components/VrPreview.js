import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { buildProjectPreview } from '../services/previewAdapters.js';
import { projectSignature, readProjectTree } from '../services/previewer.js';

// How long a burst of file events is allowed to settle before the live preview
// reboots. An agent writing 16 files fires 16 nonces in a few seconds; without
// this the game is re-executed once per file.
const LIVE_SETTLE_MS = 1200;

// Boots a built project directory into a sandboxed iframe.
export function VrPreview({ projectHandle, nonce, stack, live, domainAdapter }) {
  const nonWeb = stack && String(stack).toLowerCase() !== 'web';
  const [state, setState] = useState({ status: 'idle' });
  const [paused, setPaused] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const revokeRef = useRef(null);
  const signatureRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    if (!projectHandle) { setState({ status: 'idle' }); return; }
    // A paused live preview keeps whatever is already on screen. The generated
    // game runs in the same process as this page, so a half-written game with a
    // hot loop freezes the app — pausing is the user's escape hatch.
    if (paused) return;

    const build = async () => {
      try {
        const files = await readProjectTree(projectHandle);
        if (cancelled) return;
        const signature = projectSignature(files);
        // Nothing on disk changed, so re-executing the game would achieve
        // nothing and cost a full restart of its loop, audio and timers.
        if (signature === signatureRef.current && state.status === 'ok') {
          setSkipped(value => value + 1);
          return;
        }
        signatureRef.current = signature;
        setState(current => (current.status === 'ok' ? current : { status: 'loading' }));
        const result = domainAdapter
          ? await domainAdapter.preview(projectHandle, { stack, files })
          : await buildProjectPreview(projectHandle, { stack, files });
        if (cancelled) { result.revoke?.(); return; }
        if (revokeRef.current) revokeRef.current();
        revokeRef.current = result.revoke || null;
        setState(result.ok ? { status: 'ok', ...result } : { status: 'no-entry', ...result });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e.message });
      }
    };

    if (live) timer = setTimeout(build, LIVE_SETTLE_MS);
    else build();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [projectHandle, nonce, stack, domainAdapter, paused]);

  // A fresh project starts a fresh signature, so switching runs always rebuilds.
  useEffect(() => { signatureRef.current = ''; setSkipped(0); setPaused(false); }, [projectHandle]);

  useEffect(() => () => { if (revokeRef.current) revokeRef.current(); }, []);

  return html`
    <div class="gf-preview">
      <div class="gf-preview-bar">
        <span><i class="fas fa-play"></i> Preview</span>
        ${live && !paused && html`<span class="gf-live"><span class="gf-live-dot"></span> live</span>`}
        ${live && paused && html`<span class="gf-preview-paused">paused</span>`}
        ${state.entry && html`<span class="gf-preview-entry">${state.entry}</span>`}
        ${state.adapterLabel && html`<span class="gf-preview-entry">${state.adapterLabel}</span>`}
        ${state.fileList && html`<span class="gf-preview-files">${state.fileList.length} files</span>`}
        ${live && html`
          <button class=${`gf-btn gf-preview-pause ${paused ? 'active' : ''}`}
            onClick=${() => setPaused(!paused)}
            title=${paused
              ? 'Resume live preview. The generated project runs in this page\u2019s process, so a half-written scene can slow the app down.'
              : 'Pause the live preview. The project stops being restarted as files land \u2014 use this if the page becomes sluggish mid-build.'}>
            <i class=${`fas ${paused ? 'fa-play' : 'fa-pause'}`}></i> ${paused ? 'Resume' : 'Pause'}
          </button>`}
        ${state.status === 'ok' && html`<button class="gf-icon-btn" title="Open in new tab" onClick=${() => window.open(state.url, '_blank')}><i class="fas fa-up-right-from-square"></i></button>`}
      </div>
      <div class="gf-preview-body">
        ${state.adapterWarning && html`<div class="gf-preview-adapter-warn"><i class="fas fa-triangle-exclamation"></i> ${state.adapterWarning}</div>`}
        ${state.status === 'idle' && html`<div class="gf-preview-msg">Run a build to preview the project here.</div>`}
        ${state.status === 'loading' && html`<div class="gf-preview-msg"><i class="fas fa-spinner fa-spin"></i> Assembling preview…</div>`}
        ${state.status === 'error' && html`<div class="gf-preview-msg gf-err">Preview error: ${state.message}</div>`}
        ${state.status === 'no-entry' && html`
          <div class=${`gf-preview-msg ${nonWeb || live ? '' : 'gf-err'}`}>
            ${nonWeb
              ? html`<b><i class="fas fa-box-archive"></i> Built in ${String(stack).toUpperCase()} — archived for review.</b><br/>Live in-browser running of ${String(stack).toUpperCase()} projects is a later phase; the project tree is on disk and gradeable now.`
              : live
                ? html`<b><i class="fas fa-spinner fa-spin"></i> Building…</b><br/>Waiting for <code>index.html</code> — the preview will boot as soon as the entry file lands.`
                : html`No <code>index.html</code> entry — archived only (the model didn't produce a web entry).`}
            ${(state.fileList || []).length > 0 && html`<div class="gf-filelist">${state.fileList.map(f => html`<div>${f}</div>`)}</div>`}
          </div>`}
        ${state.status === 'ok' && html`
          <iframe class="gf-iframe" src=${state.url}
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-modals"
            allow="autoplay; fullscreen; xr-spatial-tracking"></iframe>`}
      </div>
    </div>`;
}
