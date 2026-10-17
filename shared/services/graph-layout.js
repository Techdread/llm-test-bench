// Shared graph + tree layout. Hand-rolled force-directed simulator with a few
// stability tricks (Verlet-ish integration, grid-based repulsion, centring
// pull), plus a deterministic tidy-tree layout for strict hierarchies.
//
// Consumed by spec 42 (Algorithm Visualizer) and spec 52 (Diagram-from-Code).

/**
 * Run a force-directed layout on a set of nodes and edges.
 *
 * @param {Object} graph
 * @param {Array<{id:string}>} graph.nodes
 * @param {Array<{source:string,target:string}>} graph.edges
 * @param {Object} [options]
 * @param {number} [options.width=640]
 * @param {number} [options.height=420]
 * @param {number} [options.iterations=300]
 * @param {number} [options.repulsion=900]     — pairwise repulsion strength
 * @param {number} [options.spring=0.06]       — edge spring constant
 * @param {number} [options.springLength=60]   — edge rest length
 * @param {number} [options.damping=0.82]      — velocity damping per step
 * @param {number} [options.centerPull=0.005]  — pull toward the centre
 * @returns {Map<string, {x:number,y:number}>}
 */
export function forceDirectedLayout(graph, options = {}) {
  const width = options.width || 640;
  const height = options.height || 420;
  const iterations = options.iterations || 300;
  const repulsion = options.repulsion ?? 900;
  const spring = options.spring ?? 0.06;
  const springLength = options.springLength ?? 60;
  const damping = options.damping ?? 0.82;
  const centerPull = options.centerPull ?? 0.005;

  const nodes = graph.nodes.map((n, i) => ({
    id: n.id,
    x: (Math.cos(i * 2.39996) * Math.min(width, height) * 0.35) + width / 2,
    y: (Math.sin(i * 2.39996) * Math.min(width, height) * 0.35) + height / 2,
    vx: 0, vy: 0,
  }));
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = (graph.edges || [])
    .map(e => [idx.get(e.source), idx.get(e.target)])
    .filter(([a, b]) => a != null && b != null);

  for (let it = 0; it < iterations; it++) {
    // Repulsion O(n²) — fine for small graphs.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01; }
        const d = Math.sqrt(d2);
        const f = repulsion / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }
    // Edge springs.
    for (const [ai, bi] of edges) {
      const a = nodes[ai], b = nodes[bi];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = spring * (d - springLength);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // Centring pull.
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * centerPull;
      n.vy += (height / 2 - n.y) * centerPull;
    }
    // Integration with damping.
    for (const n of nodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  // Normalise into the viewport with padding.
  const pad = 24;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x; if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x; if (n.y > maxY) maxY = n.y;
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const sx = (width - pad * 2) / spanX;
  const sy = (height - pad * 2) / spanY;
  const s = Math.min(sx, sy);
  const out = new Map();
  for (const n of nodes) {
    out.set(n.id, {
      x: (n.x - minX) * s + pad,
      y: (n.y - minY) * s + pad,
    });
  }
  return out;
}

/**
 * Tidy tree layout — Reingold-Tilford style but simplified: assign x by
 * in-order index at the deepest level, then percolate up by averaging child x.
 *
 * @param {{id:string, children?:Array<...>}} root
 * @param {Object} [options]
 * @param {number} [options.width=640]
 * @param {number} [options.height=420]
 * @param {number} [options.paddingX=24]
 * @param {number} [options.paddingY=40]
 */
export function treeLayout(root, options = {}) {
  const width = options.width || 640;
  const height = options.height || 420;
  const paddingX = options.paddingX ?? 24;
  const paddingY = options.paddingY ?? 40;
  if (!root) return new Map();

  const positions = new Map();
  // First pass: assign a pre-order index to every leaf; use in-order for
  // spacing (count the leaves, assign each an x slot).
  let leafCount = 0;
  let maxDepth = 0;
  const nodeInfo = new Map();

  function prepass(node, depth) {
    if (depth > maxDepth) maxDepth = depth;
    const kids = node.children || [];
    const info = { depth, leaves: [] };
    if (kids.length === 0) {
      info.leaves.push(node);
      info.leafX = leafCount++;
    } else {
      for (const k of kids) {
        const kInfo = prepass(k, depth + 1);
        info.leaves.push(...kInfo.leaves);
      }
      info.leafX = (info.leaves[0].__layout.leafX + info.leaves[info.leaves.length - 1].__layout.leafX) / 2;
    }
    node.__layout = info;
    nodeInfo.set(node, info);
    return info;
  }
  prepass(root, 0);

  const slots = Math.max(leafCount - 1, 1);
  const usableW = Math.max(width - paddingX * 2, 1);
  const usableH = Math.max(height - paddingY * 2, 1);
  const stepY = maxDepth > 0 ? usableH / maxDepth : 0;

  function place(node) {
    const info = nodeInfo.get(node);
    const x = paddingX + (info.leafX / slots) * usableW;
    const y = paddingY + info.depth * stepY;
    positions.set(node.id, { x, y });
    for (const k of (node.children || [])) place(k);
  }
  place(root);

  // Remove internal layout marks so callers don't see them.
  for (const [node] of nodeInfo) { delete node.__layout; }
  return positions;
}

/**
 * Build a graph from edge list, keyed by node id. Accepts adjacency lists
 * (`{a:['b','c']}`), edge pairs (`[['a','b'], ['b','c']]`), or an explicit
 * `{nodes, edges}` shape. Returns `{nodes, edges}` with unique node ids.
 */
export function normaliseGraph(input) {
  if (!input) return { nodes: [], edges: [] };
  if (Array.isArray(input)) {
    const nodes = new Set();
    const edges = [];
    for (const item of input) {
      if (Array.isArray(item) && item.length >= 2) {
        nodes.add(String(item[0]));
        nodes.add(String(item[1]));
        edges.push({ source: String(item[0]), target: String(item[1]) });
      }
    }
    return { nodes: [...nodes].map(id => ({ id })), edges };
  }
  if (input.nodes && input.edges) return input;
  // Adjacency dict
  const nodes = new Set();
  const edges = [];
  for (const k of Object.keys(input)) {
    nodes.add(String(k));
    const ns = input[k];
    if (Array.isArray(ns)) {
      for (const v of ns) {
        nodes.add(String(v));
        edges.push({ source: String(k), target: String(v) });
      }
    }
  }
  return { nodes: [...nodes].map(id => ({ id })), edges };
}
