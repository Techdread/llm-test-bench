// Tree renderer. Handles both a linked `{value, left, right}` structure and
// an array-as-heap representation.

import { treeLayout } from '../../../shared/services/graph-layout.js';

let cachedKey = null;
let cachedData = null;

export function resetTreeCache() { cachedKey = null; cachedData = null; }

export function renderTreeView(ctx, { snapshot, mapping, width, height, theme }) {
  const bg        = theme === 'dark' ? '#0b1020' : '#f8fafc';
  const nodeCol   = theme === 'dark' ? '#6366f1' : '#4f46e5';
  const activeCol = '#f97316';
  const edgeCol   = theme === 'dark' ? '#475569' : '#94a3b8';
  const txtCol    = '#ffffff';
  const msgCol    = theme === 'dark' ? '#e2e8f0' : '#1f2937';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const rootName = mapping.root || guessTreeRoot(snapshot.vars);
  const rootVal = rootName ? snapshot.vars.get(rootName) : null;
  if (!rootVal) {
    drawCentreMessage(ctx, width, height, msgCol, `No tree found${rootName ? ` (looked for \`${rootName}\`)` : ''}`);
    return;
  }

  let root;
  if (Array.isArray(rootVal)) root = heapToTree(rootVal);
  else root = normaliseNode(rootVal);
  if (!root) {
    drawCentreMessage(ctx, width, height, msgCol, 'Tree structure was unreadable');
    return;
  }

  const key = JSON.stringify(summarise(root));
  if (cachedKey !== key) {
    const positions = treeLayout(root, { width, height });
    cachedData = { root, positions };
    cachedKey = key;
  }
  const { positions } = cachedData;

  // Edges.
  ctx.strokeStyle = edgeCol;
  ctx.lineWidth = 1.5;
  function drawEdges(node) {
    const p = positions.get(node.id);
    if (!p) return;
    for (const k of node.children || []) {
      const cp = positions.get(k.id);
      if (!cp) continue;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cp.x, cp.y); ctx.stroke();
      drawEdges(k);
    }
  }
  drawEdges(root);

  // Active cursor (mapping.cursor or 'current').
  const currentVal = snapshot.vars.get(mapping.cursor || 'current');

  // Nodes.
  const r = 14;
  function drawNodes(node) {
    const p = positions.get(node.id);
    if (!p) return;
    const active = valueMatches(node.value, currentVal);
    ctx.fillStyle = active ? activeCol : nodeCol;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = txtCol;
    ctx.font = 'bold 11px "Cascadia Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(node.value), p.x, p.y);
    for (const k of node.children || []) drawNodes(k);
  }
  drawNodes(root);
}

function normaliseNode(v, idCounter = { id: 0 }) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return null;
  const id = String(idCounter.id++);
  const children = [];
  if (v.left)  { const k = normaliseNode(v.left, idCounter); if (k) children.push(k); }
  if (v.right) { const k = normaliseNode(v.right, idCounter); if (k) children.push(k); }
  if (Array.isArray(v.children)) {
    for (const c of v.children) { const k = normaliseNode(c, idCounter); if (k) children.push(k); }
  }
  return { id, value: v.value ?? v.val ?? v.key ?? '?', children };
}

function heapToTree(arr) {
  if (arr.length === 0) return null;
  function build(i) {
    if (i >= arr.length || arr[i] === null || arr[i] === undefined) return null;
    const node = { id: String(i), value: arr[i], children: [] };
    const L = build(2 * i + 1); if (L) node.children.push(L);
    const R = build(2 * i + 2); if (R) node.children.push(R);
    return node;
  }
  return build(0);
}

function guessTreeRoot(varMap) {
  for (const [k, v] of varMap.entries()) {
    if (!v || typeof v !== 'object') continue;
    if ('left' in v || 'right' in v || 'children' in v) return k;
    if (k === 'tree' || k === 'root' || k === 'node' || k === 'head') return k;
  }
  return null;
}

function valueMatches(a, b) {
  if (a === b) return true;
  if (b && typeof b === 'object' && 'value' in b) return a === b.value;
  return false;
}

function summarise(node) {
  if (!node) return null;
  return [node.value, (node.children || []).map(summarise)];
}

function drawCentreMessage(ctx, width, height, color, msg) {
  ctx.fillStyle = color;
  ctx.font = '13px "Cascadia Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, width / 2, height / 2);
}
