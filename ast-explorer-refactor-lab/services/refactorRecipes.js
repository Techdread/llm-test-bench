// Built-in refactor recipes. Each recipe is *data* — a human-readable label,
// the language(s) it supports, a system prompt establishing role and rules,
// and a user-prompt template with placeholders:
//   {{source}}        full source text
//   {{selection}}     the currently selected range (or empty string)
//   {{language}}      'js' | 'ts' | 'tsx' | 'python'
//   {{extra}}         optional free-text supplied by the user (e.g. a new name)
//   {{selectionRange}} "lineA:colA-lineB:colB" (human-readable)

const SHARED_SYSTEM = `You are a precise, minimal code refactoring assistant. You output the ENTIRE updated source file only — no markdown fences, no commentary, no preamble. Preserve whitespace, indentation, and comments outside the refactored region. Never introduce new imports or APIs that were not already used in the file. If the requested change is not safely applicable, return the source unchanged.`;

export const BUILTIN_RECIPES = [
  {
    id: 'extract-function',
    label: 'Extract function',
    description: 'Move the selection into a new function and replace with a call.',
    supportedLangs: ['js', 'ts', 'tsx', 'python'],
    systemPrompt: SHARED_SYSTEM,
    userPromptTemplate:
`Extract the following selection into a new function named {{extra|extracted}}. The surrounding source is given below. Replace the selection with a call to the new function and place the new function at the nearest reasonable scope (top of module or enclosing class). Infer parameters from variables used in the selection but defined outside it. Return the full updated source.

Language: {{language}}
Selection range: {{selectionRange}}

--- Selection ---
{{selection}}

--- Full source ---
{{source}}`,
    guardrails: ['No new imports', 'Preserve external behaviour', 'Keep original formatting'],
  },
  {
    id: 'inline-variable',
    label: 'Inline variable',
    description: 'Inline the declaration at the cursor and remove the variable.',
    supportedLangs: ['js', 'ts', 'tsx', 'python'],
    systemPrompt: SHARED_SYSTEM,
    userPromptTemplate:
`Find the variable whose declaration contains the selection range (if any), inline its initializer at every usage within its scope, and remove the declaration. If no single declaration is obviously the target, pick the one nearest the selection. Return the full updated source.

Language: {{language}}
Selection range: {{selectionRange}}
Selection: {{selection}}

--- Full source ---
{{source}}`,
    guardrails: ['Preserve side effects', 'Only inline pure initialisers when usage count > 1'],
  },
  {
    id: 'convert-callbacks-to-async',
    label: 'Convert callbacks to async/await',
    description: 'Rewrite callback/Promise chains in the selection (or whole file) to async/await.',
    supportedLangs: ['js', 'ts', 'tsx'],
    systemPrompt: SHARED_SYSTEM,
    userPromptTemplate:
`Rewrite callback and Promise-then chains to async/await form. Prefer the narrowest region: if the selection spans such code, rewrite only inside it; otherwise rewrite the whole file. Keep error handling via try/catch where it was previously handled via .catch or trailing callback args. Return the full updated source.

Language: {{language}}
Selection range: {{selectionRange}}

--- Selection ---
{{selection}}

--- Full source ---
{{source}}`,
    guardrails: ['Mark enclosing functions async as needed', 'Preserve semantics, especially error paths'],
  },
  {
    id: 'introduce-early-returns',
    label: 'Introduce early returns',
    description: 'Flatten nested conditionals with guard clauses / early returns.',
    supportedLangs: ['js', 'ts', 'tsx', 'python'],
    systemPrompt: SHARED_SYSTEM,
    userPromptTemplate:
`Refactor control flow to use early returns / guard clauses instead of nested if/else. Reverse negated conditions when that shortens the happy path. Do not change observable behaviour. Return the full updated source.

Language: {{language}}
Selection range: {{selectionRange}}

--- Selection ---
{{selection}}

--- Full source ---
{{source}}`,
    guardrails: ['No behaviour change', 'Do not remove error handling'],
  },
  {
    id: 'rename-symbol',
    label: 'Rename symbol',
    description: 'Rename the identifier at the cursor to a new name (LLM-driven, scope-aware).',
    supportedLangs: ['js', 'ts', 'tsx', 'python'],
    systemPrompt: SHARED_SYSTEM,
    userPromptTemplate:
`Rename the identifier at the selection to "{{extra|newName}}". Update all references that refer to the SAME binding, including imports/exports where applicable. Do not rename shadowed identifiers in inner scopes or unrelated identifiers with the same spelling in other scopes. Return the full updated source.

Language: {{language}}
Selection range: {{selectionRange}}
Original identifier (selection): {{selection}}

--- Full source ---
{{source}}`,
    guardrails: ['Scope-aware rename only', 'Do not rename comments or strings unless they reference the symbol'],
  },
  {
    id: 'add-types',
    label: 'Add TypeScript types',
    description: 'Infer and add explicit type annotations to parameters, returns, and locals.',
    supportedLangs: ['ts', 'tsx'],
    systemPrompt: SHARED_SYSTEM,
    userPromptTemplate:
`Add explicit TypeScript type annotations to function parameters, return types, and notable locals where the inferred type is non-trivial. Prefer structural interfaces over inline types for repeated shapes. Do not add \`any\`. If inference is not safe, leave the annotation off. Return the full updated source.

Language: {{language}}
Selection range: {{selectionRange}}

--- Selection ---
{{selection}}

--- Full source ---
{{source}}`,
    guardrails: ['No any', 'Only add annotations, do not change logic'],
  },
];

export function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{([a-zA-Z_]+)(?:\|([^}]*))?\}\}/g, (_, key, fallback) => {
    const v = vars[key];
    if (v === undefined || v === null || v === '') return fallback || '';
    return String(v);
  });
}

/**
 * Subset of recipes applicable to the current language.
 */
export function filterByLanguage(lang) {
  return BUILTIN_RECIPES.filter(r => r.supportedLangs.includes(lang));
}

export function getRecipe(id) {
  return BUILTIN_RECIPES.find(r => r.id === id) || null;
}
