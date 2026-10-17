// Shared AI Coach panel — Ask / Quiz / Explain tabs.
//
// Drop into a lab's right rail or as a floating dialog:
//
//   <${AICoachPanel}
//     dbName="linear-algebra-lab"
//     appTitle="Linear Algebra Lab"
//     systemPrompt=${TUTOR_SYSTEM_PROMPT}
//     policy=${coachPolicy}
//     lessonId=${lessonId}
//     getContext=${() => buildCoachContext({ lessonId, state })}
//     explainTarget=${selectedElement}      // optional — drives the Explain tab
//     onOpenSettings=${() => navigateToHubSettings()}
//   />
//
// The panel is intentionally lab-agnostic. Everything lab-specific (system
// prompt, context shape, policy storage, the element being "explained") is
// passed in. The panel handles the LLM calls, the streaming display, the
// missing-API-key setup prompt (no silent fallback), and a lightweight view
// over the lab's transcript log.

import { html } from 'htm/preact';
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';

import { ask, quiz, gradeAnswer, explain, isProviderReady, listTranscripts } from '../services/ai-coach.js';

const TABS = [
  { id: 'ask', label: 'Ask', icon: 'fa-comment-question' },
  { id: 'quiz', label: 'Quiz', icon: 'fa-circle-question' },
  { id: 'explain', label: 'Explain', icon: 'fa-magnifying-glass' },
  { id: 'history', label: 'History', icon: 'fa-clock-rotate-left' },
];

function MissingKeyNotice({ onOpenSettings }) {
  return html`
    <div class="coach-missing-key" style=${{ padding: '16px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-secondary, #1d1d1d)' }}>
      <h3 style=${{ margin: '0 0 8px', fontSize: '14px' }}>
        <i class="fa-solid fa-key" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>
        OpenRouter API key required
      </h3>
      <p style=${{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        The AI Coach is a core feature of this lab. Add an OpenRouter key in the hub Settings to enable Ask, Quiz, and Explain.
      </p>
      <button class="btn" onClick=${onOpenSettings}>
        <i class="fa-solid fa-gear" style=${{ marginRight: '6px' }}></i>
        Open Settings
      </button>
    </div>
  `;
}

function StreamingAnswer({ text, busy }) {
  return html`
    <div class="coach-answer" style=${{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: 1.5, padding: '8px 0' }}>
      ${text}
      ${busy && html`<span class="coach-cursor" style=${{ opacity: 0.6 }}> ▍</span>`}
    </div>
  `;
}

function AskTab({ baseOpts, getContext }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleAsk = useCallback(async () => {
    if (!question.trim() || busy) return;
    setBusy(true); setError(''); setAnswer('');
    try {
      const ctx = await getContext();
      await ask({ ...baseOpts, context: ctx, question, onChunk: setAnswer });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [baseOpts, getContext, question, busy]);

  return html`
    <div>
      <textarea
        class="form-input"
        rows="3"
        placeholder="Ask anything about the current lab state…"
        value=${question}
        onInput=${(e) => setQuestion(e.target.value)}
        disabled=${busy}
      ></textarea>
      <div style=${{ marginTop: '8px', display: 'flex', gap: '8px' }}>
        <button class="btn" onClick=${handleAsk} disabled=${busy || !question.trim()}>
          <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`} style=${{ marginRight: '6px' }}></i>
          ${busy ? 'Asking…' : 'Ask'}
        </button>
      </div>
      ${error && html`<p style=${{ color: 'var(--danger, #e66)', fontSize: '13px', marginTop: '8px' }}>${error}</p>`}
      <${StreamingAnswer} text=${answer} busy=${busy} />
    </div>
  `;
}

function QuizTab({ baseOpts, getContext }) {
  const [proposed, setProposed] = useState(null);  // { question, expectedAnswerKind, hint }
  const [userAnswer, setUserAnswer] = useState('');
  const [grade, setGrade] = useState(null);
  const [streamingGrade, setStreamingGrade] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleNewQuiz = useCallback(async () => {
    setBusy(true); setError(''); setProposed(null); setUserAnswer(''); setGrade(null); setStreamingGrade('');
    try {
      const ctx = await getContext();
      const q = await quiz({ ...baseOpts, context: ctx });
      setProposed(q);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [baseOpts, getContext]);

  const handleSubmit = useCallback(async () => {
    if (!proposed || !userAnswer.trim() || busy) return;
    setBusy(true); setError(''); setGrade(null); setStreamingGrade('');
    try {
      const ctx = await getContext();
      const result = await gradeAnswer({
        ...baseOpts,
        context: ctx,
        question: proposed.question,
        answer: userAnswer,
        onChunk: setStreamingGrade,
      });
      setGrade(result);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [baseOpts, getContext, proposed, userAnswer, busy]);

  return html`
    <div>
      ${!proposed && html`
        <button class="btn" onClick=${handleNewQuiz} disabled=${busy}>
          <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-dice'}`} style=${{ marginRight: '6px' }}></i>
          ${busy ? 'Generating…' : 'Get a question'}
        </button>
      `}
      ${proposed && html`
        <div class="coach-question" style=${{ padding: '8px 12px', borderLeft: '3px solid var(--accent)', background: 'var(--bg-secondary, #1d1d1d)', fontSize: '13px', lineHeight: 1.5 }}>
          ${proposed.question}
        </div>
        <textarea
          class="form-input"
          rows="3"
          placeholder="Your answer…"
          value=${userAnswer}
          onInput=${(e) => setUserAnswer(e.target.value)}
          disabled=${busy}
          style=${{ marginTop: '8px' }}
        ></textarea>
        <div style=${{ marginTop: '8px', display: 'flex', gap: '8px' }}>
          <button class="btn" onClick=${handleSubmit} disabled=${busy || !userAnswer.trim()}>
            <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-check'}`} style=${{ marginRight: '6px' }}></i>
            ${busy ? 'Grading…' : 'Submit'}
          </button>
          <button class="btn btn-secondary" onClick=${handleNewQuiz} disabled=${busy}>
            <i class="fa-solid fa-rotate" style=${{ marginRight: '6px' }}></i>
            New question
          </button>
        </div>
      `}
      ${error && html`<p style=${{ color: 'var(--danger, #e66)', fontSize: '13px', marginTop: '8px' }}>${error}</p>`}
      ${streamingGrade && !grade && html`<${StreamingAnswer} text=${streamingGrade} busy=${busy} />`}
      ${grade && html`
        <div class="coach-grade" style=${{ marginTop: '12px', padding: '10px 12px', borderRadius: '6px', background: 'var(--bg-secondary, #1d1d1d)' }}>
          ${grade.score != null && html`
            <div style=${{ fontWeight: 600, marginBottom: '4px' }}>Score: ${(grade.score * 100).toFixed(0)}%</div>
          `}
          <div style=${{ fontSize: '13px', lineHeight: 1.5 }}>${grade.feedback}</div>
          ${Array.isArray(grade.misconceptions) && grade.misconceptions.length > 0 && html`
            <details style=${{ marginTop: '8px' }}>
              <summary style=${{ cursor: 'pointer', fontSize: '12px' }}>Misconceptions (${grade.misconceptions.length})</summary>
              <ul style=${{ marginTop: '4px', fontSize: '12px' }}>${grade.misconceptions.map(m => html`<li>${m}</li>`)}</ul>
            </details>
          `}
          ${grade.nextStep && html`
            <div style=${{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <strong>Next:</strong> ${grade.nextStep}
            </div>
          `}
        </div>
      `}
    </div>
  `;
}

function ExplainTab({ baseOpts, getContext, explainTarget, autoRun = false }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleExplain = useCallback(async () => {
    if (!explainTarget || busy) return;
    setBusy(true); setError(''); setAnswer('');
    try {
      const ctx = await getContext();
      await explain({ ...baseOpts, context: ctx, element: explainTarget, onChunk: setAnswer });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [baseOpts, getContext, explainTarget, busy]);

  // autoRun (opt-in via AICoachPanel autoExplain): fire as soon as a new
  // element arrives instead of waiting for the button press.
  const lastAutoTargetRef = useRef(null);
  useEffect(() => {
    if (!autoRun || !explainTarget || busy) return;
    if (lastAutoTargetRef.current === explainTarget) return;
    lastAutoTargetRef.current = explainTarget;
    handleExplain();
  }, [autoRun, explainTarget, busy, handleExplain]);

  return html`
    <div>
      ${!explainTarget && html`
        <p style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Click any UI element in the lab (a matrix cell, a node, a slider…) and it will appear here for explanation.
        </p>
      `}
      ${explainTarget && html`
        <div class="coach-target" style=${{ padding: '8px 12px', background: 'var(--bg-secondary, #1d1d1d)', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: '140px', overflow: 'auto' }}>
          ${JSON.stringify(explainTarget, null, 2)}
        </div>
        <button class="btn" onClick=${handleExplain} disabled=${busy} style=${{ marginTop: '8px' }}>
          <i class=${`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}`} style=${{ marginRight: '6px' }}></i>
          ${busy ? 'Explaining…' : 'Explain this'}
        </button>
      `}
      ${error && html`<p style=${{ color: 'var(--danger, #e66)', fontSize: '13px', marginTop: '8px' }}>${error}</p>`}
      <${StreamingAnswer} text=${answer} busy=${busy} />
    </div>
  `;
}

function HistoryTab({ dbName, lessonId, refreshKey }) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listTranscripts(dbName, { lessonId });
        if (!cancelled) setEntries(list.slice().reverse());
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [dbName, lessonId, refreshKey]);

  if (error) return html`<p style=${{ color: 'var(--danger, #e66)' }}>${error}</p>`;
  if (!entries.length) return html`<p style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>No transcripts yet for this lesson.</p>`;

  return html`
    <ul style=${{ listStyle: 'none', padding: 0, margin: 0, fontSize: '12px' }}>
      ${entries.map(e => html`
        <li key=${e.id} style=${{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <div style=${{ fontWeight: 600 }}>[${e.mode}] ${new Date(e.ts).toLocaleString()}</div>
          ${e.question && html`<div style=${{ marginTop: '2px' }}><em>Q:</em> ${e.question}</div>`}
          ${e.answer && html`<div style=${{ marginTop: '2px', opacity: 0.85 }}><em>A:</em> ${String(e.answer).slice(0, 220)}${e.answer.length > 220 ? '…' : ''}</div>`}
          ${e.result?.feedback && html`<div style=${{ marginTop: '2px', opacity: 0.85 }}><em>Grade:</em> ${e.result.feedback}</div>`}
        </li>
      `)}
    </ul>
  `;
}

export function AICoachPanel({
  dbName,
  appTitle,
  systemPrompt,
  policy,
  lessonId,
  getContext,
  explainTarget,
  onOpenSettings,
  // Optional host request (for example, a generated learner player's
  // Ask/Quiz/Explain buttons) that selects the matching Coach mode.
  requestedTab,
  // Opt-in (off by default so labs that pass an ever-changing explain
  // target, e.g. sprite-studio's active sprite, keep their tab behaviour):
  // when a new explainTarget arrives, switch to the Explain tab and run
  // the explanation immediately.
  autoExplain = false,
}) {
  // Older callers occasionally passed the object-store name here. Keep their
  // transcripts isolated by deriving the required per-app database name.
  const resolvedDbName = dbName === 'coach-transcripts'
    ? `${String(appTitle || 'ai-coach').toLowerCase().replace(/\s+coach$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-coach`
    : dbName;
  const [active, setActive] = useState('ask');
  useEffect(() => {
    if (autoExplain && explainTarget) setActive('explain');
  }, [autoExplain, explainTarget]);
  useEffect(() => {
    if (['ask', 'quiz', 'explain'].includes(requestedTab)) setActive(requestedTab);
  }, [requestedTab]);
  // The "is the coach usable" check now depends on the *active provider*.
  // OpenRouter needs an API key; LM Studio + custom providers do not.
  // Re-evaluated whenever the policy (provider override) changes.
  const providerId = policy?.providerId;
  const [providerReady, setProviderReady] = useState(() => isProviderReady(providerId));
  useEffect(() => { setProviderReady(isProviderReady(providerId)); }, [providerId]);

  const baseOpts = { dbName: resolvedDbName, appTitle, systemPrompt, policy, lessonId };

  if (!providerReady) {
    return html`
      <div class="ai-coach-panel">
        <${MissingKeyNotice} onOpenSettings=${onOpenSettings || (() => {})} />
      </div>
    `;
  }

  return html`
    <div class="ai-coach-panel">
      <div class="coach-tabs" style=${{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)', marginBottom: '12px' }}>
        ${TABS.map(t => html`
          <button
            key=${t.id}
            class=${`btn-tab ${active === t.id ? 'active' : ''}`}
            onClick=${() => setActive(t.id)}
            style=${{
              padding: '6px 10px',
              background: active === t.id ? 'var(--bg-secondary, #1d1d1d)' : 'transparent',
              border: 'none',
              borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--text)',
            }}
          >
            <i class=${`fa-solid ${t.icon}`} style=${{ marginRight: '4px' }}></i>
            ${t.label}
          </button>
        `)}
      </div>
      <div class="coach-tab-body">
        ${active === 'ask' && html`<${AskTab} baseOpts=${baseOpts} getContext=${getContext} />`}
        ${active === 'quiz' && html`<${QuizTab} baseOpts=${baseOpts} getContext=${getContext} />`}
        ${active === 'explain' && html`<${ExplainTab} baseOpts=${baseOpts} getContext=${getContext} explainTarget=${explainTarget} autoRun=${autoExplain} />`}
        ${active === 'history' && html`<${HistoryTab} dbName=${resolvedDbName} lessonId=${lessonId} refreshKey=${active} />`}
      </div>
    </div>
  `;
}
