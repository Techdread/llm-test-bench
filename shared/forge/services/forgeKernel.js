// The Forge kernel — the adapter-driven surface every Forge app drives. It
// holds no domain knowledge itself: prompts, capabilities, validation and
// preview all come from the registered domain adapter.

import { iterationMetadata } from './projectWorkbench.js';
import { assertDomainAdapter, validatePromptAgainstSchema } from '../adapters/contract.js';

export function createForgeKernel(adapter) {
  adapter = assertDomainAdapter(adapter);
  return Object.freeze({
    adapter,
    buildTask(task) {
      return adapter.buildTask(task);
    },
    systemPrompt(task, options) {
      return adapter.systemPromptForTask(task, options);
    },
    validateTask(task) {
      return validatePromptAgainstSchema(task, adapter.promptSchema);
    },
    capabilities(task, options) {
      return [...new Set(adapter.capabilitiesForTask(task, options))];
    },
    externalAgentTask(task, options) {
      if (typeof adapter.externalAgentTask !== 'function') {
        throw new Error(`Adapter ${adapter.id} does not support external agents.`);
      }
      return adapter.externalAgentTask(task, options);
    },
    async runModelBuild({
      task, revisionTask = '', imageAssets = false,
      // Any further per-run toggles an adapter understands (webSearch, and a
      // Forge's own switches) ride along in `runOptions` untouched.
      runOptions = {},
      ...params
    }) {
      const taskErrors = validatePromptAgainstSchema(task, adapter.promptSchema);
      if (taskErrors.length) throw new Error(`Invalid ${adapter.id} task: ${taskErrors.join(' ')}`);
      // Keep the reusable kernel importable under node:test. The provider stack
      // contains browser settings integration, so it is loaded only when a real
      // model build begins.
      const { runBuild } = await import('./buildLoop.js');
      const revision = !!String(revisionTask || '').trim();
      const options = { imageAssets, revision, ...runOptions };
      const capabilities = [...new Set(adapter.capabilitiesForTask(task, options))];
      return runBuild({
        ...params,
        task: `${adapter.buildTask(task)}${revisionTask ? `\n\n${revisionTask}` : ''}`,
        imageAssets,
        systemPrompt: adapter.systemPromptForTask(task, options),
        capabilities,
        capabilityPolicies: adapter.capabilityPolicies || {},
        // An adapter that offers preview_app or run_project, or has its own
        // completion rule, supplies them; buildLoop keeps its defaults otherwise.
        ...(typeof adapter.previewInspector === 'function'
          ? { previewInspector: adapter.previewInspector }
          : {}),
        ...(typeof adapter.projectRunner === 'function'
          ? { projectRunner: adapter.projectRunner }
          : {}),
        ...(typeof adapter.completionEvidence === 'function'
          ? { completionEvidence: adapter.completionEvidence }
          : {}),
        // Explicit only: `adapter.id` is the domain ("game"), not the app id,
        // and using it would silently retag an existing Forge's provider
        // attribution and media-generation records.
        ...(adapter.appId ? { appId: adapter.appId } : {}),
        ...(adapter.appTitle ? { appTitle: adapter.appTitle } : {}),
      });
    },
    validate(params) {
      return adapter.validator(params);
    },
    preview(projectHandle, options) {
      return adapter.preview(projectHandle, options);
    },
    coachContext(params) {
      return adapter.coachContext(params);
    },
    baseRunMetadata({ task, runId, artifactSlug, backend, budgets, createdAt }) {
      const taskErrors = validatePromptAgainstSchema(task, adapter.promptSchema);
      if (taskErrors.length) throw new Error(`Invalid ${adapter.id} task: ${taskErrors.join(' ')}`);
      const taskSnapshot = adapter.snapshotTask(task);
      return {
        schemaVersion: 3,
        forgeKernelVersion: 1,
        adapterId: adapter.id,
        adapterContractVersion: adapter.contractVersion,
        artifactLabel: adapter.artifactLabel,
        runId,
        taskId: taskSnapshot.id,
        taskTitle: taskSnapshot.title,
        artifactSlug,
        taskSnapshot,
        promptSnapshot: taskSnapshot,
        backend,
        status: 'created',
        stopReason: null,
        error: null,
        budgets,
        rating: 0,
        createdAt,
        ...(typeof adapter.metadataForTask === 'function'
          ? adapter.metadataForTask(task, { artifactSlug })
          : {}),
      };
    },
    iterationMetadata,
  });
}
