// Shared Ace-backed code editor.
//
// Promoted from notebook-lab/components/CellEditor.js + dsl-workbench/components/AceEditor.js
// per spec 59. Props are a superset of both originals.
//
// Required globals: `window.ace` must be loaded via a classic script tag
// before this component renders (every consumer app already wires this).
//
// Props:
//   value         current source text (canonical name)
//   onChange(v)   user-edit callback; never fires for programmatic value swaps
//   mode          Ace mode string, e.g. 'ace/mode/python' — preferred
//   kind          shorthand language key ('py', 'js', 'md', …) resolved via MODES
//   theme         'dark' | 'light' | <falsy>  (also accepts raw Ace theme strings)
//   readOnly      bool — default false
//   minLines      default 4
//   maxLines      default 30
//   wrap          default true
//   fontSize      default 13
//   followOutput  scroll to the final line after programmatic value updates
//   markers       [{line, column, length?, className?}] — error highlight ranges
//   onRun         optional () => void — if provided, binds Shift-Enter / Ctrl-Enter / Cmd-Enter
//   runKeys       { win, mac } — override the default run key bindings
//   className     wrapper <div> class — defaults to 'ace-host'

import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';

const MODES = {
  md: 'ace/mode/markdown',
  markdown: 'ace/mode/markdown',
  js: 'ace/mode/javascript',
  javascript: 'ace/mode/javascript',
  ts: 'ace/mode/typescript',
  py: 'ace/mode/python',
  python: 'ace/mode/python',
  c: 'ace/mode/c_cpp',
  cpp: 'ace/mode/c_cpp',
  rust: 'ace/mode/rust',
  lua: 'ace/mode/lua',
  java: 'ace/mode/java',
  go: 'ace/mode/golang',
  golang: 'ace/mode/golang',
  scala: 'ace/mode/scala',
  clojure: 'ace/mode/clojure',
  html: 'ace/mode/html',
  css: 'ace/mode/css',
  json: 'ace/mode/json',
  ui: 'ace/mode/json',
  chart: 'ace/mode/json',
  text: 'ace/mode/text',
};

function resolveMode({ mode, kind }) {
  if (mode) return mode;
  if (kind && MODES[kind]) return MODES[kind];
  return 'ace/mode/text';
}

function resolveTheme(theme) {
  if (!theme) return 'ace/theme/chrome';
  if (typeof theme === 'string' && theme.startsWith('ace/theme/')) return theme;
  return theme === 'dark' ? 'ace/theme/monokai' : 'ace/theme/chrome';
}

const DEFAULT_RUN_KEYS = { win: 'Shift-Enter|Ctrl-Enter', mac: 'Shift-Enter|Cmd-Enter' };

export function CellEditor({
  value,
  onChange,
  mode,
  kind,
  theme,
  readOnly = false,
  minLines = 4,
  maxLines = 30,
  wrap = true,
  fontSize = 13,
  followOutput = false,
  markers = [],
  onRun,
  runKeys = DEFAULT_RUN_KEYS,
  className = 'ace-host',
}) {
  const hostRef = useRef(null);
  const aceRef = useRef(null);
  const suppressRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const markerIdsRef = useRef([]);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    if (!hostRef.current || aceRef.current) return;
    const editor = window.ace.edit(hostRef.current);
    editor.setOptions({
      fontSize,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      wrap,
      minLines,
      maxLines,
      readOnly,
    });
    editor.session.on('change', () => {
      if (!suppressRef.current) onChangeRef.current?.(editor.getValue());
    });

    // Run hotkey — only bind if a callback was provided. Clear any default
    // binding that could swallow Shift-Enter first.
    if (onRunRef.current) {
      try { editor.commands.bindKey('Shift-Enter', null); } catch {}
      editor.commands.addCommand({
        name: 'runCell',
        bindKey: runKeys,
        exec: () => onRunRef.current && onRunRef.current(),
        readOnly: false,
        multiSelectAction: 'forEach',
      });
      // Some Ace builds only honour the key via bindKey().
      editor.commands.bindKey(runKeys, 'runCell');
    }

    aceRef.current = editor;
    return () => {
      editor.destroy();
      aceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (aceRef.current) aceRef.current.setTheme(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    if (aceRef.current) aceRef.current.session.setMode(resolveMode({ mode, kind }));
  }, [mode, kind]);

  useEffect(() => {
    if (aceRef.current) aceRef.current.setReadOnly(!!readOnly);
  }, [readOnly]);

  useEffect(() => {
    if (!aceRef.current) return;
    const current = aceRef.current.getValue();
    if (current !== (value || '')) {
      suppressRef.current = true;
      aceRef.current.setValue(value || '', -1);
      if (followOutput && value) {
        const lastLine = aceRef.current.session.getLength();
        aceRef.current.gotoLine(lastLine, Infinity, false);
        aceRef.current.scrollToLine(lastLine, true, true);
        aceRef.current.clearSelection();
      }
      suppressRef.current = false;
    }
  }, [value, followOutput]);

  useEffect(() => {
    const editor = aceRef.current;
    if (!editor) return;
    const session = editor.session;
    const Range = window.ace.require('ace/range').Range;
    for (const id of markerIdsRef.current) session.removeMarker(id);
    markerIdsRef.current = [];
    for (const m of markers) {
      const range = new Range(m.line - 1, m.column - 1, m.line - 1, (m.column - 1) + (m.length || 1));
      const id = session.addMarker(range, m.className || 'ace-error-marker', 'text', false);
      markerIdsRef.current.push(id);
    }
    return () => {
      for (const id of markerIdsRef.current) session.removeMarker(id);
      markerIdsRef.current = [];
    };
  }, [markers]);

  return html`<div class=${className} ref=${hostRef}></div>`;
}
