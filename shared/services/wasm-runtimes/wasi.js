// wasi — just enough WASI (preview1) to run xcc's C compiler and the programs
// it builds (c-xcc.worker.js), over an in-memory file system. No DOM and no
// Node APIs, so it runs in a page, a worker or node. One preopened directory,
// "/", so every path is absolute.

const ERR = { SUCCESS: 0, BADF: 8, EXIST: 20, INVAL: 28, ISDIR: 31, NOENT: 44, NOTDIR: 54 };
const FILETYPE = { CHAR: 2, DIR: 3, FILE: 4 };
const OFLAGS = { CREAT: 1, DIRECTORY: 2, EXCL: 4, TRUNC: 8 };
const FDFLAG_APPEND = 1;
const ROOT_FD = 3;

export class WasiExit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

const norm = (p) => '/' + p.split('/').filter((s) => s && s !== '.').reduce((out, s) => (s === '..' ? out.slice(0, -1) : [...out, s]), []).join('/');

// A file is a node { data }, so an open handle keeps it alive after it is
// unlinked, as on Unix: the compiler writes a temp file, unlinks it, keeps using it.
export class MemFs {
  constructor() { this.files = new Map(); }               // absolute path -> { data: Uint8Array }
  write(path, data) { this.files.set(norm(path), { data: typeof data === 'string' ? new TextEncoder().encode(data) : data }); }
  read(path) { return this.files.get(norm(path))?.data; }
  isDir(path) {
    const p = norm(path);
    if (p === '/') return true;
    for (const k of this.files.keys()) if (k.startsWith(p + '/')) return true;
    return false;
  }
}

/**
 * Run a WASI module to completion.
 * @returns {{ exitCode: number|null, trap: Error|null, stdout: string, stderr: string }}
 */
export async function runWasi(module, { args = ['prog'], fs = new MemFs(), stdin = '', cwd = '/', env = null } = {}) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let memory;
  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);
  const str = (ptr, len) => decoder.decode(bytes().subarray(ptr, ptr + len));
  const out = { 1: [], 2: [] };
  const stdinBytes = encoder.encode(stdin);
  let stdinPos = 0;

  const fds = new Map();   // fd -> { path, data, pos, append, dir }
  let nextFd = ROOT_FD + 1;
  const argBytes = args.map((a) => encoder.encode(a + '\0'));

  const resolve = (dirfd, ptr, len) => {
    const rel = str(ptr, len);
    const base = dirfd === ROOT_FD ? '/' : (fds.get(dirfd)?.path || cwd);
    return norm(rel.startsWith('/') ? rel : `${base}/${rel}`);
  };
  const writeStat = (ptr, filetype, size) => {
    const v = view();
    for (let i = 0; i < 64; i++) v.setUint8(ptr + i, 0);
    v.setUint8(ptr + 16, filetype);
    v.setBigUint64(ptr + 24, 1n, true);
    v.setBigUint64(ptr + 32, BigInt(size), true);
  };

  const wasi = {
    args_sizes_get(argcPtr, sizePtr) {
      view().setUint32(argcPtr, args.length, true);
      view().setUint32(sizePtr, argBytes.reduce((n, b) => n + b.length, 0), true);
      return ERR.SUCCESS;
    },
    args_get(argvPtr, bufPtr) {
      let p = bufPtr;
      argBytes.forEach((b, i) => { view().setUint32(argvPtr + i * 4, p, true); bytes().set(b, p); p += b.length; });
      return ERR.SUCCESS;
    },
    environ_sizes_get(countPtr, sizePtr) { view().setUint32(countPtr, 0, true); view().setUint32(sizePtr, 0, true); return ERR.SUCCESS; },
    environ_get() { return ERR.SUCCESS; },
    fd_prestat_get(fd, ptr) {
      if (fd !== ROOT_FD) return ERR.BADF;
      view().setUint8(ptr, 0);
      view().setUint32(ptr + 4, 1, true);
      return ERR.SUCCESS;
    },
    fd_prestat_dir_name(fd, ptr, len) {
      if (fd !== ROOT_FD) return ERR.BADF;
      bytes().set(encoder.encode('/').subarray(0, len), ptr);
      return ERR.SUCCESS;
    },
    path_open(dirfd, _dirflags, pathPtr, pathLen, oflags, _rb, _ri, fdflags, fdPtr) {
      const path = resolve(dirfd, pathPtr, pathLen);
      const exists = fs.files.has(path);
      if (fs.isDir(path) && !exists) {
        if (oflags & OFLAGS.CREAT) return ERR.ISDIR;
        const fd = nextFd++;
        fds.set(fd, { path, dir: true, pos: 0 });
        view().setUint32(fdPtr, fd, true);
        return ERR.SUCCESS;
      }
      if (oflags & OFLAGS.DIRECTORY) return ERR.NOTDIR;
      if (!exists && !(oflags & OFLAGS.CREAT)) return ERR.NOENT;
      if (exists && (oflags & OFLAGS.EXCL)) return ERR.EXIST;
      if (!exists || (oflags & OFLAGS.TRUNC)) fs.files.set(path, { data: new Uint8Array(0) });
      const fd = nextFd++;
      fds.set(fd, { path, node: fs.files.get(path), pos: 0, append: !!(fdflags & FDFLAG_APPEND) });
      view().setUint32(fdPtr, fd, true);
      return ERR.SUCCESS;
    },
    fd_read(fd, iovs, iovsLen, nreadPtr) {
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        let chunk;
        if (fd === 0) {
          chunk = stdinBytes.subarray(stdinPos, stdinPos + len);
          stdinPos += chunk.length;
        } else {
          const f = fds.get(fd);
          if (!f || f.dir) return ERR.BADF;
          const data = f.node.data;
          chunk = data.subarray(f.pos, f.pos + len);
          f.pos += chunk.length;
        }
        bytes().set(chunk, ptr);
        total += chunk.length;
        if (chunk.length < len) break;
      }
      view().setUint32(nreadPtr, total, true);
      return ERR.SUCCESS;
    },
    fd_write(fd, iovs, iovsLen, nwrittenPtr) {
      let total = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view().getUint32(iovs + i * 8, true);
        const len = view().getUint32(iovs + i * 8 + 4, true);
        const chunk = bytes().slice(ptr, ptr + len);
        if (fd === 1 || fd === 2) {
          out[fd].push(chunk);
        } else {
          const f = fds.get(fd);
          if (!f || f.dir) return ERR.BADF;
          let data = f.node.data;
          if (f.append) f.pos = data.length;
          if (f.pos + len > data.length) {
            const grown = new Uint8Array(Math.max(f.pos + len, data.length * 2));
            grown.set(data);
            data = grown.subarray(0, f.pos + len);
          }
          data.set(chunk, f.pos);
          f.node.data = data;
          f.pos += len;
        }
        total += len;
      }
      view().setUint32(nwrittenPtr, total, true);
      return ERR.SUCCESS;
    },
    fd_seek(fd, offset, whence, newOffsetPtr) {
      const f = fds.get(fd);
      if (!f) return fd <= 2 ? ERR.SUCCESS : ERR.BADF;
      const size = f.node?.data.length || 0;
      const base = whence === 0 ? 0 : whence === 1 ? f.pos : size;
      f.pos = Math.max(0, base + Number(offset));
      view().setBigUint64(newOffsetPtr, BigInt(f.pos), true);
      return ERR.SUCCESS;
    },
    fd_close(fd) { fds.delete(fd); return ERR.SUCCESS; },
    fd_filestat_get(fd, ptr) {
      if (fd <= 2) { writeStat(ptr, FILETYPE.CHAR, 0); return ERR.SUCCESS; }
      if (fd === ROOT_FD) { writeStat(ptr, FILETYPE.DIR, 0); return ERR.SUCCESS; }
      const f = fds.get(fd);
      if (!f) return ERR.BADF;
      writeStat(ptr, f.dir ? FILETYPE.DIR : FILETYPE.FILE, f.dir ? 0 : f.node.data.length);
      return ERR.SUCCESS;
    },
    path_filestat_get(dirfd, _flags, pathPtr, pathLen, ptr) {
      const path = resolve(dirfd, pathPtr, pathLen);
      if (fs.files.has(path)) { writeStat(ptr, FILETYPE.FILE, fs.files.get(path).data.length); return ERR.SUCCESS; }
      if (fs.isDir(path)) { writeStat(ptr, FILETYPE.DIR, 0); return ERR.SUCCESS; }
      return ERR.NOENT;
    },
    path_unlink_file(dirfd, pathPtr, pathLen) {
      const path = resolve(dirfd, pathPtr, pathLen);
      if (!fs.files.delete(path)) return ERR.NOENT;
      return ERR.SUCCESS;
    },
    random_get(ptr, len) {
      const buf = bytes().subarray(ptr, ptr + len);
      for (let i = 0; i < len; i += 65536) globalThis.crypto.getRandomValues(buf.subarray(i, Math.min(len, i + 65536)));
      return ERR.SUCCESS;
    },
    clock_time_get(_id, _precision, timePtr) {
      view().setBigUint64(timePtr, BigInt(Math.round(performance.now() * 1e6)), true);
      return ERR.SUCCESS;
    },
    proc_exit(code) { throw new WasiExit(code); },
  };

  // `env(getMemory)` supplies extra imports (the C cells' nb_* functions); they
  // reach the module's memory through the getter once it exists.
  const imports = { wasi_snapshot_preview1: wasi };
  if (env) imports.env = env(() => memory);
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory;
  // A crash (a WebAssembly trap, or an error thrown by an import) still hands
  // back what the program printed before it.
  let exitCode = 0;
  let trap = null;
  try {
    instance.exports._start();
  } catch (error) {
    if (error instanceof WasiExit) exitCode = error.code;
    else { exitCode = null; trap = error; }
  }
  const join = (chunks) => decoder.decode(chunks.reduce((acc, c) => { const n = new Uint8Array(acc.length + c.length); n.set(acc); n.set(c, acc.length); return n; }, new Uint8Array(0)));
  return { exitCode, trap, stdout: join(out[1]), stderr: join(out[2]) };
}
