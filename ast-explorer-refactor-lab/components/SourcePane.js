// Source editor pane — Ace editor wired to emit text changes and report the
// caret offset. A parent-provided `highlight` (range in char offsets) is
// converted to a line/col range and applied as a selection.

import { html } from 'htm/preact';
import { useRef, useEffect } from 'preact/hooks';

const MODES = {
  js: 'ace/mode/javascript',
  ts: 'ace/mode/typescript',
  tsx: 'ace/mode/tsx',
  python: 'ace/mode/python',
};

export function SourcePane({ value, language, theme, onChange, onCursorChange, highlight }) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const silentUpdate = useRef(false);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    const editor = window.ace.edit(containerRef.current, {
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      wrap: false,
      scrollPastEnd: 0.3,
    });
    editor.setValue(value, -1);
    editor.session.setMode(MODES[language] || MODES.js);

    editor.session.on('change', () => {
      if (silentUpdate.current) return;
      onChange?.(editor.getValue());
    });

    editor.selection.on('changeCursor', () => {
      if (silentUpdate.current) return;
      const pos = editor.getCursorPosition();
      const offset = editor.session.getDocument().positionToIndex(pos);
      onCursorChange?.(offset);
    });

    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== value) {
      silentUpdate.current = true;
      const pos = editor.getCursorPosition();
      editor.setValue(value, -1);
      editor.moveCursorToPosition(pos);
      editor.clearSelection();
      silentUpdate.current = false;
    }
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.session.setMode(MODES[language] || MODES.js);
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setTheme(theme === 'dark' ? 'ace/theme/monokai' : 'ace/theme/chrome');
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !highlight) return;
    const doc = editor.session.getDocument();
    const startPos = doc.indexToPosition(highlight[0]);
    const endPos = doc.indexToPosition(highlight[1]);
    const Range = window.ace.require('ace/range').Range;
    const range = new Range(startPos.row, startPos.column, endPos.row, endPos.column);

    silentUpdate.current = true; // prevent cursor feedback loop
    editor.selection.setRange(range);
    editor.renderer.scrollSelectionIntoView(range.start, range.end, 0.5);
    silentUpdate.current = false;

    if (markerRef.current != null) editor.session.removeMarker(markerRef.current);
    markerRef.current = editor.session.addMarker(range, 'ace_selected-word', 'text');
    return () => {
      if (markerRef.current != null) {
        editor.session.removeMarker(markerRef.current);
        markerRef.current = null;
      }
    };
  }, [highlight]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !containerRef.current) return;
    const observer = new ResizeObserver(() => editor.resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return html`<div class="editor-host" ref=${containerRef}></div>`;
}
