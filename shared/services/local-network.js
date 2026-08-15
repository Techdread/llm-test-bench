// Browser-safe helpers for connecting a hosted app to a model server running
// on the visitor's own machine or LAN. Chrome's Local Network Access model can
// use targetAddressSpace to identify these requests before DNS resolution.

function parseUrl(value) {
  try {
    if (typeof value === 'string' || value instanceof URL) return new URL(value, globalThis.location?.href);
    if (value?.url) return new URL(value.url, globalThis.location?.href);
  } catch {
    return null;
  }
  return null;
}

function ipv4AddressSpace(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return '';
  if (parts[0] === 127) return 'loopback';
  if (parts[0] === 10) return 'local';
  if (parts[0] === 192 && parts[1] === 168) return 'local';
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'local';
  if (parts[0] === 169 && parts[1] === 254) return 'local';
  return '';
}

export function targetAddressSpaceFor(value) {
  const url = parseUrl(value);
  if (!url) return '';
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') return 'loopback';
  const ipv4 = ipv4AddressSpace(hostname);
  if (ipv4) return ipv4;
  if (hostname.endsWith('.local') || /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(hostname)) return 'local';
  return '';
}

export function isLocalNetworkUrl(value) {
  return !!targetAddressSpaceFor(value);
}

export function localNetworkHelp(baseUrl) {
  const url = parseUrl(baseUrl);
  const endpoint = url?.origin || String(baseUrl || 'the local endpoint');
  return `Could not reach ${endpoint}. Start the local model server, enable its CORS/web-access option, and allow this site's Local network access permission in Chrome or Edge.`;
}

export async function localNetworkFetch(input, init = {}, fetchImpl = globalThis.fetch) {
  const targetAddressSpace = targetAddressSpaceFor(input);
  const requestInit = targetAddressSpace && !init.targetAddressSpace
    ? { ...init, targetAddressSpace }
    : init;

  try {
    return await fetchImpl(input, requestInit);
  } catch (error) {
    if (targetAddressSpace && error?.name !== 'AbortError' && error?.name !== 'TimeoutError') {
      const wrapped = new Error(localNetworkHelp(input), { cause: error });
      wrapped.name = 'LocalNetworkConnectionError';
      throw wrapped;
    }
    throw error;
  }
}
