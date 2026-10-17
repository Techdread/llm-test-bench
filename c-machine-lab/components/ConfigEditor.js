import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { defaultConfig, mergeConfig, validateConfig } from '../services/config.js';

export function ConfigEditor({ config, onSave, onClose }) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [errors, setErrors] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parseConfig = () => {
    try {
      const merged = mergeConfig(JSON.parse(text));
      const errs = validateConfig(merged);
      return { cfg: merged, errors: errs };
    } catch (err) {
      return { cfg: null, errors: [`JSON parse error: ${err.message}`] };
    }
  };

  const save = () => {
    const result = parseConfig();
    if (result.errors.length) return setErrors(result.errors);
    onSave(result.cfg);
  };

  const exportConfig = () => {
    const result = parseConfig();
    if (result.errors.length) return setErrors(result.errors);
    const blob = new Blob([JSON.stringify(result.cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'c-machine-lab-config.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importFile = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
    event.target.value = '';
  };

  return html`
    <div class="cfg-backdrop">
      <div class="cfg-dialog" onClick=${event => event.stopPropagation()}>
        <div class="cfg-header">
          <h3><i class="fa-solid fa-sliders"></i> Machine Config</h3>
          <button class="btn-icon" onClick=${onClose} title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <p class="cfg-hint">Edit memory layout, trace retention, heap behavior, runtime limits, and teaching safety settings. Save rebuilds the VM.</p>
        <textarea class="cfg-textarea" spellcheck="false" value=${text} onInput=${e => { setText(e.target.value); setErrors([]); }}></textarea>
        ${errors.length > 0 && html`<ul class="cfg-errors">${errors.map(err => html`<li key=${err}>${err}</li>`)}</ul>`}
        <div class="cfg-footer">
          <button class="btn" onClick=${() => { setText(JSON.stringify(defaultConfig(), null, 2)); setErrors([]); }}><i class="fa-solid fa-rotate-left"></i> Defaults</button>
          <button class="btn" onClick=${() => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch (err) { setErrors([err.message]); } }}><i class="fa-solid fa-indent"></i> Format</button>
          <button class="btn" onClick=${() => inputRef.current?.click()}><i class="fa-solid fa-file-import"></i> Import</button>
          <button class="btn" onClick=${exportConfig}><i class="fa-solid fa-file-export"></i> Export</button>
          <input ref=${inputRef} type="file" accept="application/json,.json" style="display:none" onChange=${importFile} />
          <div class="cfg-spacer"></div>
          <button class="btn" onClick=${onClose}>Cancel</button>
          <button class="btn btn-primary" onClick=${save}><i class="fa-solid fa-check"></i> Save & Rebuild</button>
        </div>
      </div>
    </div>
  `;
}
