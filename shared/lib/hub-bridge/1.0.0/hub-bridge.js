/**
 * Hub Bridge 1.0.0 — the services a generated Forge project may use at runtime.
 *
 * A project served from the hub's own origin (including a VR project opened on a
 * Quest through the adb reverse at http://localhost:8084/) can ask the hub for
 * three things a static page cannot do for itself:
 *
 *   HubBridge.ask({ prompt })     a language-model answer
 *   HubBridge.image({ prompt })   a generated image, as a data URL
 *   HubBridge.agent({ prompt })   a local CLI coding agent, for heavier work
 *
 * Design rules, because a simulation is not a chat app:
 *
 * - **No keys ever reach this file.** Whatever provider is configured lives in
 *   the hub server's environment; the project only sees text back.
 * - **Everything is optional.** `status()` says what is actually available, and
 *   every call rejects with a plain message when it is not. A simulation that
 *   stops working because the hub is unreachable is a broken simulation: use
 *   these to *enrich* a scene that already runs on its own.
 * - **Never call from a frame loop.** The hub rate-limits (20/minute by
 *   default) and a model call takes seconds. Ask on a deliberate action — a
 *   button, a grab, the end of a round — and show the previous answer until a
 *   new one arrives.
 *
 * This file is copied into a project's own lib/ folder. It has no dependencies
 * and adds no globals beyond `HubBridge`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HubBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 120000;

  function endpoint(path) {
    // Same-origin absolute path: correct both in the hub's preview iframe and
    // in Quest Browser on http://localhost:8084/_data/…
    return path;
  }

  async function call(path, body, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('hub call timed out')), timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    let response;
    try {
      response = await fetch(endpoint(path), {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(`the hub is not reachable from this page (${error.message})`);
    } finally {
      clearTimeout(timer);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.hint ? ` — ${payload.hint}` : '';
      throw new Error((payload.error || `hub returned ${response.status}`) + detail);
    }
    return payload;
  }

  let statusCache = null;

  const HubBridge = {
    version: '1.0.0',

    /**
     * What this hub can actually do right now, cached for the page's lifetime.
     * `{ ask, image: {reachable}, agent, limits }`. Never throws: an
     * unreachable hub reports everything as unavailable.
     */
    async status({ refresh = false } = {}) {
      if (!statusCache || refresh) {
        statusCache = call(endpoint('/__ask/status'))
          .then(value => ({ reachable: true, ...value }))
          .catch(() => ({ reachable: false, ask: false, image: { reachable: false }, agent: false, limits: null }));
      }
      return statusCache;
    },

    /** True when a model service is configured. Cheap to call repeatedly. */
    async canAsk() {
      return !!(await this.status()).ask;
    },

    /** True when an image node is reachable. */
    async canGenerateImages() {
      return !!(await this.status()).image?.reachable;
    },

    /**
     * Ask a question and get one answer back.
     *
     * @param {object} options
     * @param {string} options.prompt      the question (≤ 8000 chars)
     * @param {string} [options.system]    a role/instruction line
     * @param {boolean} [options.json]     ask the model for a JSON object
     * @param {number} [options.maxTokens] capped by the server
     * @returns {Promise<{text, model, usage}>}
     */
    async ask({ prompt, system, json = false, maxTokens, timeoutMs, signal } = {}) {
      if (!prompt || !String(prompt).trim()) throw new Error('ask: prompt is required');
      return call(endpoint('/__ask'), {
        prompt: String(prompt), system, json: !!json, maxTokens,
      }, { timeoutMs, signal });
    },

    /**
     * Ask for a JSON object and get it parsed, or throw with the raw text.
     * Useful for a simulation that wants structured input: a generated scenario,
     * a set of policy weights, a piece of scripted dialogue.
     */
    async askJson(options) {
      const answer = await this.ask({ ...options, json: true });
      const text = String(answer.text || '').trim();
      const body = text.startsWith('```')
        ? text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
        : text;
      try {
        return { ...answer, data: JSON.parse(body) };
      } catch (error) {
        throw new Error(`the model did not return JSON (${error.message}): ${text.slice(0, 200)}`);
      }
    },

    /**
     * Generate one image and get it back as a data URL, ready to use as a
     * texture. Takes seconds to minutes; call it on an explicit action, show
     * something in its place meanwhile, and cache the result.
     *
     * @returns {Promise<{dataUrl, mime, bytes, jobId}>}
     */
    async image({ prompt, resolution, seed, model, timeoutMs = 300000, signal } = {}) {
      if (!prompt || !String(prompt).trim()) throw new Error('image: prompt is required');
      return call(endpoint('/__ask/image'), {
        prompt: String(prompt), resolution, seed, model,
      }, { timeoutMs, signal });
    },

    /** An <img>-ready texture, or null if image generation is unavailable. */
    async imageOrNull(options) {
      try {
        if (!(await this.canGenerateImages())) return null;
        return await this.image(options);
      } catch {
        return null;
      }
    },

    /**
     * Run a local CLI coding agent (Claude Code, Codex, …) and wait for its
     * final answer. No API key is involved — it uses the CLI's own login.
     *
     * Slower and heavier than `ask`, but it can do real work: write files into
     * a scratch directory, compute something with tools, analyse a dataset.
     *
     * @param {object} options
     * @param {string} options.prompt
     * @param {string} [options.agent]      'claude-code' (default), 'codex', 'antigravity'
     * @param {Function} [options.onEvent]  every normalized bridge event
     * @returns {Promise<{text, events, runId}>}
     */
    async agent({ prompt, agent = 'claude-code', onEvent, timeoutMs = 600000, signal } = {}) {
      if (!prompt || !String(prompt).trim()) throw new Error('agent: prompt is required');
      const started = await call(endpoint('/__agent/run'), {
        agent, prompt: String(prompt), options: {},
      }, { timeoutMs: 30000, signal });
      const runId = started.runId;
      if (!runId) throw new Error('the agent bridge did not start a run');

      return new Promise((resolve, reject) => {
        const events = [];
        const source = new EventSource(endpoint(`/__agent/stream/${encodeURIComponent(runId)}`));
        const timer = setTimeout(() => {
          source.close();
          reject(new Error('the agent did not finish in time'));
        }, timeoutMs);
        const finish = (value, error) => {
          clearTimeout(timer);
          source.close();
          if (error) reject(error); else resolve(value);
        };
        source.onmessage = (message) => {
          let event;
          try { event = JSON.parse(message.data); } catch { return; }
          events.push(event);
          onEvent?.(event);
          if (event.type === 'done') {
            const text = events.filter(item => item.type === 'message' && item.text)
              .map(item => item.text).join('\n').trim();
            finish({ text: text || event.summary || '', events, runId });
          }
          if (event.type === 'error' && !event.budgetCode) {
            finish(null, new Error(event.message || 'the agent reported an error'));
          }
        };
        source.onerror = () => finish(null, new Error('the agent stream was interrupted'));
        signal?.addEventListener('abort', () => {
          fetch(endpoint(`/__agent/cancel/${encodeURIComponent(runId)}`), { method: 'POST' }).catch(() => {});
          finish(null, new Error('cancelled'));
        }, { once: true });
      });
    },
  };

  return HubBridge;
});
