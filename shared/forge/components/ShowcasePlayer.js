// Showcase player for forge projects. A showcase tile links to
// `<forge>/#/showcase/<id>`; mountShowcasePlayer() watches for that route and
// lays a full-window player over the app, so a visitor plays the published
// run without connecting a folder or choosing a model. Closing it clears the
// hash and leaves the app exactly as it was underneath.
//
// ShowcaseProjectFrame is the frame on its own; the showcase admin console
// uses it to preview a run before publishing.

import { html, render } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { loadShowcaseItem, showcaseIdFromHash } from '../../services/showcase.js';
import { loadPreviewerSource, parseBundle, resolveBundleFiles, runnerSrcdoc, startRunner } from '../services/showcaseProject.js';

/**
 * Plays one bundle in an opaque-origin sandbox.
 * @param {{ bundle, bootstrap?: string[], frameRef?, onStatus?: (s) => void, runKey?: any }} props
 *   `runKey` changes restart the project; `bootstrap` scripts run before the
 *   project's own (the admin console injects its poster-capture hook).
 */
export function ShowcaseProjectFrame({ bundle, bootstrap = [], frameRef, onStatus = () => {}, runKey = 0, title = 'Project' }) {
  const ref = useRef(null);
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe || !bundle) return undefined;
    if (frameRef) frameRef.current = iframe;
    let live = true;
    let runner = null;
    let errors = 0;
    onStatus({ state: 'loading', errors: 0 });
    (async () => {
      const [files, previewer] = await Promise.all([resolveBundleFiles(bundle), loadPreviewerSource()]);
      if (!live) return;
      runner = startRunner(iframe, {
        files, entry: bundle.entry, previewer, bootstrap,
        onDiagnostic: (d) => {
          if (!live || !/error|unhandledrejection/.test(d.kind)) return;
          errors++;
          onStatus({ state: 'running', errors, lastError: d.message });
        },
      });
      // The listener is in place before the runner document exists, so its
      // "ready" message cannot be missed.
      iframe.srcdoc = runnerSrcdoc();
      await runner.started;
      if (live) onStatus({ state: 'running', errors });
    })().catch((error) => { if (live) onStatus({ state: 'failed', errors, message: error.message }); });
    return () => { live = false; runner?.stop(); iframe.removeAttribute('srcdoc'); };
  }, [bundle, runKey]);

  return html`<iframe ref=${ref} class="showcase-project-frame" title=${title}
    sandbox="allow-scripts allow-pointer-lock allow-modals"
    allow="fullscreen; gamepad; autoplay; xr-spatial-tracking; accelerometer; gyroscope"></iframe>`;
}

const STYLE = `
/* The app underneath can be wider than a phone; hidden, it cannot stretch the page under the player. */
html.showcase-player-open body>:not(.showcase-player-host){display:none!important}
.showcase-player{position:fixed;inset:0;z-index:2000;display:grid;grid-template-rows:auto 1fr;background:var(--bg-primary,#05070c);color:var(--text-primary,#e6e9f0);font-family:var(--font-family,system-ui,sans-serif)}
.showcase-player-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:10px 16px;border-bottom:1px solid var(--border-color,#222a38);background:var(--bg-secondary,#0b0f18)}
.showcase-player-bar h1{font-size:16px;margin:0;font-weight:650}
.showcase-player-bar .sp-sub{color:var(--text-secondary,#9aa4b8);font-size:13px}
.showcase-player-bar .sp-chip{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent-color,#7c5cff) 22%,transparent);color:var(--accent-color,#a48bff)}
.showcase-player-bar .sp-spacer{flex:1}
.showcase-player-bar a,.showcase-player-bar button{font:inherit;font-size:13px;color:inherit;background:transparent;border:1px solid var(--border-color,#2a3344);border-radius:8px;padding:6px 10px;cursor:pointer;text-decoration:none}
.showcase-player-bar a:hover,.showcase-player-bar button:hover{border-color:var(--accent-color,#7c5cff)}
.showcase-player-body{position:relative;display:grid;grid-template-columns:1fr auto;min-height:0}
.showcase-project-frame{width:100%;height:100%;border:0;background:#05070c;display:block}
.showcase-player-side{width:min(380px,40vw);overflow:auto;padding:14px 16px;border-left:1px solid var(--border-color,#222a38);background:var(--bg-secondary,#0b0f18);font-size:13px;line-height:1.55}
.showcase-player-side h2{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary,#9aa4b8)}
.showcase-player-side pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0 0 16px}
.showcase-player-status{position:absolute;left:12px;bottom:12px;max-width:min(560px,80%);font-size:12px;padding:6px 10px;border-radius:8px;background:rgba(6,8,14,.82);color:#e6e9f0;pointer-events:none}
.showcase-player-status.is-bad{color:#ffb4a8}
.showcase-player-msg{display:grid;place-items:center;text-align:center;padding:24px;color:var(--text-secondary,#9aa4b8)}
@media (max-width:760px){.showcase-player-body{grid-template-columns:1fr;grid-template-rows:1fr auto}.showcase-player-side{width:auto;max-height:34vh;border-left:0;border-top:1px solid var(--border-color,#222a38)}}
`;

function statusText(status) {
  if (!status) return '';
  if (status.state === 'loading') return 'Loading the project…';
  if (status.state === 'failed') return `Could not start: ${status.message}`;
  if (status.errors) return `${status.errors} error${status.errors === 1 ? '' : 's'} reported${status.lastError ? `: ${String(status.lastError).slice(0, 140)}` : ''}`;
  return '';
}

function Player({ id, appTitle, onClose }) {
  const [item, setItem] = useState(undefined);   // undefined = loading, null = not found
  const [bundle, setBundle] = useState(null);
  const [problem, setProblem] = useState('');
  const [status, setStatus] = useState(null);
  const [runKey, setRunKey] = useState(0);
  const [showInfo, setShowInfo] = useState(() => globalThis.innerWidth > 760);
  const body = useRef(null);

  useEffect(() => {
    let live = true;
    setItem(undefined); setBundle(null); setProblem('');
    loadShowcaseItem(id).then((found) => {
      if (!live) return;
      setItem(found);
      if (!found) return;
      if (found.kind !== 'project') { setProblem('This showcase item is not a forge project.'); return; }
      try { setBundle(parseBundle(found.code)); } catch (error) { setProblem(error.message); }
    });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const text = statusText(status);
  return html`
    <div class="showcase-player" role="dialog" aria-modal="true" aria-label=${item?.title || 'Showcase project'}>
      <div class="showcase-player-bar">
        <span class="sp-chip">${appTitle} showcase</span>
        <h1>${item?.title || (item === null ? 'Not found' : 'Loading…')}</h1>
        ${item?.note && html`<span class="sp-sub">${item.note}</span>`}
        ${item?.rating && html`<span class="sp-sub" title="Maintainer rating">${item.rating}</span>`}
        <span class="sp-spacer"></span>
        ${bundle && html`
          <button type="button" onClick=${() => setRunKey(k => k + 1)}>Restart</button>
          <button type="button" onClick=${() => body.current?.querySelector('iframe')?.requestFullscreen?.()}>Fullscreen</button>
          <button type="button" aria-pressed=${showInfo} onClick=${() => setShowInfo(v => !v)}>Prompt</button>`}
        <a href="../showcase.html">All showcase</a>
        <button type="button" onClick=${onClose}>Open ${appTitle}</button>
      </div>
      ${item === undefined && html`<div class="showcase-player-msg">Loading…</div>`}
      ${item === null && html`<div class="showcase-player-msg">There is no published project called “${id}”.</div>`}
      ${problem && html`<div class="showcase-player-msg">${problem}</div>`}
      ${bundle && html`
        <div class="showcase-player-body" ref=${body}>
          <${ShowcaseProjectFrame} bundle=${bundle} runKey=${runKey} onStatus=${setStatus} title=${item.title} />
          ${showInfo && html`
            <aside class="showcase-player-side">
              <h2>Prompt</h2>
              <pre>${item.prompt || 'No prompt was published with this project.'}</pre>
              <h2>About</h2>
              <p>Built by ${item.note || 'a model'} in ${appTitle}: the model wrote every file of this project, and the forge ran and checked it. It plays here in a sandbox that cannot read this site's storage.</p>
              <p>${bundle.files.length} files, opening ${bundle.entry}.</p>
            </aside>`}
          ${text && html`<div class=${`showcase-player-status ${status.state === 'failed' || status.errors ? 'is-bad' : ''}`}>${text}</div>`}
        </div>`}
    </div>`;
}

/**
 * Watch for `#/showcase/<id>` and show the player over the app while it is set.
 * @param {{ appTitle: string }} options
 */
export function mountShowcasePlayer({ appTitle }) {
  const host = document.createElement('div');
  host.className = 'showcase-player-host';
  document.body.appendChild(host);
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const close = () => {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    sync();
  };
  function sync() {
    const id = showcaseIdFromHash();
    document.documentElement.classList.toggle('showcase-player-open', Boolean(id));
    render(id ? html`<${Player} key=${id} id=${id} appTitle=${appTitle} onClose=${close} />` : null, host);
  }
  addEventListener('hashchange', sync);
  sync();
}
