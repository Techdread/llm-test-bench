// Ace-backed SQL editor with Ctrl+Enter = Run and a programmatic `insertText`
// handle exposed via apiRef.

import { html } from 'htm/preact';
import { useRef, useEffect } from 'preact/hooks';

export function SqlEditor({ value, theme, onChange, onRun, apiRef }) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const silent = useRef(false);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  useEffect(() => { onChangeRef.current = onChange; onRunRef.current = onRun; });

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;
    const editor = window.ace.edit(containerRef.current, {
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      wrap: false,
      scrollPastEnd: 0.25,
    });
    // Ace's hidden textarea is what screen readers and axe see.
    editor.textInput.getElement().setAttribute('aria-label', 'SQL editor');
    editor.session.setMode('ace/mode/sql');
    editor.setValue(value || '', -1);
    editor.session.on('change', () => {
      if (silent.current) return;
      onChangeRef.current?.(editor.getValue());
    });
    editor.commands.addCommand({
      name: 'runQuery',
      bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' },
      exec: () => onRunRef.current?.(),
    });
    editorRef.current = editor;

    if (apiRef) {
      apiRef.current = {
        insertText: (text) => {
          editor.focus();
          editor.insert(text);
        },
        setValue: (v) => {
          silent.current = true;
          editor.setValue(v || '', -1);
          silent.current = false;
          onChangeRef.current?.(editor.getValue());
        },
        format: () => {
          const current = editor.getValue();
          const formatted = formatSql(current);
          silent.current = true;
          editor.setValue(formatted, -1);
          silent.current = false;
          onChangeRef.current?.(formatted);
        },
        getSelectedOrAll: () => {
          const sel = editor.getSelectedText();
          return sel && sel.trim() ? sel : editor.getValue();
        },
      };
    }

    return () => { editor.destroy(); editorRef.current = null; };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== (value || '')) {
      silent.current = true;
      const pos = editor.getCursorPosition();
      editor.setValue(value || '', -1);
      editor.moveCursorToPosition(pos);
      editor.clearSelection();
      silent.current = false;
    }
  }, [value]);

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

  return html`<div class="sql-editor-host" ref=${containerRef}></div>`;
}

// Very small SQL pretty-printer: line-break before the main keywords and
// indent 2 spaces inside them. Not a full parser — just enough to be helpful.
const KW = /\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|JOIN|UNION ALL|UNION|INTERSECT|EXCEPT|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|CREATE TABLE|CREATE INDEX|DROP TABLE|ALTER TABLE|WITH|ON|AND|OR)\b/gi;
export function formatSql(sql) {
  if (!sql) return sql;
  const statements = sql.split(/;\s*\n?/).map(s => s.trim()).filter(Boolean);
  return statements.map(s => {
    let t = s.replace(/\s+/g, ' ');
    t = t.replace(KW, (m) => '\n' + m.toUpperCase());
    t = t.replace(/\n(AND|OR|ON)\b/g, '\n  $1');
    return t.trim();
  }).join(';\n\n') + ';';
}
