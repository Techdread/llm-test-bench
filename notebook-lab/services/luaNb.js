// luaNb — gives Lua cells two-way access to the notebook's `nb` store.
//
// Lua cells used to be emit-only: they could publish a value by printing an
// `__NB_SET__ {json}` line, but never read one. This installs a real `nb`
// table in the Lua engine before the cell runs:
//
//   nb.get(key, default)  -- a copy of the value, as Lua tables; default if unset
//   nb.set(key, value)    -- numbers, text, booleans and tables (lists or maps)
//   nb.has(key)           -- true when the key is set
//   nb.keys()             -- a list of every key
//
// Values cross the boundary as JSON text. Wasmoon would otherwise hand Lua
// JavaScript objects as userdata proxies (so `pairs`, `ipairs` and
// `table.sort` don't work on them) and fails outright when a JS function
// returns null, so the conversion is done here, in Lua, with plain tables.
// JSON lists become 1-based Lua sequences, objects become tables with string
// keys, null becomes nil, and whole numbers stay Lua integers.
//
// `__NB_SET__` lines still work, so existing notebooks are unchanged.

export const LUA_NB_PRELUDE = String.raw`
local function encode(v, seen)
  local t = type(v)
  if v == nil then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    if math.type(v) == 'integer' then return string.format('%d', v) end
    local s = string.format('%.14g', v)
    if tonumber(s) ~= v then s = string.format('%.17g', v) end
    return s
  end
  if t == 'string' then
    local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
    return '"' .. (v:gsub('[%c"\\]', function (c) return escapes[c] or string.format('\\u%04x', c:byte()) end)) .. '"'
  end
  if t == 'table' then
    if seen[v] then error('nb.set: a table that contains itself cannot be shared', 0) end
    seen[v] = true
    local n, count, out = #v, 0, {}
    for _ in pairs(v) do count = count + 1 end
    if count == n then
      -- A sequence 1..n (or an empty table) is a list.
      for i = 1, n do out[i] = encode(v[i], seen) end
      seen[v] = nil
      return '[' .. table.concat(out, ',') .. ']'
    end
    for k, value in pairs(v) do
      out[#out + 1] = encode(tostring(k), seen) .. ':' .. encode(value, seen)
    end
    seen[v] = nil
    return '{' .. table.concat(out, ',') .. '}'
  end
  error('nb.set: a ' .. t .. ' cannot be shared; use numbers, text, true/false and tables', 0)
end

local function decode(s)
  local pos = 1
  local function skip() pos = s:find('[^ \t\r\n]', pos) or #s + 1 end
  local function text()
    local out, i = {}, pos + 1
    local simple = { b = '\b', f = '\f', n = '\n', r = '\r', t = '\t', ['"'] = '"', ['\\'] = '\\', ['/'] = '/' }
    while true do
      local c = s:sub(i, i)
      if c == '"' then pos = i + 1; return table.concat(out) end
      if c == '' then error('nb: unreadable value', 0) end
      if c == '\\' then
        local e = s:sub(i + 1, i + 1)
        if e == 'u' then
          local cp = tonumber(s:sub(i + 2, i + 5), 16)
          i = i + 6
          if cp >= 0xD800 and cp <= 0xDBFF and s:sub(i, i + 1) == '\\u' then
            cp = 0x10000 + (cp - 0xD800) * 0x400 + (tonumber(s:sub(i + 2, i + 5), 16) - 0xDC00)
            i = i + 6
          end
          out[#out + 1] = utf8.char(cp)
        else
          out[#out + 1] = simple[e] or e
          i = i + 2
        end
      else
        local j = s:find('["\\]', i)
        if not j then error('nb: unreadable value', 0) end
        out[#out + 1] = s:sub(i, j - 1)
        i = j
      end
    end
  end
  local value
  function value()
    skip()
    local c = s:sub(pos, pos)
    if c == '{' then
      local t = {}
      pos = pos + 1; skip()
      if s:sub(pos, pos) == '}' then pos = pos + 1; return t end
      while true do
        skip(); local k = text(); skip()
        pos = pos + 1                      -- the ':'
        t[k] = value(); skip()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == '}' then return t end
      end
    elseif c == '[' then
      local t, n = {}, 0
      pos = pos + 1; skip()
      if s:sub(pos, pos) == ']' then pos = pos + 1; return t end
      while true do
        n = n + 1; t[n] = value(); skip()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == ']' then return t end
      end
    elseif c == '"' then return text()
    elseif s:find('^true', pos) then pos = pos + 4; return true
    elseif s:find('^false', pos) then pos = pos + 5; return false
    elseif s:find('^null', pos) then pos = pos + 4; return nil
    end
    local num = s:match('^-?%d+%.?%d*[eE]?[-+]?%d*', pos)
    if not num then error('nb: unreadable value', 0) end
    pos = pos + #num
    local n = tonumber(num)
    return math.tointeger(n) or n
  end
  return value()
end

nb = {}

function nb.get(key, default)
  local raw = __nb_get_json(tostring(key))
  if raw == '' then return default end
  local v = decode(raw)
  if v == nil then return default end
  return v
end

function nb.set(key, value)
  __nb_set_json(tostring(key), encode(value, {}))
end

function nb.has(key)
  return __nb_get_json(tostring(key)) ~= ''
end

function nb.keys()
  return decode(__nb_keys_json())
end
`;

/**
 * Install `nb` in a Wasmoon engine, backed by `bridge` (services/nbBridge.js).
 * The JS functions always return strings: Wasmoon breaks on a null return.
 */
export async function installLuaNb(lua, bridge) {
  lua.global.set('__nb_get_json', (key) => {
    if (!bridge.hasKey(String(key))) return '';
    const value = bridge.getValue(String(key));
    return value === undefined ? '' : JSON.stringify(value);
  });
  lua.global.set('__nb_set_json', (key, json) => {
    bridge.setValue(String(key), JSON.parse(String(json)));
    return '';
  });
  lua.global.set('__nb_keys_json', () => JSON.stringify(Object.keys(bridge.snapshot())));
  await lua.doString(LUA_NB_PRELUDE);
}
