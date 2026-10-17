import { lex } from './lexer.js';
import { parse } from './parser.js';
import { analyze } from './semantic.js';
import { lowerToIr } from './lowerToIr.js';
import { lowerToAssembly } from './lowerToAssembly.js';

export function compile(source, config) {
  const sourceHash = hashSource(source);
  const lexed = lex(source);
  const parsed = parse(lexed.tokens);
  const semantic = analyze(parsed.ast);
  const ir = lowerToIr(parsed.ast);
  const lowered = lowerToAssembly(parsed.ast, semantic, config);
  const diagnostics = [
    ...lexed.diagnostics,
    ...parsed.diagnostics,
    ...semantic.diagnostics,
    ...lowered.diagnostics,
  ];

  return {
    version: 1,
    sourceHash,
    diagnostics,
    ast: parsed.ast,
    ir,
    assembly: lowered.assembly,
    sourceMap: lowered.sourceMap,
    symbols: lowered.symbols,
    memoryImage: lowered.memoryImage,
  };
}

function hashSource(source) {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
