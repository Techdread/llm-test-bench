// Deterministic acceptance-checklist and audit normalization helpers for the
// Prompt Gallery Verified Generation pilot. This module deliberately has no
// DOM, provider, timer, or filesystem dependencies so it can be tested in Node.

const MAX_PROMPT_CHECKS = 12;
const MAX_LABEL = 240;
const MAX_EVIDENCE = 500;
const MAX_REPAIR_TASKS = 4;

function compact(value, cap = MAX_LABEL) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > cap ? text.slice(0, cap).trimEnd() : text;
}

function sentenceCase(value) {
  const text = compact(value, MAX_LABEL - 1).replace(/^[\s:,-]+|[\s,]+$/g, '');
  if (!text) return '';
  const cased = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
}

function evidenceKind(requirement) {
  const value = requirement.toLowerCase();
  if (/\b(click|button|control|keyboard|key|drag|drop|restart|start|pause|play|input|select|toggle|interact)/.test(value)) return 'interaction';
  if (/\b(visible|visual|colour|color|layout|responsive|animate|animation|canvas|svg|image|scene|render|display|show)/.test(value)) return 'visual';
  if (/\b(source|html|css|javascript|script|doctype|semantic|aria)/.test(value)) return 'source';
  return 'source';
}

function candidateClauses(prompt) {
  const out = [];
  const lines = String(prompt || '').replace(/\r/g, '').split('\n');
  for (const rawLine of lines) {
    let line = rawLine.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s*)/, '').trim();
    if (!line) continue;

    // A heading followed by a colon often introduces a compact feature list.
    const colon = line.indexOf(':');
    if (colon > 0 && colon < 80) line = line.slice(colon + 1).trim() || line;

    const semicolonParts = line.split(/\s*;\s*/).filter(Boolean);
    for (const semicolonPart of semicolonParts) {
      const sentences = semicolonPart.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter(Boolean);
      for (const sentence of sentences) {
        // Split explicit comma lists only when the line clearly introduces a
        // list. Free prose keeps its context intact.
        const parts = /\b(include|provide|add|show|support|with|features?)\b/i.test(sentence)
          && (sentence.match(/,/g) || []).length >= 2
          ? sentence.split(/\s*,\s*(?:and\s+)?/)
          : [sentence];
        for (const part of parts) out.push(part);
      }
    }
  }
  return out;
}

function uniqueChecks(values, source, prefix, limit) {
  const seen = new Set();
  const checks = [];
  for (const value of values) {
    const requirement = sentenceCase(value);
    const key = requirement.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!requirement || requirement.length < 4 || seen.has(key)) continue;
    seen.add(key);
    checks.push({
      id: `${prefix}-${String(checks.length + 1).padStart(2, '0')}`,
      source,
      requirement,
      priority: 'must',
      evidenceKind: evidenceKind(requirement),
    });
    if (checks.length >= limit) break;
  }
  return checks;
}

export function deriveAcceptanceChecklist(promptItem = {}) {
  const host = [
    { id: 'runtime-01', source: 'host', requirement: 'Return a non-empty HTML document.', priority: 'must', evidenceKind: 'runtime' },
    { id: 'runtime-02', source: 'host', requirement: 'Complete the sandbox run within the time limit.', priority: 'must', evidenceKind: 'runtime' },
    { id: 'runtime-03', source: 'host', requirement: 'Produce no captured runtime errors.', priority: 'must', evidenceKind: 'runtime' },
  ];
  const promptChecks = uniqueChecks(candidateClauses(promptItem.prompt), 'prompt', 'prompt', MAX_PROMPT_CHECKS);
  const watchValues = String(promptItem.notes || '')
    .replace(/^\s*watch\s+for\s*:?\s*/i, '')
    .split(/\s*;\s*|\n+/)
    .map(value => value.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
  const watchChecks = uniqueChecks(watchValues, 'watchFor', 'watch', MAX_PROMPT_CHECKS);

  // Remove duplicates across prompt and Watch for while retaining stable IDs
  // inside each source group.
  const seen = new Set();
  const userChecks = [];
  for (const check of [...promptChecks, ...watchChecks]) {
    const key = check.requirement.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    userChecks.push(check);
    if (userChecks.length >= MAX_PROMPT_CHECKS) break;
  }
  const counters = { prompt: 0, watchFor: 0 };
  const reindexed = userChecks.map(check => {
    counters[check.source]++;
    const prefix = check.source === 'watchFor' ? 'watch' : 'prompt';
    return { ...check, id: `${prefix}-${String(counters[check.source]).padStart(2, '0')}` };
  });
  return { schemaVersion: 1, checks: [...host, ...reindexed] };
}

function extractJsonObject(text) {
  const source = String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Audit did not contain a complete JSON object');
}

export function normalizeAudit(value, checklist) {
  const parsed = typeof value === 'string' ? JSON.parse(extractJsonObject(value)) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Audit response must be a JSON object');
  const known = new Map((checklist?.checks || []).map(check => [check.id, check]));
  const supplied = new Map();
  for (const row of Array.isArray(parsed.checks) ? parsed.checks : []) {
    if (!row || !known.has(row.id) || supplied.has(row.id)) continue;
    const status = ['pass', 'fail', 'unknown'].includes(row.status) ? row.status : 'unknown';
    supplied.set(row.id, { id: row.id, status, evidence: compact(row.evidence, MAX_EVIDENCE) });
  }
  const checks = [...known.keys()].map(id => supplied.get(id) || { id, status: 'unknown', evidence: '' });
  const repairTasks = [];
  const taskSet = new Set();
  for (const task of Array.isArray(parsed.repairTasks) ? parsed.repairTasks : []) {
    const normalized = compact(task, MAX_EVIDENCE);
    const key = normalized.toLowerCase();
    if (!normalized || taskSet.has(key)) continue;
    taskSet.add(key);
    repairTasks.push(normalized);
    if (repairTasks.length >= MAX_REPAIR_TASKS) break;
  }
  return {
    schemaVersion: 1,
    checks,
    repairTasks,
    notes: compact(parsed.notes, MAX_EVIDENCE),
  };
}

export function applySandboxAuthority(audit, checklist, sandbox, html = '') {
  const rows = new Map((audit?.checks || []).map(row => [row.id, { ...row }]));
  const set = (id, status, evidence) => rows.set(id, { id, status, evidence: compact(evidence, MAX_EVIDENCE) });
  if (!String(html || '').trim()) set('runtime-01', 'fail', 'The generated document was empty.');
  else set('runtime-01', 'pass', 'The generator returned a non-empty document.');
  if (sandbox?.timedOut) set('runtime-02', 'fail', `Sandbox timed out after ${sandbox.duration || 0}ms.`);
  else if (sandbox) set('runtime-02', 'pass', `Sandbox completed in ${sandbox.duration || 0}ms.`);
  if (sandbox?.timedOut || (sandbox?.errors || []).length) {
    set('runtime-03', 'fail', sandbox?.timedOut
      ? 'Runtime status is unavailable because the sandbox timed out.'
      : `${sandbox.errors.length} runtime error${sandbox.errors.length === 1 ? '' : 's'} captured.`);
  } else if (sandbox) set('runtime-03', 'pass', 'No runtime errors were captured.');
  return {
    ...(audit || { schemaVersion: 1, repairTasks: [], notes: '' }),
    checks: (checklist?.checks || []).map(check => rows.get(check.id) || { id: check.id, status: 'unknown', evidence: '' }),
  };
}

export function computeVerificationVerdict(checklist, audit, sandbox, { auditError = false } = {}) {
  const rows = new Map((audit?.checks || []).map(row => [row.id, row]));
  const must = (checklist?.checks || []).filter(check => check.priority === 'must');
  let passedMust = 0;
  let failedMust = 0;
  let unknownMust = 0;
  let earned = 0;
  let total = 0;
  for (const check of checklist?.checks || []) {
    const weight = check.priority === 'must' ? 2 : 1;
    const status = rows.get(check.id)?.status || 'unknown';
    total += weight;
    if (status === 'pass') earned += weight;
    else if (status === 'unknown') earned += weight * 0.5;
    if (check.priority === 'must') {
      if (status === 'pass') passedMust++;
      else if (status === 'fail') failedMust++;
      else unknownMust++;
    }
  }
  let status;
  if (sandbox?.timedOut || (sandbox?.errors || []).length) status = 'failed';
  else if (auditError) status = 'audit_error';
  else if (failedMust > 0) status = 'failed';
  else if (unknownMust > 0) status = 'warned';
  else status = 'passed';
  return {
    status,
    passedMust,
    failedMust,
    unknownMust,
    completionRatio: total ? Math.round((earned / total) * 1000) / 1000 : 0,
    totalMust: must.length,
  };
}

export function unresolvedMustChecks(checklist, audit) {
  const rows = new Map((audit?.checks || []).map(row => [row.id, row]));
  return (checklist?.checks || [])
    .filter(check => check.priority === 'must' && rows.get(check.id)?.status !== 'pass')
    .map(check => ({ ...check, status: rows.get(check.id)?.status || 'unknown', evidence: rows.get(check.id)?.evidence || '' }));
}
