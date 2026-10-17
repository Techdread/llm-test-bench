const REQUIRED_FUNCTIONS = [
  'systemPromptForTask',
  'buildTask',
  'snapshotTask',
  'capabilitiesForTask',
  'validator',
  'preview',
  'coachContext',
];

export function validateDomainAdapter(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== 'object') return ['Adapter must be an object.'];
  if (adapter.contractVersion !== DOMAIN_ADAPTER_CONTRACT_VERSION) {
    errors.push(`contractVersion must be ${DOMAIN_ADAPTER_CONTRACT_VERSION}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(adapter.id || '')) errors.push('Adapter id must be a kebab-case identifier.');
  if (!String(adapter.title || '').trim()) errors.push('Adapter title is required.');
  if (!String(adapter.artifactLabel || '').trim()) errors.push('artifactLabel is required.');
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof adapter[name] !== 'function') errors.push(`${name} must be a function.`);
  }
  if (!adapter.promptSchema || typeof adapter.promptSchema !== 'object') errors.push('promptSchema is required.');
  if (!Array.isArray(adapter.evaluationRubric)) errors.push('evaluationRubric must be an array.');
  if (adapter.capabilityPolicies != null && typeof adapter.capabilityPolicies !== 'object') {
    errors.push('capabilityPolicies must be an object when provided.');
  }
  return errors;
}

export function validatePromptAgainstSchema(prompt, schema) {
  const errors = [];
  if (!prompt || typeof prompt !== 'object') return ['Prompt must be an object.'];
  for (const name of schema?.required || []) {
    if (prompt[name] == null || (typeof prompt[name] === 'string' && !prompt[name].trim())) {
      errors.push(`${name} is required.`);
    }
  }
  for (const [name, descriptor] of Object.entries(schema?.fields || {})) {
    if (prompt[name] == null) continue;
    if (descriptor.type === 'array') {
      if (!Array.isArray(prompt[name])) errors.push(`${name} must be an array.`);
      else if (descriptor.items && prompt[name].some(item => typeof item !== descriptor.items)) {
        errors.push(`${name} items must be ${descriptor.items}.`);
      }
    } else if (descriptor.type && typeof prompt[name] !== descriptor.type) {
      errors.push(`${name} must be ${descriptor.type}.`);
    }
  }
  return errors;
}

export function assertDomainAdapter(adapter) {
  const errors = validateDomainAdapter(adapter);
  if (errors.length) throw new Error(`Invalid Forge domain adapter: ${errors.join(' ')}`);
  return adapter;
}

export const DOMAIN_ADAPTER_CONTRACT_VERSION = 1;
