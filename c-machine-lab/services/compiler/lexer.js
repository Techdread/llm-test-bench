import { diagnostic, unsupported } from './diagnostics.js';

const KEYWORDS = new Set(['int', 'char', 'void', 'if', 'else', 'while', 'for', 'return', 'break', 'continue']);
const TWO_CHAR = new Set(['==', '!=', '<=', '>=', '&&', '||', '++', '--']);
const ONE_CHAR = new Set(['{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '<', '>', '=', '!', '&']);
const ALLOWED_INCLUDES = new Set(['stdio.h', 'stdlib.h', 'string.h']);

export function lex(source) {
  const tokens = [];
  const diagnostics = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const current = () => source[i] || '';
  const next = () => source[i + 1] || '';
  const advance = () => {
    const ch = source[i++] || '';
    if (ch === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return ch;
  };
  const startToken = () => ({ line, column, index: i });
  const push = (type, value, start, extra = {}) => {
    tokens.push({
      type,
      value,
      line: start.line,
      column: start.column,
      index: start.index,
      endLine: line,
      endColumn: column,
      ...extra,
    });
  };

  while (i < source.length) {
    const ch = current();

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    if (ch === '#' && column === 1) {
      const start = startToken();
      let text = '';
      while (i < source.length && current() !== '\n') text += advance();
      const include = text.match(/^#\s*include\s*[<"]([^>"]+)[>"]/);
      if (include) {
        if (!ALLOWED_INCLUDES.has(include[1])) {
          diagnostics.push(unsupported('multi-file includes are not supported; only stdio.h, stdlib.h, and string.h are ignored metadata', start));
        }
      } else if (/^#\s*define\b/.test(text)) {
        diagnostics.push(unsupported('macros are not part of the teaching subset', start));
      } else {
        diagnostics.push(unsupported('preprocessor directives beyond the standard teaching includes are not supported', start));
      }
      continue;
    }

    if (ch === '/' && next() === '/') {
      while (i < source.length && current() !== '\n') advance();
      continue;
    }

    if (ch === '/' && next() === '*') {
      const start = startToken();
      advance();
      advance();
      while (i < source.length && !(current() === '*' && next() === '/')) advance();
      if (i >= source.length) {
        diagnostics.push(diagnostic('unterminated block comment', start));
      } else {
        advance();
        advance();
      }
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = startToken();
      let value = '';
      while (/[A-Za-z0-9_]/.test(current())) value += advance();
      push(KEYWORDS.has(value) ? 'keyword' : 'identifier', value, start);
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = startToken();
      let raw = '';
      if (ch === '0' && (next() === 'x' || next() === 'X')) {
        raw += advance();
        raw += advance();
        while (/[0-9a-fA-F]/.test(current())) raw += advance();
      } else {
        while (/[0-9]/.test(current())) raw += advance();
      }
      const value = raw.startsWith('0x') || raw.startsWith('0X') ? parseInt(raw, 16) : parseInt(raw, 10);
      push('number', raw, start, { numberValue: Number.isFinite(value) ? value : 0 });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = startToken();
      advance();
      let value = '';
      let terminated = false;
      while (i < source.length) {
        const c = advance();
        if (c === quote) {
          terminated = true;
          break;
        }
        if (c === '\\') {
          const escaped = advance();
          value += decodeEscape(escaped);
        } else {
          value += c;
        }
      }
      if (!terminated) diagnostics.push(diagnostic(`unterminated ${quote === '"' ? 'string' : 'character'} literal`, start));
      if (quote === "'") {
        push('number', `'${value}'`, start, { numberValue: value.charCodeAt(0) || 0 });
      } else {
        push('string', value, start);
      }
      continue;
    }

    const two = ch + next();
    if (TWO_CHAR.has(two)) {
      const start = startToken();
      advance();
      advance();
      if (two === '++' || two === '--') {
        diagnostics.push(unsupported('++ and -- are not part of the first teaching subset; use i = i + 1 instead', start));
      }
      push('symbol', two, start);
      continue;
    }

    if (ONE_CHAR.has(ch)) {
      const start = startToken();
      push('symbol', advance(), start);
      continue;
    }

    const start = startToken();
    diagnostics.push(diagnostic(`unexpected character "${ch}"`, start));
    advance();
  }

  tokens.push({ type: 'eof', value: '<eof>', line, column, endLine: line, endColumn: column, index: i });
  return { tokens, diagnostics };
}

function decodeEscape(ch) {
  if (ch === 'n') return '\n';
  if (ch === 't') return '\t';
  if (ch === 'r') return '\r';
  if (ch === '0') return '\0';
  if (ch === '\\') return '\\';
  if (ch === '"') return '"';
  if (ch === "'") return "'";
  return ch;
}
