// Render an SVG the way a browser shows an image file, not as inline markup.
//
// Inline rendering has to go through the HTML sanitizer, and its SVG profile
// drops <style>, <animate>, <set> and <use> plus the from/to/calcMode
// attributes, which leaves animated SVGs frozen or broken. An SVG loaded as an
// image runs SMIL and CSS animation but never scripts, event handlers or
// external requests, so it is safe without sanitizing. It is also exactly how
// pixeldiff rasterises an SVG for auto-scoring, so what you see is what is
// scored.
//
// Pure string helpers only (no DOM imports), so node tests can use them.

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

// Inline SVG forgives a missing xmlns; an image document does not and renders
// nothing. Add the namespaces a model commonly forgets.
export function prepareSvgForImage(svg) {
  const text = String(svg || '').trim();
  const open = text.match(/<svg\b[^>]*>/i);
  if (!open) return text;
  const tag = open[0];
  let fixed = tag;
  if (!/\sxmlns\s*=/.test(tag)) fixed = fixed.replace(/^<svg\b/i, `<svg xmlns="${SVG_NS}"`);
  if (/\bxlink:/.test(text) && !/\sxmlns:xlink\s*=/.test(tag)) {
    fixed = fixed.replace(/^<svg\b/i, `<svg xmlns:xlink="${XLINK_NS}"`);
  }
  if (fixed === tag) return text;
  return text.slice(0, open.index) + fixed + text.slice(open.index + tag.length);
}

export function svgDataUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(prepareSvgForImage(svg));
}

// A streaming or broken SVG is not well-formed XML and would show as a broken
// image, so callers fall back to sanitized inline markup for those.
export function isWellFormedSvg(svg) {
  const text = prepareSvgForImage(svg);
  if (!/<svg[\s>]/i.test(text)) return false;
  if (typeof DOMParser === 'undefined') return true;
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    return !doc.querySelector('parsererror') && doc.documentElement?.localName === 'svg';
  } catch (e) {
    return false;
  }
}
