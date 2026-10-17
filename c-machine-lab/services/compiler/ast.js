export function node(kind, props = {}, token = null) {
  return {
    kind,
    id: `${kind}-${Math.random().toString(36).slice(2, 9)}`,
    loc: token ? {
      line: token.line,
      column: token.column,
      endLine: token.endLine || token.line,
      endColumn: token.endColumn || token.column,
    } : props.loc || null,
    ...props,
  };
}

export function typeDisplay(type) {
  if (!type) return 'unknown';
  return `${type.base}${'*'.repeat(type.pointerDepth || 0)}${type.arrayLength ? `[${type.arrayLength}]` : ''}`;
}

export function cloneType(type) {
  return {
    base: type.base,
    pointerDepth: type.pointerDepth || 0,
    arrayLength: type.arrayLength || null,
    display: typeDisplay(type),
  };
}
