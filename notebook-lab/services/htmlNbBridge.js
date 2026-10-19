// htmlNbBridge — gives HTML cells a window into notebook state.
//
// HTML cells render into `sandbox="allow-scripts"` srcdoc iframes, so they
// cannot touch the app's nb bridge directly. This module builds the srcdoc:
// a bootstrap script is injected ahead of the cell source that defines a
// small `nb` API inside the iframe, seeded with a snapshot of notebook state
// and kept fresh over postMessage:
//
//   nb.get(key, default) / nb.has(key) / nb.keys() / nb.all()
//   nb.onChange(cb)  — cb(values) fires whenever notebook state changes
//   nb.set(key, val) — posts the write up to the app (JSON values only)
//
// The parent side (OutputRenderer's HtmlFrame) relays bridge changes down as
// `{__nbHtmlBridge:'update'}` (full snapshot) or `{__nbHtmlBridge:'patch'}`
// (one key changed — the common case, e.g. a slider drag) messages, and
// applies `{__nbHtmlBridge:'set'}` messages coming back up. Sandboxed srcdoc
// documents have an opaque origin, so messages use targetOrigin '*' and the
// parent trusts only `event.source`.

export const HTML_NB_BRIDGE_MARKER = '__nbHtmlBridge';

export function buildBootstrapScript(snapshot) {
  // <-escape so a value containing "</script>" can't break the tag.
  const json = JSON.stringify(snapshot || {}).replace(/</g, '\\u003c');
  return `<script>(function () {
  var values = ${json};
  var listeners = [];
  window.nb = {
    get: function (k, d) { return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : d; },
    has: function (k) { return Object.prototype.hasOwnProperty.call(values, k); },
    keys: function () { return Object.keys(values); },
    all: function () { var o = {}; for (var k in values) o[k] = values[k]; return o; },
    set: function (k, v) { parent.postMessage({ ${HTML_NB_BRIDGE_MARKER}: 'set', key: String(k), value: v }, '*'); },
    onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
  };
  function fire() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](window.nb.all()); } catch (err) { /* keep other listeners alive */ }
    }
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    var kind = d.${HTML_NB_BRIDGE_MARKER};
    if (kind === 'update') {
      values = d.values && typeof d.values === 'object' ? d.values : {};
      fire();
    } else if (kind === 'patch' && typeof d.key === 'string') {
      if (d.remove) { delete values[d.key]; } else { values[d.key] = d.value; }
      fire();
    }
  });
})();</scr` + `ipt>`;
}

export function buildHtmlCellSrcdoc(source, snapshot) {
  const src = String(source || '');
  const boot = buildBootstrapScript(snapshot);
  // Full documents keep their doctype first so they don't fall into quirks mode.
  const doctype = src.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) {
    const end = doctype[0].length;
    return src.slice(0, end) + boot + src.slice(end);
  }
  return boot + src;
}

// True when a value survives the structured JSON round-trip the bridge needs.
export function toJsonSafe(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}
