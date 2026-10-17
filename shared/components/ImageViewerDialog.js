import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Floating, draggable, zoomable image dialog. Used to preview the
 * test-paper or answer-sheet page at full size while the parent reviews
 * the LLM's marking decision.
 *
 * - Click the header to drag.
 * - Zoom buttons or `+` / `-` keys to scale.
 * - Mouse-wheel over the image to zoom around the cursor.
 * - `Escape` closes.
 * - The bottom-right corner is a native CSS `resize` handle.
 */
export function ImageViewerDialog({ src, title, onClose, initialSize }) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(40, Math.round(window.innerWidth * 0.18)),
    y: Math.max(40, Math.round(window.innerHeight * 0.12)),
  }));
  const [scale, setScale] = useState(1);
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const dragRef = useRef(null);
  const sizeAppliedRef = useRef(false);

  // Apply the initial width/height exactly once, via a ref, so React never
  // re-asserts them on subsequent renders. CSS `resize: both` on the dialog
  // is then free to own the size, and dragging won't snap it back.
  useEffect(() => {
    if (sizeAppliedRef.current || !dialogRef.current) return;
    const { w = 760, h = 640 } = initialSize || {};
    dialogRef.current.style.width = w + 'px';
    dialogRef.current.style.height = h + 'px';
    sizeAppliedRef.current = true;
  }, [initialSize]);

  // Drag from header.
  const onHeaderMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const next = {
        x: Math.max(0, Math.min(window.innerWidth - 80, dragRef.current.baseX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, dragRef.current.baseY + dy)),
      };
      setPos(next);
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') setScale(s => Math.min(6, +(s + 0.25).toFixed(2)));
      else if (e.key === '-' || e.key === '_') setScale(s => Math.max(0.25, +(s - 0.25).toFixed(2)));
      else if (e.key === '0') setScale(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Wheel = zoom (with ctrl/cmd or always when over the body).
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) return; // require modifier so scrolling within still works
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale(s => +Math.max(0.25, Math.min(6, s + delta)).toFixed(2));
  };

  return html`
    <div
      class="image-viewer-dialog"
      ref=${dialogRef}
      style=${{
        position: 'fixed',
        left: pos.x + 'px',
        top: pos.y + 'px',
      }}
      role="dialog"
      aria-label=${title || 'Image preview'}
    >
      <header class="image-viewer-header" onMouseDown=${onHeaderMouseDown}>
        <span class="image-viewer-title" title=${title || ''}>
          <i class="fa-solid fa-up-down-left-right" style=${{ marginRight: '6px', opacity: 0.7 }}></i>
          ${title || 'Preview'}
        </span>
        <div class="image-viewer-actions" onMouseDown=${(e) => e.stopPropagation()}>
          <button class="btn-icon" title="Zoom out (-)" onClick=${() => setScale(s => Math.max(0.25, +(s - 0.25).toFixed(2)))}>
            <i class="fa-solid fa-magnifying-glass-minus"></i>
          </button>
          <span class="muted small" style=${{ minWidth: '46px', textAlign: 'center' }}>${Math.round(scale * 100)}%</span>
          <button class="btn-icon" title="Zoom in (+)" onClick=${() => setScale(s => Math.min(6, +(s + 0.25).toFixed(2)))}>
            <i class="fa-solid fa-magnifying-glass-plus"></i>
          </button>
          <button class="btn-icon" title="Reset zoom (0)" onClick=${() => setScale(1)}>
            <i class="fa-solid fa-arrows-rotate"></i>
          </button>
          <button class="btn-icon" title="Close (Esc)" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </header>
      <div class="image-viewer-body" ref=${bodyRef} onWheel=${onWheel}>
        ${src
          ? html`<img
              src=${src}
              alt=${title || 'preview'}
              draggable=${false}
              style=${{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
            />`
          : html`<div class="muted small placeholder">No image to preview.</div>`}
      </div>
      <div class="image-viewer-hint muted small">drag header to move · ctrl/⌘ + scroll to zoom · drag bottom-right to resize</div>
    </div>
  `;
}
