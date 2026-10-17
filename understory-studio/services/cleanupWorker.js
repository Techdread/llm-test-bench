// The clean-up pass runs here so a 360k-triangle character does not freeze the
// viewport, and so Cancel can simply terminate it. Every import must resolve
// WITHOUT an import map — module Workers do not inherit the document's.
import { cleanLevel } from './meshCleanup.js';

self.onmessage = async ({ data }) => {
  try {
    for (const [levelIndex, level] of data.levels.entries()) {
      const result = await cleanLevel(level, data.settings, {
        levelIndex: level.levelIndex ?? levelIndex,
        poses: level.poses || [],
        onProgress: progress => self.postMessage({ progress: { ...progress, level: level.id, levelIndex, levels: data.levels.length } }),
      });
      const buffers = result.meshes.flatMap(mesh => [mesh.positions.buffer, mesh.index.buffer, mesh.vertexMap.buffer]);
      self.postMessage({ level: level.id, result }, buffers);
    }
    self.postMessage({ done: true });
  } catch (error) {
    self.postMessage({ error: error.message || 'Triangle clean-up failed.' });
  }
};
