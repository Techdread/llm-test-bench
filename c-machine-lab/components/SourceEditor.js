import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';

export function SourceEditor({ source, onSourceChange, theme, currentLine, diagnostics, onCompile }) {
  const nodeRef = useRef(null);
  const editorRef = useRef(null);
  const markerRef = useRef(null);
  const suppressRef = useRef(false);
  const changeRef = useRef(onSourceChange);
  const compileRef = useRef(onCompile);
  changeRef.current = onSourceChange;
  compileRef.current = onCompile;

  useEffect(() => {
    if (!nodeRef.current || editorRef.current || !window.ace) return;
    const editor = window.ace.edit(nodeRef.current);
    editor.setOptions({
      fontSize: 13,
      fontFamily: 'var(--font-mono)',
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      wrap: true,
    });
    editor.session.setMode('ace/mode/c_cpp');
    editor.session.on('change', () => {
      if (!suppressRef.current) changeRef.current(editor.getValue());
    });
    editor.commands.addCommand({
      name: 'compileCml',
      bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' },
      exec: () => compileRef.current?.(),
    });
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.setTheme(theme === 'dark' ? 'ace/theme/monokai' : 'ace/theme/chrome');
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== source) {
      suppressRef.current = true;
      editor.setValue(source || '', -1);
      suppressRef.current = false;
    }
  }, [source]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const Range = window.ace.require('ace/range').Range;
    if (markerRef.current != null) editor.session.removeMarker(markerRef.current);
    if (currentLine) {
      markerRef.current = editor.session.addMarker(new Range(currentLine - 1, 0, currentLine - 1, 1), 'ace-current-source-line', 'fullLine');
    }
  }, [currentLine]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.session.setAnnotations((diagnostics || []).map(d => ({
      row: Math.max(0, (d.line || 1) - 1),
      column: Math.max(0, (d.column || 1) - 1),
      text: d.message,
      type: d.severity === 'warning' ? 'warning' : 'error',
    })));
  }, [diagnostics]);

  return html`
    <section class="panel source-panel">
      <div class="panel-header">
        <span><i class="fa-solid fa-file-code"></i> C Source</span>
        <span class=${`diag-count ${(diagnostics || []).some(d => d.severity === 'error') ? 'has-errors' : ''}`}>
          ${(diagnostics || []).length} diagnostics
        </span>
      </div>
      <div class="source-editor" ref=${nodeRef}></div>
      ${(diagnostics || []).length > 0 && html`
        <div class="diagnostics-strip">
          ${(diagnostics || []).slice(0, 3).map(d => html`
            <div class=${`diagnostic diagnostic-${d.severity}`} key=${`${d.line}:${d.column}:${d.message}`}>
              <span>${d.line}:${d.column}</span> ${d.message}
            </div>
          `)}
        </div>
      `}
    </section>
  `;
}
