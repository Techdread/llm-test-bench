import { html } from 'htm/preact';
import { useRef, useCallback, useEffect } from 'preact/hooks';

export function ReferencePanel({ referenceUrl, onReferenceChange, attachReference, onToggleAttach, visionSupport }) {
  const dropRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => onReferenceChange(reader.result);
    reader.readAsDataURL(file);
  }, [onReferenceChange]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.add('drag-over');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dropRef.current?.classList.remove('drag-over');
  }, []);

  // Paste from clipboard
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          handleFile(item.getAsFile());
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFile]);

  return html`
    <div class="reference-panel">
      <div class="section-header">
        <span><i class="fa-solid fa-image"></i> Reference</span>
        <div class="section-header-actions">
          ${referenceUrl && html`
            <button class="btn-icon" onClick=${() => onReferenceChange(null)} title="Remove reference">
              <i class="fa-solid fa-trash"></i>
            </button>
          `}
          <button class="btn-icon" onClick=${() => fileInputRef.current?.click()} title="Upload image">
            <i class="fa-solid fa-upload"></i>
          </button>
        </div>
      </div>
      <div
        class="reference-drop-zone"
        ref=${dropRef}
        onDrop=${handleDrop}
        onDragOver=${handleDragOver}
        onDragLeave=${handleDragLeave}
        onClick=${() => !referenceUrl && fileInputRef.current?.click()}
      >
        ${referenceUrl
          ? html`<img class="reference-image" src=${referenceUrl} alt="Reference" />`
          : html`
            <div class="reference-placeholder">
              <i class="fa-solid fa-cloud-arrow-up"></i>
              <p>Drop image, paste from clipboard, or click to upload</p>
              <span class="reference-hint">PNG, JPG, or other image formats</span>
            </div>
          `
        }
      </div>
      ${referenceUrl && onToggleAttach && html`
        <label class="reference-attach">
          <input
            type="checkbox"
            checked=${!!attachReference}
            onChange=${(e) => onToggleAttach(e.target.checked)}
          />
          <span>Send reference to model (vision)</span>
        </label>
        ${attachReference && visionSupport === false && html`
          <p class="reference-attach-warn">
            <i class="fa-solid fa-triangle-exclamation"></i>
            Selected model isn't vision-capable — generation will fail. Pick a vision model.
          </p>
        `}
        ${attachReference && visionSupport === null && html`
          <p class="reference-attach-hint">
            Vision support unknown for this model — it'll be attempted anyway.
          </p>
        `}
      `}
      <input
        ref=${fileInputRef}
        type="file"
        accept="image/*"
        style="display: none"
        onChange=${(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  `;
}
