// htmlValueOutput — rendering a cell's returned HTML string as actual HTML.
//
// A JS (or Python) cell that returns markup used to be printed as source text,
// because the check for it was `value.startsWith('<')` and a template literal
// almost always begins with a newline. Detection now trims first, and the
// markup renders in its own sandboxed srcdoc iframe rather than being injected
// into the notebook DOM: a returned fragment routinely carries a `<style>`
// block, and `table { … }` inside one would otherwise restyle the whole app.
//
// The iframe reports its own content height so the output box hugs the render
// instead of showing a fixed-size window into it.

export const HTML_VALUE_MARKER = '__nbHtmlValue';

/** Height beyond which the frame stops growing and scrolls internally. */
export const MAX_AUTO_HEIGHT = 1200;

// A tag, a comment, or a doctype at the very start. Deliberately narrow: it
// must not fire on prose that happens to open with "<" ("<3", "<- see above",
// "<placeholder>" is fine to catch, but "5 < 6" never reaches here anyway).
const HTML_START = /^\s*<(?:!doctype\s|!--|[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>)/i;

export function looksLikeHtml(value) {
  return typeof value === 'string' && HTML_START.test(value);
}

/**
 * The auto-height reporter injected into every rendered value.
 * Runs inside the sandbox, so it only ever posts a number outward.
 */
function heightScript() {
  return `<script>(function () {
  function post() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    parent.postMessage({ ${HTML_VALUE_MARKER}: 'height', height: h }, '*');
  }
  if (window.ResizeObserver) new ResizeObserver(post).observe(document.documentElement);
  window.addEventListener('load', post);
  // Late layout shifts — webfonts, images without dimensions — land after load.
  setTimeout(post, 50);
  setTimeout(post, 400);
  post();
})();</scr` + `ipt>`;
}

/**
 * Base styling for the sandboxed document. The background stays transparent so
 * the notebook's own output panel shows through in either theme, and the text
 * colour/font are handed in from the live computed style of the output element
 * — an unstyled `<table>` then reads the same as the text around it.
 */
function baseStyle({ color = '#e2e8f0', fontFamily = 'system-ui, sans-serif', fontSize = '13px', colorScheme = 'dark' } = {}) {
  return `<style>
  :root { color-scheme: ${colorScheme}; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: ${color};
    font-family: ${fontFamily};
    font-size: ${fontSize};
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  a { color: inherit; }
  img, canvas, svg, video { max-width: 100%; }
  table { border-collapse: collapse; }
</style>`;
}

/**
 * Wrap a returned HTML string into a full srcdoc document.
 * A value that already declares its own doctype keeps it first so the render
 * does not fall into quirks mode.
 */
export function buildValueSrcdoc(value, theme) {
  const src = String(value ?? '');
  const head = baseStyle(theme) + heightScript();
  const doctype = src.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) {
    const end = doctype[0].length;
    return src.slice(0, end) + head + src.slice(end);
  }
  return head + src;
}

/** Clamp a reported height into something a cell output can sensibly show. */
export function clampHeight(height) {
  const value = Number(height);
  if (!Number.isFinite(value) || value <= 0) return 24;
  return Math.min(MAX_AUTO_HEIGHT, Math.max(24, Math.ceil(value)));
}
