// Cookie fallback policy for legacy cross-port settings sync. Cookies are sent
// with same-origin HTTP requests, so credentials and provider configuration
// must never be copied out of browser storage into them.

const SENSITIVE_SEGMENT = /(?:^|[-_.:])(api[-_]?key|key|token|secret|password|credential|authorization|auth)(?:$|[-_.:])/i;

const SENSITIVE_CONFIG_KEYS = new Set([
  'devtools-hub-model-providers',
  'devtools-hub-local-backends',
  'devtools-hub-modly-nodes',
  'devtools-hub-wan2gp-nodes',
]);

const SKIP_KEYS = new Set([
  'devtools-hub-openrouter-models',
  'devtools-hub-model-cache',
]);

const APP_PREFIXES = [
  'devtools-hub-',
  'prompt-gallery-',
  'code-arena-',
  'svg-benchmark-',
  'html-viewer-',
  'component-playground-',
  'css-grader-',
  'doc-writer-',
  'email-tester-',
  'figma-clone-',
  'figma-v2-',
  'markdown-workshop-',
  'portfolio-gen-',
  'regex-tester-',
  'slide-builder-',
  'api-viewer-',
  'three-prompt-lab-',
];

export function isSyncableSettingKey(key) {
  if (typeof key !== 'string' || !key) return false;
  if (SKIP_KEYS.has(key) || SENSITIVE_CONFIG_KEYS.has(key) || SENSITIVE_SEGMENT.test(key)) return false;
  return APP_PREFIXES.some(prefix => key.startsWith(prefix));
}
