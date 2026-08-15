import { html } from 'htm/preact';
import { sendToCodeMorphLab } from '../../shared/services/code-morph-handoff.js';

export function SubmissionList({
  benchmark,
  submissions,
  onBack,
  onAddSubmission,
  onCompare,
  onSelectSubmission,
  onDeleteSubmission,
  onDeleteBenchmark,
  allowHandoffs = true,
}) {
  const hasSubmissions = submissions && submissions.length > 0;

  return html`
    <div class="submission-list-view">
      <div class="submission-header">
        <button class="btn" onClick=${onBack}>
          <i class="fa-solid fa-arrow-left"></i>
          <span class="btn-label">Back</span>
        </button>
        <div class="submission-header-info">
          <h2 class="submission-title">${benchmark?.prompt || benchmark?.slug}</h2>
          <div class="submission-meta-row">
            ${benchmark?.meta?.category && html`<span class="tag-chip">${benchmark.meta.category}</span>`}
            ${benchmark?.meta?.difficulty && html`<span class="tag-chip difficulty-${benchmark.meta.difficulty}">${benchmark.meta.difficulty}</span>`}
          </div>
        </div>
        <div class="submission-header-actions">
          <button class="btn btn-primary" onClick=${onAddSubmission}>
            <i class="fa-solid fa-plus"></i>
            <span class="btn-label">Add Submission</span>
          </button>
          ${allowHandoffs && benchmark?.prompt && html`
            <button class="btn" onClick=${() => sendToCodeMorphLab({
              source: 'svg-benchmark',
              kind: 'prompt',
              title: (benchmark.prompt || '').slice(0, 60),
              prompt: benchmark.prompt,
              language: 'html',
              meta: {
                benchmarkSlug: benchmark.slug,
                sourceId: benchmark.slug,
              },
            })} title="Send prompt to Code Morph Lab">
              <i class="fa-solid fa-wand-magic-sparkles"></i> <span class="btn-label">Morph</span>
            </button>
          `}
          ${hasSubmissions && html`
            <button class="btn" onClick=${onCompare}>
              <i class="fa-solid fa-columns"></i>
              <span class="btn-label">Compare All</span>
            </button>
          `}
          <button class="btn btn-danger" onClick=${onDeleteBenchmark} title="Delete benchmark">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      ${benchmark?.referenceUrl && html`
        <div class="submission-reference">
          <div class="section-header">
            <span><i class="fa-solid fa-image"></i> Reference Image</span>
          </div>
          <div class="submission-reference-img-wrap">
            <img src=${benchmark.referenceUrl} alt="Reference" class="submission-reference-img" />
          </div>
        </div>
      `}

      ${hasSubmissions
        ? html`
          <div class="submission-grid">
            ${submissions.map(sub => html`
              <div class="submission-card" key=${sub.id}>
                <div class="submission-card-preview" onClick=${() => onSelectSubmission(sub.id)}>
                  <div class="submission-svg-thumb" dangerouslySetInnerHTML=${{ __html: sub.svg || '' }}></div>
                </div>
                <div class="submission-card-body">
                  <div class="submission-card-title">${sub.model || sub.id}</div>
                  <div class="submission-card-scores">
                    ${sub.autoScore != null && html`
                      <span class="score-badge ${sub.autoScore >= 0.8 ? 'good' : sub.autoScore >= 0.5 ? 'ok' : 'poor'}">
                        <i class="fa-solid fa-bullseye"></i> ${Math.round(sub.autoScore * 100)}%
                      </span>
                    `}
                    ${sub.manualScore > 0 && html`
                      <span class="score-badge manual">
                        <i class="fa-solid fa-star"></i> ${sub.manualScore}/10
                      </span>
                    `}
                  </div>
                  <div class="submission-card-stats">
                    ${sub.elementCount != null && html`<span>${sub.elementCount} elements</span>`}
                    ${sub.fileSize != null && html`<span>${formatSize(sub.fileSize)}</span>`}
                  </div>
                  <div class="submission-card-actions">
                    <button class="btn-icon" onClick=${() => onSelectSubmission(sub.id)} title="View details">
                      <i class="fa-solid fa-expand"></i>
                    </button>
                    ${allowHandoffs && sub.svg && html`
                      <button class="btn-icon" onClick=${(e) => {
                        e.stopPropagation();
                        sendToCodeMorphLab({
                          source: 'svg-benchmark',
                          kind: 'code',
                          title: sub.model || sub.id,
                          prompt: benchmark?.prompt || '',
                          files: [{ name: 'artwork.svg', content: sub.svg }],
                          language: 'html',
                          meta: {
                            benchmarkSlug: benchmark?.slug,
                            sourceId: sub.id,
                            submissionId: sub.id,
                            model: sub.model || sub.id,
                          },
                        });
                      }} title="Morph in Code Morph Lab">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                      </button>
                    `}
                    <button class="btn-icon" onClick=${() => onDeleteSubmission(sub.id)} title="Delete submission">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            `)}
          </div>
        `
        : html`
          <div class="gallery-empty">
            <i class="fa-solid fa-file-code"></i>
            <p>No submissions yet. Generate or paste an SVG to add one.</p>
            <button class="btn btn-primary" onClick=${onAddSubmission}>
              <i class="fa-solid fa-plus"></i> Add Submission
            </button>
          </div>
        `
      }
    </div>
  `;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
