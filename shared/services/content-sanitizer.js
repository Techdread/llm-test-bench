// Origin-safe rendering helpers for user/model-authored rich content.
// Raw artefacts remain untouched for editing/export; only same-origin preview
// surfaces receive the sanitised copy.

import createDOMPurify from '../lib/dompurify/3/index.mjs';

let purifier = null;

function getPurifier() {
  if (purifier) return purifier;
  purifier = typeof createDOMPurify?.sanitize === 'function'
    ? createDOMPurify
    : createDOMPurify(globalThis.window);
  return purifier;
}

/** Sanitise rendered Markdown/LLM prose before using innerHTML. */
export function sanitizeRichHtml(value) {
  return getPurifier().sanitize(String(value || ''), {
    USE_PROFILES: { html: true },
    // Rich prose does not need active controls or auto-loading media. Keeping
    // those out also prevents imported prompts from making surprise requests.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'img', 'svg', 'math'],
    FORBID_ATTR: ['style'],
  });
}

/** Sanitise SVG for inline same-origin display without changing the raw SVG. */
export function sanitizeSvgMarkup(value) {
  return getPurifier().sanitize(String(value || ''), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'style', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video'],
  });
}
