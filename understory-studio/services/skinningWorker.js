// Skin weighting is the one genuinely expensive step in the animated lane —
// seconds per LOD on a dense character. Off the main thread so the viewport
// stays live and the host can terminate it on cancel.
import { calculateSkinWeights } from './skinWeights.js';

self.onmessage = ({ data }) => {
  try {
    const weights = calculateSkinWeights(data);
    self.postMessage({ weights }, weights.flatMap(w => [w.indices.buffer, w.weights.buffer]));
  } catch (error) {
    self.postMessage({ error: error.message || 'Automatic skin weighting failed.' });
  }
};
