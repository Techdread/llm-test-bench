const encoder = new TextEncoder();

export function normalizeStdin(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

export function createStdinController(stdin = '', options = {}) {
  const initial = normalizeStdin(stdin);
  let buffer = initial;
  let cursor = 0;
  let byteBuffer = encoder.encode(initial);
  let byteCursor = 0;
  const promptedInput = [];
  const interactive = options.interactive === true;
  const promptLabel = options.promptLabel || 'Program is waiting for input';

  const takeRemaining = () => {
    if (cursor >= buffer.length) return '';
    const chunk = buffer.slice(cursor);
    cursor = buffer.length;
    return chunk;
  };

  const takeLine = () => {
    if (cursor < buffer.length) {
      const newlineIndex = buffer.indexOf('\n', cursor);
      if (newlineIndex === -1) {
        const line = buffer.slice(cursor);
        cursor = buffer.length;
        return line;
      }
      const line = buffer.slice(cursor, newlineIndex);
      cursor = newlineIndex + 1;
      return line;
    }

    const prompted = promptForLine();
    return prompted == null ? null : prompted.replace(/\n$/, '');
  };

  const takeChars = (count) => {
    if (!Number.isFinite(count) || count <= 0) return '';
    if (cursor >= buffer.length) {
      const prompted = promptForLine();
      if (prompted == null) return null;
      buffer += prompted;
    }
    const chunk = buffer.slice(cursor, cursor + count);
    cursor += chunk.length;
    return chunk || null;
  };

  const takeNumber = () => {
    while (true) {
      if (cursor >= buffer.length) {
        const prompted = promptForLine();
        if (prompted == null) return null;
        buffer += prompted;
      }

      const rest = buffer.slice(cursor);
      const leading = rest.match(/^\s*/)?.[0]?.length || 0;
      cursor += leading;
      const numberMatch = buffer.slice(cursor).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!numberMatch) {
        return null;
      }
      cursor += numberMatch[0].length;
      return Number(numberMatch[0]);
    }
  };

  const readBytes = (target) => {
    if (byteCursor >= byteBuffer.length) {
      const prompted = promptForLine();
      if (prompted == null) return 0;
      byteBuffer = encoder.encode(prompted);
      byteCursor = 0;
    }

    const length = Math.min(target.length, byteBuffer.length - byteCursor);
    target.set(byteBuffer.subarray(byteCursor, byteCursor + length));
    byteCursor += length;
    return length;
  };

  const drain = () => {
    const remaining = takeRemaining();
    if (remaining) return remaining;
    return promptForLine() || '';
  };

  const promptForLine = () => {
    if (!interactive || typeof window === 'undefined' || typeof window.prompt !== 'function') {
      return null;
    }
    const answer = window.prompt(promptLabel);
    if (answer == null) return null;
    promptedInput.push(answer);
    return answer.endsWith('\n') ? answer : `${answer}\n`;
  };

  return {
    stdin: initial,
    get promptedInput() {
      return promptedInput.slice();
    },
    get consumedInput() {
      return [initial, ...promptedInput.map(line => `${line}\n`)].join('');
    },
    readBytes,
    readLine: takeLine,
    readAll: takeRemaining,
    readChars: takeChars,
    readNumber: takeNumber,
    drain,
  };
}
