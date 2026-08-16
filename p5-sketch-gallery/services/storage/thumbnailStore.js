// Thumbnail helpers — extracted as a separate module per the architecture spec.
// Currently just exposes a passthrough to encode/decode preview frames.

export function dataUrlSize(dataUrl) {
  if (!dataUrl) return 0;
  const idx = dataUrl.indexOf(',');
  return Math.max(0, dataUrl.length - idx - 1);
}

export async function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const res = await fetch(dataUrl);
  return res.blob();
}
