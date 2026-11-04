import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

import { listShowcaseItems } from '../services/showcase.js';

// A bench's gallery for a visitor with no folder connected (public site): the
// curated showcase items, each shown by the poster chosen in the admin console,
// opening the full-size showcase view. `fallback` renders when the build has
// no showcase for this bench, so the old "connect a folder" page still shows.
export function ShowcaseGrid({ bench, onConnect, fallback = null }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let current = true;
    listShowcaseItems({ bench }).then((list) => { if (current) setItems(list); });
    return () => { current = false; };
  }, [bench]);

  if (items === null) {
    return html`<div class="showcase-landing-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
  }
  if (!items.length) return fallback;

  return html`
    <div class="showcase-gallery">
      <div class="showcase-gallery-intro">
        <div>
          <h2>Showcase</h2>
          <p>Hand-picked generations, each with the model that made it. Open one to see it running, then its prompt and code. Connect a folder to save and browse your own.</p>
        </div>
        ${onConnect && html`
          <button class="btn" onClick=${onConnect}><i class="fa-solid fa-folder-plus"></i> Connect a folder</button>
        `}
      </div>
      <div class="showcase-gallery-grid">
        ${items.map((it) => html`
          <a class="showcase-gallery-card" key=${it.id} href=${`#/showcase/${encodeURIComponent(it.id)}`}>
            <div class="showcase-gallery-picture">
              ${(it.posterUrl || it.artUrl)
                ? html`<img src=${it.posterUrl || it.artUrl} alt="" loading="lazy" draggable="false" />`
                : html`<i class="fa-solid fa-image"></i>`}
            </div>
            <div class="showcase-gallery-body">
              <strong>${it.title}</strong>
              ${it.note && html`<span class="showcase-landing-model">${it.note}</span>`}
              ${it.rating && html`<span class="showcase-landing-rating"><i class="fa-solid fa-star"></i> ${it.rating}</span>`}
            </div>
          </a>
        `)}
      </div>
    </div>
  `;
}
