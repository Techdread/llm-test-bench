import { html } from 'htm/preact';
import { versionLabel } from '../services/projectStore.js';

const VIEW_LABELS = ['Front', 'Side', 'Back', 'Walk', 'Crouch', 'Arm bend'];

export function ReviewPanel({
  versions, selectedVersion, onSelectVersion, review, views, onZoom,
  animation, onAnimation, onPlay, onSpeed, onAdjustRig,
  exportContent, onExportContent,
  cleanup, cleanupReady, exportVariant, onExportVariant,
  onExport, onExportAll, onExportFBX, onSendBlender, onScreenshot,
  blender, exporting, hasModel, busy,
}) {
  const verdict = !review
    ? html`<span class="us-verdict none">Not yet reviewed</span>`
    : review.approved
      ? html`<span class="us-verdict ok"><i class="fas fa-check"></i> Reviewed by the model</span>`
      : html`<span class="us-verdict no"><i class="fas fa-rotate"></i> Needs refinement</span>`;

  return html`
    <div class="us-rail us-rail-right">
      <div class="us-section">
        <h3>Visual review</h3>
        ${verdict}
        <p class="us-note">
          ${review?.summary
            || 'The generating model compares your reference with front, side and back renders of what it actually built.'}
        </p>
        ${review?.issues?.length > 0 && html`
          <ul class="us-issues">${review.issues.map((issue, i) => html`<li key=${i}>${issue}</li>`)}</ul>`}
        ${views.length > 0 && html`
          <div class="us-views">
            ${views.map((src, index) => html`
              <figure key=${index}>
                <img src=${src} alt=${VIEW_LABELS[index] || `View ${index + 1}`}
                     onClick=${() => onZoom(src)} />
                <figcaption>${VIEW_LABELS[index] || `View ${index + 1}`}</figcaption>
              </figure>`)}
          </div>`}
        ${review && !review.approved && html`
          <p class="us-note">A model's approval is its own assessment, not proof of fidelity. Hidden sides are inferred.</p>`}
      </div>

      <div class="us-section">
        <h3>Versions</h3>
        <label class="us-field">
          <select value=${String(selectedVersion)} disabled=${busy || !versions.length}
                  onChange=${e => onSelectVersion(Number(e.target.value))}>
            ${versions.length === 0
              ? html`<option value="-1">No versions yet</option>`
              : versions.map((version, index) => html`
                  <option key=${index} value=${String(index)}>${versionLabel(version, index)}</option>`)}
          </select>
        </label>
        <p class="us-note">
          Generating from an older version branches from it. Up to 30 versions are kept per project.
        </p>
      </div>

      ${cleanup}

      ${animation?.rigged && html`
        <div class="us-section">
          <h3>Animation</h3>
          <label class="us-field">Clip
            <select value=${animation.selected} onChange=${e => onAnimation(e.target.value)}>
              <option value="">Rest pose (T-pose)</option>
              ${animation.clips.map(clip => html`<option key=${clip} value=${clip}>${clip}</option>`)}
            </select>
          </label>
          <div class="us-exports">
            <button class="us-btn us-btn-sm" disabled=${!animation.selected}
                    onClick=${() => onPlay(!animation.playing)}>
              <i class=${`fas ${animation.playing ? 'fa-pause' : 'fa-play'}`}></i>
              ${animation.playing ? 'Pause' : 'Play'}
            </button>
            <select class="us-btn us-btn-sm" value=${String(animation.speed)}
                    onChange=${e => onSpeed(Number(e.target.value))}>
              <option value="0.5">0.5×</option><option value="1">1×</option>
              <option value="1.5">1.5×</option><option value="2">2×</option>
            </select>
            <button class="us-btn us-btn-sm" disabled=${busy} onClick=${onAdjustRig}>
              <i class="fas fa-sliders"></i> Adjust rig
            </button>
          </div>
          <label class="us-field">Export content
            <select value=${exportContent} onChange=${e => onExportContent(e.target.value)}>
              <option value="animated">Animated mesh · selected clip</option>
              <option value="rigged">Rigged T-pose · no clip</option>
              <option value="static">Static T-pose · no skeleton</option>
            </select>
          </label>
          <p class="us-note">
            87 clips from <a href="https://github.com/Mesh2Motion/mesh2motion-app" target="_blank" rel="noopener noreferrer">Mesh2Motion</a>.
            Hands move as whole hands. Check joint bends before export.
          </p>
        </div>`}

      <div class="us-section">
        <h3>Export</h3>
        ${cleanupReady && html`
          <label class="us-field">Which levels
            <select value=${exportVariant} onChange=${e => onExportVariant(e.target.value)}>
              <option value="both">Original + cleaned (both)</option>
              <option value="original">Original only</option>
              <option value="cleaned">Cleaned only</option>
            </select>
          </label>`}
        <div class="us-exports">
          <button class="us-btn us-btn-sm" disabled=${!hasModel || exporting} onClick=${onExport}>
            <i class="fas fa-download"></i> Selected .glb
          </button>
          <button class="us-btn us-btn-sm" disabled=${!hasModel || exporting} onClick=${onExportAll}>
            <i class="fas fa-file-zipper"></i> All levels .zip
          </button>
          <button class="us-btn us-btn-sm"
                  disabled=${!hasModel || exporting || !blender.convert}
                  title=${blender.convert ? `Convert with ${blender.version}` : blender.reason}
                  onClick=${onExportFBX}>
            <i class="fas fa-cubes"></i> Selected .fbx
          </button>
          <button class="us-btn us-btn-sm" disabled=${!hasModel || exporting}
                  title="Add the selected level to a Blender you already have open"
                  onClick=${onSendBlender}>
            <i class="fas fa-share-from-square"></i> Send to Blender
          </button>
          <button class="us-btn us-btn-sm" disabled=${!hasModel || exporting} onClick=${onScreenshot}>
            <i class="fas fa-camera"></i> PNG
          </button>
        </div>
        <p class="us-note">
          Exports always use the original textured materials and the bind pose, whatever the viewport shows.
          ${cleanupReady && ' Cleaned files carry a -clean suffix; nothing replaces an original.'}
          ${!blender.convert && html` FBX needs a local Blender: ${blender.reason}`}
        </p>
      </div>
    </div>`;
}
