// Motion check for animated SVG submissions.
//
// Pixel-diff against a still reference means nothing for an animation, so the
// Animated prompt set gets this instead:
//   1. Static analysis: is there SMIL or CSS animation at all, does it loop,
//      does it lean on script (which never runs in an image) or on a click?
//   2. Frame check: render the SVG frozen at several moments and compare the
//      frames. Models often write animation markup that moves nothing, and
//      only rendering catches that.
//
// Freezing works on the markup, because an SVG loaded as an image cannot be
// paused or seeked from outside:
//   - SMIL: every clock-value `begin` is shifted back by t (a missing begin
//     becomes begin="-t s"), so the image opens t seconds into its timeline.
//     Syncbase begins (`a.end+1s`) follow their shifted base.
//   - CSS: an injected rule pauses every animation with animation-delay: -t s.
//     That overrides authored delays, so staggered elements fall in phase in
//     the probe frames. Fine for "does it move", not a faithful still.
//
// Everything except checkAnimation's renderFrame callback is pure, so node
// tests cover it without a browser.

import { prepareSvgForImage } from './svgRender.js';

const SMIL_OPEN = /<(animate|animateTransform|animateMotion|animateColor|set)\b([^>]*?)(\/?)>/gi;
const CLOCK_VALUE = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s|min|h)?$/i;
const EVENT_BEGIN = /\b(click|dblclick|mouse\w*|focus\w*|blur|keydown|keyup|accessKey|activate)\b/i;

// Probe times are deliberately off-beat so common loop lengths (1s, 2s, 4s)
// never land every frame back on the starting pose.
export const PROBE_TIMES = Object.freeze([0, 0.37, 0.91, 1.63, 2.71, 3.9]);
export const PROBE_SIZE = 320;
// A pixel counts as changed past this summed RGB distance, which ignores
// antialiasing wobble. Forty changed pixels at 320×320 is a small blink.
const PIXEL_TOLERANCE = 24;
const MIN_CHANGED_PIXELS = 40;

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return m ? m[2] : null;
}

function styleText(svg) {
  const blocks = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  const inline = [...svg.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)].map(m => m[2]);
  return [...blocks, ...inline].join('\n');
}

export function analyzeAnimation(svg) {
  const text = String(svg || '');
  const smil = { animate: 0, animateTransform: 0, animateMotion: 0, set: 0 };
  let smilCount = 0;
  let smilRepeating = 0;
  let eventTriggered = false;

  for (const m of text.matchAll(SMIL_OPEN)) {
    const name = m[1].toLowerCase();
    const key = name === 'animatetransform' ? 'animateTransform'
      : name === 'animatemotion' ? 'animateMotion'
      : name === 'set' ? 'set' : 'animate';
    smil[key]++;
    smilCount++;
    const attrs = m[2];
    const begin = attr(attrs, 'begin') || '';
    if (/indefinite/i.test(attr(attrs, 'repeatCount') || '') || /indefinite/i.test(attr(attrs, 'repeatDur') || '')
      || /\.(end|begin)\b/.test(begin)) {
      smilRepeating++;
    }
    if (EVENT_BEGIN.test(begin)) eventTriggered = true;
  }

  const css = styleText(text);
  const keyframes = (css.match(/@(?:-webkit-)?keyframes\b/gi) || []).length;
  const animationDecls = css.match(/(?:^|[;{\s])animation(?:-name)?\s*:[^;}]*/gi) || [];
  const cssAnimations = animationDecls.filter(d => !/:\s*none\b/i.test(d)).length;
  const cssInfinite = /\binfinite\b/i.test(css);

  const hasSmil = smilCount > 0;
  const hasCss = keyframes > 0 && cssAnimations > 0;
  const loops = (hasSmil && smilRepeating > 0) || (hasCss && cssInfinite);

  return {
    animated: hasSmil || hasCss,
    smil,
    smilCount,
    keyframes,
    cssAnimations,
    loops,
    eventTriggered,
    hasScript: /<script\b/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /javascript:/i.test(text),
  };
}

function seconds(value, unit) {
  const n = Number(value);
  switch ((unit || 's').toLowerCase()) {
    case 'ms': return n / 1000;
    case 'min': return n * 60;
    case 'h': return n * 3600;
    default: return n;
  }
}

function fmt(n) {
  return `${Math.round(n * 1000) / 1000}s`;
}

// Shift the clock-value entries of a begin list back by t. Returns null when
// the list has no clock values (events, syncbases, indefinite) so it is left alone.
export function shiftBegin(value, t) {
  let shifted = false;
  const parts = String(value).split(';').map((raw) => {
    const entry = raw.trim();
    const m = entry.match(CLOCK_VALUE);
    if (!m) return entry;
    shifted = true;
    return fmt(seconds(m[1], m[2]) - t);
  });
  return shifted ? parts.join(';') : null;
}

export function freezeSvgAt(svg, t) {
  const at = Number(t) || 0;
  let text = prepareSvgForImage(svg);

  text = text.replace(SMIL_OPEN, (whole, name, attrs, selfClose) => {
    const beginMatch = attrs.match(/\sbegin\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!beginMatch) return `<${name}${attrs.replace(/\s*$/, '')} begin="${fmt(-at)}"${selfClose ? ' /' : ''}>`;
    const next = shiftBegin(beginMatch[2], at);
    if (next == null) return whole;
    return `<${name}${attrs.replace(beginMatch[0], ` begin="${next}"`)}${selfClose}>`;
  });

  const open = text.match(/<svg\b[^>]*>/i);
  if (open) {
    const freeze = `<style>*{animation-delay:${fmt(-at)}!important;animation-play-state:paused!important}</style>`;
    const end = open.index + open[0].length;
    text = text.slice(0, end) + freeze + text.slice(end);
  }
  return text;
}

// Fraction of pixels that differ between two same-sized RGBA frames.
export function changedFraction(a, b, tolerance = PIXEL_TOLERANCE) {
  const da = a.data;
  const db = b.data;
  const total = Math.min(da.length, db.length) / 4;
  if (!total) return 0;
  let changed = 0;
  for (let i = 0; i < total * 4; i += 4) {
    const dist = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    if (dist > tolerance) changed++;
  }
  return changed / total;
}

// renderFrame(svgMarkup, size) → Promise<{ data, width, height }> (an ImageData).
// Without one, only the static analysis runs.
export async function checkAnimation(svg, { renderFrame, times = PROBE_TIMES, size = PROBE_SIZE } = {}) {
  const analysis = analyzeAnimation(svg);
  const result = { ...analysis, moves: null, motion: null, framesChecked: 0, issues: [] };

  if (analysis.animated && renderFrame) {
    try {
      const frames = [];
      for (const t of times) frames.push(await renderFrame(freezeSvgAt(svg, t), size));
      let most = 0;
      for (let i = 1; i < frames.length; i++) most = Math.max(most, changedFraction(frames[0], frames[i]));
      result.framesChecked = frames.length;
      result.motion = Math.round(most * 10000) / 10000;
      result.moves = most * size * size >= MIN_CHANGED_PIXELS;
    } catch (e) {
      result.issues.push(`Frame check failed: ${e.message}`);
    }
  }

  if (!analysis.animated) result.issues.push('No SMIL or CSS animation found');
  else if (result.moves === false) result.issues.push('Has animation markup, but nothing visibly moves');
  if (analysis.animated && !analysis.loops) result.issues.push('Nothing is set to repeat forever');
  if (analysis.eventTriggered) result.issues.push('Some animation waits for a click or hover');
  if (analysis.hasScript) result.issues.push('Contains script or event handlers, which never run here');

  result.ok = analysis.animated && result.moves !== false && !analysis.hasScript;
  return result;
}
