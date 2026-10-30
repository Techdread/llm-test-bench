# xcc 0.1.13-631e318 (WebAssembly build)

Built by `tools/vendor-xcc.mjs` from https://github.com/tyfkda/xcc at
631e318432aeaaf72d6d2dfc93085766934314a2 with `xcc-notebook-lab.patch` applied (MIT, see LICENSE).

- `cc.wasm`: the C compiler (wcc compiled by itself), a WASI program:
  `cc -o /tmp/a.wasm /tmp/main.c`
- `sysroot.json`: `{ path: base64 }` for /usr/include and /usr/lib, which
  cc.wasm reads.

The patch fixes float formatting in printf and makes strtod exact (offered
upstream as tyfkda/xcc#270), and adds clock().
