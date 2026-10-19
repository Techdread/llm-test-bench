// Pure helpers for hiding cell output without changing source or nb variables.

export function clearCellOutput(cell) {
  return {
    ...cell,
    outputs: null,
    error: null,
    lastOutputText: '',
    outputCleared: true,
  };
}

export function clearNotebookOutputs(notebook) {
  return {
    ...notebook,
    cells: (notebook.cells || []).map(clearCellOutput),
  };
}
