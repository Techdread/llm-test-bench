// Build an ER graph from a schema and lay it out using the shared
// force-directed layout.

import { forceDirectedLayout } from '../../shared/services/graph-layout.js';

/**
 * Given the result of introspect(db), produce:
 *   nodes: [{ id, columns: [{ name, pk, type }] }]
 *   edges: [{ source, target, fromCol, toCol }]
 *   positions: Map<tableName, {x, y}>
 */
export function layoutSchema(schema, { width = 640, height = 440 } = {}) {
  const nodes = (schema.tables || []).map(t => ({
    id: t.name,
    columns: t.columns || [],
  }));
  const edges = [];
  for (const t of (schema.tables || [])) {
    for (const fk of (t.foreignKeys || [])) {
      edges.push({
        source: t.name,
        target: fk.toTable,
        fromCol: fk.fromColumn,
        toCol: fk.toColumn,
      });
    }
  }
  const positions = forceDirectedLayout(
    { nodes, edges },
    { width, height, iterations: 260, repulsion: 1800, spring: 0.04, springLength: 130, damping: 0.84, centerPull: 0.004 },
  );
  return { nodes, edges, positions };
}
