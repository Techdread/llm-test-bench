// Classify run results into one of:
// 'syntax' | 'runtime' | 'timeout' | 'missing_file' | 'unknown' | null (no error)
// Also extract a best-effort location {file, line, column} when possible.

const KIND_LABELS = {
  syntax:       { label: 'Syntax error',   color: '#f59e0b' },
  runtime:      { label: 'Runtime error',  color: '#ef4444' },
  timeout:      { label: 'Timeout',        color: '#a855f7' },
  missing_file: { label: 'Missing file',   color: '#f59e0b' },
  unknown:      { label: 'Unknown error',  color: '#6b7280' },
};

export function classifyError(runResult, language) {
  if (!runResult) return null;
  if (runResult.exitCode === 0 && !runResult.timedOut) return null;

  if (runResult.timedOut) {
    return { kind: 'timeout', ...KIND_LABELS.timeout, location: null };
  }

  const stderr = runResult.stderr || '';

  // Missing file / import — checked first so a Node-resolver error that
  // mentions both ENOENT and SyntaxError gets the more specific kind.
  if (/No such file|ENOENT|Module not found|ModuleNotFoundError|ImportError/i.test(stderr)) {
    return {
      kind: 'missing_file',
      ...KIND_LABELS.missing_file,
      location: parseLocation(stderr, language),
    };
  }

  // Syntax-ish signals (same for HTML/Python).
  if (/SyntaxError|Unexpected token|Unexpected end of input|unmatched tag/i.test(stderr)) {
    return {
      kind: 'syntax',
      ...KIND_LABELS.syntax,
      location: parseLocation(stderr, language),
    };
  }

  // Runtime (default for non-zero exit).
  if (/Uncaught|Traceback|Error:|Exception/i.test(stderr)) {
    return {
      kind: 'runtime',
      ...KIND_LABELS.runtime,
      location: parseLocation(stderr, language),
    };
  }

  return { kind: 'unknown', ...KIND_LABELS.unknown, location: null };
}

function parseLocation(stderr, language) {
  if (language === 'python') {
    // File "foo.py", line 42, in <module>
    // Take the LAST frame in a traceback — that's the actual error site,
    // not the outermost caller.
    const matches = [...stderr.matchAll(/File\s+"([^"]+)",\s+line\s+(\d+)/g)];
    const last = matches[matches.length - 1];
    if (last) return { file: last[1], line: parseInt(last[2], 10), column: null };
  }
  // Generic "file.ext:line:col"
  const m = stderr.match(/([\w./-]+\.(?:html|js|py|css)):(\d+):(\d+)/);
  if (m) return { file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) };
  return null;
}

/**
 * Build a compact feedback string for the model.
 */
export function buildErrorSummary(runResult, errorInfo) {
  if (!runResult) return 'No program execution was performed this iteration.';
  if (!errorInfo) {
    return `run_program succeeded (exit 0).\nstdout:\n${runResult.stdout || '(empty)'}`;
  }
  const parts = [
    `Error kind: ${errorInfo.kind}`,
  ];
  if (errorInfo.location) {
    const loc = errorInfo.location;
    parts.push(`Location: ${loc.file}:${loc.line}${loc.column ? ':' + loc.column : ''}`);
  }
  parts.push('');
  parts.push('stderr:');
  parts.push((runResult.stderr || '(empty)').slice(-2000));
  parts.push('');
  parts.push('stdout:');
  parts.push((runResult.stdout || '(empty)').slice(-1000));
  return parts.join('\n');
}
