// Detect Vega-Lite objects returned by JavaScript/Python cells.

const TOP_LEVEL_VIEW_KEYS = ['mark', 'layer', 'hconcat', 'vconcat', 'concat', 'facet', 'repeat'];
const COMPOSITION_KEYS = ['layer', 'hconcat', 'vconcat', 'concat'];
const DIRECT_MANIPULATION_MARKS = new Set(['arc', 'bar', 'circle', 'geoshape', 'image', 'point', 'square', 'tick']);

export function isVegaLiteSpec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.$schema !== 'string' || !value.$schema.toLowerCase().includes('vega-lite')) return false;
  return TOP_LEVEL_VIEW_KEYS.some(key => Object.hasOwn(value, key));
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
}

function selectionNames(params) {
  return new Set(params.map(param => param.name).filter(name => typeof name === 'string' && name));
}

function referencesSelection(value, names) {
  if (Array.isArray(value)) return value.some(child => referencesSelection(child, names));
  if (!value || typeof value !== 'object') return false;
  if (typeof value.param === 'string' && names.has(value.param)) return true;
  return Object.values(value).some(child => referencesSelection(child, names));
}

function unitMarkType(spec) {
  const mark = spec?.mark;
  return typeof mark === 'string' ? mark : mark?.type;
}

function layerScore(layer, names) {
  let score = referencesSelection(layer, names) ? 100 : 0;
  const mark = unitMarkType(layer);
  if (DIRECT_MANIPULATION_MARKS.has(mark)) score += 10;
  if (layer?.encoding && typeof layer.encoding === 'object') score += 1;
  return score;
}

function moveUnscopedSelectionsIntoLayer(spec) {
  if (!Array.isArray(spec?.layer) || !Array.isArray(spec.params)) return;

  // Vega-Lite 5.23 duplicates the generated Vega signals when an unscoped
  // selection parameter sits on a layered view. Parameters explicitly scoped
  // with `views` already compile safely and should keep their authored intent.
  const selections = spec.params.filter(param => (
    param?.select && (!Array.isArray(param.views) || param.views.length === 0)
  ));
  if (!selections.length) return;

  const names = selectionNames(selections);
  let targetIndex = 0;
  let targetScore = -1;
  spec.layer.forEach((layer, index) => {
    const score = layerScore(layer, names);
    if (score > targetScore) {
      targetIndex = index;
      targetScore = score;
    }
  });

  const target = spec.layer[targetIndex];
  const retained = spec.params.filter(param => !selections.includes(param));
  const existing = Array.isArray(target.params) ? target.params : [];
  const existingNames = new Set(existing.map(param => param?.name));
  target.params = [...existing, ...selections.filter(param => !existingNames.has(param.name))];
  if (retained.length) spec.params = retained;
  else delete spec.params;
}

function repairLayeredSelections(spec) {
  if (!spec || typeof spec !== 'object') return;
  moveUnscopedSelectionsIntoLayer(spec);
  for (const key of COMPOSITION_KEYS) {
    if (Array.isArray(spec[key])) spec[key].forEach(repairLayeredSelections);
  }
  if (spec.spec) repairLayeredSelections(spec.spec);
}

/**
 * Return a render-safe copy of a Vega-Lite specification.
 *
 * In the bundled Vega-Lite 5.23 compiler, selection params declared on a
 * layered view are expanded into every child and yield duplicate Vega signal
 * names. Defining the selections on one unit layer is equivalent for shared
 * layered scales and lets conditions in sibling layers continue to reference
 * them. This also follows Vega-Lite's documented single-view selection shape.
 */
export function prepareVegaLiteSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  const prepared = cloneValue(spec);
  repairLayeredSelections(prepared);
  return prepared;
}
