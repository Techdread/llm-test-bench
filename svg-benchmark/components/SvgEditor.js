import { html } from 'htm/preact';
import { useEffect, useRef } from 'preact/hooks';

export function SvgEditor({ value, onChange, theme }) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const silentUpdate = useRef(false);

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    const editor = window.ace.edit(containerRef.current, {
      mode: 'ace/mode/xml',
      theme: theme === 'dark' ? 'ace/theme/one_dark' : 'ace/theme/chrome',
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      showPrintMargin: false,
      wrap: true,
      tabSize: 2,
      useSoftTabs: true,
      scrollPastEnd: 0.5,
    });

    editor.session.on('change', () => {
      if (!silentUpdate.current && onChange) {
        onChange(editor.getValue());
      }
    });

    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // Update theme
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setTheme(theme === 'dark' ? 'ace/theme/one_dark' : 'ace/theme/chrome');
    }
  }, [theme]);

  // Update value without triggering onChange
  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.getValue()) {
      silentUpdate.current = true;
      const pos = editorRef.current.getCursorPosition();
      editorRef.current.setValue(value || '', -1);
      editorRef.current.moveCursorToPosition(pos);
      silentUpdate.current = false;
    }
  }, [value]);

  return html`
    <div class="svg-editor">
      <div class="section-header">
        <span><i class="fa-solid fa-code"></i> SVG Code</span>
      </div>
      <div class="editor-container" ref=${containerRef}></div>
    </div>
  `;
}
