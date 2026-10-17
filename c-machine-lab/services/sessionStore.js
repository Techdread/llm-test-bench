export function buildSession({ title, source, lessonId, compiled, machine, trace, compareRun, selectedProviderId, selectedModelId }) {
  return {
    id: `c-machine-lab-${Date.now()}`,
    title,
    source,
    lessonId,
    compiled: compiled ? {
      version: compiled.version,
      sourceHash: compiled.sourceHash,
      diagnostics: compiled.diagnostics,
      assembly: compiled.assembly,
      sourceMap: compiled.sourceMap,
      symbols: compiled.symbols,
    } : null,
    machineSnapshot: machine?.snapshot?.() || null,
    trace: trace || [],
    stdout: machine?.stdout || '',
    stderr: machine?.stderr || '',
    compareRun: compareRun || null,
    selectedProviderId,
    selectedModelId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function downloadSession(session) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${session.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function readSessionFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result || '{}')));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read session file'));
    reader.readAsText(file);
  });
}
