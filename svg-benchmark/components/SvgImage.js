import { html } from 'htm/preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { sanitizeSvgMarkup } from '../../shared/services/content-sanitizer.js';
import { isWellFormedSvg, svgDataUrl } from '../services/svgRender.js';

// The one SVG renderer for every preview surface. A well-formed SVG shows as an
// <img>, so its animation plays and nothing in it can run (see svgRender.js).
// A partial SVG mid-stream, or a broken one, falls back to sanitized inline
// markup so the live preview still updates while the model writes.
export function SvgImage({ svg, className = '', alt = '' }) {
  const text = (svg || '').trim();
  const asImage = useMemo(() => !!text && isWellFormedSvg(text), [text]);
  const src = useMemo(() => (asImage ? svgDataUrl(text) : ''), [asImage, text]);
  const ref = useRef(null);

  useEffect(() => {
    if (asImage || !ref.current) return;
    ref.current.innerHTML = text ? sanitizeSvgMarkup(text) : '';
  }, [asImage, text]);

  // Distinct keys remount the wrapper when switching modes, so markup injected
  // for the inline fallback never lingers beside the <img>.
  return asImage
    ? html`<div key="image" class=${`svg-render is-image ${className}`}>
        <img class="svg-render-img" src=${src} alt=${alt} draggable="false" />
      </div>`
    : html`<div key="inline" class=${`svg-render is-inline ${className}`} ref=${ref}></div>`;
}
