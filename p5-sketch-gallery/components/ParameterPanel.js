import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// Edit params as JSON, plus inline numeric sliders for top-level number values.
export function ParameterPanel({
  params,
  onParamsChange,
  seed,
  onSeedChange,
  onRandomSeed,
  playing,
  onTogglePlay,
  onRestart,
  notes,
  onNotesChange,
  tags,
  onTagsChange,
  runtimeStatus,
  onSyncParams,
  onExplain,
  onProposeRemix,
  remixSuggestions,
  onApplyRemix,
}) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(params || {}, null, 2));
  const [jsonErr, setJsonErr] = useState('');

  // Sync external params -> textarea (only if text doesn't already match)
  useEffect(() => {
    let parsed;
    try { parsed = JSON.parse(jsonText); } catch (e) { return; }
    if (JSON.stringify(parsed) !== JSON.stringify(params || {})) {
      setJsonText(JSON.stringify(params || {}, null, 2));
    }
  }, [params]);

  const applyJson = (text) => {
    setJsonText(text);
    try {
      const v = JSON.parse(text);
      setJsonErr('');
      onParamsChange(v);
    } catch (e) {
      setJsonErr(e.message);
    }
  };

  const numericKeys = Object.entries(params || {}).filter(([, v]) => typeof v === 'number');

  return html`
    <div class="param-panel">
      <div class="panel-section">
        <div class="panel-title">
          <i class="fa-solid fa-play"></i> Playback
        </div>
        <div class="row">
          <button class="btn" onClick=${onTogglePlay}>
            <i class=${`fa-solid ${playing ? 'fa-pause' : 'fa-play'}`}></i>
            ${playing ? 'Pause' : 'Play'}
          </button>
          <button class="btn" onClick=${onRestart} title="Restart sketch">
            <i class="fa-solid fa-rotate-right"></i> Restart
          </button>
        </div>
        <div class="row" style=${{ marginTop: '8px' }}>
          <label class="label">Seed</label>
          <input
            class="form-input mono"
            type="number"
            value=${seed}
            onInput=${(e) => onSeedChange(parseInt(e.target.value, 10) || 1)}
            style=${{ width: '120px' }}
          />
          <button class="btn-icon" onClick=${onRandomSeed} title="Randomize seed">
            <i class="fa-solid fa-dice"></i>
          </button>
        </div>
        ${runtimeStatus && html`<div class="status-line">${runtimeStatus}</div>`}
      </div>

      <div class="panel-section">
        <div class="panel-title">
          <i class="fa-solid fa-sliders"></i> Parameters
          ${onSyncParams && html`
            <button
              class="btn-icon panel-title-action"
              onClick=${onSyncParams}
              title="Rebuild this panel from the ctx.params the sketch actually reads"
            ><i class="fa-solid fa-arrows-rotate"></i></button>
          `}
        </div>
        ${numericKeys.length === 0 && html`
          <div class="param-empty">
            This sketch reads no <code>ctx.params</code> values — nothing to tune.
          </div>
        `}
        ${numericKeys.length > 0 && html`
          <div class="param-sliders">
            ${numericKeys.map(([k, v]) => html`
              <div class="slider-row" key=${k}>
                <label>${k}</label>
                <input
                  type="range"
                  min=${Math.min(0, v) - Math.abs(v)}
                  max=${Math.max(1, Math.abs(v) * 3)}
                  step=${Math.abs(v) < 1 ? 0.01 : 1}
                  value=${v}
                  onInput=${(e) => onParamsChange({ ...params, [k]: parseFloat(e.target.value) })}
                />
                <span class="mono small">${v}</span>
              </div>
            `)}
          </div>
        `}
        <textarea
          class="param-json"
          value=${jsonText}
          onInput=${(e) => applyJson(e.target.value)}
        ></textarea>
        ${jsonErr && html`<div class="json-err"><i class="fa-solid fa-triangle-exclamation"></i> ${jsonErr}</div>`}
      </div>

      <div class="panel-section">
        <div class="panel-title">
          <i class="fa-solid fa-tags"></i> Tags
        </div>
        <input
          class="form-input"
          type="text"
          value=${(tags || []).join(', ')}
          placeholder="comma, separated, tags"
          onInput=${(e) => onTagsChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
        />
      </div>

      <div class="panel-section">
        <div class="panel-title">
          <i class="fa-solid fa-pen"></i> Notes
        </div>
        <textarea
          class="form-input"
          rows="3"
          value=${notes || ''}
          onInput=${(e) => onNotesChange(e.target.value)}
          placeholder="What were you going for?"
        ></textarea>
      </div>

      <div class="panel-section">
        <div class="panel-title">
          <i class="fa-solid fa-wand-magic-sparkles"></i> AI helpers
        </div>
        <div class="row">
          <button class="btn" onClick=${onExplain} title="Explain this sketch">
            <i class="fa-solid fa-lightbulb"></i> Explain
          </button>
          <button class="btn" onClick=${onProposeRemix} title="Propose parameter remixes">
            <i class="fa-solid fa-shuffle"></i> Remix params
          </button>
        </div>
        ${(remixSuggestions || []).length > 0 && html`
          <div class="remix-list">
            ${remixSuggestions.map((r, i) => html`
              <button class="btn remix-chip" key=${i} onClick=${() => onApplyRemix(r)} title=${JSON.stringify(r.params)}>
                ${r.name || `Remix ${i + 1}`}
              </button>
            `)}
          </div>
        `}
      </div>
    </div>
  `;
}
