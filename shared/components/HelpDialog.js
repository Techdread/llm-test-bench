// HelpDialog — shared Preact component
// Modal that renders markdown help content. Either pass an inline `markdown`
// string or a `src` URL (relative to the page) to fetch a .md file.
// Lazy-loads `marked` and `dompurify` from shared/lib on first open.
//
// SLIDE HELP
// ----------
// If the app has a help deck at `./help/deck.json` it opens as slides, with a
// "Read as text" toggle back to the full markdown. Apps opt in simply by
// having the file — no call-site change — so building decks with
// tools/help-decks.mjs upgrades every app that already uses this dialog.
//
// If the deck is missing or fails to load, this behaves exactly as it always
// did: the markdown, rendered. That fallback is why a bad deck can never take
// an app's help away.

import { html } from 'htm/preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { SlideHelp } from './SlideHelp.js';

let _marked = null;
let _purify = null;
async function loadMarkdownLibs() {
  if (!_marked) {
    const mod = await import('../lib/marked/12/index.mjs');
    _marked = mod.marked || mod.default || mod;
  }
  if (!_purify) {
    const mod = await import('../lib/dompurify/3/index.mjs');
    _purify = mod.default || mod;
  }
  return { marked: _marked, purify: _purify };
}

export function HelpDialog({ src, markdown, deckSrc = './help/deck.json', title = 'Help', onClose }) {
  const [rawMd, setRawMd] = useState(markdown || '');
  const [renderedHtml, setRenderedHtml] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!markdown);

  // null = still looking, false = no deck (text only), object = deck
  const [deck, setDeck] = useState(deckSrc ? null : false);
  const [mode, setMode] = useState('slides');   // 'slides' | 'text'

  // Look for a slide deck. A miss is completely normal — most apps won't have
  // one — so it is never surfaced as an error.
  useEffect(() => {
    if (!deckSrc) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(deckSrc, { cache: 'no-cache' });
        if (!res.ok) throw new Error(String(res.status));
        const parsed = await res.json();
        const usable = parsed && Array.isArray(parsed.slides) && parsed.slides.length > 0;
        if (!cancelled) setDeck(usable ? parsed : false);
      } catch {
        if (!cancelled) setDeck(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deckSrc]);

  // An app may ship a deck and no markdown at all (its whole help is the
  // walkthrough). Without this it would sit on "Loading…" forever, because the
  // fetch effect below bails out and never clears the flag.
  useEffect(() => {
    if (!markdown && !src) setLoading(false);
  }, [markdown, src]);

  // Warm marked/dompurify as soon as the dialog opens rather than waiting for
  // the deck to arrive first — slides cannot render until DOMPurify has
  // sanitised them, so the import is on the critical path either way. Both
  // modules are small and the loader memoises, so this costs one idle fetch.
  useEffect(() => { loadMarkdownLibs().catch(() => {}); }, []);

  // Fetch markdown if a src URL was supplied.
  useEffect(() => {
    if (markdown || !src) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const text = await res.text();
        if (!cancelled) setRawMd(text);
      } catch (e) {
        if (!cancelled) setError(`Failed to load help: ${e.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [src, markdown]);

  // Render markdown → sanitised HTML.
  useEffect(() => {
    if (!rawMd) return;
    let cancelled = false;
    (async () => {
      try {
        const { marked, purify } = await loadMarkdownLibs();
        const dirty = marked.parse(rawMd, { gfm: true, breaks: false });
        const clean = purify.sanitize(dirty, { ADD_ATTR: ['target', 'rel'] });
        if (!cancelled) setRenderedHtml(clean);
      } catch (e) {
        if (!cancelled) setError(`Failed to render help: ${e.message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [rawMd]);

  // Sanitise deck slide bodies with the same policy as the markdown path.
  // Deck HTML is generated from in-repo content, but it lands in the page via
  // innerHTML, so it goes through DOMPurify like everything else.
  const [safeDeck, setSafeDeck] = useState(null);
  useEffect(() => {
    if (!deck) { setSafeDeck(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { purify } = await loadMarkdownLibs();
        const slides = deck.slides.map((s) => ({
          ...s,
          html: purify.sanitize(s.html || '', { ADD_ATTR: ['target', 'rel'] }),
        }));
        if (!cancelled) setSafeDeck({ ...deck, slides });
      } catch {
        if (!cancelled) setSafeDeck(false);   // fall back to text
      }
    })();
    return () => { cancelled = true; };
  }, [deck]);

  // ── expand to fullscreen ────────────────────────────────────────────────
  const dialogRef = useRef(null);
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback(async () => {
    const el = dialogRef.current;
    if (expanded) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setExpanded(false);
      return;
    }
    // Real fullscreen where it's allowed; otherwise just fill the viewport.
    // The Fullscreen API can be refused (permissions policy, an embedding
    // iframe), and losing the toggle entirely would be worse than a dialog
    // that merely covers the window.
    try { await el?.requestFullscreen(); } catch { /* CSS fallback below */ }
    setExpanded(true);
  }, [expanded]);

  // Stay in sync when fullscreen ends by some other route — Esc, F11, or the
  // browser dropping out of it.
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setExpanded(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Escape backs out one level at a time: leave fullscreen first, close second.
  // When the browser is handling the fullscreen exit itself this never sees the
  // key, which is why the fullscreenElement check comes first.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        if (!typing) { e.preventDefault(); toggleExpanded(); }
        return;
      }
      if (e.key !== 'Escape') return;
      if (document.fullscreenElement) return;      // the browser exits fullscreen
      if (expanded) { setExpanded(false); return; }
      onClose?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, expanded, toggleExpanded]);

  // Leaving fullscreen behind when the dialog unmounts would strand the page.
  useEffect(() => () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const stop = useCallback((e) => e.stopPropagation(), []);

  const hasDeck = !!(safeDeck && safeDeck.slides?.length);
  // Only offer "Read as text" when there is actually text behind it.
  const hasText = !!(markdown || src);
  const showSlides = hasDeck && mode === 'slides';
  // Slide images are stored beside deck.json, so resolve them against it.
  const deckBaseUrl = new URL(deckSrc || './help/deck.json', window.location.href).href;

  return html`
    <div class="modal-overlay">
      <div class=${`modal help-dialog ${expanded ? 'is-expanded' : ''}`} ref=${dialogRef} onClick=${stop}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-circle-question" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>${title}</h2>
          <div class="help-dialog-actions">
            <button
              class="btn-icon"
              onClick=${toggleExpanded}
              title=${expanded ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              aria-pressed=${expanded ? 'true' : 'false'}
            >
              <i class=${`fa-solid ${expanded ? 'fa-compress' : 'fa-expand'}`}></i>
            </button>
            <button class="btn-icon" onClick=${onClose} title="Close (Esc)">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
        <div class=${`modal-body help-dialog-body ${showSlides ? 'is-slides' : ''}`}>
          ${showSlides && html`
            <${SlideHelp}
              deck=${safeDeck}
              baseUrl=${deckBaseUrl}
              onReadAsText=${hasText ? () => setMode('text') : null}
            />
          `}

          ${!showSlides && html`
            ${error && html`<div class="help-error"><i class="fa-solid fa-circle-exclamation"></i> ${error}</div>`}
            ${!error && loading && html`<div class="help-loading">Loading…</div>`}
            ${!error && !loading && !hasText && !hasDeck && html`
              <div class="help-loading">No help is available for this app yet.</div>
            `}
            ${!error && !loading && hasText && html`
              <div class="help-content" dangerouslySetInnerHTML=${{ __html: renderedHtml }}></div>
            `}
            ${hasDeck && html`
              <div class="help-back-to-slides">
                <button class="btn" onClick=${() => setMode('slides')}>
                  <i class="fa-solid fa-images"></i> Back to slides
                </button>
              </div>
            `}
          `}
        </div>
      </div>
    </div>
  `;
}
