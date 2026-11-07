import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { loadForgeDemoIndex } from '../services/forgeDemos.js';

// The first thing in a forge's Library: a finished run the forge built, ready
// to play (`#/demo/<slug>`, see ShowcasePlayer), so a visitor sees what the
// forge makes before choosing a brief and a model. Closing it is remembered
// per app; nothing else changes.

const HIDDEN_KEY = appId => `${appId}-demo-strip-hidden`;

export function ForgeDemoStrip({ appId, noun = 'game' }) {
  const [demos, setDemos] = useState([]);
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDDEN_KEY(appId)) === '1'; } catch { return false; }
  });

  useEffect(() => {
    let live = true;
    loadForgeDemoIndex().then(index => { if (live) setDemos(index.demos); });
    return () => { live = false; };
  }, []);

  if (hidden || !demos.length) return null;
  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(HIDDEN_KEY(appId), '1'); } catch { /* private mode */ }
  };

  return html`
    <section class="forge-demo-strip" aria-label=${`Play a finished ${noun}`}>
      ${demos.map(demo => html`
        <div class="forge-demo-card" key=${demo.slug}>
          <a class="forge-demo-poster" href=${`#/demo/${encodeURIComponent(demo.slug)}`} aria-label=${`Play ${demo.title}`}>
            ${demo.poster
              ? html`<img src=${demo.poster} alt="" loading="lazy" />`
              : html`<i class="fa-solid fa-play"></i>`}
          </a>
          <div class="forge-demo-text">
            <p class="forge-demo-eyebrow">Play a finished ${noun}</p>
            <h2>${demo.title}</h2>
            ${demo.model && html`<p class="forge-demo-model">Built by ${demo.model}, from this brief:</p>`}
            ${demo.prompt && html`<p class="forge-demo-brief">${demo.prompt}</p>`}
            <div class="forge-demo-actions">
              <a class="btn btn-primary" href=${`#/demo/${encodeURIComponent(demo.slug)}`}>
                <i class="fa-solid fa-play"></i> Play
              </a>
              <span class="forge-demo-hint">Then pick a brief below, choose a model and press Build to make your own.</span>
            </div>
          </div>
        </div>`)}
      <button class="forge-demo-close btn-icon" type="button" title="Hide" aria-label="Hide the demo" onClick=${hide}>
        <i class="fa-solid fa-xmark"></i>
      </button>
    </section>`;
}
