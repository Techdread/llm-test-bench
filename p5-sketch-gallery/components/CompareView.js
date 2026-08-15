import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CanvasPreview } from './CanvasPreview.js';
import { loadProject } from '../services/storage/projectStore.js';

// Synced multi-sketch comparison. Up to 4 panes.
export function CompareView({
  projects,
  compareIds,
  onCompareIdsChange,
  rootHandle,
}) {
  const [loaded, setLoaded] = useState({}); // id -> { code, params }
  const [seed, setSeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const apisRef = useRef({}); // id -> api

  // Initialize seed from first available project (deterministic playback)
  useEffect(() => {
    if (compareIds.length && Number.isFinite(loaded[compareIds[0]]?.metadata?.seed)) {
      setSeed(loaded[compareIds[0]].metadata.seed);
    }
  }, [compareIds.length]);

  // Lazy-load each compare project's code/params
  useEffect(() => {
    if (!rootHandle) return;
    let canceled = false;
    (async () => {
      for (const id of compareIds) {
        if (loaded[id]) continue;
        try {
          const proj = await loadProject(rootHandle, id);
          if (canceled) return;
          setLoaded(prev => ({ ...prev, [id]: proj }));
        } catch (e) { /* skip */ }
      }
    })();
    return () => { canceled = true; };
  }, [compareIds, rootHandle]);

  const remove = (id) => onCompareIdsChange(compareIds.filter(x => x !== id));
  const addable = projects.filter(p => !compareIds.includes(p.id));

  const broadcast = (fn) => {
    for (const id of compareIds) {
      const api = apisRef.current[id];
      if (api) fn(api);
    }
  };

  const handleSeed = (v) => {
    setSeed(v);
    broadcast(api => api.applySeed(v));
  };

  const handlePlayPause = () => {
    setPlaying(p => {
      const next = !p;
      broadcast(api => next ? api.play() : api.pause());
      return next;
    });
  };

  const handleRestart = () => {
    broadcast(api => api.restart());
  };

  const cols = Math.min(4, Math.max(1, compareIds.length));

  return html`
    <div class="compare-screen">
      <div class="compare-toolbar">
        <button class="btn" onClick=${handlePlayPause}>
          <i class=${`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`}></i>
          ${playing ? 'Pause all' : 'Play all'}
        </button>
        <button class="btn" onClick=${handleRestart}>
          <i class="fa-solid fa-rotate-right"></i> Restart all
        </button>
        <label class="label">Seed</label>
        <input
          class="form-input mono"
          type="number"
          value=${seed}
          onInput=${(e) => handleSeed(parseInt(e.target.value, 10) || 1)}
          style=${{ width: '120px' }}
        />
        <select
          class="form-input"
          value=""
          onChange=${(e) => {
            const id = e.target.value;
            if (id && compareIds.length < 4) onCompareIdsChange([...compareIds, id]);
            e.target.value = '';
          }}
          disabled=${compareIds.length >= 4}
        >
          <option value="">+ Add sketch (${compareIds.length}/4)</option>
          ${addable.map(p => html`<option key=${p.id} value=${p.id}>${p.title}</option>`)}
        </select>
      </div>

      ${compareIds.length === 0 ? html`
        <div class="gallery-empty">
          <i class="fa-solid fa-columns"></i>
          <p>Pick 2–4 sketches from the gallery to compare side by side.</p>
        </div>
      ` : html`
        <div class="compare-grid" style=${{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          ${compareIds.map(id => {
            const p = projects.find(x => x.id === id);
            const proj = loaded[id];
            return html`
              <div class="compare-pane" key=${id}>
                <div class="pane-header">
                  <span class="pane-title">${p?.title || id}</span>
                  <button class="btn-icon" onClick=${() => remove(id)} title="Remove">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>
                <div class="pane-canvas">
                  ${proj
                    ? html`<${CanvasPreview}
                        code=${proj.code}
                        params=${proj.params || {}}
                        seed=${seed}
                        playing=${playing}
                        registerApi=${(api) => { apisRef.current[id] = api; }}
                      />`
                    : html`<div class="gallery-empty"><i class="fa-solid fa-spinner fa-spin"></i></div>`}
                </div>
              </div>
            `;
          })}
        </div>
      `}
    </div>
  `;
}
