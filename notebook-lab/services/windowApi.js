export function registerWindowApi(handlers) {
  const api = {
    version: 'notebook-lab-api-v1',
    loadNotebook: handlers.loadNotebook,
    runNotebook: handlers.runNotebook,
    saveNotebook: handlers.saveNotebook,
    runAndSave: handlers.runAndSave,
    getCurrentNotebook: handlers.getCurrentNotebook,
  };

  window.NotebookLabAPI = api;

  const onMessage = async (event) => {
    if (event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.target !== 'notebook-lab' || !msg.action) return;
    const fn = api[msg.action];
    if (typeof fn !== 'function') return;
    const payload = msg.payload && typeof msg.payload === 'object'
      ? { ...msg.payload, requestId: msg.payload.requestId || msg.requestId }
      : msg;

    try {
      const result = await fn(payload);
      postResponse(event, {
        source: 'notebook-lab',
        requestId: msg.requestId || msg.payload?.requestId || null,
        ok: true,
        result,
      });
    } catch (err) {
      postResponse(event, {
        source: 'notebook-lab',
        requestId: msg.requestId || msg.payload?.requestId || null,
        ok: false,
        error: err.message || String(err),
      });
    }
  };

  window.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener('message', onMessage);
    if (window.NotebookLabAPI === api) delete window.NotebookLabAPI;
  };
}

function postResponse(event, payload) {
  const target = event.source || window;
  try {
    target.postMessage(payload, event.origin || window.location.origin);
  } catch {
    window.postMessage(payload, window.location.origin);
  }
}
