import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { GamePreview } from './GamePreview.js';
import { getProjectHandle, readRunArtifact } from '../services/runStore.js';
import { getAllPrompts } from '../services/library.js';
import { getAllLanes, laneLabel } from '../services/lanes.js';
import {
  BASE_COLUMN, MATRIX_METRICS, buildVariantMatrix, columnAverage, loadAllRuns, runMetric,
} from '../services/variantMatrix.js';

const MAX_COMPARE = 6;

/** A run's saved validation screenshot, as an object URL. */
function RunThumb({ run }) {
  const [url, setUrl] = useState('');
  const revokeRef = useRef('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const file = await readRunArtifact(run.runDir, 'preview.png');
      if (cancelled || !file) return;
      const next = URL.createObjectURL(file);
      revokeRef.current = next;
      setUrl(next);
    })();
    return () => {
      cancelled = true;
      if (revokeRef.current) URL.revokeObjectURL(revokeRef.current);
      revokeRef.current = '';
    };
  }, [run.runId]);
  if (!url) return html`<div class="gf-matrix-thumb gf-matrix-thumb-empty"><i class="fas fa-image"></i></div>`;
  return html`<img class="gf-matrix-thumb" src=${url} alt="" loading="lazy" />`;
}

/**
 * The (game × lane) grid — the view the whole spec exists for.
 *
 * Deliberately not styled as a leaderboard. Model nondeterminism between two
 * runs of one cell routinely exceeds the difference between two lanes, so every
 * cell reports how many runs are behind it and a single-run cell is marked
 * provisional. This is an instrument for noticing differences worth looking at
 * by hand, not a benchmark table.
 */
export function MatrixView({ domainAdapter, onBuild }) {
  const [runs, setRuns] = useState([]);
  const [lanes, setLanes] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [metric, setMetric] = useState('rubric');
  const [loading, setLoading] = useState(true);
  const [compare, setCompare] = useState(null);
  const [selected, setSelected] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [allRuns, allLanes, allPrompts] = await Promise.all([
          loadAllRuns(), getAllLanes(), getAllPrompts(),
        ]);
        setRuns(allRuns);
        setLanes(allLanes);
        setPrompts(allPrompts);
      } catch (error) { setMessage(`Could not read runs: ${error.message}`); }
      setLoading(false);
    })();
  }, []);

  const { rows, columns } = buildVariantMatrix(runs, id => laneLabel(lanes, id));
  const metricSpec = MATRIX_METRICS.find(item => item.id === metric) || MATRIX_METRICS[0];

  const openCompare = async row => {
    const picks = columns
      .map(column => row.cells.get(column.id)?.best)
      .filter(Boolean)
      .slice(0, MAX_COMPARE);
    const loaded = await Promise.all(picks.map(async run => {
      const { projectHandle } = await getProjectHandle(run.gameSlug, run.runId);
      return { ...run, projectHandle };
    }));
    setSelected(loaded);
    setCompare(row);
  };

  /** Build the missing cell — only possible once its variant prompt exists. */
  const buildCell = (row, laneId) => {
    const wanted = laneId === BASE_COLUMN
      ? prompts.find(prompt => prompt.id === row.id)
      : prompts.find(prompt => prompt.derivation?.laneId === laneId
        && prompt.derivation?.parentPromptId === row.id);
    if (!wanted) {
      setMessage(`No ${laneId === BASE_COLUMN ? 'base' : laneLabel(lanes, laneId)} prompt for "${row.title}" — create it from the Library with Create variants.`);
      return;
    }
    onBuild(wanted);
  };

  if (compare) {
    return html`
      <div class="gf-matrix">
        <div class="gf-runs-head">
          <button class="gf-btn" onClick=${() => { setCompare(null); setSelected([]); }}>
            <i class="fas fa-arrow-left"></i> Matrix
          </button>
          <h2>${compare.title}</h2>
          <span class="gf-hint">${selected.length} lane${selected.length === 1 ? '' : 's'} side by side</span>
        </div>
        <div class="gf-matrix-compare">
          ${selected.map(run => html`
            <div class="gf-matrix-compare-cell" key=${run.runId}>
              <header>
                <strong>${run.meta?.laneId ? laneLabel(lanes, run.meta.laneId) : 'Base prompt'}</strong>
                <span class=${`gf-run-status status-${run.meta?.status || 'legacy'}`}>${run.meta?.status || 'legacy'}</span>
              </header>
              <${GamePreview} projectHandle=${run.projectHandle} nonce=${0}
                stack=${run.meta?.targetStack || 'web'} domainAdapter=${domainAdapter} />
              <div class="gf-matrix-compare-meta">
                ${MATRIX_METRICS.map(item => {
                  const value = runMetric(run.meta, item.id);
                  return html`<span key=${item.id}>${item.label}: <b>${item.format(value)}</b></span>`;
                })}
              </div>
              ${run.meta?.variantMode && html`
                <div class="gf-matrix-mode">${run.meta.variantMode === 'held-constant'
                  ? 'held constant — only the library differs'
                  : `adapted · ${run.meta.variantMode}`}</div>`}
            </div>`)}
          ${selected.length === 0 && html`<div class="gf-empty">No runs to compare yet.</div>`}
        </div>
      </div>`;
  }

  return html`
    <div class="gf-matrix">
      <div class="gf-runs-head">
        <h2>Library matrix</h2>
        <label class="gf-matrix-metric">Metric
          <select value=${metric} onChange=${event => setMetric(event.target.value)}>
            ${MATRIX_METRICS.map(item => html`<option value=${item.id}>${item.label}</option>`)}
          </select>
        </label>
      </div>
      <p class="gf-matrix-caveat">
        Each cell shows its best run and how many runs are behind it. One run proves nothing —
        nondeterminism between two runs of the same cell is routinely larger than the difference
        between two lanes, and fewer turns on a batteries-included engine measures the engine's
        scope rather than the model's competence.
      </p>
      ${message && html`<div class="gf-library-message">${message}</div>`}
      ${loading && html`<div class="gf-empty">Reading runs…</div>`}
      ${!loading && rows.length === 0 && html`
        <div class="gf-empty">
          No runs yet. Create variants from the Library, then build a few lanes of the same game.
        </div>`}
      ${rows.length > 0 && html`
        <div class="gf-matrix-scroll">
          <table class="gf-matrix-table">
            <thead>
              <tr>
                <th class="gf-matrix-corner">Game</th>
                ${columns.map(column => html`
                  <th key=${column.id}>
                    <div>${column.label}</div>
                    <small>${metricSpec.format(columnAverage(rows, column.id, metric))} avg · ${column.runs} run${column.runs === 1 ? '' : 's'}</small>
                  </th>`)}
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => html`
                <tr key=${row.id}>
                  <th class="gf-matrix-rowhead">
                    <button class="gf-btn" onClick=${() => openCompare(row)} title="Compare every lane side by side">
                      ${row.title || row.id}
                    </button>
                  </th>
                  ${columns.map(column => {
                    const cell = row.cells.get(column.id);
                    if (!cell) {
                      return html`
                        <td class="gf-matrix-cell gf-matrix-cell-empty" key=${column.id}>
                          <button class="gf-btn" onClick=${() => buildCell(row, column.id)}>
                            <i class="fas fa-hammer"></i> Build
                          </button>
                        </td>`;
                    }
                    const value = runMetric(cell.best.meta, metric);
                    return html`
                      <td class=${`gf-matrix-cell status-${cell.best.meta?.status || 'legacy'}`} key=${column.id}>
                        <${RunThumb} run=${cell.best} />
                        <div class="gf-matrix-cell-meta">
                          <span class=${`gf-run-status status-${cell.best.meta?.status || 'legacy'}`}>
                            ${cell.best.meta?.status || 'legacy'}
                          </span>
                          <b>${metricSpec.format(value)}</b>
                        </div>
                        <small class=${cell.runs.length < 2 ? 'gf-matrix-provisional' : ''}>
                          ${cell.runs.length} run${cell.runs.length === 1 ? ' · provisional' : 's'}
                        </small>
                      </td>`;
                  })}
                </tr>`)}
            </tbody>
          </table>
        </div>`}
    </div>`;
}
