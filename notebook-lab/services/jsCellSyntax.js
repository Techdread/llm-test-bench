// jsCellSyntax — the editor's syntax check for JavaScript cells.
//
// A JS cell runs as the body of an async function (services/runnerJs.js), so
// top-level `await` and `return` are valid. Ace's built-in checker (JSHint)
// predates that, and newer syntax such as `3_600_000` and `#private` fields,
// so it marked working cells with errors. Acorn parses the code the way the
// cell actually runs it, and only reports what would really fail.

import { parse } from '../../shared/lib/acorn/8.11.3/acorn.mjs';

const CELL_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
};

/** Ace annotations for a JS cell: empty when it parses, else one error. */
export function checkJsCell(code) {
  try {
    parse(String(code ?? ''), CELL_OPTIONS);
    return [];
  } catch (error) {
    if (!error?.loc) return [];
    return [{
      row: error.loc.line - 1,
      column: error.loc.column,
      type: 'error',
      text: String(error.message).replace(/\s*\(\d+:\d+\)$/, ''),
    }];
  }
}
