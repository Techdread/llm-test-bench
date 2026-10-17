export function lowerToIr(ast) {
  return {
    version: 1,
    kind: 'TeachingIR',
    ast,
    note: 'The first C Machine Lab IR is intentionally close to the AST; lowerToAssembly performs the visible instruction lowering.',
  };
}
