// In-memory workspace — files as name→content Map.
// Snapshot returns an independent copy so diffs are stable.

export function createWorkspace() {
  const files = new Map();

  return {
    writeFile(name, content) {
      files.set(name, content);
    },
    readFile(name) {
      if (!files.has(name)) throw new Error(`File not found: ${name}`);
      return files.get(name);
    },
    editFile(name, oldString, newString) {
      if (!files.has(name)) throw new Error(`File not found: ${name}`);
      const content = files.get(name);
      const idx = content.indexOf(oldString);
      if (idx === -1) {
        throw new Error(`old_string not found in ${name}`);
      }
      // Ensure uniqueness.
      const second = content.indexOf(oldString, idx + oldString.length);
      if (second !== -1) {
        let count = 1;
        let pos = idx;
        while (true) {
          const next = content.indexOf(oldString, pos + oldString.length);
          if (next === -1) break;
          count++;
          pos = next;
        }
        throw new Error(`old_string appears ${count} times in ${name} — include more surrounding context to make it unique`);
      }
      files.set(name, content.slice(0, idx) + newString + content.slice(idx + oldString.length));
    },
    deleteFile(name) {
      files.delete(name);
    },
    listFiles() {
      return [...files.keys()].sort();
    },
    fileCount() {
      return files.size;
    },
    hasFile(name) {
      return files.has(name);
    },
    snapshot() {
      return new Map(files);
    },
    toObject() {
      const obj = {};
      for (const [k, v] of files) obj[k] = v;
      return obj;
    },
    loadFromObject(obj) {
      files.clear();
      for (const [k, v] of Object.entries(obj || {})) files.set(k, v);
    },
  };
}

/**
 * Compute a simple unified-style diff between two strings.
 * Returns {changed, unified} where unified is a line-prefixed diff string.
 */
export function computeDiff(before, after) {
  if (before === after) return { changed: false, unified: '' };
  // Strip a single trailing newline before splitting so files that end with
  // `\n` don't produce a phantom empty last line in the diff output.
  const stripTrailingNewline = (s) => (s.endsWith('\n') ? s.slice(0, -1) : s);
  const beforeLines = stripTrailingNewline(before).split('\n');
  const afterLines = stripTrailingNewline(after).split('\n');
  const lines = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      if (b !== undefined) lines.push('  ' + b);
    } else {
      if (b !== undefined) lines.push('- ' + b);
      if (a !== undefined) lines.push('+ ' + a);
    }
  }
  return { changed: true, unified: lines.join('\n') };
}
