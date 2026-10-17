// Zero-dependency test harness for code-morph-lab-v3 services.

const output = document.getElementById('output');
let passed = 0;
let failed = 0;
const pending = [];

function line(text, cls) {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text + '\n';
  output.appendChild(span);
}

export function assertEq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    line(`  ✓ ${msg}`, 'pass');
  } else {
    failed++;
    line(`  ✗ ${msg}`, 'fail');
    line(`      expected: ${JSON.stringify(expected)}`, 'fail');
    line(`      actual:   ${JSON.stringify(actual)}`, 'fail');
  }
}

export function assertTrue(cond, msg) {
  if (cond) { passed++; line(`  ✓ ${msg}`, 'pass'); }
  else { failed++; line(`  ✗ ${msg}`, 'fail'); }
}

export function test(name, fn) {
  line(`\n── ${name} ──`);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.catch(e => { failed++; line(`  ✗ threw: ${e.message}`, 'fail'); console.error(e); }));
    }
  } catch (e) { failed++; line(`  ✗ threw: ${e.message}`, 'fail'); console.error(e); }
}

// ── workspaceStore tests ──
import { createWorkspace, computeDiff } from './workspaceStore.js';

test('createWorkspace: empty workspace has no files', () => {
  const ws = createWorkspace();
  assertEq(ws.listFiles(), [], 'listFiles returns empty array');
  assertEq(ws.fileCount(), 0, 'fileCount is 0');
});

test('writeFile + readFile', () => {
  const ws = createWorkspace();
  ws.writeFile('index.html', '<html></html>');
  assertEq(ws.readFile('index.html'), '<html></html>', 'readFile returns written content');
  assertEq(ws.listFiles(), ['index.html'], 'listFiles reflects the write');
  assertEq(ws.fileCount(), 1, 'fileCount is 1');
});

test('editFile: unique match replaces', () => {
  const ws = createWorkspace();
  ws.writeFile('a.html', '<h1>Hello</h1>');
  ws.editFile('a.html', '<h1>Hello</h1>', '<h1>World</h1>');
  assertEq(ws.readFile('a.html'), '<h1>World</h1>', 'edit replaced the unique match');
});

test('editFile: zero match throws', () => {
  const ws = createWorkspace();
  ws.writeFile('a.html', 'hello');
  let threw = false;
  try { ws.editFile('a.html', 'nope', 'x'); } catch (e) { threw = e.message.includes('not found'); }
  assertTrue(threw, 'zero match throws not found');
});

test('editFile: multiple matches throws', () => {
  const ws = createWorkspace();
  ws.writeFile('a.html', 'x x x');
  let threw = false;
  try { ws.editFile('a.html', 'x', 'y'); } catch (e) { threw = e.message.includes('appears'); }
  assertTrue(threw, 'multi match throws appears-N-times');
});

test('deleteFile', () => {
  const ws = createWorkspace();
  ws.writeFile('a.html', 'x');
  ws.deleteFile('a.html');
  assertEq(ws.listFiles(), [], 'deleted file gone from list');
});

test('snapshot is independent of subsequent edits', () => {
  const ws = createWorkspace();
  ws.writeFile('a.html', 'v1');
  const snap = ws.snapshot();
  ws.writeFile('a.html', 'v2');
  assertEq(snap.get('a.html'), 'v1', 'snapshot still has v1');
  assertEq(ws.readFile('a.html'), 'v2', 'workspace has v2');
});

test('computeDiff detects changes', () => {
  const diff = computeDiff('line1\nline2\n', 'line1\nline2-changed\n');
  assertTrue(diff.changed, 'diff marked changed');
  assertTrue(diff.unified.includes('line2'), 'diff mentions line2');
});

test('computeDiff on identical strings', () => {
  const diff = computeDiff('same', 'same');
  assertTrue(!diff.changed, 'identical content → not changed');
});

import { classifyError } from './errorClassifier.js';

test('classifyError: exit 0 → null', () => {
  const info = classifyError({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }, 'html');
  assertEq(info, null, 'success has no error info');
});

test('classifyError: timeout', () => {
  const info = classifyError({ exitCode: 1, stdout: '', stderr: 'timed out', timedOut: true }, 'html');
  assertEq(info.kind, 'timeout', 'kind is timeout');
});

test('classifyError: html syntax-ish', () => {
  const info = classifyError({
    exitCode: 1, stdout: '', stderr: 'Uncaught SyntaxError: Unexpected token', timedOut: false,
  }, 'html');
  assertEq(info.kind, 'syntax', 'kind is syntax');
});

test('classifyError: html runtime', () => {
  const info = classifyError({
    exitCode: 1, stdout: '', stderr: 'Uncaught TypeError: undefined is not a function', timedOut: false,
  }, 'html');
  assertEq(info.kind, 'runtime', 'kind is runtime');
});

import { getToolDefinitions, executeTool } from './toolRegistry.js';

test('getToolDefinitions returns 6 tools', () => {
  const tools = getToolDefinitions();
  assertEq(tools.length, 6, 'six tools');
  const names = tools.map(t => t.function.name).sort();
  assertEq(names, ['delete_file','edit_file','list_files','read_file','run_program','write_file'], 'tool names');
});

test('executeTool: write_file + list_files', async () => {
  const ws = createWorkspace();
  const stubRunner = async () => ({ exitCode: 0, stdout: '', stderr: '', duration: 0, timedOut: false });
  await executeTool('write_file', { filename: 'a.html', content: 'hi' }, ws, stubRunner);
  const list = await executeTool('list_files', {}, ws, stubRunner);
  assertTrue(list.text.includes('a.html'), 'list_files shows a.html');
});

test('executeTool: edit_file', async () => {
  const ws = createWorkspace();
  const stubRunner = async () => ({});
  ws.writeFile('a.html', 'hello world');
  const r = await executeTool('edit_file', { filename: 'a.html', old_string: 'world', new_string: 'there' }, ws, stubRunner);
  assertEq(ws.readFile('a.html'), 'hello there', 'edit_file applied');
  assertTrue(r.text.includes('ok') || r.text.includes('edited'), 'tool result mentions success');
});

test('executeTool: run_program returns rawResult', async () => {
  const ws = createWorkspace();
  ws.writeFile('a.html', '<html></html>');
  const stubRunner = async () => ({ exitCode: 0, stdout: 'hi', stderr: '', duration: 5, timedOut: false });
  const r = await executeTool('run_program', { entry: 'a.html' }, ws, stubRunner);
  assertEq(r.rawResult.exitCode, 0, 'raw result exitCode');
  assertTrue(r.text.includes('exit'), 'tool text mentions exit');
});

import { readHandoff, peekHandoff } from './handoff.js';

test('readHandoff: empty → null', () => {
  localStorage.removeItem('cml:handoff');
  assertEq(readHandoff(), null, 'returns null when empty');
});

test('peekHandoff does not clear', () => {
  localStorage.setItem('cml:handoff', JSON.stringify({ v: 1, source: 'test', kind: 'prompt', prompt: 'x' }));
  const peeked = peekHandoff();
  assertEq(peeked.source, 'test', 'peek returns payload');
  assertTrue(!!localStorage.getItem('cml:handoff'), 'peek does not clear storage');
  localStorage.removeItem('cml:handoff');
});

test('readHandoff clears on read', () => {
  localStorage.setItem('cml:handoff', JSON.stringify({ v: 1, source: 'test', kind: 'prompt', prompt: 'x' }));
  const read = readHandoff();
  assertEq(read.source, 'test', 'read returns payload');
  assertEq(localStorage.getItem('cml:handoff'), null, 'read clears storage');
});

test('readHandoff rejects unknown version', () => {
  localStorage.setItem('cml:handoff', JSON.stringify({ v: 99, source: 'x' }));
  assertEq(readHandoff(), null, 'unknown version → null');
  assertEq(localStorage.getItem('cml:handoff'), null, 'cleared anyway');
});

import { buildMorphNotebook, buildSelfContainedHtml } from './notebookExport.js';

test('buildSelfContainedHtml inlines local css and js', () => {
  const html = buildSelfContainedHtml(
    '<!DOCTYPE html><html><head><link rel="stylesheet" href="./style.css"><script src="app.js"></script></head><body><h1>Hi</h1></body></html>',
    [
      { name: 'style.css', content: 'h1 { color: red; }' },
      { name: 'app.js', content: 'console.log("ok");' },
    ]
  );
  assertTrue(html.includes('<style>h1 { color: red; }</style>'), 'stylesheet is inline');
  assertTrue(html.includes('<script>console.log("ok");</script>'), 'script is inline');
  assertTrue(!html.includes('href="./style.css"'), 'local css link removed');
  assertTrue(!html.includes('src="app.js"'), 'local script src removed');
});

test('buildMorphNotebook creates prompt and output cells', () => {
  const notebook = buildMorphNotebook({
    session: {
      id: 'session-1',
      goal: 'Build a tiny page',
      language: 'html',
      model: 'provider:model',
      status: 'success',
    },
    files: [{ name: 'index.html', content: '<h1>Hello</h1>' }],
    entryFile: 'index.html',
    runResult: { exitCode: 0, stdout: '', stderr: '', duration: 12, timedOut: false },
  });
  assertEq(notebook.cells.length, 2, 'two cells');
  assertEq(notebook.cells[0].kind, 'md', 'first cell is markdown prompt');
  assertEq(notebook.cells[1].kind, 'html', 'second cell is html output');
  assertTrue(notebook.cells[0].source.includes('Build a tiny page'), 'prompt is preserved');
  assertEq(notebook.cells[1].metadata.codeMorph.entryFile, 'index.html', 'entry file metadata is preserved');
});

// Summary
Promise.all(pending).then(() => {
  line(`\n── Summary ──`);
  line(`${passed} passed, ${failed} failed`, failed > 0 ? 'fail' : 'pass');
});
