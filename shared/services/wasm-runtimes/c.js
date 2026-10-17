// Shared C runner — uses JSCPP (JavaScript C/C++ interpreter).
// This is intentionally constrained to small single-file programs.

import { createStdinController } from './stdin.js';

let jscppModule = null;

async function loadJSCPP() {
  if (jscppModule) return jscppModule;
  const mod = await import('../../lib/JSCPP/2.0.9/index.mjs');
  jscppModule = mod.default || mod;
  return jscppModule;
}

export async function runC(code, options = {}) {
  const JSCPP = await loadJSCPP();
  const runFn = typeof JSCPP.run === 'function' ? JSCPP.run.bind(JSCPP)
    : typeof JSCPP === 'function' ? JSCPP : null;

  if (!runFn) {
    throw new Error('JSCPP module loaded but run() not found. Keys: ' + Object.keys(JSCPP).join(', '));
  }

  let stdout = '';
  let stderr = '';
  let runSucceeded = true;
  let compileSucceeded = true;
  const stdin = createStdinController(options.stdin, {
    interactive: options.interactiveInput,
    promptLabel: 'C program is waiting for input',
  });

  try {
    const config = {
      stdio: {
        drain: () => stdin.drain(),
        write: (s) => { stdout += s; },
      },
      unsigned_overflow: 'warn',
    };
    const exitCode = runFn(code, '', config);
    runSucceeded = exitCode === 0 || exitCode === undefined;
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('Parse') || msg.includes('Syntax') || msg.includes('unexpected')) {
      compileSucceeded = false;
      stderr = msg;
    } else {
      runSucceeded = false;
      stderr = msg;
    }
  }

  return {
    runtimeKind: 'interpreted',
    compileSucceeded,
    runSucceeded: compileSucceeded && runSucceeded,
    stdout: capOutput(stdout),
    stderr,
    compileLog: compileSucceeded ? '' : stderr,
    stdin: stdin.consumedInput,
    promptedInput: stdin.promptedInput,
  };
}

/**
 * Spec-59 uniform runner. Adapts runC() to the
 * `run({code, stdin, timeoutMs}) -> {stdout, stderr, durationMs, runSucceeded}` shape.
 */
export async function run({ code, stdin = '', timeoutMs = 10000 } = {}) {
  const start = performance.now();
  const result = await Promise.race([
    runC(code, { stdin }),
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

function capOutput(text, maxLen = 50000) {
  if (text.length > maxLen) {
    return text.slice(0, maxLen) + '\n... (output truncated)';
  }
  return text;
}
