// AST Explorer & Refactor Lab — LLM service.
// Delegates to the shared model-providers layer, adds a `proposeRefactor`
// entry point that wraps one recipe call, streams the response, and strips
// stray code fences the model may emit.

import { getApiKey, saveApiKey, hasApiKey } from '../../shared/services/providers-openrouter.js';
import { streamChat } from '../../shared/services/model-providers.js';
import { getRecipe, renderTemplate } from './refactorRecipes.js';

export { getApiKey, saveApiKey, hasApiKey };

const APP_TITLE = 'AST Explorer & Refactor Lab';

export async function proposeRefactor({
  providerId,
  modelId,
  recipeId,
  source,
  language,
  selection,
  selectionRange,
  extra,
  onChunk,
}) {
  const recipe = getRecipe(recipeId);
  if (!recipe) throw new Error(`Unknown recipe "${recipeId}"`);

  const userPrompt = renderTemplate(recipe.userPromptTemplate, {
    source,
    language,
    selection: selection || '',
    selectionRange: selectionRange || 'n/a',
    extra: extra || '',
  });

  const text = await streamChat({
    providerId,
    modelId,
    systemPrompt: recipe.systemPrompt,
    userPrompt,
    onChunk,
    appTitle: APP_TITLE,
  });
  return stripCodeFences(text);
}

function stripCodeFences(text) {
  if (!text) return '';
  let t = text.trim();
  t = t.replace(/^```[a-zA-Z]*\s*\n/, '');
  t = t.replace(/\n```\s*$/, '');
  return t;
}
