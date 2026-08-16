// Built-in example sketches. Each one is fully self-contained and follows the
// instance-mode `function sketch(p, ctx)` convention used by sketchRunner.

export const EXAMPLES = [
  {
    id: 'flowing-circles',
    title: 'Flowing circles',
    description: 'Lissajous-ish ring of circles cycling hue with frame count.',
    prompt: 'A ring of circles cycling colour as they orbit, with adjustable count and radius.',
    seed: 1,
    params: { count: 80, radius: 140 },
    code: `function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.noiseSeed(ctx.seed);
    p.colorMode(p.HSB, 360, 100, 100, 1);
  };
  p.draw = () => {
    p.background(220, 30, 10);
    p.noFill();
    p.strokeWeight(1.4);
    const n = ctx.params.count ?? 80;
    const r = ctx.params.radius ?? 140;
    for (let i = 0; i < n; i++) {
      const t = p.frameCount * 0.005 + i * 0.07;
      const x = p.width / 2 + p.cos(t) * r;
      const y = p.height / 2 + p.sin(t * 1.3) * r;
      p.stroke((i * 6 + p.frameCount * 0.4) % 360, 80, 100, 0.9);
      p.circle(x, y, 18 + p.sin(t * 2) * 6);
    }
  };
}`,
  },

  {
    id: 'noise-flow-field',
    title: 'Noise flow field',
    description: 'Particles drifting through a Perlin noise vector field.',
    prompt: 'Particles tracing flow lines through a Perlin noise field on a dark canvas.',
    seed: 17,
    params: { particles: 600, step: 1.6, noiseScale: 0.0035, fade: 12 },
    code: `function sketch(p, ctx) {
  let pts = [];
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.noiseSeed(ctx.seed);
    p.background(8);
    const n = ctx.params.particles ?? 600;
    pts = Array.from({ length: n }, () => ({
      x: p.random(p.width), y: p.random(p.height),
      h: p.random(180, 320),
    }));
  };
  p.draw = () => {
    p.noStroke();
    p.fill(8, 8, 12, ctx.params.fade ?? 12);
    p.rect(0, 0, p.width, p.height);
    p.colorMode(p.HSB, 360, 100, 100, 1);
    const sc = ctx.params.noiseScale ?? 0.0035;
    const step = ctx.params.step ?? 1.6;
    for (const q of pts) {
      const a = p.noise(q.x * sc, q.y * sc, p.frameCount * 0.002) * p.TWO_PI * 2;
      q.x += p.cos(a) * step;
      q.y += p.sin(a) * step;
      if (q.x < 0 || q.x > p.width || q.y < 0 || q.y > p.height) {
        q.x = p.random(p.width); q.y = p.random(p.height);
      }
      p.stroke(q.h, 80, 100, 0.6);
      p.point(q.x, q.y);
    }
    p.colorMode(p.RGB, 255);
  };
}`,
  },

  {
    id: 'spiral-bloom',
    title: 'Spiral bloom',
    description: 'Polar spiral whose petal length pulses with time.',
    prompt: 'A polar spiral with pulsing petals that breathe outward and back.',
    seed: 3,
    params: { arms: 7, density: 1200, twist: 0.18, pulse: 0.8 },
    code: `function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.colorMode(p.HSB, 360, 100, 100, 1);
  };
  p.draw = () => {
    p.background(260, 40, 8);
    p.translate(p.width / 2, p.height / 2);
    p.noStroke();
    const arms = ctx.params.arms ?? 7;
    const d = ctx.params.density ?? 1200;
    const twist = ctx.params.twist ?? 0.18;
    const pulse = ctx.params.pulse ?? 0.8;
    for (let i = 0; i < d; i++) {
      const t = i * 0.1;
      const r = i * 0.2 * (1 + p.sin(p.frameCount * 0.02 + i * 0.01) * pulse * 0.1);
      const a = t * twist + p.frameCount * 0.003 + (i % arms) * (p.TWO_PI / arms);
      const x = p.cos(a) * r;
      const y = p.sin(a) * r;
      p.fill((i * 0.6 + p.frameCount * 0.3) % 360, 70, 100, 0.7);
      p.circle(x, y, 4);
    }
  };
}`,
  },

  {
    id: 'truchet-tiles',
    title: 'Truchet tiles',
    description: 'Random quarter-circle tile field that re-rolls slowly.',
    prompt: 'A grid of quarter-circle Truchet tiles that gently re-roll over time.',
    seed: 42,
    params: { cells: 14, lineWidth: 6, hue: 200 },
    code: `function sketch(p, ctx) {
  let grid = [];
  function reroll(cells) {
    grid = Array.from({ length: cells }, () =>
      Array.from({ length: cells }, () => p.random() < 0.5 ? 0 : 1));
  }
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.colorMode(p.HSB, 360, 100, 100, 1);
    reroll(ctx.params.cells ?? 14);
  };
  p.draw = () => {
    const cells = ctx.params.cells ?? 14;
    if (grid.length !== cells) reroll(cells);
    if (p.frameCount % 60 === 0) reroll(cells);
    const s = p.width / cells;
    p.background(ctx.params.hue ?? 200, 25, 10);
    p.noFill();
    p.stroke(ctx.params.hue ?? 200, 30, 100);
    p.strokeWeight(ctx.params.lineWidth ?? 6);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const x0 = x * s, y0 = y * s;
        if (grid[y][x]) {
          p.arc(x0, y0, s, s, 0, p.HALF_PI);
          p.arc(x0 + s, y0 + s, s, s, p.PI, p.PI + p.HALF_PI);
        } else {
          p.arc(x0 + s, y0, s, s, p.HALF_PI, p.PI);
          p.arc(x0, y0 + s, s, s, -p.HALF_PI, 0);
        }
      }
    }
  };
}`,
  },

  {
    id: 'recursive-tree',
    title: 'Recursive tree',
    description: 'Branching tree that sways with a sine breeze.',
    prompt: 'A recursive branching tree that sways in a gentle wind.',
    seed: 9,
    params: { depth: 9, branchAngle: 24, lengthScale: 0.72, sway: 0.15 },
    code: `function sketch(p, ctx) {
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.colorMode(p.HSB, 360, 100, 100, 1);
  };
  p.draw = () => {
    p.background(120, 30, 6);
    p.stroke(40, 70, 90);
    p.strokeWeight(1.2);
    p.translate(p.width / 2, p.height - 10);
    branch(120, ctx.params.depth ?? 9);
  };
  function branch(len, d) {
    if (d <= 0) return;
    const sway = (ctx.params.sway ?? 0.15) * p.sin(p.frameCount * 0.02 + d * 0.3);
    p.line(0, 0, 0, -len);
    p.translate(0, -len);
    p.push();
    p.rotate(p.radians(ctx.params.branchAngle ?? 24) + sway);
    branch(len * (ctx.params.lengthScale ?? 0.72), d - 1);
    p.pop();
    p.push();
    p.rotate(-p.radians(ctx.params.branchAngle ?? 24) + sway);
    branch(len * (ctx.params.lengthScale ?? 0.72), d - 1);
    p.pop();
  }
}`,
  },

  {
    id: 'lissajous-trace',
    title: 'Lissajous trace',
    description: 'Looping Lissajous curve with rainbow trail.',
    prompt: 'A Lissajous curve drawing itself with a fading rainbow trail.',
    seed: 5,
    params: { a: 3, b: 2, phase: 1.4, trail: 220 },
    code: `function sketch(p, ctx) {
  let history = [];
  p.setup = () => {
    p.createCanvas(480, 480);
    p.colorMode(p.HSB, 360, 100, 100, 1);
  };
  p.draw = () => {
    p.background(240, 25, 8, 0.18);
    const a = ctx.params.a ?? 3;
    const b = ctx.params.b ?? 2;
    const phase = ctx.params.phase ?? 1.4;
    const t = p.frameCount * 0.015;
    const x = p.width / 2 + p.sin(a * t + phase) * 180;
    const y = p.height / 2 + p.sin(b * t) * 180;
    history.push({ x, y, h: (p.frameCount * 1.2) % 360 });
    if (history.length > (ctx.params.trail ?? 220)) history.shift();
    p.noFill();
    for (let i = 1; i < history.length; i++) {
      const a0 = history[i - 1], a1 = history[i];
      p.stroke(a1.h, 80, 100, i / history.length);
      p.strokeWeight(2);
      p.line(a0.x, a0.y, a1.x, a1.y);
    }
  };
}`,
  },

  {
    id: 'bouncing-particles',
    title: 'Bouncing particles',
    description: 'A few dozen balls bouncing inside the canvas.',
    prompt: 'Bouncing balls in a black box, each leaving a soft motion trail.',
    seed: 21,
    params: { count: 36, gravity: 0.14, damping: 0.985, trail: 30 },
    code: `function sketch(p, ctx) {
  let balls = [];
  function reset() {
    const n = ctx.params.count ?? 36;
    balls = Array.from({ length: n }, () => ({
      x: p.random(p.width), y: p.random(p.height * 0.4),
      vx: p.random(-2, 2), vy: p.random(-1, 1),
      r: p.random(6, 18),
      h: p.random(360),
    }));
  }
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.background(0);
    reset();
  };
  p.draw = () => {
    p.noStroke();
    p.fill(0, 0, 0, (ctx.params.trail ?? 30) / 255);
    p.rect(0, 0, p.width, p.height);
    if (balls.length !== (ctx.params.count ?? 36)) reset();
    const g = ctx.params.gravity ?? 0.14;
    const damp = ctx.params.damping ?? 0.985;
    for (const b of balls) {
      b.vy += g; b.vx *= damp; b.vy *= damp;
      b.x += b.vx; b.y += b.vy;
      if (b.x < b.r) { b.x = b.r; b.vx *= -1; }
      if (b.x > p.width - b.r) { b.x = p.width - b.r; b.vx *= -1; }
      if (b.y < b.r) { b.y = b.r; b.vy *= -1; }
      if (b.y > p.height - b.r) { b.y = p.height - b.r; b.vy *= -0.85; }
      p.fill(b.h, 70, 100, 0.9);
      p.circle(b.x, b.y, b.r * 2);
    }
  };
}`,
  },

  {
    id: 'starfield-warp',
    title: 'Starfield warp',
    description: 'Hyperspace dots streaking outward from centre.',
    prompt: 'A hyperspace starfield streaking outward from the centre.',
    seed: 88,
    params: { stars: 320, speed: 1.8, depth: 22 },
    code: `function sketch(p, ctx) {
  let stars = [];
  function reset() {
    const n = ctx.params.stars ?? 320;
    stars = Array.from({ length: n }, () => ({
      x: p.random(-p.width / 2, p.width / 2),
      y: p.random(-p.height / 2, p.height / 2),
      z: p.random(p.width),
      pz: 0,
    }));
    stars.forEach(s => s.pz = s.z);
  }
  p.setup = () => {
    p.createCanvas(480, 480);
    p.randomSeed(ctx.seed);
    p.background(0);
    reset();
  };
  p.draw = () => {
    p.background(0, 25);
    p.translate(p.width / 2, p.height / 2);
    if (stars.length !== (ctx.params.stars ?? 320)) reset();
    const speed = ctx.params.speed ?? 1.8;
    const depth = ctx.params.depth ?? 22;
    p.stroke(255);
    for (const s of stars) {
      s.pz = s.z;
      s.z -= speed;
      if (s.z < 1) {
        s.x = p.random(-p.width / 2, p.width / 2);
        s.y = p.random(-p.height / 2, p.height / 2);
        s.z = p.width; s.pz = s.z;
      }
      const sx = (s.x / s.z) * depth * 10;
      const sy = (s.y / s.z) * depth * 10;
      const px = (s.x / s.pz) * depth * 10;
      const py = (s.y / s.pz) * depth * 10;
      p.strokeWeight(p.map(s.z, 0, p.width, 3, 0.4));
      p.line(px, py, sx, sy);
    }
  };
}`,
  },
];

export function getExample(id) {
  return EXAMPLES.find(e => e.id === id) || null;
}
