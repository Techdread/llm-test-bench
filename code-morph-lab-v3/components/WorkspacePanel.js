import { html } from 'htm/preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';

function aceModeForFile(fileName) {
  if (!fileName) return 'ace/mode/text';
  if (fileName.endsWith('.html')) return 'ace/mode/html';
  if (fileName.endsWith('.css')) return 'ace/mode/css';
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) return 'ace/mode/javascript';
  if (fileName.endsWith('.json')) return 'ace/mode/json';
  if (fileName.endsWith('.py')) return 'ace/mode/python';
  if (fileName.endsWith('.md')) return 'ace/mode/markdown';
  return 'ace/mode/text';
}

export function WorkspacePanel({ files, selectedFile, onSelectFile, readOnly = true, snapshot }) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const content = useMemo(
    () => selectedFile && snapshot ? (snapshot[selectedFile] ?? '') : '',
    [selectedFile, snapshot]
  );

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    const ace = window.ace;
    if (!ace) return;

    const editor = ace.edit(containerRef.current, {
      mode: aceModeForFile(selectedFile),
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      wrap: true,
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      readOnly,
      highlightActiveLine: !readOnly,
      highlightGutterLine: !readOnly,
      scrollPastEnd: 0.5,
    });
    // Ace's hidden textarea is what screen readers and axe see.
    editor.textInput.getElement().setAttribute('aria-label', 'Workspace file editor');
    editor.setTheme(document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'ace/theme/monokai'
      : 'ace/theme/chrome');
    editor.setValue(content, -1);
    editor.renderer.$cursorLayer.element.style.display = readOnly ? 'none' : '';
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== content) {
      const position = editor.getCursorPosition();
      editor.setValue(content, -1);
      editor.moveCursorToPosition(position);
      editor.clearSelection();
    }
  }, [content]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.session.setMode(aceModeForFile(selectedFile));
  }, [selectedFile]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setReadOnly(readOnly);
    editor.setOption('highlightActiveLine', !readOnly);
    editor.setOption('highlightGutterLine', !readOnly);
    editor.renderer.$cursorLayer.element.style.display = readOnly ? 'none' : '';
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      editor.setTheme(isDark ? 'ace/theme/monokai' : 'ace/theme/chrome');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !containerRef.current) return;
    const observer = new ResizeObserver(() => editor.resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return html`
    <div class="workspace-panel">
      <div class="workspace-files">
        ${files.length === 0
          ? html`<div class="workspace-empty">No files yet</div>`
          : files.map(f => html`
            <button
              key=${f}
              class=${`workspace-file ${f === selectedFile ? 'workspace-file-active' : ''}`}
              onClick=${() => onSelectFile(f)}
            >${f}</button>
          `)}
      </div>
      <div class="workspace-code-editor" ref=${containerRef}></div>
    </div>
  `;
}
