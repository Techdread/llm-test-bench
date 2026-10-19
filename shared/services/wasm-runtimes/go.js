// Shared Go runner — compiles + runs with the real Go toolchain in the Debian
// guest (spec 278), the same backend the Polyglot Forge `go` module uses. Returns
// the runtimeManager RunResult shape so Notebook Lab can run `go` cells.

import { compileAndRun } from '../debianVm.js';

export async function runGo(code, options = {}) {
  const stdin = options.stdin || '';
  const env = 'HOME=/tmp GOCACHE=/tmp/gocache GOPATH=/tmp/gopath GOFLAGS=-mod=mod GO111MODULE=off';
  const r = await compileAndRun({
    source: code, stdin, srcName: 'main.go',
    compileCmd: `env ${env} go build -o prog main.go`, runCmd: './prog',
    timeoutMs: 360000, onStatus: options.onStatus,
  });
  return toRunResult(r, 'native (Go, Debian/v86)', stdin);
}

// Map debianVm's { stdout, cerr, rerr, exitCode } onto the runner contract.
export function toRunResult(r, runtimeKind, stdin) {
  const failed = r.exitCode !== 0;
  return {
    runtimeKind,
    compileSucceeded: !failed ? true : (r.cerr && r.cerr.trim() ? false : true),
    runSucceeded: !failed && !r.timedOut,
    stdout: r.stdout || '',
    stderr: r.rerr || '',
    compileLog: r.cerr || '',
    stdin,
  };
}
