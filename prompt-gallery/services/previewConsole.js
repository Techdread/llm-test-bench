// Error capture for the live Create preview. The generated page runs at an
// opaque origin, so its errors only ever reached DevTools; a one-line script
// injected into the preview posts them to the hub instead.
//
// The script is kept on ONE line and inserted mid-line, so the line numbers the
// browser reports (about:srcdoc:<line>) are the editor's line numbers.

export const PREVIEW_CONSOLE_MESSAGE = 'pg-preview-console';
const MESSAGE_CAP = 2000;
const ENTRY_CAP = 200;

/** The capture script for one preview load. `channel` ties messages to that load. */
export function previewConsoleScript(channel) {
  const body = `(function(){`
    + `var C=${JSON.stringify(String(channel))},T=${JSON.stringify(PREVIEW_CONSOLE_MESSAGE)},sent=0;`
    + `function cut(v){v=String(v==null?'':v);return v.length>${MESSAGE_CAP}?v.slice(0,${MESSAGE_CAP})+'…':v;}`
    + `function fmt(v){try{if(v instanceof Error)return v.stack||v.message;if(v&&typeof v==='object')return JSON.stringify(v);return String(v);}catch(e){return '[unprintable]';}}`
    + `function post(level,message,line,col,stack){if(sent>=500)return;sent++;try{parent.postMessage({type:T,channel:C,entry:{level:level,message:cut(message),line:line||0,col:col||0,stack:cut(stack||'')}},'*');}catch(e){}}`
    + `window.addEventListener('error',function(e){var t=e.target;if(t&&t!==window&&t.tagName){var src=t.src||t.href||'';post('error','Failed to load <'+t.tagName.toLowerCase()+'> '+src,0,0,'');return;}post('error',e.message||'Script error',e.lineno,e.colno,e.error&&e.error.stack);},true);`
    + `window.addEventListener('unhandledrejection',function(e){var r=e.reason;post('error','Unhandled promise rejection: '+(r&&r.message?r.message:fmt(r)),0,0,r&&r.stack);});`
    + `['error','warn'].forEach(function(k){var o=console[k];console[k]=function(){post(k==='warn'?'warning':'error',Array.prototype.map.call(arguments,fmt).join(' '),0,0,'');return o.apply(console,arguments);};});`
    + `})();`;
  return `<script>${body}</script>`;
}

/** Insert the capture script without adding a line, ahead of the page's own scripts. */
export function injectPreviewConsole(htmlContent, channel) {
  const doc = String(htmlContent || '');
  const script = previewConsoleScript(channel);
  if (/<head(?:\s[^>]*)?>/i.test(doc)) return doc.replace(/<head(?:\s[^>]*)?>/i, match => match + script);
  if (/<html(?:\s[^>]*)?>/i.test(doc)) return doc.replace(/<html(?:\s[^>]*)?>/i, match => `${match}<head>${script}</head>`);
  // Never ahead of a doctype: that would drop the page into quirks mode.
  if (/<!doctype[^>]*>/i.test(doc)) return doc.replace(/<!doctype[^>]*>/i, match => match + script);
  return script + doc;
}

/** The line an entry points at: the event's own line, else the first about:srcdoc frame of its stack. */
export function entryLine(entry) {
  if (entry?.line > 0) return { line: entry.line, col: entry.col || 0 };
  const match = /about:srcdoc:(\d+)(?::(\d+))?/.exec(`${entry?.stack || ''}\n${entry?.message || ''}`);
  return match ? { line: Number(match[1]), col: Number(match[2] || 0) } : null;
}

/**
 * Add one posted entry to the list. A repeat (same level, text and place) bumps
 * its count instead of adding a row — an error thrown every animation frame is
 * one row, not thousands.
 */
export function addConsoleEntry(list, raw, { now = Date.now(), cap = ENTRY_CAP } = {}) {
  if (!raw || typeof raw !== 'object') return list;
  const level = raw.level === 'warning' ? 'warning' : 'error';
  const message = String(raw.message || '').slice(0, MESSAGE_CAP + 1) || '(no message)';
  const stack = String(raw.stack || '').slice(0, MESSAGE_CAP + 1);
  const line = Number(raw.line) > 0 ? Math.floor(Number(raw.line)) : 0;
  const col = Number(raw.col) > 0 ? Math.floor(Number(raw.col)) : 0;
  const key = `${level}|${message}|${line}:${col}`;
  const index = list.findIndex(entry => entry.key === key);
  if (index >= 0) {
    const next = list.slice();
    next[index] = { ...list[index], count: list[index].count + 1, lastAt: now };
    return next;
  }
  if (list.length >= cap) return list;
  return [...list, { key, level, message, stack, line, col, count: 1, firstAt: now, lastAt: now }];
}

export function consoleCounts(list) {
  let errors = 0;
  let warnings = 0;
  for (const entry of list || []) {
    if (entry.level === 'warning') warnings++;
    else errors++;
  }
  return { errors, warnings };
}

/** One error per line, in the form the hidden sandbox check and Heal already use. */
export function consoleErrorStrings(list) {
  return (list || [])
    .filter(entry => entry.level !== 'warning')
    .map(entry => {
      const at = entryLine(entry);
      return at ? `${entry.message} at line ${at.line}:${at.col}` : entry.message;
    });
}

/** Plain text for the clipboard (to paste into a chat with a model, an issue, …). */
export function formatConsoleForCopy(list) {
  return (list || []).map(entry => {
    const at = entryLine(entry);
    const head = `[${entry.level}]${entry.count > 1 ? ` ×${entry.count}` : ''} ${entry.message}${at ? ` (line ${at.line}${at.col ? `:${at.col}` : ''})` : ''}`;
    return entry.stack && !entry.stack.includes(entry.message) ? `${head}\n${entry.stack}` : head;
  }).join('\n\n');
}

/**
 * The run status handed to Refine. Errors seen in the live preview are added
 * to the hidden check's, so Heal sees a crash the 2.5s check missed.
 */
export function mergePreviewErrors(runStatus, list) {
  const live = consoleErrorStrings(list);
  if (!live.length) return runStatus || null;
  if (!runStatus) {
    return { ok: false, errors: live, warnings: [], logs: [], duration: 0, timedOut: false, evidence: {}, source: 'preview' };
  }
  const errors = [...(runStatus.errors || [])];
  for (const error of live) if (!errors.includes(error)) errors.push(error);
  return { ...runStatus, ok: false, errors };
}
