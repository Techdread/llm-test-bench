// Fetch a generation's page only when something is about to show it.
//
// The gallery scan deliberately leaves `response` empty (180 folders here hold
// 59 MB of HTML, which is a local disk read on the desktop and a very long wait
// over the network). Everything that renders a page — a thumbnail, a compare
// pane, a run preview — asks for it through this hook, so only what is on
// screen is ever fetched. metadata.js caches by id, so a second view of the
// same generation costs nothing.

import { useEffect, useState } from 'preact/hooks';

/**
 * @param {string} id generation id
 * @param {(id: string) => Promise<string>} loadHtml
 * @param {{ enabled?: boolean, initial?: string }} options
 *        `enabled` false keeps it unfetched (offscreen thumbnails).
 *        `initial` is a page the caller already holds (a just-generated one).
 */
export function useLazyHtml(id, loadHtml, { enabled = true, initial = '' } = {}) {
  const [html, setHtml] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setHtml(initial); }, [id, initial]);

  useEffect(() => {
    if (!enabled || initial || !id || !loadHtml) return undefined;
    let live = true;
    setLoading(true);
    Promise.resolve(loadHtml(id))
      .then((text) => { if (live) setHtml(text || ''); })
      .catch(() => { if (live) setHtml(''); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, enabled, initial, loadHtml]);

  return { html, loading };
}
