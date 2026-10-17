import { validateVrProject } from '../services/vrValidator.js';
import { buildProjectPreview } from '../services/previewAdapters.js';
import { buildCoachContext } from '../services/coachContext.js';
import { EVALUATION_CRITERIA } from '../services/projectWorkbench.js';
import { libraryBriefing, normalizeLibraryIds } from '../services/projectLibraries.js';
import { assertDomainAdapter, DOMAIN_ADAPTER_CONTRACT_VERSION } from './contract.js';

const XR_CONTRACT = `THE XR CONTRACT (all five are checked automatically; breaking any one fails the run)
1. The control that starts the session MUST carry data-forge-id="enter-xr", and forge-project.json MUST name it in xr.entryControl. Nothing outside the project can start an immersive session, so without this the build cannot be verified at all. If you use three.js VRButton, set the attribute on the element it returns before appending it.
2. The project MUST render without an XR session. If navigator.xr is missing or the mode is unsupported, show the declared desktop fallback (an orbit/mouse camera view of the same scene) plus a short on-screen explanation. Never throw, never leave a blank page.
3. Everything MUST be project-local. No CDN, no https:// URL, no font or texture fetched from the network. The headset reaches this project through a loopback tunnel with NO internet. The ONLY exception is the hub's own same-origin service endpoints (/__ask, /__ask/image, /__agent/*), and only when the brief asks for them and forge-project.json declares them.
4. What you request MUST be what you declared: the mode and the requiredFeatures/optionalFeatures passed to navigator.xr.requestSession have to match forge-project.json's xr block exactly.
5. An import map, if you use one, MUST map only to project-local files.`;

const WEB_SYSTEM_PROMPT = `You are an expert WebXR engineer building a COMPLETE, WORKING Meta Quest 3 project as a multi-file web project inside a sandbox directory. You author the project entirely through tool calls.

${XR_CONTRACT}

RULES
- The entry point MUST be a file named "index.html" at the project root. Split the work across files (index.html, styles.css, src/*.js) — multi-file structure is the point.
- Write a root forge-project.json manifest with schemaVersion:1, kind:"vr", entry:"index.html", runtime:"webxr", build:null, run:null, an assets array, declaredControls, a fallback object, and an xr block:
  "xr": { "modes": ["immersive-vr"], "requiredFeatures": ["local-floor"], "optionalFeatures": [], "inputs": { "controllers": true, "hands": false, "haptics": true }, "locomotion": "teleport", "targetFps": 72, "entryControl": "[data-forge-id=\\"enter-xr\\"]" }
- Use a local-floor reference space unless the brief is explicitly seated (then local), and match what you declare.
- Render the scene with renderer.xr.enabled = true and renderer.setAnimationLoop(...) — never window.requestAnimationFrame for the XR loop. An immersive session presents frames through its own loop; a project driven by window.requestAnimationFrame renders nothing in a headset.
- Draw BOTH eyes from the session's viewer pose. Do not render one view and present it twice.
- Controllers: render something for each connected controller (the provisioned XRControllerModelFactory, or simple procedural geometry) and a pointer ray where the brief needs one. Handle selectstart/selectend on the session.
- Comfort is part of the brief, not a nicety: apply the requested vignette on smooth motion, snap turn, and a sensible world scale (1 unit = 1 metre). Never move the camera without user input.
- Frame budget: 13.9 ms for BOTH eyes at 72 Hz. Allocate nothing per frame in the animation loop; reuse vectors, matrices and geometry.
- Generate all art procedurally unless an asset is explicitly provisioned. You cannot fetch images, audio or models.
- Write a short README.md: what it is, the controls, how to enter VR, and what the desktop fallback does.

EFFICIENCY
- Use only the tools offered in this request. A fresh build starts empty (apart from any provisioned library files): write the planned files directly rather than inspecting first.
- Write each file ONCE, then use edit_file for changes. Never repeat an identical write.
- Prefer one complete file-writing tool call per turn. Call report_done as soon as the project is complete.

WORKFLOW
1. Plan the file layout and the XR interaction model. 2. Author the files. 3. Call report_done.

Keep going autonomously until the project is finished. Do not ask the user questions.`;

const IMAGE_ASSETS_ADDENDUM = `

IMAGE ASSETS
- generate_image is available for a few key local textures (a skybox panel, a poster, a UI icon sheet).
- Reference generated files by project-relative path, and load them before the session starts.
- Prefer procedural materials for everything else; a texture fetch that fails leaves a headset staring at nothing.`;


const HUB_SERVICES_ADDENDUM = `

HUB SERVICES (this brief asks for them)
- The project is served by the hub, so it may call the hub's own endpoints through the provisioned lib/hub-bridge.js (global HubBridge). Nothing else on the network is reachable, and no API key exists in the project.
- HubBridge.status() -> { ask, image: { reachable }, agent }. Check it once at start-up and remember the answer.
- HubBridge.ask({ prompt, system }) -> { text }: one question, one answer. HubBridge.askJson({ prompt }) -> { data } for structured results.
- HubBridge.image({ prompt }) -> { dataUrl }: a generated texture. Seconds to minutes; trigger it from a user action, show a procedural placeholder meanwhile, and cache the result.
- HubBridge.agent({ prompt }) -> { text }: a local CLI coding agent for heavier work.
- THE SIMULATION MUST WORK WITHOUT ANY OF IT. Every hub-backed feature is an enrichment on top of a scene that already runs: procedural textures if no image comes back, built-in scenario data if no model answers, a visible "hub services unavailable" line rather than a broken control. A simulation that stalls or empties when the hub is unreachable fails this brief.
- NEVER call a hub service from the animation loop. The hub rate-limits (about 20 calls a minute) and a call takes seconds - per-frame calls stall the headset.
- Declare what you use in forge-project.json: "hub": { "services": ["ask", "image"], "required": false }.`;

const VR_CAPABILITY_POLICIES = Object.freeze({
  'project.file.write': { permission: 'project-write', timeoutMs: 10_000, audited: true },
  'project.file.edit': { permission: 'project-write', timeoutMs: 10_000, audited: true },
  'project.file.read': { permission: 'project-read', timeoutMs: 10_000, audited: true },
  'project.file.list': { permission: 'project-read', timeoutMs: 10_000, audited: true },
  'media.image.generate': { permission: 'media-generation', timeoutMs: 180_000, audited: true },
  'workflow.complete': { permission: 'run-control', timeoutMs: 5_000, audited: true },
});

export const VR_KINDS = Object.freeze(['game', 'simulation', 'app']);
export const HUB_SERVICES = Object.freeze(['ask', 'image', 'agent']);

/**
 * Which hub services a brief opts into, normalized to a list.
 *
 * Accepts either an array of names or the `{ ask: 'optional' }` shape the brief
 * editor writes; 'none' and absent both mean off.
 */
export function hubServicesFor(task) {
  const value = task?.hubServices;
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(item => HUB_SERVICES.includes(item));
  return HUB_SERVICES.filter(name => value[name] && value[name] !== 'none');
}
export const XR_MODES = Object.freeze(['immersive-vr', 'immersive-ar', 'both']);
export const LOCOMOTION = Object.freeze(['teleport', 'smooth', 'roomscale', 'seated', 'none']);

/** The brief, in the words the model needs, with the checkable parts spelled out. */
function vrBuildTask(task) {
  const libraries = normalizeLibraryIds(task.libraries);
  const interaction = task.interaction || {};
  const comfort = task.comfort || {};
  const features = task.xrFeatures || {};
  const lines = [
    task.prompt,
    '',
    `[Kind] ${task.kind || 'app'}`,
    `[Session] ${task.xrMode === 'both' ? 'immersive-vr and immersive-ar' : (task.xrMode || 'immersive-vr')}`,
    `[Input] controllers: ${interaction.controllers || 'required'}; hands: ${interaction.hands || 'none'}; locomotion: ${interaction.locomotion || 'teleport'}; haptics: ${interaction.haptics ? 'yes' : 'no'}`,
    `[Comfort] target ${comfort.targetFps || 72} fps${comfort.vignetteOnMove ? '; vignette on smooth motion' : ''}${comfort.snapTurn ? '; snap turn' : ''}${comfort.seatedSupported ? '; must work seated' : ''}`,
  ];
  if (features.required?.length) lines.push(`[Required WebXR features] ${features.required.join(', ')}`);
  if (features.optional?.length) lines.push(`[Optional WebXR features] ${features.optional.join(', ')}`);
  const hub = hubServicesFor(task);
  if (hub.length) {
    lines.push(`[Hub services] ${hub.join(', ')} — through lib/hub-bridge.js, and every one of them optional at runtime: the simulation must work fully when the hub is unreachable.`);
  }
  if (task.scene?.description) lines.push(`[Scene] ${task.scene.description}`);
  if (task.scene?.elements?.length) lines.push(`[Scene must contain] ${task.scene.elements.join(', ')}`);
  lines.push(`[Desktop fallback — required] ${task.desktopFallback || 'An orbit camera view of the same scene, with mouse interaction standing in for the controllers.'}`);
  if (task.acceptance?.length) lines.push(`[Acceptance] ${task.acceptance.map(item => `- ${item}`).join('\n')}`);
  if (task.watchFor) lines.push(`[Watch for] ${task.watchFor}`);
  if (libraries.length) {
    lines.push(`[Provisioned project libraries] ${libraries.join(', ')} — already present in the project; use the exact paths from your instructions.`);
  } else {
    lines.push('[Libraries] None provisioned. Write raw WebXR against WebGL2 yourself.');
  }
  lines.push('', 'Build it now as a multi-file project.');
  return lines.join('\n');
}

export const VR_PROMPT_SCHEMA = {
  schemaVersion: 1,
  required: ['id', 'title', 'prompt', 'kind', 'xrMode', 'desktopFallback'],
  fields: {
    id: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    kind: { type: 'string', default: 'app' },
    xrMode: { type: 'string', default: 'immersive-vr' },
    interaction: { type: 'object', default: { controllers: 'required', hands: 'none', locomotion: 'teleport', haptics: false } },
    xrFeatures: { type: 'object', default: { required: ['local-floor'], optional: [] } },
    comfort: { type: 'object', default: { targetFps: 72, vignetteOnMove: true, snapTurn: true, seatedSupported: false } },
    desktopFallback: { type: 'string' },
    hubServices: { type: 'object', default: {} },
    scene: { type: 'object', default: { description: '', elements: [] } },
    acceptance: { type: 'array', items: 'string', default: [] },
    watchFor: { type: 'string', default: '' },
    targetStack: { type: 'string', default: 'web' },
    tags: { type: 'array', items: 'string', default: [] },
    category: { type: 'string', default: 'uncategorized' },
    subcategory: { type: 'string', default: '' },
    collections: { type: 'array', items: 'string', default: [] },
    libraries: { type: 'array', items: 'string', default: [] },
    authoring: { type: 'object', default: { source: 'human' } },
  },
};

export const VR_ADAPTER = assertDomainAdapter({
  contractVersion: DOMAIN_ADAPTER_CONTRACT_VERSION,
  id: 'vr',
  title: 'VR Forge',
  appId: 'vr-forge',
  appTitle: 'VR Forge',
  artifactLabel: 'VR project',
  promptSchema: VR_PROMPT_SCHEMA,
  capabilityPolicies: VR_CAPABILITY_POLICIES,
  systemPromptForTask(task, { imageAssets = false } = {}) {
    let base = imageAssets ? WEB_SYSTEM_PROMPT + IMAGE_ASSETS_ADDENDUM : WEB_SYSTEM_PROMPT;
    if (hubServicesFor(task).length) base += HUB_SERVICES_ADDENDUM;
    const briefing = libraryBriefing(task?.libraries);
    return briefing ? `${base}\n\n${briefing}` : base;
  },
  buildTask(task) {
    return vrBuildTask(task);
  },
  snapshotTask(task) {
    return {
      id: task.id,
      version: task.promptVersion || 1,
      title: task.title,
      prompt: task.prompt,
      kind: task.kind || 'app',
      xrMode: task.xrMode || 'immersive-vr',
      interaction: { ...(task.interaction || {}) },
      xrFeatures: {
        required: [...(task.xrFeatures?.required || [])],
        optional: [...(task.xrFeatures?.optional || [])],
      },
      comfort: { ...(task.comfort || {}) },
      desktopFallback: task.desktopFallback || '',
      hubServices: hubServicesFor(task),
      scene: { description: task.scene?.description || '', elements: [...(task.scene?.elements || [])] },
      acceptance: [...(task.acceptance || [])],
      watchFor: task.watchFor || '',
      targetStack: 'web',
      libraries: normalizeLibraryIds(task.libraries),
      tags: [...(task.tags || [])],
      category: task.category || 'uncategorized',
      subcategory: task.subcategory || '',
      collections: [...(task.collections || [])],
      authoring: task.authoring ? { ...task.authoring } : { source: 'human' },
    };
  },
  metadataForTask(task, { artifactSlug }) {
    return {
      briefId: task.id,
      briefTitle: task.title,
      projectSlug: artifactSlug,
      // Kept under the VR Forge names too, because the shared Runs, Matrix and
      // workbench views read them by those keys.
      gameId: task.id,
      gameTitle: task.title,
      gameSlug: artifactSlug,
      era: task.kind || 'app',
      kind: task.kind || 'app',
      xrMode: task.xrMode || 'immersive-vr',
      targetStack: 'web',
      libraries: normalizeLibraryIds(task.libraries),
      category: task.category || 'uncategorized',
      subcategory: task.subcategory || '',
      collections: [...(task.collections || [])],
      prompt: task.prompt,
      promptVersion: task.promptVersion || 1,
      watchFor: task.watchFor || '',
      desktopFallback: task.desktopFallback || '',
      hubServices: hubServicesFor(task),
      variantOf: task.derivation?.laneId ? task.derivation.parentPromptId || null : null,
      laneId: task.derivation?.laneId || null,
      variantMode: task.derivation?.variantMode || null,
    };
  },
  externalAgentTask(task, { revisionTask = '' } = {}) {
    const directoryState = revisionTask
      ? 'The current directory is copied from a saved run. Inspect and revise the existing files; preserve what works.'
      : normalizeLibraryIds(task.libraries).length
        ? 'The current directory contains only the forge-provisioned library files under lib/; everything else is yours to write.'
        : 'The current directory is empty.';
    return `${directoryState} Build a complete multi-file WebXR project for the Meta Quest 3, with a root index.html and forge-project.json (kind "vr", runtime "webxr"). Work only inside the current directory.\n\n${XR_CONTRACT}\n\n${vrBuildTask(task)}${revisionTask ? `\n\n${revisionTask}` : ''}`;
  },
  capabilitiesForTask(task, { imageAssets = false, revision = false } = {}) {
    return [
      ...(revision ? ['project.file.read', 'project.file.list'] : []),
      'project.file.write',
      'project.file.edit',
      ...(imageAssets ? ['media.image.generate'] : []),
      'workflow.complete',
    ];
  },
  preview(projectHandle, options) {
    return buildProjectPreview(projectHandle, options);
  },
  validator(params) {
    return validateVrProject(params);
  },
  evaluator: 'rubric',
  evaluationRubric: EVALUATION_CRITERIA,
  coachContext(params) {
    return buildCoachContext(params);
  },
  coachSystemPrompt: 'You are a WebXR reviewer for Meta Quest 3 projects. Ground every claim in the attached project, the emulated-session evidence, the manifest and the trace. Be concrete about interaction, comfort, frame cost and fallback behaviour. The emulator proves a session ran and rendered stereo frames; it proves nothing about on-device performance, so never claim it does.',
});
