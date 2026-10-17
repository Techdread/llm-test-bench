export class VirtualFileSystem {
  constructor(virtualFiles = [], config) {
    this.config = config;
    this.files = new Map();
    for (const file of virtualFiles) {
      this.files.set(file.name, {
        id: file.id || file.name,
        name: file.name,
        content: file.content || '',
        readonly: !!file.readonly,
        createdByLesson: !!file.createdByLesson,
      });
    }
    this.handles = [];
    this.nextHandle = 3;
  }

  listFiles() {
    return [...this.files.values()].map(file => ({ ...file }));
  }

  open(name, mode) {
    let file = this.files.get(name);
    if (!file && mode.includes('r')) return { ok: false, error: `virtual file "${name}" not found`, handle: 0 };
    if (!file || mode.includes('w')) {
      file = { id: name, name, content: '', readonly: false, createdByLesson: false };
      this.files.set(name, file);
    }
    const handle = {
      id: this.nextHandle++,
      filename: name,
      mode,
      offset: mode.includes('a') ? file.content.length : 0,
      eof: false,
      error: '',
      open: true,
      bufferPreview: '',
    };
    this.handles.push(handle);
    return { ok: true, handle };
  }

  close(handleId) {
    const handle = this.handles.find(h => h.id === handleId && h.open);
    if (!handle) return { ok: false, error: `invalid file handle ${handleId}` };
    handle.open = false;
    return { ok: true, handle };
  }

  getHandle(handleId) {
    return this.handles.find(h => h.id === handleId && h.open) || null;
  }

  readChar(handleId) {
    const handle = this.getHandle(handleId);
    if (!handle) return { ok: false, error: `invalid file handle ${handleId}`, value: -1 };
    const file = this.files.get(handle.filename);
    if (handle.offset >= file.content.length) {
      handle.eof = true;
      handle.bufferPreview = 'EOF';
      return { ok: true, value: -1, handle };
    }
    const value = file.content.charCodeAt(handle.offset) & 0xff;
    handle.offset += 1;
    handle.bufferPreview = String.fromCharCode(value);
    return { ok: true, value, handle };
  }

  writeChar(handleId, value) {
    const handle = this.getHandle(handleId);
    if (!handle) return { ok: false, error: `invalid file handle ${handleId}` };
    if (!/[wa+]/.test(handle.mode)) return { ok: false, error: `file handle ${handleId} is not writable` };
    const file = this.files.get(handle.filename);
    const ch = String.fromCharCode(value & 0xff);
    file.content = file.content.slice(0, handle.offset) + ch + file.content.slice(handle.offset + 1);
    handle.offset += 1;
    handle.bufferPreview = ch;
    return { ok: true, handle, value: ch };
  }

  writeString(handleId, value) {
    const handle = this.getHandle(handleId);
    if (!handle) return { ok: false, error: `invalid file handle ${handleId}` };
    if (!/[wa+]/.test(handle.mode)) return { ok: false, error: `file handle ${handleId} is not writable` };
    const file = this.files.get(handle.filename);
    const text = String(value);
    file.content = file.content.slice(0, handle.offset) + text + file.content.slice(handle.offset + text.length);
    handle.offset += text.length;
    handle.bufferPreview = text.slice(-40);
    return { ok: true, handle, bytes: text.length };
  }

  rewind(handleId) {
    const handle = this.getHandle(handleId);
    if (!handle) return { ok: false, error: `invalid file handle ${handleId}` };
    handle.offset = 0;
    handle.eof = false;
    handle.bufferPreview = 'rewind';
    return { ok: true, handle };
  }
}
