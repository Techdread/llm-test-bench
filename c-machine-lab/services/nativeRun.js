import { runC } from '../../shared/services/wasm-runtimes/c.js';

export async function runNativeComparison(source) {
  const started = performance.now();
  try {
    const result = await runC(source);
    return {
      ...result,
      durationMs: Math.round(performance.now() - started),
      unavailable: false,
    };
  } catch (err) {
    return {
      runtimeKind: 'interpreted',
      compileSucceeded: false,
      runSucceeded: false,
      stdout: '',
      stderr: err.message || String(err),
      compileLog: err.message || String(err),
      durationMs: Math.round(performance.now() - started),
      unavailable: true,
    };
  }
}
