// Shared Rust runner — uses the public Rust Playground API.
// This is remote compilation/execution, not local browser execution.

import { normalizeStdin } from './stdin.js';

const PLAYGROUND_URL = 'https://play.rust-lang.org/execute';

export async function runRust(code, options = {}) {
  let stdout = '';
  let stderr = '';
  let compileSucceeded = true;
  let runSucceeded = true;
  let compileLog = '';
  const stdin = normalizeStdin(options.stdin);
  const inputUnsupported = stdin.length > 0;

  try {
    const response = await fetch(PLAYGROUND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'stable',
        mode: 'debug',
        edition: '2021',
        crateType: 'bin',
        tests: false,
        code,
        backtrace: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Rust Playground returned HTTP ${response.status}`);
    }

    const result = await response.json();
    stdout = result.stdout || '';
    const rawStderr = result.stderr || '';
    const { info, rest } = splitCargoStderr(rawStderr);
    compileLog = info;
    stderr = rest;

    if (result.success === false) {
      if (rest.includes('error[E') || /^error(\[|:)/m.test(rest)) {
        compileSucceeded = false;
        compileLog = rawStderr;
        stderr = rest;
      }
      runSucceeded = false;
    }
  } catch (err) {
    runSucceeded = false;
    stderr = err.message || String(err);
  }

  if (inputUnsupported) {
    const note = 'Rust Playground execution does not accept stdin; input panel text was not passed to the program.';
    stderr = stderr ? `${note}\n${stderr}` : note;
  }

  return {
    runtimeKind: 'remote',
    compileSucceeded,
    runSucceeded,
    stdout: capOutput(stdout),
    stderr,
    compileLog,
    stdin,
    promptedInput: [],
    inputUnsupported,
  };
}

/**
 * Spec-59 uniform runner. Adapts runRust() to the
 * `run({code, stdin, timeoutMs}) -> {stdout, stderr, durationMs, runSucceeded}` shape.
 */
export async function run({ code, stdin = '', timeoutMs = 30000 } = {}) {
  const start = performance.now();
  const result = await Promise.race([
    runRust(code, { stdin }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]).catch((err) => ({
    runSucceeded: false,
    stdout: '',
    stderr: err.message || String(err),
  }));
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    durationMs: Math.round(performance.now() - start),
    runSucceeded: !!result.runSucceeded,
  };
}

function splitCargoStderr(text) {
  if (!text) return { info: '', rest: '' };
  const infoPattern = /^\s*(Compiling|Finished|Running|Updating|Downloading|Downloaded|Fresh|Blocking|Checking|Building)\b/;
  const infoLines = [];
  const restLines = [];
  for (const line of text.split('\n')) {
    if (infoPattern.test(line)) {
      infoLines.push(line);
    } else {
      restLines.push(line);
    }
  }
  return {
    info: infoLines.join('\n'),
    rest: restLines.join('\n').replace(/^\n+|\n+$/g, ''),
  };
}

function capOutput(text, maxLen = 50000) {
  if (text.length > maxLen) {
    return text.slice(0, maxLen) + '\n... (output truncated)';
  }
  return text;
}
