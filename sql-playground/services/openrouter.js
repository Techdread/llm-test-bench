// SQL Playground LLM service — thin wrappers around the shared model-provider
// stack for draftSchema / suggestQuery / explainQuery.

import { getApiKey, saveApiKey, hasApiKey } from '../../shared/services/providers-openrouter.js';
import { chatCompletion } from '../../shared/services/model-providers.js';
import { runToolLoop } from '../../shared/services/tool-runner.js';

export { getApiKey, saveApiKey, hasApiKey };

const APP_TITLE = 'SQL Playground';

// ── helpers ──

function stripFences(text) {
  if (!text) return '';
  const fence = /```(?:sql)?\s*([\s\S]*?)```/i;
  const m = text.match(fence);
  return (m ? m[1] : text).trim();
}

function schemaSummary(schema) {
  if (!schema || !schema.tables || schema.tables.length === 0) return '(empty database — no tables yet)';
  return schema.tables.map(t => {
    const cols = (t.columns || []).map(c => {
      const pk = c.pk ? ' PK' : '';
      return `  ${c.name} ${c.type || 'ANY'}${pk}`;
    }).join('\n');
    const fks = (t.foreignKeys || []).map(fk =>
      `  FK ${fk.fromColumn} -> ${fk.toTable}(${fk.toColumn})`
    ).join('\n');
    return `TABLE ${t.name}\n${cols}${fks ? '\n' + fks : ''}`;
  }).join('\n\n');
}

async function chat(messages, providerId, modelId, { tools, signal } = {}) {
  const res = await chatCompletion({ providerId, modelId, messages, tools, appTitle: APP_TITLE });
  const message = res?.choices?.[0]?.message;
  if (!message) throw new Error('Provider returned no message');
  if (signal?.aborted) throw new Error('aborted');
  return { message };
}

// ── draftSchema ──

const DRAFT_SYSTEM = `You design clean, minimal SQLite schemas.
Given a description, emit ONLY SQL DDL: CREATE TABLE statements (with primary keys,
sensible types, and FOREIGN KEY constraints) plus, optionally, INSERT statements for
a tiny demo seed. No explanations, no markdown fences — just the SQL.`;

export async function draftSchema({ description, providerId, modelId, signal }) {
  const messages = [
    { role: 'system', content: DRAFT_SYSTEM },
    { role: 'user', content: description.trim() },
  ];
  const { message } = await chat(messages, providerId, modelId, { signal });
  const sql = stripFences(message.content || '');
  if (!sql) throw new Error('Model returned no SQL');
  return { sql };
}

// ── suggestQuery ──

const SUGGEST_SYSTEM = `You write precise SQLite queries.
You will be given a schema summary and a natural-language question.
Respond with ONLY the SQL for a single query that answers the question.
Use the exact table and column names from the schema. No explanations, no
markdown fences — just the SQL statement.`;

export async function suggestQuery({ schema, question, providerId, modelId, signal }) {
  const messages = [
    { role: 'system', content: SUGGEST_SYSTEM },
    { role: 'user', content: `Schema:\n${schemaSummary(schema)}\n\nQuestion: ${question.trim()}` },
  ];
  const { message } = await chat(messages, providerId, modelId, { signal });
  const sql = stripFences(message.content || '');
  if (!sql) throw new Error('Model returned no SQL');
  return { sql };
}

// ── explainQuery ──

const EXPLAIN_SYSTEM = `You explain SQL queries in plain language for a working
developer. Given a schema summary and a SQL query, return a 3–6 sentence
explanation that describes what the query returns, how it joins/filters/aggregates,
and any noteworthy subtleties (nullability, indexes that would help, etc.).
No markdown, just prose.`;

export async function explainQuery({ schema, sql, providerId, modelId, signal }) {
  const messages = [
    { role: 'system', content: EXPLAIN_SYSTEM },
    { role: 'user', content: `Schema:\n${schemaSummary(schema)}\n\nSQL:\n${sql.trim()}` },
  ];
  const { message } = await chat(messages, providerId, modelId, { signal });
  return { text: (message.content || '').trim() };
}

// ── Seed data generator ──

const SEED_SYSTEM = `You generate realistic SQLite seed data.
Given a schema and a target row count per table, emit ONLY INSERT statements that
respect primary keys and foreign keys. Keep values short and plausible. No
explanations, no markdown fences — just the SQL.`;

export async function draftSeed({ schema, rowsPerTable = 5, providerId, modelId, signal }) {
  const messages = [
    { role: 'system', content: SEED_SYSTEM },
    { role: 'user', content: `Schema:\n${schemaSummary(schema)}\n\nRows per table: ${rowsPerTable}` },
  ];
  const { message } = await chat(messages, providerId, modelId, { signal });
  const sql = stripFences(message.content || '');
  if (!sql) throw new Error('Model returned no SQL');
  return { sql };
}

// ── Tool-loop variant (kept for future expansion) ──
// eslint-disable-next-line no-unused-vars
async function _toolLoop(toolSet, { systemPrompt, userPrompt, providerId, modelId, signal }) {
  const completion = async (messages, tools, { signal: s }) =>
    chat(messages, providerId, modelId, { tools, signal: s });
  return runToolLoop({ toolSet, chatCompletion: completion, systemPrompt, userPrompt, maxSteps: 3, signal });
}
