// Shared Lua runner — uses Wasmoon (Lua 5.4 WASM runtime).
// Promoted from wasm-code-lab; see spec 59.

import { createStdinController } from './stdin.js';

let factoryPromise = null;
const WASMOON_URL = new URL('../../lib/wasmoon/1.16.0/index.mjs', import.meta.url).href;
const WASMOON_WASM_URL = new URL('../../lib/wasmoon/1.16.0/glue.wasm', import.meta.url).href;

async function getFactory() {
  if (factoryPromise) return factoryPromise;
  factoryPromise = (async () => {
    const { LuaFactory } = await import(WASMOON_URL);
    return new LuaFactory(WASMOON_WASM_URL);
  })();
  return factoryPromise;
}

export async function createLuaEngine() {
  const factory = await getFactory();
  return factory.createEngine();
}

/**
 * Legacy-shape runner.
 * @param {string} code
 * @param {object} [options]
 * @param {string} [options.stdin]
 * @param {boolean} [options.interactiveInput]
 */
export async function runLua(code, options = {}) {
  const lua = await createLuaEngine();
  const stdin = createStdinController(options.stdin, {
    interactive: options.interactiveInput,
    promptLabel: 'Lua program is waiting for input',
  });

  let stdout = '';
  let runSucceeded = true;
  let stderr = '';

  try {
    lua.global.set('print', (...args) => {
      stdout += args.map((a) => String(a)).join('\t') + '\n';
    });
    lua.global.set('__wcl_write', (...args) => {
      stdout += args.map((a) => String(a)).join('');
    });
    await installLuaStdin(lua, stdin);
    await lua.doString(code);
  } catch (err) {
    runSucceeded = false;
    stderr = err.message || String(err);
  } finally {
    lua.global.close();
  }

  return {
    runtimeKind: 'wasm',
    compileSucceeded: null,
    runSucceeded,
    stdout: capOutput(stdout),
    stderr,
    compileLog: '',
    stdin: stdin.consumedInput,
    promptedInput: stdin.promptedInput,
  };
}

/**
 * Spec-59 uniform runner.
 */
export async function run({ code, stdin = '', timeoutMs = 10000 } = {}) {
  const start = performance.now();
  const result = await Promise.race([
    runLua(code, { stdin }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]).catch((err) => ({
    runSucceeded: false,
    stdout: '',
    stderr: err.message || String(err),
  }));
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    durationMs: Math.round(performance.now() - start),
    runSucceeded: !!result.runSucceeded,
  };
}

function installLuaStdin(lua, stdin) {
  lua.global.set('__wcl_read_line', () => stdin.readLine());
  lua.global.set('__wcl_read_all', () => stdin.readAll());
  lua.global.set('__wcl_read_chars', (count) => stdin.readChars(Number(count)));
  lua.global.set('__wcl_read_number', () => stdin.readNumber());

  return lua.doString(`
if io == nil then io = {} end

io.write = function(...)
  __wcl_write(...)
end

io.read = function(...)
  local formats = {...}
  if #formats == 0 then
    formats = {"*l"}
  end

  local values = {}
  for i, fmt in ipairs(formats) do
    if fmt == "*l" or fmt == "l" then
      values[i] = __wcl_read_line()
    elseif fmt == "*a" or fmt == "a" then
      values[i] = __wcl_read_all()
    elseif fmt == "*n" or fmt == "n" then
      values[i] = __wcl_read_number()
    elseif type(fmt) == "number" then
      values[i] = __wcl_read_chars(fmt)
    else
      values[i] = __wcl_read_line()
    end
  end

  return table.unpack(values)
end
`);
}

function capOutput(text, maxLen = 50000) {
  if (text.length > maxLen) {
    return text.slice(0, maxLen) + '\n... (output truncated)';
  }
  return text;
}
