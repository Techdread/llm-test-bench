// generate → build → render → review → refine.
//
// The loop is the app. Everything else exists to make one turn of it possible.
// What makes the outputs good is step 3: the model is shown its OWN renders
// beside the reference, so it corrects what it actually built rather than what
// it believed it had described.
//
// Two failure modes are handled differently on purpose:
//   * A model answer that will not build is a REPAIR round. The validator's
//     message goes back as feedback and the revision counter does not advance,
//     twice, before the run gives up. A bad answer is not a failed run.
//   * A review that says "not approved" is a REFINEMENT round. It consumes one
//     of the user's chosen rounds, and its issues become the next prompt.
//
// The DESCRIBE LANE (optional `eyes` backend) lets a model that cannot see
// build the asset anyway. A vision model becomes the eyes for the whole run:
// it describes the references once, and it performs every review. The builder
// then never receives an image — it works from those descriptions, and from the
// review findings, as text. Step 3 survives intact, because the thing doing the
// looking is still looking at the renders the builder actually produced.

import {
  buildContext, describePrompt, generationPrompt, parseAnswer, reviewPrompt,
  validateDescription, validateGeneration, validateReview, viewDescribePrompt,
} from './prompts.js';
import { riggingTarget } from './riggingTargets.js';

const MAX_REPAIRS = 2;

// Both browser dependencies are reached through a dynamic import rather than a
// static one, and both are injectable. The hub's provider module reads
// `document` at load time and the sandbox needs a real DOM, so a static import
// of either would make this file — the one with all the control flow worth
// testing — unloadable under `node --test`.

/** One provider call with ordered images. CLI-agent providers turn these image
 *  parts into staged files themselves (providers-cli-agent.js), so the same
 *  message shape serves an API model and a CLI agent. */
async function askModel({ providerId, modelId, prompt, images, signal, params, onStream }) {
  const { streamChatCompletion } = await import('../../shared/services/model-providers.js');
  const content = [
    { type: 'text', text: prompt },
    ...images.map(dataUrl => ({ type: 'image_url', image_url: { url: dataUrl } })),
  ];
  let text = '';
  await streamChatCompletion({
    providerId,
    modelId,
    appTitle: 'Understory Studio',
    signal,
    params,
    messages: [{ role: 'user', content }],
    onChunk: chunk => {
      // streamChatCompletion delivers accumulated text, not a delta.
      text = typeof chunk === 'string' ? chunk : (chunk?.content ?? text);
      onStream?.(text);
    },
  });
  if (!text.trim()) throw new Error('The model returned an empty response.');
  return text;
}

async function evaluateInSandbox(code, seed, signal) {
  const { evaluateDesign } = await import('./designSandbox.js');
  return evaluateDesign(code, seed, signal);
}

/**
 * Run the full loop.
 *
 * @param {object} options
 * @param {object} options.backend      { providerId, modelId, params }
 * @param {object} [options.eyes]       { providerId, modelId } — a vision model
 *   that describes the references and performs the reviews, so `backend` can be
 *   a text-only model. Omit for the normal single-model run.
 * @param {string[]} options.references 1–3 reference image data URLs.
 * @param {string} options.brief
 * @param {string} options.kind         object | character | scene
 * @param {string} options.rigging      none | mixamo | animated
 * @param {number} options.rounds       Maximum automatic refinements.
 * @param {string} options.code         Starting code when branching a version.
 * @param {object} options.viewer       The studioViewer instance to build into.
 * @param {function} [options.ask]      Override the provider call (tests).
 * @param {function} [options.evaluate] Override sandbox evaluation (tests).
 * @param {function} options.onStatus   Human-readable progress.
 * @param {function} options.onRecord   Called with each completed exchange.
 * @param {function} options.onVersion  Called with each saved version.
 * @param {AbortSignal} options.signal
 */
export async function runStudioBuild({
  backend, eyes = null, references, brief, kind, rigging: requestedRigging, rounds = 2, code = '',
  viewer, onStatus = () => {}, onRecord = () => {}, onVersion = () => {},
  onViews = () => {}, onStream = () => {}, signal,
  ask = askModel, evaluate = evaluateInSandbox,
}) {
  if (!references.length || references.length > 3) throw new Error('Attach 1–3 reference images.');
  if (!backend?.providerId || !backend?.modelId) throw new Error('Select a provider and model first.');
  const seeing = eyes?.providerId && eyes?.modelId ? eyes : null;
  if (eyes && !seeing) throw new Error('Select a model for the describing pass, or turn it off.');
  const rigging = riggingTarget(requestedRigging ?? 'none', kind);

  let feedback = '';
  let views = [];
  let movementViews = [];
  let repairs = 0;
  let lastSummary = '';
  // Written once per run by the eyes, then reused: the references do not change
  // between revisions, and re-describing them would cost a vision call per round
  // to produce a slightly different description of the same picture.
  let description = '';
  let viewDescription = '';

  const record = entry => onRecord({ at: new Date().toISOString(), ...entry });

  const call = async (action, prompt, images, who = backend) => {
    const started = Date.now();
    const attribution = { model: who.modelId, providerId: who.providerId, role: who === backend ? 'builder' : 'eyes' };
    try {
      const text = await ask({ ...who, prompt, images, signal, onStream });
      record({ action, status: 'completed', prompt, images, response: text, ms: Date.now() - started, ...attribution });
      return text;
    } catch (error) {
      // Recorded before rethrowing: a failed or cancelled call is exactly the
      // one you want to read afterwards.
      record({ action, status: signal?.aborted ? 'cancelled' : 'failed', prompt, images, error: error.message, ms: Date.now() - started, ...attribution });
      throw error;
    }
  };

  // Images reach the builder only when the builder can see them. In the describe
  // lane it gets none, and the descriptions carry everything instead.
  const forBuilder = images => (seeing ? [] : images);

  // When a character is being prepared from an existing version, the model gets
  // to see what it is converting before it is asked to convert it.
  if (code && rigging !== 'none') {
    onStatus('Inspecting the selected character before preparing its T-pose…');
    await viewer.load(await evaluate(code, 73519, signal), { rigging: 'none', kind, signal });
    views = await viewer.captureViews();
    onViews(views);
    signal?.throwIfAborted();
  }

  if (seeing) {
    onStatus('The describing model is reading your reference pictures…');
    description = validateDescription(
      await call('describe', describePrompt({ kind, brief, referenceCount: references.length }), references, seeing),
    );
    signal?.throwIfAborted();
    // The T-pose path is the one place renders reach the builder without a
    // review having been written about them first.
    if (views.length) {
      onStatus('…and describing the character it is about to convert…');
      viewDescription = validateDescription(
        await call('describe-views', viewDescribePrompt({ movementCount: 0 }), views, seeing),
      );
      signal?.throwIfAborted();
    }
  }

  for (let revision = 0; revision <= rounds; revision++) {
    signal?.throwIfAborted();
    onStatus(revision ? `Refining the design · pass ${revision} of ${rounds}…` : 'Building the design from your reference…');

    const context = buildContext({
      kind, brief, code, feedback, rigging, description, viewDescription,
      referenceCount: seeing ? 0 : references.length,
      viewCount: seeing ? 0 : views.length,
      movementCount: seeing ? 0 : movementViews.length,
    });

    const answer = validateGeneration(parseAnswer(
      await call('generate', generationPrompt(context, rigging), forBuilder([...references, ...views, ...movementViews])),
    ));
    code = answer.code;
    lastSummary = answer.summary;

    onStatus('Building and checking all five detail levels…');
    try {
      const design = await evaluate(code, 73519, signal);
      await viewer.load(design, { rigging, kind, signal });
    } catch (error) {
      signal?.throwIfAborted();
      if (repairs++ >= MAX_REPAIRS) throw error;
      onStatus(`The design did not build. Asking for a repair (${repairs} of ${MAX_REPAIRS})…`);
      feedback = `Repair the generated code: ${error.message}`;
      revision--;
      continue;
    }

    onStatus('Rendering front, side, and back for the model to inspect…');
    views = await viewer.captureViews();
    signal?.throwIfAborted();
    movementViews = rigging === 'animated' ? await viewer.captureViews(true) : [];
    onViews([...views, ...movementViews]);
    signal?.throwIfAborted();

    onStatus('The model is comparing its renders with your reference…');
    const reviewContext = buildContext({
      kind, brief, code, feedback: '', rigging,
      referenceCount: references.length,
      viewCount: views.length,
      movementCount: movementViews.length,
    });
    const review = validateReview(parseAnswer(
      await call('review', reviewPrompt(reviewContext), [...references, ...views, ...movementViews], seeing || backend),
    ));

    // A description of the geometry written before this revision describes the
    // geometry before this revision; the review that just landed is newer and
    // more specific, so the stale one is dropped rather than carried forward.
    viewDescription = '';

    onVersion({
      code, rigging, summary: lastSummary, review,
      views: [...views, ...movementViews],
      model: backend.modelId, providerId: backend.providerId,
      eyesModel: seeing ? seeing.modelId : '',
      at: new Date().toISOString(),
    });

    if (review.approved) {
      onStatus(
        rigging === 'animated' ? 'Animated character reviewed and saved. Choose an animation, preview it, and export.'
          : rigging === 'mixamo' ? 'T-pose version reviewed and saved. Inspect a level, export its FBX, then upload it to Mixamo.'
          : 'Design reviewed and saved. Explore the five levels, refine further, or export.',
      );
      return { approved: true, code, review };
    }
    feedback = `${review.summary}\n${review.issues.join('\n')}`;
  }

  onStatus('Saved with outstanding visual issues. Review the findings below and refine further when ready.');
  return { approved: false, code };
}
