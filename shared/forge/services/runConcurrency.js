let nextRunToken = 1;

/**
 * Tracks independent generation attempts without coupling their lifecycles to
 * whichever attempt is currently rendered in the Build view.
 */
export function createRunCoordinator(onChange = () => {}) {
  const active = new Map();
  let currentToken = null;

  const snapshot = () => {
    const current = currentToken != null ? active.get(currentToken) : null;
    return {
      activeCount: active.size,
      currentToken,
      currentActive: !!current,
      // Pause belongs to a single run, not to the app: another run started while
      // this one is parked keeps generating.
      currentPauseState: current?.lease.pauseState() || 'running',
      currentPauseContext: current?.lease.pauseContext() || null,
    };
  };
  const emit = () => onChange(snapshot());

  /**
   * Pause is a control on the run being displayed, so a run that loses the
   * display loses the only button that could resume it. Rather than leave it
   * parked forever — an external agent would stay suspended as a stopped OS
   * process — release it as it goes.
   */
  const releaseCurrent = () => {
    const lease = currentToken != null ? active.get(currentToken)?.lease : null;
    if (lease?.isPauseRequested()) Promise.resolve(lease.resume()).catch(() => {});
  };

  function begin() {
    releaseCurrent();
    const token = nextRunToken++;
    const controller = new AbortController();
    let finished = false;

    // ── Pause state ──────────────────────────────────────────────────────────
    // `requested` is the button; `parked` means a cooperative loop is actually
    // sitting at a safe boundary; `hookApplied` means an out-of-process runner
    // (the agent bridge) confirmed it is suspended. Either of the latter two is
    // what makes the state honestly "paused" rather than "pausing…".
    let requested = false;
    let parked = false;
    let hookApplied = false;
    let release = null;      // resolves the parked loop's promise
    let context = null;      // what the loop was about to do when it parked
    let hook = null;         // optional async (paused:boolean) => any

    const pauseState = () => (!requested ? 'running' : (parked || hookApplied ? 'paused' : 'pausing'));

    const letGo = () => {
      const resolve = release;
      release = null;
      parked = false;
      context = null;
      resolve?.();
    };

    // A hard stop must never leave a run parked at a gate or suspended in the
    // background: release the gate and lift the hook before the abort lands.
    controller.signal.addEventListener('abort', () => {
      if (!requested) return;
      requested = false;
      if (hookApplied) { hookApplied = false; try { hook?.(false); } catch { /* run is ending anyway */ } }
      letGo();
      emit();
    }, { once: true });

    const lease = {
      token,
      controller,
      isCurrent: () => currentToken === token,
      guard(callback) {
        if (currentToken !== token) return undefined;
        return callback();
      },
      finish() {
        if (finished) return;
        finished = true;
        requested = false;
        hookApplied = false;
        hook = null;
        letGo();
        active.delete(token);
        emit();
      },

      /**
       * Register how a run that is NOT a cooperative in-process loop suspends
       * itself — the external-agent bridge suspends its child process. Called
       * with `true` to pause and `false` to resume; returning false (or
       * throwing) means the pause did not take, and the lease stays running.
       */
      setPauseHook(fn) { hook = fn; },
      pauseState,
      pauseContext: () => context,
      isPauseRequested: () => requested,

      async pause() {
        if (finished || requested || controller.signal.aborted) return false;
        requested = true;
        emit(); // "Pausing…" immediately; the boundary/hook decides when it is real
        if (!hook) return true;
        try {
          const ok = await hook(true);
          if (ok === false) throw new Error('pause was refused');
          hookApplied = true;
          emit();
          return true;
        } catch (error) {
          requested = false;
          emit();
          throw error;
        }
      },

      async resume() {
        if (!requested) return false;
        requested = false;
        letGo();
        emit();
        if (hookApplied) {
          hookApplied = false;
          await hook?.(false);
        }
        return true;
      },

      /**
       * The gate a cooperative loop awaits at a safe boundary. Resolves at once
       * unless a pause is pending, so it is cheap to call on every boundary.
       */
      async waitIfPaused(nextContext) {
        if (!requested || finished || controller.signal.aborted) return;
        parked = true;
        context = nextContext || null;
        emit();
        await new Promise(resolve => { release = resolve; });
      },
    };

    active.set(token, { lease, controller });
    currentToken = token;
    emit();
    return lease;
  }

  const currentLease = () => (currentToken != null ? active.get(currentToken)?.lease : null);

  return {
    begin,
    snapshot,
    currentLease,
    detachCurrent() {
      releaseCurrent();
      currentToken = null;
      emit();
    },
    pauseCurrent() {
      return currentLease()?.pause() ?? Promise.resolve(false);
    },
    resumeCurrent() {
      return currentLease()?.resume() ?? Promise.resolve(false);
    },
    cancelCurrent() {
      if (currentToken == null) return;
      active.get(currentToken)?.controller.abort();
    },
    cancelAll() {
      for (const { controller } of active.values()) controller.abort();
    },
  };
}

/** Bind Preact state setters so stale runs cannot overwrite the newest UI. */
export function bindRunSetters(lease, setters) {
  return Object.fromEntries(Object.entries(setters).map(([name, setter]) => [
    name,
    (...args) => lease.guard(() => setter(...args)),
  ]));
}
