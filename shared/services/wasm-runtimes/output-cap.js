// Output cap shared by the Rust, Lua and C runners.
//
// Long output is cut so a runaway loop can't flood the page, but a
// `__NB_SET__ {json}` line is never cut: Notebook Lab parses it as JSON, and
// half a line silently loses the whole value.

const NB_MARKER = '__NB_SET__';

export function capOutput(text, maxLen = 50000) {
  if (text.length <= maxLen) return text;
  const kept = [];
  let room = maxLen;
  let cut = false;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith(NB_MARKER)) {
      kept.push(line);
    } else if (cut) {
      continue;
    } else if (line.length + 1 <= room) {
      kept.push(line);
      room -= line.length + 1;
    } else {
      kept.push(line.slice(0, room));
      cut = true;
    }
  }
  return kept.join('\n') + (cut ? '\n... (output truncated)' : '');
}
