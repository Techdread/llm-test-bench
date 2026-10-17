// The (game × lane) grid of completed runs (spec 327).
//
// Built from run metadata alone. A run outlives the prompt that made it — the
// prompt can be hidden, edited or re-swept — so nothing here reads the library;
// `variantOf` / `laneId` were denormalised into meta at run creation for exactly
// this reason.

import { evaluationAverage } from './projectWorkbench.js';
import { listGames, listRuns } from './runStore.js';

/** The column a run with no lane belongs to: built straight from the base prompt. */
export const BASE_COLUMN = '__base__';
export const BASE_COLUMN_LABEL = 'Base prompt';

// How complete a run is, for picking a cell's representative. Judged before
// rubric score, because a warned run that exists beats a failed one that scored.
const STATUS_RANK = {
  passed: 5, ok: 4, warned: 3, validating: 2, stopped: 1, generating: 1, failed: 0,
};

export const MATRIX_METRICS = Object.freeze([
  { id: 'rubric', label: 'Rubric', format: value => (value == null ? '—' : `${value.toFixed(1)}/5`) },
  { id: 'files', label: 'Files', format: value => (value == null ? '—' : String(value)) },
  { id: 'turns', label: 'Turns', format: value => (value == null ? '—' : String(value)) },
  { id: 'elapsed', label: 'Time', format: value => (value == null ? '—' : `${Math.round(value / 1000)}s`) },
  { id: 'cost', label: 'Cost', format: value => (value == null ? '—' : `$${Number(value).toFixed(2)}`) },
]);

export function runMetric(meta, metric) {
  const telemetry = meta?.telemetry || {};
  switch (metric) {
    case 'rubric': return evaluationAverage(meta?.evaluation);
    case 'files': return telemetry.filesWritten ?? telemetry.files ?? null;
    case 'turns': return telemetry.turns ?? null;
    case 'elapsed': return telemetry.elapsedMs ?? null;
    case 'cost': return telemetry.costUsd ?? null;
    default: return null;
  }
}

/**
 * The base prompt title behind a variant run.
 *
 * Variant titles are built as `${base} · ${laneLabel}`, so the suffix comes off
 * when it matches. The run stores the label as it read at the time, and a lane
 * can be renamed afterwards, so the lane id is accepted as well — otherwise a
 * renamed lane would strand its rows under a title like "Frogger · Old Label".
 *
 * A suffix that matches neither is left alone: a hand-edited variant title is
 * the author's and must not be truncated on a guess.
 */
export function baseTitleFor(meta, ...laneNames) {
  const title = meta?.gameTitle || meta?.gameId || '';
  for (const name of laneNames) {
    if (!name) continue;
    const suffix = ` · ${name}`;
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) return title.slice(0, -suffix.length);
  }
  return title;
}

function betterRun(a, b) {
  if (!a) return b;
  if (!b) return a;
  const rank = (STATUS_RANK[b.meta?.status] ?? 0) - (STATUS_RANK[a.meta?.status] ?? 0);
  if (rank !== 0) return rank < 0 ? a : b;
  const score = (evaluationAverage(b.meta?.evaluation) ?? -1) - (evaluationAverage(a.meta?.evaluation) ?? -1);
  if (score !== 0) return score < 0 ? a : b;
  return (b.runId || '').localeCompare(a.runId || '') < 0 ? a : b;
}

/**
 * Fold runs into rows (base prompts) and columns (lanes).
 *
 * `runs` is a flat list of `{ gameSlug, runId, meta }`; `laneName` resolves a
 * lane id to its label. Pure, so the cell-selection rule is testable without a
 * data root.
 */
export function buildVariantMatrix(runs = [], laneName = id => id) {
  const rows = new Map();
  const columns = new Map();
  for (const run of runs) {
    const meta = run.meta || {};
    const laneId = meta.laneId || BASE_COLUMN;
    const rowId = meta.variantOf || meta.gameId || run.gameSlug;
    if (!rowId) continue;
    const label = laneId === BASE_COLUMN ? BASE_COLUMN_LABEL : laneName(laneId);
    if (!columns.has(laneId)) columns.set(laneId, { id: laneId, label, runs: 0 });
    columns.get(laneId).runs++;
    if (!rows.has(rowId)) rows.set(rowId, { id: rowId, title: '', cells: new Map() });
    const row = rows.get(rowId);
    // A baseline run names the row outright; a variant only supplies a fallback,
    // so an edited variant title never renames the whole row.
    const derived = laneId === BASE_COLUMN ? baseTitleFor(meta) : baseTitleFor(meta, label, laneId);
    if (laneId === BASE_COLUMN) row.title = meta.gameTitle || derived || row.title;
    else if (!row.title) row.title = derived;
    const cell = row.cells.get(laneId) || { laneId, runs: [], best: null };
    cell.runs.push(run);
    cell.best = betterRun(cell.best, run);
    row.cells.set(laneId, cell);
  }
  return {
    rows: [...rows.values()].sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id)),
    columns: [...columns.values()].sort((a, b) => {
      if (a.id === BASE_COLUMN) return -1;
      if (b.id === BASE_COLUMN) return 1;
      return a.label.localeCompare(b.label);
    }),
  };
}

/** Aggregate one metric down a column, ignoring cells that cannot report it. */
export function columnAverage(rows, laneId, metric) {
  const values = rows
    .map(row => runMetric(row.cells.get(laneId)?.best?.meta, metric))
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Every run in the projects folder, flattened for the matrix. */
export async function loadAllRuns() {
  const games = await listGames();
  const perGame = await Promise.all(games.map(async game => {
    const runs = await listRuns(game.slug);
    return runs.map(run => ({ ...run, gameSlug: game.slug }));
  }));
  return perGame.flat();
}
