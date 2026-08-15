function sketch(p, ctx) {
  let streaks = [];
  let rings = [];
  const maxZ = 2000;
  const focalLen = 280;

  function makeStreak(scatterZ) {
    const angle = p.random(p.TWO_PI);
    const radius = p.random(30, 280);
    return {
      x: p.cos(angle) * radius,
      y: p.sin(angle) * radius,
      z: scatterZ ? p.random(10, maxZ) : maxZ + p.random(200),
      pz: 0,
      isPink: p.random() > 0.5,
      brightness: p.random(0.6, 1.2)
    };
  }

  function makeRing(scatterZ) {
    return {
      z: scatterZ ? p.random(10, maxZ) : maxZ + p.random(600),
      radius: p.random(80, 320),
      isPink: p.random() > 0.5,
      segments: p.floor(p.random(6, 16))
    };
  }

  p.setup = function () {
    p.randomSeed(ctx.seed);
    p.noiseSeed(ctx.seed);
    p.createCanvas(600, 600);

    for (let i = 0; i < 320; i++) streaks.push(makeStreak(true));
    for (let i = 0; i < 24; i++) rings.push(makeRing(true));
  };

  p.draw = function () {
    const speed = ctx.params.speed ?? 18;
    const glow = ctx.params.glow ?? 0.75;
    const twist = ctx.params.twist ?? 0.4;

    p.background(4, 0, 12);

    const cx = p.width / 2;
    const cy = p.height / 2;
    const rotAngle = p.frameCount * twist * 0.004;
    const cosA = p.cos(rotAngle);
    const sinA = p.sin(rotAngle);

    p.push();
    p.translate(cx, cy);
    p.blendMode(p.ADD);

    // --- Streaks ---
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      s.pz = s.z;
      s.z -= speed;

      if (s.z < 2) {
        const ns = makeStreak(false);
        s.x = ns.x; s.y = ns.y; s.z = ns.z;
        s.pz = s.z; s.isPink = ns.isPink; s.brightness = ns.brightness;
        continue;
      }

      const rx = s.x * cosA - s.y * sinA;
      const ry = s.x * sinA + s.y * cosA;

      const sx = (rx / s.z) * focalLen;
      const sy = (ry / s.z) * focalLen;
      const px = (rx / s.pz) * focalLen;
      const py = (ry / s.pz) * focalLen;

      const t = 1 - s.z / maxZ;
      const alpha = p.constrain(p.map(t, 0, 1, 5, 220) * glow * s.brightness, 0, 255);
      const sw = p.map(t, 0, 1, 0.3, 2.8);

      const r = s.isPink ? 255 : 30;
      const g = s.isPink ? 30 : 255;
      const b = s.isPink ? 147 : 255;

      // outer glow
      p.stroke(r, g, b, alpha * 0.15);
      p.strokeWeight(sw * 6);
      p.line(px, py, sx, sy);

      // mid glow
      p.stroke(r, g, b, alpha * 0.45);
      p.strokeWeight(sw * 2.5);
      p.line(px, py, sx, sy);

      // core
      p.stroke(r, g, b, alpha);
      p.strokeWeight(sw);
      p.line(px, py, sx, sy);

      // hot white center
      p.stroke(255, 240, 255, alpha * 0.55);
      p.strokeWeight(sw * 0.4);
      p.line(px, py, sx, sy);

      // bright tip dot for nearby streaks
      if (t > 0.7) {
        const dotAlpha = p.map(t, 0.7, 1, 0, 180) * glow;
        p.noStroke();
        p.fill(255, 255, 255, dotAlpha);
        p.ellipse(sx, sy, sw * 3, sw * 3);
      }
    }

    // --- Rings ---
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      ring.z -= speed;

      if (ring.z < 2) {
        const nr = makeRing(false);
        ring.z = nr.z; ring.radius = nr.radius;
        ring.isPink = nr.isPink; ring.segments = nr.segments;
        continue;
      }

      const projR = (ring.radius / ring.z) * focalLen;
      const t = 1 - ring.z / maxZ;
      const alpha = p.constrain(p.map(t, 0, 1, 3, 55) * glow, 0, 255);
      const sw = p.map(t, 0, 1, 0.2, 1.8);

      const r = ring.isPink ? 255 : 0;
      const g = ring.isPink ? 20 : 255;
      const b = ring.isPink ? 147 : 255;

      p.noFill();
      p.stroke(r, g, b, alpha * 0.5);
      p.strokeWeight(sw * 3);
      p.ellipse(0, 0, projR * 2, projR * 2);

      p.stroke(r, g, b, alpha);
      p.strokeWeight(sw);
      p.ellipse(0, 0, projR * 2, projR * 2);

      // dashed ring segments for texture
      if (projR > 20) {
        p.stroke(r, g, b, alpha * 1.3);
        p.strokeWeight(sw * 1.5);
        const segAngle = p.TWO_PI / ring.segments;
        const gap = segAngle * 0.35;
        for (let j = 0; j < ring.segments; j++) {
          const a1 = j * segAngle + p.frameCount * 0.003 * (ring.isPink ? 1 : -1);
          const a2 = a1 + segAngle - gap;
          p.arc(0, 0, projR * 2, projR * 2, a1, a2);
        }
      }
    }

    // --- Pulsing center glow ---
    const pulse = 0.8 + 0.2 * p.sin(p.frameCount * 0.05);
    p.noStroke();
    for (let rad = 70; rad > 0; rad -= 1) {
      const a = p.map(rad, 0, 70, 50, 0) * glow * pulse;
      p.fill(100, 20, 160, a);
      p.ellipse(0, 0, rad * 2, rad * 2);
    }
    // hot core
    for (let rad = 12; rad > 0; rad -= 1) {
      const a = p.map(rad, 0, 12, 90, 0) * glow * pulse;
      p.fill(220, 150, 255, a);
      p.ellipse(0, 0, rad * 2, rad * 2);
    }

    p.blendMode(p.BLEND);
    p.pop();

    // Vignette overlay
    p.noFill();
    for (let i = 0; i < 40; i++) {
      const a = p.map(i, 0, 40, 0, 100);
      p.stroke(4, 0, 12, a);
      p.strokeWeight(8);
      p.rect(i * 4, i * 4, p.width - i * 8, p.height - i * 8, 20);
    }
  };
}