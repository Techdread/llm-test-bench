export function makeSourceMapEntry(instruction) {
  return {
    instructionId: instruction.id,
    sourceLine: instruction.sourceLine || 1,
    sourceColumn: instruction.sourceColumn || 1,
    astNodeId: instruction.astNodeId || '',
    explanationHint: instruction.explanationHint || '',
  };
}
