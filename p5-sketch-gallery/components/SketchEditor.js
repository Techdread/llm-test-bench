import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';

export function SketchEditor({ code, onChange, theme }) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const silentUpdate = useRef(false);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    const editor = window.ace.edit(containerRef.current, {
      mode: 'ace/mode/javascript',
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      wrap: true,
      scrollPastEnd: 0.5,
    });
    editor.setValue(code || '', -1);
    editor.session.on('change', () => {
      if (silentUpdate.current) return;
      onChange(editor.getValue());
    });
    editorRef.current = editor;
    return () => { editor.destroy(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== code) {
      silentUpdate.current = true;
      const pos = editor.getCursorPosition();
      editor.setValue(code || '', -1);
      editor.moveCursorToPosition(pos);
      editor.clearSelection();
      silentUpdate.current = false;
    }
  }, [code]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setTheme(theme === 'dark' ? 'ace/theme/monokai' : 'ace/theme/chrome');
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !containerRef.current) return;
    const ro = new ResizeObserver(() => editor.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return html`
    <div class="response-section">
      <div class="section-header">
        <span><i class="fa-solid fa-code"></i> Sketch source (sketch(p, ctx))</span>
      </div>
      <div class="editor-container" ref=${containerRef}></div>
    </div>
  `;
}
