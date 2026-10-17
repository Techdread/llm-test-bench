// Seeded procedural surfaces: colour, height, roughness and tangent-space
// normal maps painted into canvases at build time.
//
// This is why a generated asset can look like a material rather than like
// flat-shaded plastic without a single texture file, upload step or download.
// A design names one surface per material; its colour, roughness and metalness
// come from the design, and everything else from these painters.
//
// The painter engine below (noise fields, strokes, fibres, cracks, knots,
// pores, irises and the height-to-normal conversion) is ported unchanged from
// the standalone Understory project's `materials.js`. What changed is the top:
// that file ended by building the guardian sculpt's own twenty named
// materials, which mean nothing here. This one exposes the nine *surfaces*
// instead, for the recipe contract to name.

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TangentSpaceNormalMap,
} from 'three';

const TAU = Math.PI * 2;
const NORMAL_REFERENCE_HEIGHT = 0.025;
const SURFACE_SPANS = {
  bark: [4, 3],
  root: [1.4, 2.5],
  moss: [2.5, 2.5],
  face: [1.8, 2],
  cap: [6, 2.6],
  gill: [6, 2.3],
  stem: [1.6, 2.8],
  iris: [0.45, 0.45],
  stone: [3, 3],
};

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseField(random, columns, rows) {
  const values = Float32Array.from({ length: columns * rows }, random);
  return (u, v) => {
    const x = ((u % 1) + 1) % 1 * columns;
    const y = ((v % 1) + 1) % 1 * rows;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const nextX = (ix + 1) % columns;
    const nextY = (iy + 1) % rows;
    const a = values[iy * columns + ix];
    const b = values[iy * columns + nextX];
    const c = values[nextY * columns + ix];
    const d = values[nextY * columns + nextX];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function canvasLayer(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  let context;
  try {
    context = canvas.getContext('2d');
  } catch {
    return null;
  }
  return context ? { canvas, context } : null;
}

function pixel(data, offset, red, green = red, blue = red) {
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = 255;
}

function stroke(surface, points, width, colors, displacement = 0) {
  const { size, layers, clampV } = surface;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x + displacement);
    maxX = Math.max(maxX, x + displacement);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (const dx of [-size, 0, size]) {
    if (maxX + dx < -width || minX + dx > size + width) continue;
    for (const dy of clampV ? [0] : [-size, 0, size]) {
      if (maxY + dy < -width || minY + dy > size + width) continue;
      for (let channel = 0; channel < layers.length; channel++) {
        if (!colors[channel]) continue;
        const context = layers[channel].context;
        context.strokeStyle = colors[channel];
        context.lineWidth = width;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        for (let index = 0; index < points.length; index++) {
          const [x, y] = points[index];
          if (index === 0) context.moveTo(x + dx + displacement, y + dy);
          else context.lineTo(x + dx + displacement, y + dy);
        }
        context.stroke();
      }
    }
  }
}

function wanderingLine(random, size, length, wander, startX, startY) {
  const x = startX ?? random() * size;
  const y = startY ?? random() * size;
  const phase = random() * TAU;
  const points = [];
  let drift = 0;
  for (let index = 0; index <= 18; index++) {
    const t = index / 18;
    drift += (random() - 0.5) * wander * 0.5;
    points.push([
      x + Math.sin(t * TAU + phase) * wander + drift,
      y + t * length,
    ]);
  }
  return points;
}

function drawFibers(surface, random, count, strength, wander) {
  const { size, kind } = surface;
  const scale = size / 512;
  for (let index = 0; index < count; index++) {
    const length = size * (0.08 + random() * 0.64);
    const y = kind === 'cap' ? random() * size * 0.55 : undefined;
    const points = wanderingLine(random, size, length, wander * scale, undefined, y);
    const light = random() > 0.42;
    const alpha = (strength * (0.35 + random() * 0.65)).toFixed(3);
    stroke(surface, points, (0.35 + random() * 0.75) * scale, [
      light ? `rgba(255,247,221,${alpha})` : `rgba(98,76,46,${alpha})`,
      light ? `rgba(221,221,221,${alpha})` : `rgba(46,46,46,${alpha})`,
      `rgba(242,242,242,${Number(alpha) * 0.35})`,
    ]);
  }
}

function drawCracks(surface, random, count, strength = 1) {
  const { size } = surface;
  const scale = size / 512;
  for (let index = 0; index < count; index++) {
    const points = wanderingLine(random, size, size * (0.1 + random() * 0.62), 5 * scale);
    const width = (0.45 + random() * 1.3) * scale * strength;
    stroke(surface, points, width * 4, [
      `rgba(65,44,27,${0.13 * strength})`,
      `rgba(56,56,56,${0.24 * strength})`,
      null,
    ]);
    stroke(surface, points, width * 1.2, [
      `rgba(255,233,182,${0.32 * strength})`,
      `rgba(229,229,229,${0.5 * strength})`,
      null,
    ], -width * 1.25);
    stroke(surface, points, width, [
      `rgba(50,32,25,${0.62 * strength})`,
      `rgba(21,21,21,${0.86 * strength})`,
      `rgba(252,252,252,${0.68 * strength})`,
    ]);
    if (index % 3 === 0) {
      const [x, y] = points[9];
      const direction = random() > 0.5 ? 1 : -1;
      const branch = points.slice(9, 15).map((point, step) => [
        x + direction * step * scale * (1.8 + random()),
        y + (point[1] - y) * 0.46,
      ]);
      stroke(surface, branch, width * 0.6, [
        `rgba(65,43,28,${0.45 * strength})`,
        `rgba(45,45,45,${0.65 * strength})`,
        `rgba(247,247,247,${0.35 * strength})`,
      ]);
    }
  }
}

function drawKnots(surface, random) {
  const { size } = surface;
  for (let knot = 0; knot < 7; knot++) {
    const cx = random() * size;
    const cy = random() * size;
    const radius = size * (0.007 + random() * 0.012);
    for (let ring = 1; ring <= 4; ring++) {
      const points = [];
      for (let step = 0; step <= 48; step++) {
        const angle = step / 48 * TAU;
        points.push([
          cx + Math.cos(angle) * radius * (0.4 + ring * 0.38),
          cy + Math.sin(angle) * radius * (1.8 + ring * 0.72),
        ]);
      }
      stroke(surface, points, size / 1024, [
        'rgba(65,44,27,0.25)',
        'rgba(48,48,48,0.4)',
        'rgba(244,244,244,0.15)',
      ]);
    }
  }
}

function drawPores(surface, random, count) {
  const { size, kind, layers } = surface;
  const moss = kind === 'moss';
  const stone = kind === 'stone';
  const scale = size / 512;
  for (let index = 0; index < count; index++) {
    const x = random() * size;
    const y = random() * size;
    const radius = (0.15 + random() * (moss ? 1.6 : 0.65)) * scale;
    const angle = random() * TAU;
    const light = random() > 0.48;
    const colors = moss
      ? [light ? 'rgba(231,231,157,0.36)' : 'rgba(64,76,45,0.28)', light ? '#bcbcbc' : '#5c5c5c', '#f1f1f1']
      : [light ? 'rgba(255,248,227,0.25)' : `rgba(110,94,65,${stone ? 0.25 : 0.12})`, light ? '#b1b1b1' : '#777777', '#ebebeb'];
    for (let channel = 0; channel < layers.length; channel++) {
      const context = layers[channel].context;
      context.fillStyle = colors[channel];
      context.beginPath();
      context.ellipse(x, y, radius, radius * (moss ? 2.1 : 0.72), angle, 0, TAU);
      context.fill();
    }
  }
}

function drawIris(surface, random) {
  const { size } = surface;
  const center = size / 2;
  for (let index = 0; index < 560; index++) {
    const angle = index / 560 * TAU + (random() - 0.5) * 0.018;
    const inner = size * (0.07 + random() * 0.18);
    const outer = Math.min(size * 0.475, inner + size * (0.1 + random() * 0.25));
    const points = [];
    for (let step = 0; step <= 9; step++) {
      const radius = inner + (outer - inner) * step / 9;
      const a = angle + Math.sin(step * 0.7 + index) * 0.009;
      points.push([center + Math.cos(a) * radius, center + Math.sin(a) * radius]);
    }
    const light = random() > 0.48;
    stroke(surface, points, 0.35 + random() * 1.1, [
      light ? 'rgba(255,230,139,0.48)' : 'rgba(77,43,17,0.38)',
      light ? 'rgba(178,178,178,0.38)' : 'rgba(86,86,86,0.38)',
      'rgba(230,230,230,0.1)',
    ]);
  }
}

function createNormalLayer(surface, repeat) {
  const { size, kind, layers, clampV } = surface;
  const layer = canvasLayer(size);
  if (!layer) return null;
  const height = layers[1].context.getImageData(0, 0, size, size).data;
  const smoothed = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const above = (clampV ? Math.max(0, y - 1) : (y + size - 1) % size) * size;
    const below = (clampV ? Math.min(size - 1, y + 1) : (y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const left = (x + size - 1) % size;
      const right = (x + 1) % size;
      smoothed[row + x] = (
        height[(row + x) * 4] * 4 +
        height[(row + left) * 4] + height[(row + right) * 4] +
        height[(above + x) * 4] + height[(below + x) * 4]
      ) / (8 * 255);
    }
  }
  const [spanU, spanV] = SURFACE_SPANS[kind];
  const strength = size * NORMAL_REFERENCE_HEIGHT * 0.12 * 0.5;
  const strengthU = strength * repeat[0] / spanU;
  const strengthV = strength * repeat[1] / spanV;
  const image = layer.context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const above = (clampV ? Math.max(0, y - 1) : (y + size - 1) % size) * size;
    const below = (clampV ? Math.min(size - 1, y + 1) : (y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const left = (x + size - 1) % size;
      const right = (x + 1) % size;
      const nx = (smoothed[row + left] - smoothed[row + right]) * strengthU;
      const ny = (smoothed[below + x] - smoothed[above + x]) * strengthV;
      const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      pixel(image.data, (row + x) * 4,
        (nx * inverseLength + 1) * 127.5,
        (ny * inverseLength + 1) * 127.5,
        (inverseLength + 1) * 127.5,
      );
    }
  }
  layer.context.putImageData(image, 0, 0);
  return layer;
}

function createSurface(kind, size, seed, clampV = false) {
  const layers = [canvasLayer(size), canvasLayer(size), canvasLayer(size)];
  if (layers.some(layer => !layer)) return null;
  const surface = { kind, size, layers, clampV };
  const random = randomSource(seed);
  const coarse = noiseField(random, 8, 8);
  const medium = noiseField(random, 32, 32);
  const fine = noiseField(random, 128, 128);
  const fiber = noiseField(random, kind === 'gill' ? 240 : 128, 8);
  const images = layers.map(({ context }) => context.createImageData(size, size));
  const fibrous = ['bark', 'root', 'stem', 'gill'].includes(kind);
  for (let y = 0; y < size; y++) {
    const v = 1 - y / (size - 1);
    const wave = Math.sin(y / size * TAU * 2) * 0.006;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const t = y / size;
      const broad = coarse(u, t);
      const detail = medium(u, t);
      const micro = fine(u, t);
      const grain = random();
      const strands = fibrous ? fiber(u + wave + (broad - 0.5) * 0.012, t) : 0.5;
      const noise = broad * 0.46 + detail * 0.3 + micro * 0.16 + grain * 0.08;
      const relief = fibrous ? strands * 0.5 + broad * 0.26 + micro * 0.16 + grain * 0.08 : noise;
      let tone = 211 + (noise - 0.5) * 54;
      let red;
      let green;
      let blue;
      let height = 102 + relief * 89;
      let roughness = 212 + noise * 36;
      if (fibrous) {
        tone = 218 + (relief - 0.5) * (kind === 'bark' ? 125 : 65);
      }
      red = tone;
      green = tone * 0.974;
      blue = tone * 0.923;
      if (kind === 'cap') {
        const rim = v * v * (3 - 2 * v);
        const mottling = (noise - 0.5) * 22;
        red = 244 + rim * 8 + mottling;
        green = 238 + rim * 10 + mottling;
        blue = 224 + rim * 15 + mottling;
        height = 139 + (noise - 0.5) * 43;
        roughness = 206 + noise * 38;
      } else if (kind === 'gill') {
        red = 237 + (relief - 0.5) * 30;
        green = red - 5;
        blue = red - 16;
      } else if (kind === 'face') {
        red = 238 + (noise - 0.5) * 32;
        green = red - 2;
        blue = red - 10;
        height = 138 + (noise - 0.5) * 48;
      } else if (kind === 'moss') {
        red = tone * 0.958;
        green = tone;
        blue = tone * 0.843;
        height = 75 + noise * 142;
        roughness = 233 + noise * 21;
      } else if (kind === 'iris') {
        const dx = u - 0.5;
        const dy = t - 0.5;
        const radius = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        const streak = Math.sin(angle * 173 + detail * 3 + radius * 28) * Math.sin(angle * 61 - radius * 17);
        const outerRing = Math.exp(-(((radius - 0.46) / 0.027) ** 2));
        const innerRing = Math.exp(-(((radius - 0.11) / 0.032) ** 2));
        const brightness = 220 + streak * 22 + (noise - 0.5) * 31 - outerRing * 76 - innerRing * 39;
        red = brightness;
        green = brightness * 0.91;
        blue = brightness * 0.66;
        height = 145 + streak * 14 + (micro - 0.5) * 20;
        roughness = 213 + noise * 24;
      } else if (kind === 'stone') {
        red = 228 + (noise - 0.5) * 65;
        green = red - 3;
        blue = red - 9;
      }
      const offset = (y * size + x) * 4;
      pixel(images[0].data, offset, red, green, blue);
      pixel(images[1].data, offset, height);
      pixel(images[2].data, offset, roughness);
    }
  }
  layers.forEach(({ context }, index) => context.putImageData(images[index], 0, 0));
  if (kind === 'bark') {
    drawFibers(surface, random, 920, 0.27, 2.4);
    drawCracks(surface, random, 78);
    drawKnots(surface, random);
  } else if (kind === 'root') {
    drawFibers(surface, random, 590, 0.24, 2.8);
    drawCracks(surface, random, 18, 0.48);
  } else if (kind === 'stem') {
    drawFibers(surface, random, 740, 0.18, 1.6);
  } else if (kind === 'gill') {
    drawFibers(surface, random, 880, 0.16, 0.65);
  } else if (kind === 'cap') {
    drawFibers(surface, random, 260, 0.055, 1.2);
    drawPores(surface, random, 1900);
  } else if (kind === 'face') {
    drawFibers(surface, random, 240, 0.06, 2);
    drawCracks(surface, random, 16, 0.2);
    drawPores(surface, random, 1600);
  } else if (kind === 'moss') {
    drawPores(surface, random, 2800);
    drawFibers(surface, random, 180, 0.12, 3);
  } else if (kind === 'iris') {
    drawIris(surface, random);
  } else if (kind === 'stone') {
    drawPores(surface, random, 2200);
    drawCracks(surface, random, 10, 0.22);
  }
  const repeat = kind === 'bark' ? [2, 1] : kind === 'moss' || kind === 'stone' ? [2, 2] : [1, 1];
  const normal = createNormalLayer(surface, repeat);
  if (!normal) return null;
  layers.push(normal);
  const textures = layers.map(({ canvas }, index) => {
    const texture = new CanvasTexture(canvas);
    texture.name = `woodland-${kind}-${['color', 'height', 'roughness', 'normal'][index]}`;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = clampV ? ClampToEdgeWrapping : RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = 4;
    texture.colorSpace = index === 0 ? SRGBColorSpace : NoColorSpace;
    return texture;
  });
  return { map: textures[0], bumpMap: textures[1], roughnessMap: textures[2], normalMap: textures[3] };
}


// ── Hub-facing surface API ────────────────────────────────────────────────

/**
 * The nine painted surfaces. Seven are offered to the model in RECIPE_GUIDE;
 * `gill` and `iris` back the viewer but are not in the contract, because a
 * model asked for "iris" reliably paints it onto something that is not an eye.
 */
export const SURFACES = Object.freeze(['bark', 'root', 'moss', 'face', 'cap', 'gill', 'stem', 'iris', 'stone']);

/** Surfaces the recipe contract lets a design name. `tooth` is an alias. */
export const RECIPE_SURFACES = Object.freeze({
  bark: 'bark', root: 'root', moss: 'moss', face: 'face',
  cap: 'cap', tooth: 'stem', stem: 'stem',
});

const TEXTURE_SIZE = 512;
const SURFACE_SEEDS = {
  bark: 91117, root: 24499, moss: 55291, face: 70241, cap: 13859,
  gill: 48533, stem: 61703, iris: 32869, stone: 80611,
};

let templates = null;

/**
 * Paint every surface once and cache the result. Materials handed out are
 * clones, so a design can tint the same surface differently per material
 * without repainting several megabytes of canvas.
 *
 * Returns null-safe: in a context with no 2D canvas (headless geometry tests)
 * `createSurface` yields null and the surface falls back to a plain material.
 */
export function loadSurfaceTemplates() {
  if (templates) return templates;
  templates = {};
  for (const kind of SURFACES) {
    const maps = createSurface(kind, TEXTURE_SIZE, SURFACE_SEEDS[kind], kind === 'cap' || kind === 'iris');
    const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    if (maps) {
      Object.assign(material, maps);
      material.normalMapType = TangentSpaceNormalMap;
      material.bumpScale = 0.02;
    }
    material.name = kind;
    templates[kind] = material;
  }
  return templates;
}

/**
 * Turn a design's `materials` block into real THREE materials.
 * The caller owns and must dispose what comes back.
 */
export function createDesignMaterials(design) {
  const needsTextures = Object.values(design.materials).some(spec => spec.texture);
  const library = needsTextures ? loadSurfaceTemplates() : null;
  const materials = {};
  for (const [name, spec] of Object.entries(design.materials)) {
    const surface = spec.texture ? RECIPE_SURFACES[spec.texture] : null;
    const material = surface && library?.[surface] ? library[surface].clone() : new MeshStandardMaterial();
    // Painted maps carry their own luminance; the design's colour tints them.
    material.vertexColors = false;
    material.color.set(spec.color);
    material.roughness = spec.roughness ?? 0.8;
    material.metalness = spec.metalness ?? 0;
    material.name = name;
    materials[name] = material;
  }
  return materials;
}

export function disposeDesignMaterials(materials) {
  Object.values(materials || {}).forEach(material => material.dispose());
}

/** Free the cached surface templates and their canvases. */
export function disposeSurfaceTemplates() {
  if (!templates) return;
  for (const material of Object.values(templates)) {
    for (const key of ['map', 'bumpMap', 'roughnessMap', 'normalMap']) material[key]?.dispose();
    material.dispose();
  }
  templates = null;
}
