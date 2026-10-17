import { assertDomainAdapter } from './contract.js';
import { VR_ADAPTER } from './vr.js';

const adapters = new Map();

export function registerDomainAdapter(adapter) {
  const valid = assertDomainAdapter(adapter);
  if (adapters.has(valid.id)) throw new Error(`Forge adapter "${valid.id}" is already registered.`);
  adapters.set(valid.id, valid);
  return valid;
}

export function getDomainAdapter(id) {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unknown Forge domain adapter: ${id}`);
  return adapter;
}

export function listDomainAdapters() {
  return [...adapters.values()];
}

registerDomainAdapter(VR_ADAPTER);
