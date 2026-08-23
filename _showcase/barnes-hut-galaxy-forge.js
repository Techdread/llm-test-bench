function sketch(p, ctx) {
  p.setup = function () {
    const starCount = ctx.params.starCount ?? 3600;
    const gravityStrength = ctx.params.gravityStrength ?? 0.18;
    const theta = ctx.params.theta ?? 0.65;
    const softening = ctx.params.softening ?? 6;
    const trailFade = ctx.params.trailFade ?? 12;
    const timeStep = ctx.params.timeStep ?? 0.32;

    p.randomSeed(ctx.seed);
    p.noiseSeed(ctx.seed);
    p.createCanvas(600, 600);
    p.pixelDensity(1);
    p.frameRate(60);
    p.colorMode(p.HSB, 360, 100, 100, 100);

    const initialStars = p.constrain(Math.floor(starCount), 1000, 6000);
    const G = Math.max(0.001, gravityStrength);
    const openingAngle = p.constrain(theta, 0.12, 1.6);
    const epsilon = Math.max(0.2, softening);
    const fadeAmount = p.constrain(trailFade, 0, 100);
    const dt = p.constrain(timeStep, 0.02, 1.2);
    const bodies = [];
    const cores = [];
    const trailLayer = p.createGraphics(p.width, p.height);

    trailLayer.pixelDensity(1);
    trailLayer.colorMode(p.HSB, 360, 100, 100, 100);
    trailLayer.background(232, 45, 3);

    class Quad {
      constructor(x, y, size, depth) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.depth = depth;
        this.mass = 0;
        this.cx = 0;
        this.cy = 0;
        this.bucket = [];
        this.children = null;
      }

      contains(x, y) {
        return x >= this.x && x <= this.x + this.size &&
               y >= this.y && y <= this.y + this.size;
      }

      insert(body) {
        const combinedMass = this.mass + body.m;
        this.cx = combinedMass
          ? (this.cx * this.mass + body.x * body.m) / combinedMass
          : body.x;
        this.cy = combinedMass
          ? (this.cy * this.mass + body.y * body.m) / combinedMass
          : body.y;
        this.mass = combinedMass;

        if (this.children) {
          this.childFor(body.x, body.y).insert(body);
          return;
        }

        this.bucket.push(body);
        if (this.bucket.length > 1 && this.depth < 17) {
          this.split();
          const oldBodies = this.bucket;
          this.bucket = [];
          for (const item of oldBodies) {
            this.childFor(item.x, item.y).insert(item);
          }
        }
      }

      split() {
        const half = this.size * 0.5;
        const d = this.depth + 1;
        this.children = [
          new Quad(this.x, this.y, half, d),
          new Quad(this.x + half, this.y, half, d),
          new Quad(this.x, this.y + half, half, d),
          new Quad(this.x + half, this.y + half, half, d)
        ];
      }

      childFor(x, y) {
        const right = x >= this.x + this.size * 0.5 ? 1 : 0;
        const bottom = y >= this.y + this.size * 0.5 ? 2 : 0;
        return this.children[right + bottom];
      }
    }

    function makeBody(x, y, vx, vy, mass, isCore) {
      const body = {
        x: x,
        y: y,
        vx: vx,
        vy: vy,
        ax: 0,
        ay: 0,
        m: mass,
        core: isCore
      };
      bodies.push(body);
      if (isCore) cores.push(body);
      return body;
    }

    const coreMass = 6200;
    const separation = 176;
    const binarySpeed = Math.sqrt(G * coreMass / (2 * separation));
    const leftCore = makeBody(300 - separation * 0.5, 300, 0, -binarySpeed, coreMass, true);
    const rightCore = makeBody(300 + separation * 0.5, 300, 0, binarySpeed, coreMass, true);

    for (let i = 0; i < initialStars; i++) {
      const host = i % 2 === 0 ? leftCore : rightCore;
      const direction = host === leftCore ? 1 : -1;
      const arm = Math.floor(p.random(3));
      const radius = 7 + 122 * Math.pow(p.random(), 0.58);
      const angle = arm * p.TWO_PI / 3 +
        radius * 0.046 * direction +
        p.randomGaussian(0, 0.23);
      const tilt = host === leftCore ? -0.13 : 0.13;
      const localX = Math.cos(angle) * radius;
      const localY = Math.sin(angle) * radius * 0.72;
      const cosTilt = Math.cos(tilt);
      const sinTilt = Math.sin(tilt);
      const x = host.x + localX * cosTilt - localY * sinTilt;
      const y = host.y + localX * sinTilt + localY * cosTilt;
      const stellarMass = p.random(0.45, 1.45);
      const enclosedStars =
        initialStars * 0.5 * 0.95 * Math.min(1, radius * radius / (122 * 122));
      const orbitalSpeed = Math.sqrt(
        G * (host.m + enclosedStars) /
        Math.sqrt(radius * radius + epsilon * epsilon)
      );
      let tx = -Math.sin(angle) * direction;
      let ty = Math.cos(angle) * direction / 0.72;
      const tangentLength = Math.hypot(tx, ty);
      tx /= tangentLength;
      ty /= tangentLength;
      const warmth = p.randomGaussian(0, orbitalSpeed * 0.035);

      makeBody(
        x,
        y,
        host.vx + tx * orbitalSpeed + p.randomGaussian(0, 0.035),
        host.vy + ty * orbitalSpeed + warmth,
        stellarMass,
        false
      );
    }

    function buildTree() {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const body of bodies) {
        minX = Math.min(minX, body.x);
        minY = Math.min(minY, body.y);
        maxX = Math.max(maxX, body.x);
        maxY = Math.max(maxY, body.y);
      }

      const size = Math.max(maxX - minX, maxY - minY, 32) + 16;
      const root = new Quad(
        (minX + maxX - size) * 0.5,
        (minY + maxY - size) * 0.5,
        size,
        0
      );

      for (const body of bodies) root.insert(body);
      return root;
    }

    function addAcceleration(node, body, output) {
      if (node.mass === 0) return;

      if (!node.children) {
        for (const other of node.bucket) {
          if (other === body) continue;
          const dx = other.x - body.x;
          const dy = other.y - body.y;
          const d2 = dx * dx + dy * dy + epsilon * epsilon;
          const scale = G * other.m / (d2 * Math.sqrt(d2));
          output.x += dx * scale;
          output.y += dy * scale;
        }
        return;
      }

      const dx = node.cx - body.x;
      const dy = node.cy - body.y;
      const distance = Math.sqrt(dx * dx + dy * dy) + 1e-9;

      if (!node.contains(body.x, body.y) &&
          node.size / distance < openingAngle) {
        const d2 = dx * dx + dy * dy + epsilon * epsilon;
        const scale = G * node.mass / (d2 * Math.sqrt(d2));
        output.x += dx * scale;
        output.y += dy * scale;
        return;
      }

      for (const child of node.children) {
        addAcceleration(child, body, output);
      }
    }

    function calculateAccelerations(tree) {
      for (const body of bodies) {
        const acceleration = { x: 0, y: 0 };
        addAcceleration(tree, body, acceleration);
        body.ax = acceleration.x;
        body.ay = acceleration.y;
      }
    }

    function launchCluster(x, y) {
      const clusterSize = p.constrain(
        Math.floor(initialStars * 0.035),
        70,
        170
      );

      let totalMass = 0;
      let centerX = 0;
      let centerY = 0;
      let centerVX = 0;
      let centerVY = 0;

      for (const body of bodies) {
        totalMass += body.m;
        centerX += body.x * body.m;
        centerY += body.y * body.m;
        centerVX += body.vx * body.m;
        centerVY += body.vy * body.m;
      }

      centerX /= totalMass;
      centerY /= totalMass;
      centerVX /= totalMass;
      centerVY /= totalMass;

      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.max(40, Math.hypot(dx, dy));
      const bulkSpeed = Math.sqrt(G * totalMass / distance) * 0.82;
      const tangentX = -dy / distance;
      const tangentY = dx / distance;
      const inwardX = -dx / distance;
      const inwardY = -dy / distance;
      const clusterMass = clusterSize * 0.9;

      for (let i = 0; i < clusterSize; i++) {
        const radius = 1.5 + 17 * Math.sqrt(p.random());
        const angle = p.random(p.TWO_PI);
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        const enclosedMass = clusterMass * radius * radius / (17 * 17);
        const localSpeed = Math.sqrt(
          G * enclosedMass / Math.sqrt(radius * radius + epsilon * epsilon)
        );

        makeBody(
          px,
          py,
          centerVX + tangentX * bulkSpeed + inwardX * bulkSpeed * 0.16 -
            Math.sin(angle) * localSpeed,
          centerVY + tangentY * bulkSpeed + inwardY * bulkSpeed * 0.16 +
            Math.cos(angle) * localSpeed,
          p.random(0.55, 1.25),
          false
        );
      }

      const maximumBodies = initialStars + 1400 + cores.length;
      while (bodies.length > maximumBodies) {
        const removable = bodies.findIndex(body => !body.core);
        if (removable < 0) break;
        bodies.splice(removable, 1);
      }
    }

    function drawTree(node) {
      if (node.mass === 0) return;
      p.rect(node.x, node.y, node.size, node.size);
      if (node.children) {
        for (const child of node.children) drawTree(child);
      }
    }

    let draggedCore = null;
    let dragX = 0;
    let dragY = 0;
    let currentTree = buildTree();

    p.mousePressed = function () {
      if (p.mouseX < 0 || p.mouseX > p.width ||
          p.mouseY < 0 || p.mouseY > p.height) return;

      for (const core of cores) {
        if (p.dist(p.mouseX, p.mouseY, core.x, core.y) < 25) {
          draggedCore = core;
          dragX = p.mouseX;
          dragY = p.mouseY;
          return false;
        }
      }

      launchCluster(p.mouseX, p.mouseY);
      return false;
    };

    p.mouseReleased = function () {
      draggedCore = null;
      return false;
    };

    p.draw = function () {
      if (draggedCore) {
        const nextX = p.constrain(p.mouseX, 0, p.width);
        const nextY = p.constrain(p.mouseY, 0, p.height);
        draggedCore.vx = p.constrain((nextX - dragX) / dt, -12, 12);
        draggedCore.vy = p.constrain((nextY - dragY) / dt, -12, 12);
        draggedCore.x = nextX;
        draggedCore.y = nextY;
        dragX = nextX;
        dragY = nextY;
      }

      currentTree = buildTree();
      calculateAccelerations(currentTree);

      for (const body of bodies) {
        if (body === draggedCore) continue;
        body.vx += body.ax * dt * 0.5;
        body.vy += body.ay * dt * 0.5;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
      }

      currentTree = buildTree();
      calculateAccelerations(currentTree);

      for (const body of bodies) {
        if (body === draggedCore) continue;
        body.vx += body.ax * dt * 0.5;
        body.vy += body.ay * dt * 0.5;
      }

      trailLayer.noStroke();
      trailLayer.fill(232, 45, 3, fadeAmount);
      trailLayer.rect(0, 0, p.width, p.height);

      for (const body of bodies) {
        if (body.core || body.x < -4 || body.x > p.width + 4 ||
            body.y < -4 || body.y > p.height + 4) continue;

        const speed = Math.hypot(body.vx, body.vy);
        const hue = p.map(p.constrain(speed, 0.2, 7), 0.2, 7, 205, 8);
        const brightness = p.map(p.constrain(speed, 0, 7), 0, 7, 72, 100);
        trailLayer.stroke(hue, 72, brightness, 68);
        trailLayer.strokeWeight(0.65 + body.m * 0.55);
        trailLayer.point(body.x, body.y);
      }

      p.background(232, 45, 3);
      p.image(trailLayer, 0, 0);

      if (p.keyIsDown(81)) {
        p.noFill();
        p.stroke(178, 66, 96, 34);
        p.strokeWeight(0.65);
        drawTree(currentTree);
      }

      for (let i = 0; i < cores.length; i++) {
        const core = cores[i];
        const pulse = 1.5 * Math.sin(p.frameCount * 0.055 + i * p.PI);
        p.push();
        p.drawingContext.shadowBlur = 22;
        p.drawingContext.shadowColor = i === 0
          ? "rgba(90,180,255,0.9)"
          : "rgba(255,130,80,0.9)";
        p.noStroke();
        p.fill(i === 0 ? 202 : 28, 72, 100, 24);
        p.circle(core.x, core.y, 34 + pulse);
        p.fill(i === 0 ? 202 : 28, 30, 100, 96);
        p.circle(core.x, core.y, 12);
        p.fill(50, 8, 100, 100);
        p.circle(core.x, core.y, 4);
        p.pop();
      }
    };
  };
}