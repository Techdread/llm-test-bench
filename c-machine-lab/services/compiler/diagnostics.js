export function diagnostic(message, tokenOrRange, severity = 'error', code = 'CML001') {
  const start = tokenOrRange?.start || tokenOrRange || {};
  const end = tokenOrRange?.end || tokenOrRange || start;
  return {
    code,
    severity,
    message,
    line: start.line || 1,
    column: start.column || 1,
    endLine: end.line || start.line || 1,
    endColumn: end.column || start.column || 1,
  };
}

export function unsupported(message, tokenOrRange) {
  return diagnostic(message, tokenOrRange, 'error', 'CML-UNSUPPORTED');
}

export function warning(message, tokenOrRange, code = 'CML-WARN') {
  return diagnostic(message, tokenOrRange, 'warning', code);
}
