// Prompt assembly and answer parsing for the generate / review loop.
//
// Kept apart from the loop so the exact text sent for a given context is
// testable without a provider, and so the Runs tab can show a prompt that is
// definitely the one that was sent.

import { RECIPE_GUIDE } from './recipeSchema.js';
import { HUMANOID_GUIDE } from './humanoid.js';
import { MIXAMO_GUIDE } from './riggingTargets.js';

export const SUBJECT_KINDS = Object.freeze([
  { id: 'object', label: 'Object' },
  { id: 'character', label: 'Character' },
  { id: 'scene', label: 'Scene' },
]);

const MAX_BRIEF = 8000;
const MAX_CODE = 150_000;
const MAX_DESCRIPTION = 8000;

/**
 * The shared half of both prompts: what is being built, what the images are,
 * and what went wrong last time. The image ORDER stated here has to match the
 * order the loop actually attaches, or the model reviews the wrong picture.
 */
export function buildContext({
  kind = 'object', brief = '', code = '', feedback = '',
  rigging = 'none', referenceCount = 0, viewCount = 0, movementCount = 0,
  description = '', viewDescription = '',
}) {
  const subject = SUBJECT_KINDS.some(entry => entry.id === kind) ? kind : 'object';
  // With a text-only builder there are no images on the call, so the sentence
  // describing their order must not be sent — telling a model that cannot see
  // what its first two images are is how you get a confident hallucination.
  const imageLine = referenceCount
    ? `The first ${referenceCount} images are references.`
      + (viewCount ? ' The next three are FRONT, SIDE, BACK renders of the neutral geometry.' : '')
      + (movementCount ? ' The final three images show WALK, CROUCH and ARM BEND movement tests.' : '')
    : 'No images are attached to this message. Everything you know about the subject is in the written descriptions below.';
  return [
    `Task: Build an editable 3D ${subject} from the reference images. User brief: ${String(brief).slice(0, MAX_BRIEF)}`,
    imageLine,
    description ? `Description of the reference images, written by a model that looked at them:\n${String(description).slice(0, MAX_DESCRIPTION)}` : '',
    viewDescription ? `Description of the CURRENT geometry's front, side and back renders, written by the same model:\n${String(viewDescription).slice(0, MAX_DESCRIPTION)}` : '',
    `Current code: ${String(code).slice(0, MAX_CODE) || '(none)'}`,
    `Previous review or geometry errors: ${String(feedback).slice(0, MAX_BRIEF)}`,
    rigging !== 'none' ? MIXAMO_GUIDE : '',
    rigging === 'animated' ? HUMANOID_GUIDE : '',
  ].filter(Boolean).join('\n');
}

export function generationPrompt(context, rigging = 'none') {
  return `${RECIPE_GUIDE}\n${context}\nCreate or improve the complete design. ${
    rigging !== 'none'
      ? 'Apply the rigging requirements while preserving the character identity.'
      : 'Preserve named objects and composition when refining.'
  }`;
}

/**
 * The describe lane's first call: a vision model turns the reference pictures
 * into the only thing a text-only builder will ever know about them.
 *
 * The headings are fixed because the builder is asked to model from this and
 * nothing else — free prose reliably omits the two things that decide whether
 * the result is recognisable, proportion and part inventory.
 */
export function describePrompt({ kind = 'object', brief = '', referenceCount = 1 } = {}) {
  const subject = SUBJECT_KINDS.some(entry => entry.id === kind) ? kind : 'object';
  return `You are the eyes for another model that cannot see. It will build an editable 3D ${subject} from your description alone, so describe what is in the ${referenceCount} reference image${referenceCount === 1 ? '' : 's'} precisely enough to model from.

User brief, for emphasis only — describe what is actually in the pictures: ${String(brief).slice(0, MAX_BRIEF) || '(none)'}

Write plain text under these exact headings:
FORM: the overall silhouette and stance in one or two sentences.
PARTS: every distinct part, named, with where it sits relative to the others.
PROPORTIONS: relative sizes as ratios or multiples of the largest part, and the overall bounding shape.
MATERIALS: colours as hex where you can, plus finish — matte, glossy, metallic, rough, transparent.
DETAILS: the features that make this subject recognisable rather than generic.
UNSEEN: which sides or parts the images do not show, so the builder knows what it is inventing.

Describe only what you can see. Do not write code, JSON or commentary.`;
}

/** The same eyes, pointed at the geometry rather than the reference. Used only
 *  where renders would otherwise reach a builder that cannot look at them. */
export function viewDescribePrompt({ movementCount = 0 } = {}) {
  return `You are the eyes for another model that cannot see. Describe the attached renders of a 3D model: the first three are FRONT, SIDE and BACK of the geometry as built${
    movementCount ? ', and the final three are WALK, CROUCH and ARM BEND movement tests' : ''
  }.

Write plain text under these exact headings:
FORM: the silhouette from each angle.
PARTS: what is present, and anything that looks missing, duplicated or intersecting.
PROPORTIONS: relative sizes, and anything that reads as off.${
    movementCount ? '\nMOVEMENT: how the surface deforms in each test, and where it pinches, tears or collapses.' : ''
  }

Describe only what you can see. Do not judge it against any reference, and do not write code or JSON.`;
}

export function reviewPrompt(context) {
  return `${context}
Inspect the actual rendered images against the reference. Assess silhouette, proportions, missing parts, materials, and intersections. Hidden sides are artistic interpretations. Return ONLY JSON: {"approved":true or false,"summary":"specific visual findings","issues":["actionable correction",...]}. Approve only if this is a recognizable, coherent interpretation at the requested complexity. No code in this review.`;
}

/**
 * Some local servers put explicit reasoning tags into the answer field. Keep the
 * original response for the Runs tab; parse only the closed final part. An
 * UNCLOSED thinking block is never treated as an answer — that way a truncated
 * response fails loudly instead of being parsed as half a design.
 */
export function splitResponse(text) {
  let answer = String(text ?? '').trim();
  const reasoning = [];
  while (/^<(think|analysis)>/i.test(answer)) {
    const match = /^<(think|analysis)>([\s\S]*?)<\/\1>\s*/i.exec(answer);
    if (!match) return { answer: '', reasoning: [...reasoning, answer].join('\n') };
    reasoning.push(match[2].trim());
    answer = answer.slice(match[0].length).trim();
  }
  return { answer, reasoning: reasoning.join('\n') };
}

/** Pull JSON out of an answer that may be fenced or prefaced despite the ask. */
export function parseAnswer(text) {
  const { answer } = splitResponse(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer);
  const body = (fenced ? fenced[1] : answer).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('The model returned no JSON.');
  const candidate = body.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    // Trailing prose after a complete object is common enough to be worth one
    // balanced-brace retry before giving up.
    let depth = 0, inString = false, escaped = false;
    for (let i = 0; i < candidate.length; i++) {
      const char = candidate[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) return JSON.parse(candidate.slice(0, i + 1));
      }
    }
    throw new Error('The model returned malformed JSON.');
  }
}

/**
 * A description is prose, not JSON — deliberately. It is the one answer in the
 * loop with no structure to get wrong, so it has no parse failure mode; the only
 * thing that can go wrong is an empty answer, and that is an error.
 */
export function validateDescription(text) {
  const { answer } = splitResponse(text);
  const description = answer.trim().slice(0, MAX_DESCRIPTION);
  if (!description) throw new Error('The describing model returned an empty description.');
  return description;
}

export function validateGeneration(answer) {
  if (typeof answer?.code !== 'string' || !answer.code.trim() || answer.code.length > MAX_CODE) {
    throw new Error('Model returned invalid or oversized design code.');
  }
  return { code: answer.code, summary: typeof answer.summary === 'string' ? answer.summary : '' };
}

export function validateReview(answer) {
  if (typeof answer?.approved !== 'boolean' || !Array.isArray(answer.issues)
    || !answer.issues.every(issue => typeof issue === 'string')) {
    throw new Error('Model returned an invalid visual review.');
  }
  return {
    approved: answer.approved,
    summary: typeof answer.summary === 'string' ? answer.summary : '',
    issues: answer.issues.slice(0, 40),
  };
}
