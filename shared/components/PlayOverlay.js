import { html } from 'htm/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { playableHtml } from '../services/playable-html.js';

/**
 * Full-window player for generated HTML, with a list of versions to choose
 * from: in Code Morph Lab the imported original, each iteration and the final
 * workspace; in Prompt Gallery's Refine the original and each Heal / Improve
 * step. Closing it returns to the app exactly as it was; nothing is changed.
 *
 * A version carries either `html` (one page) or `files` (a workspace, played
 * through playableHtml).
 *
 * @param {{ versions: {id,label,detail?,html?,files?,latest?}[], initialId?: string, title?: string,
 *           backLabel?: string, onClose: () => void }} props
 */
export function PlayOverlay({ versions, initialId = '', title = '', backLabel = 'Back', onClose }) {
  const fallback = versions.find(v => v.latest)?.id || versions.at(-1)?.id || '';
  const [selected, setSelected] = useState(versions.some(v => v.id === initialId) ? initialId : fallback);
  const [restarts, setRestarts] = useState(0);
  const frameRef = useRef(null);
  const closeRef = useRef(null);

  const version = versions.find(v => v.id === selected) || versions[0];
  const srcdoc = useMemo(() => (version ? (typeof version.html === 'string' ? version.html : playableHtml(version.files)) : ''), [version]);

  // Esc closes only while the bar has focus: once the game has the keyboard,
  // Esc is the game's (pause menus use it), and the back button is the way out.
  // Runs once: the parent passes a fresh onClose each render, and re-running
  // would pull focus back to this button, away from the game, on every render
  // of a running morph.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) onCloseRef.current(); };
    addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, []);

  // Hand the keyboard to the game once it has loaded, so arrow keys and the
  // like reach it without a first click.
  const focusGame = () => { try { frameRef.current?.contentWindow?.focus(); } catch { /* sandboxed */ } };

  if (!version) return null;
  const optionLabel = v => `${v.label}${v.detail ? ` · ${v.detail}` : ''}${v.latest ? ' (latest)' : ''}`;

  return html`
    <div class="play-overlay" role="dialog" aria-modal="true" aria-label=${`Playing ${title || 'the code'}: ${version.label}`}>
      <div class="play-bar">
        <span class="play-chip"><i class="fa-solid fa-play"></i> Playing</span>
        ${title && html`<strong class="play-title">${title}</strong>`}
        ${versions.length > 1
          ? html`
            <label class="play-version">
              <span>Version</span>
              <select value=${selected} onChange=${e => setSelected(e.target.value)}>
                ${versions.map(v => html`<option value=${v.id} key=${v.id}>${optionLabel(v)}</option>`)}
              </select>
            </label>`
          : html`<span class="play-version-single">${optionLabel(version)}</span>`}
        <span class="play-spacer"></span>
        <button class="btn" type="button" onClick=${() => setRestarts(n => n + 1)} title="Start this version again">
          <i class="fa-solid fa-rotate-right"></i> Restart
        </button>
        <button class="btn" type="button" onClick=${() => frameRef.current?.requestFullscreen?.()} title="Fill the screen">
          <i class="fa-solid fa-expand"></i> Fullscreen
        </button>
        <button class="btn btn-primary" type="button" ref=${closeRef} onClick=${onClose} title=${backLabel}>
          <i class="fa-solid fa-arrow-left"></i> ${backLabel}
        </button>
      </div>
      <iframe
        key=${`${version.id}:${restarts}`}
        ref=${frameRef}
        class="play-frame"
        title=${`${title || 'Code'}: ${version.label}`}
        sandbox="allow-scripts allow-pointer-lock"
        allow="fullscreen; gamepad; autoplay"
        srcdoc=${srcdoc}
        onLoad=${focusGame}
      ></iframe>
    </div>`;
}
