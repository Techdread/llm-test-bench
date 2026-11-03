// Plexus backdrop: drifting points joined by faint lines, the same effect as
// the hub's "plexus" wallpaper (shared/services/wallpaper.js), in this site's
// palette. Self-contained so the landing pages need no shared services.
//
// One fixed canvas is prepended to <body> at z-index -1, so it paints above
// site.css's colour glows (body::before) and below its grid (body::after).
// The pointer pushes nearby points away and draws threads to them. With
// prefers-reduced-motion the network is drawn once and never moves.
(function () {
  const COLORS = ['112, 167, 255', '168, 134, 255', '241, 123, 182']; // --blue, --purple, --pink
  const LINK = 120;        // px: points closer than this are joined
  const REACH = 150;       // px: pointer influence radius
  const AREA_PER_POINT = 16000;
  const MAX_POINTS = 140;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  canvas.className = 'plexus-backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let points = [];
  let pointer = null;
  let frame = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.min(MAX_POINTS, Math.floor((width * height) / AREA_PER_POINT));
    // Keep existing points on resize (mobile URL bars resize constantly);
    // only top up or trim, and pull strays back inside.
    points = points.slice(0, count);
    for (const p of points) {
      p.x = Math.min(p.x, width);
      p.y = Math.min(p.y, height);
    }
    while (points.length < count) {
      points.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 1.2 + Math.random() * 1.8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }
    if (motion.matches) draw(false);
  }

  function draw(move) {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      if (move) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        if (pointer) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < REACH) {
            const push = ((REACH - dist) / 1500) * 15;
            p.x += (dx / dist) * push;
            p.y += (dy / dist) * push;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.strokeStyle = `rgba(${p.color}, ${((REACH - dist) / REACH) * 0.3})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      for (let j = i + 1; j < points.length; j++) {
        const q = points[j];
        const dist = Math.hypot(p.x - q.x, p.y - q.y);
        if (dist < LINK) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(${p.color}, ${((LINK - dist) / LINK) * 0.2})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color}, 0.55)`;
      ctx.fill();
    }
  }

  function loop() {
    draw(true);
    frame = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(frame);
    if (motion.matches) draw(false);
    else loop();
  }

  window.addEventListener('pointermove', (e) => {
    pointer = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; });
  window.addEventListener('resize', resize);
  motion.addEventListener('change', start);

  function mount() {
    document.body.prepend(canvas);
    resize();
    start();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
