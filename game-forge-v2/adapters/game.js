import { validateProject } from '../services/validator.js';
import { buildProjectPreview } from '../services/previewAdapters.js';
import { buildCoachContext } from '../services/coachContext.js';
import { EVALUATION_CRITERIA } from '../services/projectWorkbench.js';
import { libraryBriefing, normalizeLibraryIds } from '../services/projectLibraries.js';
import { assertDomainAdapter, DOMAIN_ADAPTER_CONTRACT_VERSION } from './contract.js';

const WEB_SYSTEM_PROMPT = `You are an expert game engineer building a COMPLETE, PLAYABLE game as a multi-file web project inside a sandbox directory. You author the project entirely through tool calls.

RULES
- The entry point MUST be a file named "index.html" at the project root. Split logic into multiple files (e.g. index.html, styles.css, src/*.js) — do not cram everything into one file; multi-file structure is the point.
- The game must be fully SELF-CONTAINED: vanilla HTML/CSS/JS, Canvas 2D or WebGL plus only the project libraries explicitly provisioned below. Do NOT reference any external URL, CDN, network resource or Hub-relative path.
- Prefer classic <script src="..."> project scripts so the project opens directly. When a provisioned library explicitly requires ES modules, declare runtime:"module-web" and follow its exact import instructions.
- Generate any art procedurally (draw with canvas / shapes / simple sprite data) — you cannot fetch image or audio files.
- Make it actually playable: real controls, win/lose states, and the specific mechanics named in the task. Address every point in the task's "watch for" note.
- For animated canvas games, clear or paint the full drawable area every frame with non-zero dimensions so sprites never leave trails.
- For smooth grid movement, keep logical cells and rendered pixel positions separate; do not snap rendered positions to each new cell before tweening.
- For a literal maze/grid array, derive row and column counts from the array after declaring it (for example ROWS = MAZE.length and COLS = MAZE[0].length). Never loop over hard-coded dimensions that can exceed the actual data.
- If the brief requests edge/tunnel wrapping, ensure the collision map's boundary cells are passable at the wrap points.
- Write a short README.md describing controls and how to run it.
- Write a root forge-project.json manifest with schemaVersion:1, kind:"game", entry:"index.html", runtime:"static-web", build:null, run:null, an assets array, and a declaredControls array. Keep it accurate when files change.

EFFICIENCY
- Use only the tools actually offered in this request. A fresh build starts empty and may intentionally omit read_file/list_files: write the planned files directly without trying to inspect them first.
- Write each file ONCE. On revisions, use read_file only when you genuinely need existing content; reading every file after writing it is not a required finishing step.
- Tool acknowledgements and compact history summaries are status text, never source code. Never copy them into a file's content.
- Prefer one complete file-writing tool call per turn. After its success, move to the next planned file.
- For changes use edit_file instead of rewriting a whole file.
- Never repeat an identical write. Once complete, call report_done.

WORKFLOW
1. Plan the file layout. 2. Author files. 3. Call report_done as soon as the game is complete.

Keep going autonomously until the game is finished. Do not ask the user questions.`;

const nativeSystemPrompt = language => `You are an expert game engineer building a COMPLETE, PLAYABLE game as a multi-file ${language} project inside a sandbox directory. You author the project entirely through tool calls.

RULES
- Use an idiomatic multi-file structure and include a build manifest.
- Remain fully self-contained and buildable offline with the standard library.
- Implement the requested mechanics, a real game loop, and keyboard input.
- Write README.md with exact BUILD and RUN commands.
- Write forge-project.json with schemaVersion:1, kind:"game", runtime:"native", the real entry, build/run commands, assets, and declaredControls.
- Inspect existing files before focused revisions. Call report_done once complete.

Keep going autonomously until the game is finished. Do not ask questions.`;

const IMAGE_ASSETS_ADDENDUM = `

IMAGE ASSETS
- generate_image is available for a few key local sprites/backgrounds/tiles.
- Reference generated files by project-relative path and wait for image loading.
- Prefer procedural drawing for incidental art and UI.`;

const STACK_LANGUAGE = {
  c: 'C', cpp: 'C++', 'c++': 'C++', rust: 'Rust', go: 'Go',
  python: 'Python', py: 'Python', java: 'Java', zig: 'Zig',
};

const GAME_CAPABILITY_POLICIES = Object.freeze({
  'project.file.write': { permission: 'project-write', timeoutMs: 10_000, audited: true },
  'project.file.edit': { permission: 'project-write', timeoutMs: 10_000, audited: true },
  'project.file.read': { permission: 'project-read', timeoutMs: 10_000, audited: true },
  'project.file.list': { permission: 'project-read', timeoutMs: 10_000, audited: true },
  'media.image.generate': { permission: 'media-generation', timeoutMs: 180_000, audited: true },
  'workflow.complete': { permission: 'run-control', timeoutMs: 5_000, audited: true },
});

function gameBuildTask(task) {
  const libraries = normalizeLibraryIds(task.libraries);
  return `${task.prompt}\n\n[Acceptance / watch for] ${task.watchFor || 'Make it genuinely playable.'}${
    libraries.length
      ? `\n\nProvisioned project libraries: ${libraries.join(', ')}. They already exist in the project; use the exact paths in your instructions.`
      : ''
  }\n\nBuild it now as a multi-file project. Follow the target stack described in your instructions.`;
}

export const GAME_PROMPT_SCHEMA = {
  schemaVersion: 1,
  required: ['id', 'title', 'prompt'],
  fields: {
    id: { type: 'string' },
    title: { type: 'string' },
    prompt: { type: 'string' },
    era: { type: 'string', default: 'Custom' },
    targetStack: { type: 'string', default: 'web' },
    tags: { type: 'array', items: 'string', default: [] },
    category: { type: 'string', default: 'uncategorized' },
    subcategory: { type: 'string', default: '' },
    collections: { type: 'array', items: 'string', default: [] },
    libraries: { type: 'array', items: 'string', default: [] },
    watchFor: { type: 'string', default: '' },
    authoring: { type: 'object', default: { source: 'human' } },
  },
};

export const GAME_ADAPTER = assertDomainAdapter({
  contractVersion: DOMAIN_ADAPTER_CONTRACT_VERSION,
  id: 'game',
  title: 'Game Forge',
  artifactLabel: 'game',
  promptSchema: GAME_PROMPT_SCHEMA,
  capabilityPolicies: GAME_CAPABILITY_POLICIES,
  systemPromptForTask(task, { imageAssets = false } = {}) {
    const stack = String(task?.targetStack || 'web').toLowerCase();
    const base = stack === 'web' || !stack
      ? WEB_SYSTEM_PROMPT
      : nativeSystemPrompt(STACK_LANGUAGE[stack] || stack.toUpperCase());
    const withImages = imageAssets ? base + IMAGE_ASSETS_ADDENDUM : base;
    const briefing = stack === 'web' || !stack ? libraryBriefing(task?.libraries) : '';
    return briefing ? `${withImages}\n\n${briefing}` : withImages;
  },
  buildTask(task) {
    return gameBuildTask(task);
  },
  snapshotTask(task) {
    return {
      id: task.id,
      version: task.promptVersion || 1,
      title: task.title,
      prompt: task.prompt,
      ...(task.originalPrompt !== undefined ? {
        originalPrompt: task.originalPrompt,
        specAdditions: (task.specAdditions || []).map(item => ({ ...item })),
      } : {}),
      era: task.era || '',
      watchFor: task.watchFor || '',
      targetStack: task.targetStack || 'web',
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
      gameId: task.id,
      gameTitle: task.title,
      gameSlug: artifactSlug,
      era: task.era || '',
      targetStack: task.targetStack || 'web',
      libraries: normalizeLibraryIds(task.libraries),
      category: task.category || 'uncategorized',
      subcategory: task.subcategory || '',
      collections: [...(task.collections || [])],
      prompt: task.prompt,
      ...(task.originalPrompt !== undefined ? {
        originalPrompt: task.originalPrompt,
        specAdditions: (task.specAdditions || []).map(item => ({ ...item })),
      } : {}),
      promptVersion: task.promptVersion || 1,
      watchFor: task.watchFor || '',
      // Denormalised from the prompt's derivation so the Matrix can place a run
      // in its (game, lane) cell without reopening the prompt library — which a
      // run must survive without anyway, since prompts can be hidden or edited
      // long after the run that used them (spec 327).
      variantOf: task.derivation?.laneId ? task.derivation.parentPromptId || null : null,
      laneId: task.derivation?.laneId || null,
      variantMode: task.derivation?.variantMode || null,
    };
  },
  externalAgentTask(task, { revisionTask = '' } = {}) {
    const web = String(task?.targetStack || 'web').toLowerCase() === 'web';
    const stackLine = web
      ? 'Build a complete, playable, portable multi-file web project with root index.html and forge-project.json. Use vanilla HTML/CSS/JS with no network dependencies.'
      : `Build a complete portable ${String(task?.targetStack || '').toUpperCase()} project with README, build/run commands, and forge-project.json runtime "native".`;
    const directoryState = revisionTask
      ? 'The current directory is copied from a saved run. Inspect and revise existing files; preserve working features.'
      : normalizeLibraryIds(task.libraries).length
        ? 'The current directory contains only the forge-provisioned library files described below; everything else is yours to write.'
        : 'The current directory is empty.';
    return `${directoryState} ${stackLine} Work only inside the current directory.\n\n${gameBuildTask(task)}${revisionTask ? `\n\n${revisionTask}` : ''}`;
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
    return validateProject(params);
  },
  evaluator: 'rubric',
  evaluationRubric: EVALUATION_CRITERIA,
  coachContext(params) {
    return buildCoachContext(params);
  },
  coachSystemPrompt: 'You are a game-development reviewer. Ground every claim in the attached project, validation evidence, mechanics brief, and trace. Be concrete about playability, feel, bugs, and focused fixes.',
});
