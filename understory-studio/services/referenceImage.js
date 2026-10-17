// Reference pictures, normalised on the way in.
//
// A 12 MP phone photo costs tokens on every turn of the loop and tells the
// model nothing a 1024px edge does not. Everything that can add a reference —
// the file picker, a drop, the WAN2GP library, a cross-app handoff — funnels
// through here, so a reference is always the same thing: a PNG data URL with a
// 1024px long edge.

export const MAX_REFERENCES = 3;
export const MAX_EDGE = 1024;

/** Blob | File → normalised PNG data URL. */
export function normalizeImage(file) {
  return new Promise((resolve, reject) => {
    const label = file?.name || 'That image';
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${label} could not be read.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`${label} is not a readable image.`));
      image.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Append normalised references without ever dropping what is already there —
 * the cap is enforced by refusing the overflow, not by evicting earlier picks.
 *
 * `normalize` is injectable for the same reason `buildLoop` takes overrides:
 * the real one needs a canvas, and the cap is the part worth testing.
 *
 * @returns {Promise<{ references: string[], added: number, skipped: number }>}
 */
export async function addReferences(existing, files, normalize = normalizeImage) {
  const current = Array.isArray(existing) ? existing : [];
  const incoming = [...files].filter(Boolean);
  const room = MAX_REFERENCES - current.length;
  if (room <= 0) return { references: current, added: 0, skipped: incoming.length };
  const accepted = incoming.slice(0, room);
  const added = await Promise.all(accepted.map(normalize));
  return {
    references: [...current, ...added],
    added: added.length,
    skipped: incoming.length - accepted.length,
  };
}
