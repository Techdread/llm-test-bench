import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

import { resolveShowcaseRoute, showcaseBackHref } from '../services/showcase.js';

// What a showcase tile opens: the piece running full-size, with a thin bar
// naming it and the model that made it. The prompt and code are one click
// away ("See the prompt & code" loads them into the app's editor), so a
// visitor sees the result first and the source second.
//
// The bench supplies the renderer as children (an HTML iframe, a p5 canvas, an
// SVG image), the same one its Create view uses. `item` is a showcase payload
// from resolveShowcaseRoute(); while it is still loading, pass null.
export function ShowcaseLanding({ id, item, onOpenCreate, children }) {
  return html`
    <div class="showcase-landing">
      <header class="showcase-landing-bar">
        <a class="showcase-landing-back" href=${showcaseBackHref(id)} title="Back to the showcase">
          <i class="fa-solid fa-arrow-left"></i> Showcase
        </a>
        <div class="showcase-landing-info">
          <div class="showcase-landing-title">
            <strong>${item?.title || 'Loading…'}</strong>
            ${item?.note && html`<span class="showcase-landing-model">${item.note}</span>`}
            ${item?.rating && html`<span class="showcase-landing-rating"><i class="fa-solid fa-star"></i> ${item.rating}</span>`}
          </div>
          ${item?.prompt && html`<p class="showcase-landing-prompt" title=${item.prompt}>${item.prompt}</p>`}
        </div>
        <button class="btn btn-primary showcase-landing-open" onClick=${onOpenCreate} disabled=${!item}>
          See the prompt & code <i class="fa-solid fa-arrow-right"></i>
        </button>
      </header>
      <div class="showcase-landing-stage">
        ${item
          ? children
          : html`<div class="showcase-landing-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>`}
      </div>
    </div>
  `;
}

/**
 * The showcase item for an app's `showcase/<id>` route: `{ id, item }`, or null
 * while it loads (and on any other route). Reloads when the id changes, so
 * back/forward between two showcase links works.
 */
export function useShowcaseRoute(routeName, routeParam) {
  const [showcase, setShowcase] = useState(null);
  useEffect(() => {
    if (routeName !== 'showcase') return undefined;
    if (showcase?.id === routeParam) return undefined;
    let cancelled = false;
    setShowcase(null);
    resolveShowcaseRoute().then((found) => {
      if (!cancelled && found) setShowcase(found);
    });
    return () => { cancelled = true; };
  }, [routeName, routeParam]);
  return showcase;
}
