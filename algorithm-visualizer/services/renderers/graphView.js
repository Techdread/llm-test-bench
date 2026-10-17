// Graph renderer. Uses shared/graph-layout to place nodes once (cached by
// caller), then draws edges + nodes per frame with highlight for the
// currently-visited set / frontier.

import { forceDirectedLayout, normaliseGraph } from '../../../shared/services/graph-layout.js';

let cachedKey = null;
let cachedPositions = null;

export function resetGraphCache() { cachedKey = null; cachedPositions = null; }

export function renderGraphView(ctx, { snapshot, mapping, width, height, theme }) {
  const bg     = theme === 'dark' ? '#0b1020' : '#f8fafc';
  const nodeCol = theme === 'dark' ? '#334155' : '#cbd5e1';
  const nodeText = theme === 'dark' ? '#e2e8f0' : '#1f2937';
  const edgeCol = theme === 'dark' ? '#475569' : '#94a3b8';
  const visitedCol = '#10b981';
  const frontierCol = '#f59e0b';
  const msgCol = theme === 'dark' ? '#e2e8f0' : '#1f2937';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const adjName = mapping.adjacency || guessAdjacencyVar(snapshot.vars);
  const adj = adjName ? snapshot.vars.get(adjName) : null;
  if (!adj || typeof adj !== 'object') {
    drawCentreMessage(ctx, width, height, msgCol, `No adjacency found${adjName ? ` (looked for \`${adjName}\`)` : ''}`);
    return;
  }

  const graph = normaliseGraph(adj);
  if (graph.nodes.length === 0) {
    drawCentreMessage(ctx, width, height, msgCol, 'Adjacency is empty');
    return;
  }

  // Cache the layout by adjacency shape (stringified).
  const shapeKey = JSON.stringify(graph.nodes.map(n => n.id)) + '|' + JSON.stringify(graph.edges);
  if (cachedKey !== shapeKey) {
    cachedPositions = forceDirectedLayout(graph, { width, height, iterations: 260 });
    cachedKey = shapeKey;
  }
  const positions = cachedPositions;

  // Determine state sets.
  const visitedSet = toIdSet(snapshot.vars.get(mapping.visited));
  const frontierSet = toIdSet(snapshot.vars.get(mapping.frontier));

  // Edges.
  ctx.strokeStyle = edgeCol;
  ctx.lineWidth = 1.5;
  for (const e of graph.edges) {
    const a = positions.get(e.source);
    const b = positions.get(e.target);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Nodes.
  const r = 16;
  for (const n of graph.nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    let fill = nodeCol;
    if (visitedSet.has(n.id)) fill = visitedCol;
    if (frontierSet.has(n.id)) fill = frontierCol;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px "Cascadia Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n.id), p.x, p.y);
  }

  // Legend.
  drawLegend(ctx, [
    { color: visitedCol, label: `visited (${mapping.visited || '—'})` },
    { color: frontierCol, label: `frontier (${mapping.frontier || '—'})` },
  ], theme, width, height);
}

function toIdSet(value) {
  const set = new Set();
  if (!value) return set;
  if (Array.isArray(value)) {
    for (const v of value) set.add(String(v));
  } else if (value.__set && Array.isArray(value.__set)) {
    for (const v of value.__set) set.add(String(v));
  } else if (typeof value === 'object') {
    // Visited map like { A: true, B: false } — only include truthy keys.
    for (const k of Object.keys(value)) if (value[k]) set.add(String(k));
  }
  return set;
}

function guessAdjacencyVar(varMap) {
  for (const [k, v] of varMap.entries()) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(x => Array.isArray(x))) return k;
  }
  return null;
}

function drawCentreMessage(ctx, width, height, color, msg) {
  ctx.fillStyle = color;
  ctx.font = '13px "Cascadia Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, width / 2, height / 2);
}

function drawLegend(ctx, items, theme, width, height) {
  const txt = theme === 'dark' ? '#e2e8f0' : '#1f2937';
  let y = height - 12 - items.length * 16;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '11px "Cascadia Code", monospace';
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.arc(14, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = txt;
    ctx.fillText(it.label, 24, y);
    y += 16;
  }
}
