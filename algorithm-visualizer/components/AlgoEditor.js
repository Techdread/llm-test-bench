// Ace-backed source editor with a highlight for the "current line" driven
// by the timeline position.

import { html } from 'htm/preact';
import { useRef, useEffect } from 'preact/hooks';

const MODES = {
  js: 'ace/mode/javascript',
  python: 'ace/mode/python',
};

export function AlgoEditor({ value, language, theme, onChange, currentLine }) {
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

  // Line highlight.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (markerRef.current != null) {
      editor.session.removeMarker(markerRef.current);
      markerRef.current = null;
    }
    if (currentLine == null) return;
    const Range = window.ace.require('ace/range').Range;
    const line = Math.max(0, currentLine - 1);
    const r = new Range(line, 0, line, 1000);
    markerRef.current = editor.session.addMarker(r, 'algo-line-marker', 'fullLine');
    editor.renderer.scrollToLine(line, true, true);
  }, [currentLine]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !containerRef.current) return;
    const observer = new ResizeObserver(() => editor.resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return html`<div class="editor-host" ref=${containerRef}></div>`;
}
