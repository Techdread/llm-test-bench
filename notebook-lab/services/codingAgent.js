import {
  buildNotebookGenerationSystemPrompt,
  buildNotebookGenerationUserPrompt,
} from './notebookGeneration.js';
import { buildCellRepairPrompt, cellRepairDiagnostic } from './cellRepair.js';
import { describeNotebookVariables, HTML_NB_BRIDGE_GUIDE, JS_RETURN_GUIDE, UI_CONTROL_GUIDE } from './generationContext.js';

const EXTENSION = {
  md: 'md', js: 'js', py: 'py', c: 'c', rust: 'rs', lua: 'lua', java: 'java',
  go: 'go', scala: 'scala', clojure: 'clj', html: 'html', ui: 'json', chart: 'json',
};

const GUIDANCE = {
  md: 'Write Markdown only.',
  js: 'Write one JavaScript snippet. Top-level await is allowed. Use nb.set(key, value), nb.get(key), and console.log for notebook data and output. ' + JS_RETURN_GUIDE,
  py: 'Write one Python snippet runnable in Pyodide. numpy and matplotlib are preloaded. Use nb["key"] to share notebook values and print visible results.',
  c: 'Write a complete single-file C program with main(), compatible with common standard headers.',
  rust: 'Write a complete single-file Rust program with fn main() and the standard library only.',
  lua: 'Write a complete Lua 5.4 program using the standard library only.',
  java: 'Write a complete Java program with one public class and public static void main(String[] args).',
  go: 'Write a complete Go program in package main with func main(), using the standard library only.',
  scala: 'Write a complete Scala 2.11-compatible program with an executable Main object.',
  clojure: 'Write a complete Clojure 1.11 program using the core library only.',
  html: 'Write a complete HTML fragment for a sandboxed iframe. Inline its CSS and JavaScript; omit outer html/head tags and repository-relative dependencies. ' + HTML_NB_BRIDGE_GUIDE,
  ui: 'Write one JSON object for a Notebook Lab UI cell with title, optional description, and controls. Supported control types: label, text, textarea, number, checkbox, select, radio, slider, color, date, button. Bound inputs use a bind key and defaults. ' + UI_CONTROL_GUIDE,
  chart: 'Write one valid Vega-Lite JSON specification.',
};

export function notebookAgentOutputFile(kind) {
  const extension = EXTENSION[kind];
  if (!extension) throw new Error(`Unsupported notebook cell kind: ${kind}`);
  return `cell.${extension}`;
}

export function buildNotebookAgentTask({ kind, prompt, contextCells = [], variables, searchContext = '' } = {}) {
  const request = String(prompt || '').trim();
  if (!request) throw new Error('A cell prompt is required');
  const outputFile = notebookAgentOutputFile(kind);
  const context = contextCells.slice(-4).map((cell, index) => {
    const source = String(cell?.source || '').slice(0, 1200);
    const output = String(cell?.lastOutputText || '').slice(0, 500);
    return `PRIOR CELL ${index + 1} [${cell?.kind || 'unknown'}]\n${source}${output ? `\nOUTPUT\n${output}` : ''}`;
  }).join('\n\n');

  const research = String(searchContext || '').trim();
  const variablesText = describeNotebookVariables(variables);

  return `You are writing one ${kind} cell for Notebook Lab.

TASK
${request}
${context ? `\nNOTEBOOK CONTEXT\n${context}\n` : ''}${variablesText ? `\nNOTEBOOK VARIABLES\n${variablesText}\n` : ''}${research ? `\nWEB RESEARCH SUPPLIED BY THE USER\n${research}\n` : ''}
CELL CONTRACT
${GUIDANCE[kind]}

REQUIRED RESULT
- Write the complete cell source to ${outputFile} in the current project directory.
- The file contents become the cell verbatim: no Markdown fence around code, no commentary, and no extra wrapper unless the cell contract asks for one.
- Do not merely describe the solution in chat. Inspect the written file before finishing.`;
}

export function buildNotebookRepairAgentTask({ cell, contextCells = [], variables } = {}) {
  if (!cellRepairDiagnostic(cell)) throw new Error('A cell error is required');
  return buildNotebookAgentTask({
    kind: cell.kind,
    prompt: buildCellRepairPrompt(cell),
    contextCells,
    variables,
  });
}

export const NOTEBOOK_AGENT_OUTPUT_FILE = 'notebook.json';

export function buildNotebookGenerationAgentTask({
  prompt,
  mode = 'create',
  currentNotebook,
  searchContext = '',
  languages = [],
  visualOutput = 'auto',
  variables,
} = {}) {
  const contract = buildNotebookGenerationSystemPrompt();
  const request = buildNotebookGenerationUserPrompt({
    prompt, mode, currentNotebook, searchContext, languages, visualOutput, variables,
  });
  return `${contract}

${request}

AGENT DELIVERY CONTRACT
- Write the final strict JSON object to ${NOTEBOOK_AGENT_OUTPUT_FILE} in the current project directory.
- You may reason, inspect, and validate before writing, but the file itself must contain JSON only.
- Parse the file as JSON and inspect every cell before finishing.
- Do not merely paste the notebook into chat; the written file is the required result.`;
}
