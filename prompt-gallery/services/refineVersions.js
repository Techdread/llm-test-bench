// Refine's steps as playable versions for the shared PlayOverlay: the
// original, then each Heal and Improve step, numbered (labels repeat: two
// "Improvements applied" steps are told apart by their number) and described
// by their last sandbox check. Pure, for the tests.

export function stepCheckDetail(status) {
  if (!status) return 'not checked yet';
  if (status.timedOut) return 'timed out';
  const errors = status.errors?.length || 0;
  const warnings = status.warnings?.length || 0;
  if (errors) return `${errors} error${errors === 1 ? '' : 's'}`;
  if (warnings) return `${warnings} warning${warnings === 1 ? '' : 's'}`;
  return 'ran clean';
}

/** @returns {{ id, label, detail, html, latest? }[]} in step order */
export function refineVersions(steps = []) {
  const versions = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => typeof step?.html === 'string' && step.html.trim())
    .map(({ step, index }) => ({
      id: `step-${index}`,
      label: `${index + 1} · ${step.label || (index === 0 ? 'Original' : 'Step')}`,
      detail: stepCheckDetail(step.runStatus),
      html: step.html,
    }));
  const newest = versions.at(-1);
  if (newest && versions.length > 1) newest.latest = true;
  return versions;
}

// Work sent to Refine from Create before it is saved is called "create-session"
// (that name is also the folder it saves into, so it stays). For display, the
// page's own <title> says what it is.
export const UNSAVED_REFINE_TITLE = 'create-session';

export function pageTitle(htmlText) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(htmlText || ''));
  if (!match) return '';
  return match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function refineDisplayTitle(session) {
  if (!session) return '';
  if (session.title && session.title !== UNSAVED_REFINE_TITLE) return session.title;
  return pageTitle(session.steps?.[0]?.html) || 'Unsaved page';
}
