// debianVm — a singleton Debian i386 VM (real gcc/g++) running in v86 (a wasm x86
// emulator) on the main thread. Polyglot Forge's C/C++ module compiles with the
// REAL GNU toolchain inside it (spec 278 Linux Toolbox). Boots once (~30s, streams
// the image), then is reused for every compile.
//
// Assets: v86 engine in shared/lib/v86/master/; the Debian 9p image + custom 9p
// kernel in v86-test/ (built per v86-test/BUILD.md — large, gitignored).

const ENGINE = '../shared/lib/v86/master/';
const IMAGE = '../v86-test/';

let vmPromise = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isBooted() { return !!vmPromise; }

function hiddenScreen() {
  let el = document.getElementById('pf-v86-screen');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'pf-v86-screen';
  el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;';
  el.innerHTML = '<div style="white-space:pre;font:14px monospace"></div><canvas style="display:none"></canvas>';
  document.body.appendChild(el);
  return el;
}

export function ensureVm(onStatus) {
  if (vmPromise) return vmPromise;
  vmPromise = boot(onStatus).catch((err) => { vmPromise = null; throw err; });
  return vmPromise;
}

async function boot(onStatus) {
  if (!window.V86) throw new Error('v86 engine not loaded (libv86.js missing).');
  onStatus?.({ phase: 'loading', label: 'Booting Debian Linux (gcc) — first run streams the image…' });

  const vm = { serial: '' };
  vm.emulator = new window.V86({
    wasm_path: ENGINE + 'v86.wasm',
    memory_size: 512 * 1024 * 1024,   // headroom for rustc/g++
    vga_memory_size: 8 * 1024 * 1024,
    screen_container: hiddenScreen(),
    bios: { url: ENGINE + 'bios/seabios.bin' },
    vga_bios: { url: ENGINE + 'bios/vgabios.bin' },
    bzimage: { url: IMAGE + 'images/bzImage-9p.bin' },
    filesystem: { basefs: IMAGE + 'debian-fs.json', baseurl: IMAGE + 'flat/' },
    cmdline: 'rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose ' +
             'init=/bin/sh console=ttyS0,115200 tsc=reliable',
    autostart: true,
  });
  vm.emulator.add_listener('serial0-output-byte', (b) => { vm.serial += String.fromCharCode(b); });

  // Wait for a live shell: probe until a unique echo round-trips.
  const deadline = Date.now() + 180000;
  let ready = false;
  while (Date.now() < deadline) {
    await sleep(2500);
    const probe = 'PFUP' + Math.floor(Math.random() * 1e6);
    vm.emulator.serial0_send('echo ' + probe + '_$((6*7))\n');
    await sleep(1200);
    if (vm.serial.includes(probe + '_42')) { ready = true; break; }
    onStatus?.({ phase: 'loading', label: 'Booting Debian Linux (gcc)…' });
  }
  if (!ready) throw new Error('Debian VM did not reach a shell in time.');

  // One-time environment: PATH, /proc (rustc reads /proc/self/exe for its
  // sysroot), /sys, and a fast writable /tmp.
  vm.emulator.serial0_send(
    'export PATH=/usr/bin:/bin:/sbin:/usr/sbin; ' +
    'mount -t proc proc /proc 2>/dev/null; ' +
    'mount -t sysfs sysfs /sys 2>/dev/null; ' +
    'mount -t tmpfs tmpfs /tmp 2>/dev/null; cd /tmp\n');
  await sleep(1000);
  onStatus?.({ phase: 'ready' });
  return vm;
}

const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const fromB64 = (s) => { try { return decodeURIComponent(escape(atob(s))); } catch { try { return atob(s); } catch { return ''; } } };

// The guest's tty drops anything past ~4 KB on one line, so a file is typed in
// as base64 chunks appended to a scratch file, then decoded in one go. A single
// `echo <base64>` line silently wrote nothing for sources over about 3 KB.
const TTY_CHUNK = 2400;

function writeFileLines(text, path) {
  const tmp = `${path}.b64`;
  const chunks = b64(text).match(new RegExp(`.{1,${TTY_CHUNK}}`, 'g')) || [];
  return `: > ${tmp}\n`
    + chunks.map((chunk) => `echo ${chunk} >> ${tmp}\n`).join('')
    + `base64 -d ${tmp} > ${path}; rm -f ${tmp}\n`;
}

/** The shell script compileAndRun types into the guest. Pure, for tests. */
export function buildRunScript({ nonce, source, stdin = '', srcName, compileCmd, runCmd, files = [] }) {
  return `M=${nonce}\n` +
    `cd /tmp\n` +
    `export LC_ALL=C.UTF-8\n` +                // else the JVM prints £, é, … as '?'
    writeFileLines(source, srcName) +
    files.map((file) => writeFileLines(file.text, file.name)).join('') +
    writeFileLines(stdin, '.in') +
    `rm -f prog .out .rerr\n` +                 // no stale output if the compile fails
    `${compileCmd} 2> .cerr; CC=$?\n` +
    `if [ $CC -eq 0 ]; then ${runCmd} < .in > .out 2> .rerr; RC=$?; else RC=$CC; fi\n` +
    `echo "\${M}O=$(base64 -w0 .out 2>/dev/null)"\n` +
    `echo "\${M}C=$(base64 -w0 .cerr 2>/dev/null)"\n` +
    `echo "\${M}E=$(base64 -w0 .rerr 2>/dev/null)"\n` +
    `echo "\${M}R=$RC"\n` +
    `echo "\${M}Z"\n`;
}

// Compile a program with a real toolchain and run it. Language-agnostic: the
// caller supplies the source filename, the compile command (writing the binary
// to ./prog), the run command, and any other `files` ({ name, text }) the run
// needs beside the source. Each output stream is emitted as a single
// base64 line tagged with a per-call marker — base64 has no spaces/newlines, so
// the captured value is immune to tty command-echo, shell prompts and CRLF.
export async function compileAndRun({
  source, stdin = '', srcName = 'main.c', compileCmd = 'gcc -O0 main.c -o prog',
  runCmd = './prog', onStatus, timeoutMs = 240000, files = [],
}) {
  const vm = await ensureVm(onStatus);
  onStatus?.({ phase: 'running' });

  const nonce = 'PFR' + Math.random().toString(36).slice(2, 10);
  const script = buildRunScript({ nonce, source, stdin, srcName, compileCmd, runCmd, files });

  const startLen = vm.serial.length;
  vm.emulator.serial0_send(script);

  const endTok = nonce + 'Z';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (vm.serial.indexOf(endTok, startLen) !== -1) break;
    await sleep(400);
  }
  const out = vm.serial.slice(startLen);
  const timedOut = out.indexOf(endTok) === -1;

  // Match each marker's value (base64 / digits) — only the *expanded* marker
  // appears (the echoed command shows the literal "${M}…").
  const grab = (tag) => { const m = out.match(new RegExp(nonce + tag + '=([A-Za-z0-9+/=]*)')); return m ? m[1] : ''; };
  const rc = out.match(new RegExp(nonce + 'R=(-?\\d+)'));

  return {
    stdout: fromB64(grab('O')),
    cerr: fromB64(grab('C')),
    rerr: fromB64(grab('E')),
    exitCode: timedOut ? 124 : (rc ? parseInt(rc[1], 10) : 1),
    timedOut,
  };
}
