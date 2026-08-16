// SlideHelp — renders a hub-help-deck-v1 deck as navigable slides.
//
// Used by HelpDialog when an app has <app>/help/deck.json (built by
// tools/help-decks.mjs from HELP.md, or by tools/walkthrough-capture.mjs for
// hand-authored walkthroughs).
//
// Slide bodies are rendered into a SHADOW ROOT rather than an iframe. An
// iframe would isolate the CSS but is a separate browsing context, so it
// swallows clicks and key presses before they reach the navigation — the exact
// bug that broke arrow keys in Slide Builder's Present mode. A shadow root
// gives the same style isolation while events propagate normally, content can
// scroll, and the host's CSS custom properties (--text-primary and friends)
// inherit straight in, so slides follow whatever theme the app is in.
//
// Deck HTML is sanitised by the caller before it reaches this component.

import { html } from 'htm/preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

// Presentation for slide bodies. Lives here rather than in each deck so
// restyling every app's help is a CSS edit, not a regeneration of ~200 decks.
const SLIDE_CSS = `
  :host { display: block; height: 100%; }
  .body {
    height: 100%; overflow-y: auto; padding: 4px 2px;
    color: var(--text-secondary, #c9cfe0);
    font-family: var(--font-family, system-ui, sans-serif);
    font-size: 15px; line-height: 1.65;
  }
  .body > *:first-child { margin-top: 0; }
  .body > *:last-child { margin-bottom: 0; }
  h3 { font-size: 1.05em; margin: 1.3em 0 .5em; color: var(--text-primary, #fff); font-weight: 700; }
  h4 { font-size: .98em; margin: 1.1em 0 .4em; color: var(--text-primary, #fff); }
  p { margin: 0 0 .85em; }
  ul, ol { margin: 0 0 .85em; padding-left: 1.4em; }
  li { margin-bottom: .4em; }
  li > ul, li > ol { margin-top: .4em; }
  strong { color: var(--text-primary, #fff); font-weight: 650; }
  em { color: var(--text-secondary, #b9c0d4); }
  a { color: var(--accent, #7cc0ff); }
  code {
    font-family: var(--font-mono, ui-monospace, Menlo, monospace); font-size: .88em;
    background: var(--bg-tertiary, #232735); color: var(--accent, #9fd0ff);
    padding: .1em .4em; border-radius: 4px;
  }
  pre {
    background: var(--bg-primary, #0d0f16); border: 1px solid var(--border-color, #262b3a);
    border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0 0 .9em;
  }
  pre code { background: none; padding: 0; color: var(--text-secondary, #cfd6e6); font-size: .84em; }
  blockquote {
    margin: 0 0 .9em; padding: .1em 0 .1em 14px;
    border-left: 3px solid var(--accent, #7c5cff); color: var(--text-secondary, #b9c0d4);
  }
  table { border-collapse: collapse; margin: 0 0 .9em; font-size: .94em; width: 100%; }
  th, td { border: 1px solid var(--border-color, #2a2f40); padding: 6px 10px; text-align: left; }
  th { background: var(--bg-tertiary, #232735); color: var(--text-primary, #fff); }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  hr { border: none; border-top: 1px solid var(--border-color, #2a2f40); margin: 1.2em 0; }
`;

/** Slide body in an isolated shadow root that still inherits theme variables. */
function SlideBody({ htmlContent }) {
  const hostRef = useRef(null);
  const shadowRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) {
      shadowRef.current = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = SLIDE_CSS;
      shadowRef.current.appendChild(style);
      const body = document.createElement('div');
      body.className = 'body';
      shadowRef.current.appendChild(body);
    }
    const body = shadowRef.current.querySelector('.body');
    body.innerHTML = htmlContent || '';
    body.scrollTop = 0;
  }, [htmlContent]);

  return html`<div class="slide-help-shadow" ref=${hostRef}></div>`;
}

export function SlideHelp({ deck, baseUrl, onReadAsText }) {
  const [index, setIndex] = useState(0);
  const total = deck?.slides?.length || 0;
  const slide = deck?.slides?.[index];
  const stageRef = useRef(null);

  const go = useCallback((delta) => {
    setIndex((i) => Math.min(total - 1, Math.max(0, i + delta)));
  }, [total]);

  // Arrow / PageUp / PageDown navigation. Captured so the app underneath
  // can't act on the same keys while its help is open, and Escape is left
  // alone for HelpDialog's own close handler.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let handled = true;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': go(1); break;
        case 'ArrowLeft': case 'PageUp': go(-1); break;
        case 'Home': setIndex(0); break;
        case 'End': setIndex(total - 1); break;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, total]);

  if (!total) return null;

  const imageSrc = slide.image ? new URL(slide.image, baseUrl).href : null;

  return html`
    <div class="slide-help" ref=${stageRef}>
      <div class=${`slide-help-stage ${slide.kind === 'title' ? 'is-title' : ''} ${imageSrc ? 'has-shot' : ''}`}>
        ${slide.kind === 'title'
          ? html`<h2 class="slide-help-title-lg">${slide.title}</h2>`
          : html`<h3 class="slide-help-heading">${slide.title}</h3>`}

        ${imageSrc && html`
          <div class="slide-help-shot">
            <!-- Deliberately NOT loading="lazy": this sits in a flex column, and
                 a lazy image in a shrinkable box deadlocks — the box collapses to
                 zero because the image has no intrinsic size, and a zero-height
                 element never enters the viewport, so the image never loads. -->
            <img src=${imageSrc} alt=${slide.title || 'screenshot'} />
          </div>
        `}

        <div class="slide-help-body-wrap">
          <${SlideBody} htmlContent=${slide.html} />
        </div>
      </div>

      <div class="slide-help-nav">
        <button class="btn-icon" onClick=${() => go(-1)} disabled=${index === 0} title="Previous (←)">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <div class="slide-help-dots">
          ${deck.slides.map((s, i) => html`
            <button
              key=${i}
              class=${`slide-help-dot ${i === index ? 'active' : ''}`}
              title=${s.title || `Slide ${i + 1}`}
              aria-label=${s.title || `Slide ${i + 1}`}
              onClick=${() => setIndex(i)}
            ></button>
          `)}
        </div>
        <button class="btn-icon" onClick=${() => go(1)} disabled=${index === total - 1} title="Next (→)">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        <span class="slide-help-counter">${index + 1} / ${total}</span>
        ${onReadAsText && html`
          <button class="btn slide-help-text-toggle" onClick=${onReadAsText} title="Show the full help as text">
            <i class="fa-solid fa-align-left"></i> <span>Read as text</span>
          </button>
        `}
      </div>
    </div>
  `;
}
