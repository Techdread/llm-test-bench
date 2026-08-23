function sketch(p, ctx) {
let rawPoints = [];
let isDrawing = false;
let activeBasePoints = [];
let resampledPoints = [];
let fourierComplex = [];
let fourierX = [];
let fourierY = [];
let trail = [];
let time = 0;
let mode = "complex";
let orderMode = "amplitude";
let showOriginal = true;
let cachedSampleCount = -1;
let cachedSmoothing = -1;
let cachedOrderMode = "";
let cachedEpicycleCount = -1;
let rmsError = 0;
let relErrorPct = 0;
function createDefaultShape() {
const pts = [];
const n = 240;
const cx = 300;
const cy = 300;
for (let i = 0; i < n; i++) {
const a = (p.TWO_PI * i) / n;
const r = 135 + 40 * Math.sin(3 * a) + 25 * Math.cos(5 * a) + 12 * Math.sin(7 * a);
pts.push({
x: cx + r * Math.cos(a),
y: cy + r * Math.sin(a)
});
}
return pts;
}
function smoothPolygon(pts, passes) {
let curr = pts.slice();
for (let pass = 0; pass < passes; pass++) {
if (curr.length < 3) break;
const next = [];
const len = curr.length;
for (let i = 0; i < len; i++) {
const p0 = curr[(i - 1 + len) % len];
const p1 = curr[i];
const p2 = curr[(i + 1) % len];
next.push({
x: 0.25 * p0.x + 0.5 * p1.x + 0.25 * p2.x,
y: 0.25 * p0.y + 0.5 * p1.y + 0.25 * p2.y
});
}
curr = next;
}
return curr;
}
function resampleByArcLength(pts, targetCount) {
if (pts.length < 2) return [];
const len = pts.length;
const cumDist = [0];
for (let i = 0; i < len; i++) {
const next = pts[(i + 1) % len];
const d = p.dist(pts[i].x, pts[i].y, next.x, next.y);
cumDist.push(cumDist[cumDist.length - 1] + Math.max(d, 0.0001));
}
const totalDist = cumDist[cumDist.length - 1];
if (totalDist <= 0) return [];
const resampled = [];
const step = totalDist / targetCount;
let seg = 0;
for (let i = 0; i < targetCount; i++) {
const target = i * step;
while (seg < len && cumDist[seg + 1] < target) {
seg++;
}
if (seg >= len) seg = len - 1;
const segStart = cumDist[seg];
const segLen = cumDist[seg + 1] - segStart;
const t = segLen > 0 ? (target - segStart) / segLen : 0;
const p1 = pts[seg];
const p2 = pts[(seg + 1) % len];
resampled.push({
x: p.lerp(p1.x, p2.x, t),
y: p.lerp(p1.y, p2.y, t)
});
}
return resampled;
}
function computeComplexDFT(pts) {
const N = pts.length;
const X = [];
const half = Math.floor(N / 2);
for (let k = -half; k < half; k++) {
let re = 0;
let im = 0;
for (let n = 0; n < N; n++) {
const phi = (p.TWO_PI * k * n) / N;
const cosA = Math.cos(phi);
const sinA = Math.sin(phi);
re += pts[n].x * cosA + pts[n].y * sinA;
im += pts[n].y * cosA - pts[n].x * sinA;
}
re /= N;
im /= N;
const amp = Math.hypot(re, im);
const phase = Math.atan2(im, re);
X.push({ re, im, freq: k, amp, phase });
}
return X;
}
function compute1DDFT(values) {
const N = values.length;
const X = [];
const half = Math.floor(N / 2);
for (let k = -half; k < half; k++) {
let re = 0;
let im = 0;
for (let n = 0; n < N; n++) {
const phi = (p.TWO_PI * k * n) / N;
re += values[n] * Math.cos(phi);
im -= values[n] * Math.sin(phi);
}
re /= N;
im /= N;
const amp = Math.hypot(re, im);
const phase = Math.atan2(im, re);
X.push({ re, im, freq: k, amp, phase });
}
return X;
}
function sortFourier(terms, order) {
const copy = terms.slice();
if (order === "amplitude") {
copy.sort((a, b) => b.amp - a.amp);
} else {
copy.sort((a, b) => Math.abs(a.freq) - Math.abs(b.freq) || a.freq - b.freq);
}
return copy;
}
function updateReconstructionError(count) {
if (!resampledPoints || resampledPoints.length === 0 || !fourierComplex || fourierComplex.length === 0) {
rmsError = 0;
relErrorPct = 0;
return;
}
const N = resampledPoints.length;
const numTerms = Math.min(count, fourierComplex.length);
let sumSq = 0;
let avgX = 0;
let avgY = 0;
for (let n = 0; n < N; n++) {
avgX += resampledPoints[n].x;
avgY += resampledPoints[n].y;
}
avgX /= N;
avgY /= N;
let maxRadius = 1;
for (let n = 0; n < N; n++) {
const orig = resampledPoints[n];
const rad = p.dist(orig.x, orig.y, avgX, avgY);
if (rad > maxRadius) maxRadius = rad;
const t = (p.TWO_PI * n) / N;
let rx = 0;
let ry = 0;
for (let i = 0; i < numTerms; i++) {
const c = fourierComplex[i];
const ang = c.freq * t + c.phase;
rx += c.amp * Math.cos(ang);
ry += c.amp * Math.sin(ang);
}
sumSq += (orig.x - rx) * (orig.x - rx) + (orig.y - ry) * (orig.y - ry);
}
rmsError = Math.sqrt(sumSq / N);
relErrorPct = Math.min(100, (rmsError / maxRadius) * 100);
}
function rebuildPipeline(sampleCount, smoothingPasses, order, epicycleCount) {
if (activeBasePoints.length < 3) return;
const smoothed = smoothPolygon(activeBasePoints, smoothingPasses);
resampledPoints = resampleByArcLength(smoothed, Math.max(16, sampleCount));
const rawComplex = computeComplexDFT(resampledPoints);
fourierComplex = sortFourier(rawComplex, order);
const xVals = resampledPoints.map((pt) => pt.x);
const yVals = resampledPoints.map((pt) => pt.y);
fourierX = sortFourier(compute1DDFT(xVals), order);
fourierY = sortFourier(compute1DDFT(yVals), order);
cachedSampleCount = sampleCount;
cachedSmoothing = smoothingPasses;
cachedOrderMode = order;
cachedEpicycleCount = epicycleCount;
updateReconstructionError(epicycleCount);
}
p.setup = function () {
p.createCanvas(600, 600);
p.randomSeed(ctx.seed);
p.noiseSeed(ctx.seed);
activeBasePoints = createDefaultShape();
rebuildPipeline(200, 2, "amplitude", 80);
};
p.draw = function () {
const sampleCount = ctx.params.sampleCount ?? 200;
const epicycleCount = ctx.params.epicycleCount ?? 80;
const playbackSpeed = ctx.params.playbackSpeed ?? 1.0;
const trailLength = ctx.params.trailLength ?? 600;
const lineWeight = ctx.params.lineWeight ?? 1.5;
const smoothingPasses = ctx.params.smoothingPasses ?? 2;
if (
sampleCount !== cachedSampleCount ||
smoothingPasses !== cachedSmoothing ||
orderMode !== cachedOrderMode ||
epicycleCount !== cachedEpicycleCount
) {
rebuildPipeline(sampleCount, smoothingPasses, orderMode, epicycleCount);
}
p.background(12, 15, 22);
// Coordinate grid atmosphere
p.stroke(255, 255, 255, 8);
p.strokeWeight(1);
for (let gx = 40; gx < p.width; gx += 40) {
p.line(gx, 0, gx, p.height);
}
for (let gy = 40; gy < p.height; gy += 40) {
p.line(0, gy, p.width, gy);
}
// Draw original stroke if enabled
if (showOriginal && resampledPoints.length > 1) {
p.noFill();
p.stroke(140, 160, 200, 45);
p.strokeWeight(lineWeight);
p.beginShape();
for (let i = 0; i < resampledPoints.length; i++) {
p.vertex(resampledPoints[i].x, resampledPoints[i].y);
}
p.endShape(p.CLOSE);
}
let endX = 0;
let endY = 0;
if (!isDrawing && fourierComplex.length > 0) {
if (mode === "complex") {
let x = 0;
let y = 0;
const maxEpicycles = Math.min(epicycleCount, fourierComplex.length);
for (let i = 0; i < maxEpicycles; i++) {
const prevX = x;
const prevY = y;
const term = fourierComplex[i];
const angle = term.freq * time + term.phase;
const radius = term.amp;
x += radius * Math.cos(angle);
y += radius * Math.sin(angle);
if (radius > 0.5) {
p.noFill();
p.stroke(75, 160, 240, 38);
p.strokeWeight(Math.max(0.75, lineWeight * 0.6));
p.ellipse(prevX, prevY, radius * 2);
p.stroke(130, 210, 255, 130);
p.line(prevX, prevY, x, y);
p.fill(200, 240, 255, 200);
p.noStroke();
p.circle(x, y, Math.min(3.5, Math.max(1.8, lineWeight)));
}
}
endX = x;
endY = y;
} else {
// Separate X and Y epicycle chains
const maxEpicyclesX = Math.min(epicycleCount, fourierX.length);
const maxEpicyclesY = Math.min(epicycleCount, fourierY.length);
// X Chain along top
let xChainX = 0;
let xChainY = 85;
for (let i = 0; i < maxEpicyclesX; i++) {
const prevX = xChainX;
const prevY = xChainY;
const term = fourierX[i];
const angle = term.freq * time + term.phase;
const radius = term.amp;
xChainX += radius * Math.cos(angle);
xChainY += radius * Math.sin(angle);
if (radius > 0.5) {
p.noFill();
p.stroke(60, 200, 240, 35);
p.strokeWeight(Math.max(0.75, lineWeight * 0.6));
p.ellipse(prevX, prevY, radius * 2);
p.stroke(100, 220, 255, 120);
p.line(prevX, prevY, xChainX, xChainY);
}
}
// Y Chain along left
let yChainX = 85;
let yChainY = 0;
for (let i = 0; i < maxEpicyclesY; i++) {
const prevX = yChainX;
const prevY = yChainY;
const term = fourierY[i];
const angle = term.freq * time + term.phase;
const radius = term.amp;
yChainX += radius * Math.cos(angle);
yChainY += radius * Math.sin(angle);
if (radius > 0.5) {
p.noFill();
p.stroke(245, 100, 180, 35);
p.strokeWeight(Math.max(0.75, lineWeight * 0.6));
p.ellipse(prevX, prevY, radius * 2);
p.stroke(255, 130, 200, 120);
p.line(prevX, prevY, yChainX, yChainY);
}
}
endX = xChainX;
endY = yChainY;
// Laser projections
p.stroke(255, 230, 120, 90);
p.strokeWeight(1);
p.line(xChainX, xChainY, endX, endY);
p.line(yChainX, yChainY, endX, endY);
p.fill(255, 220, 100, 220);
p.noStroke();
p.circle(xChainX, xChainY, 4);
p.circle(yChainX, yChainY, 4);
}
// Add to reconstructed trail
trail.unshift({ x: endX, y: endY });
while (trail.length > trailLength) {
trail.pop();
}
// Progress phase
const dt = (p.TWO_PI / Math.max(16, resampledPoints.length)) * playbackSpeed;
time += dt;
if (time >= p.TWO_PI) {
time -= p.TWO_PI;
}
}
// Render reconstructed trail with glowing gradient fade
if (trail.length > 1) {
p.noFill();
for (let i = 0; i < trail.length - 1; i++) {
const progress = 1 - i / trail.length;
const alpha = progress * 240;
p.strokeWeight(lineWeight * (1 + progress * 0.8));
p.stroke(0, 255, 200, alpha);
p.line(trail[i].x, trail[i].y, trail[i + 1].x, trail[i + 1].y);
}
// Reconstructed tip beacon
p.fill(255, 255, 255, 250);
p.noStroke();
p.circle(endX, endY, lineWeight * 3 + 2);
p.fill(0, 255, 200, 90);
p.circle(endX, endY, lineWeight * 6 + 6);
}
// Real-time drawing visualization
if (isDrawing && rawPoints.length > 0) {
p.noFill();
p.stroke(255, 200, 60, 220);
p.strokeWeight(lineWeight * 2);
p.beginShape();
for (let i = 0; i < rawPoints.length; i++) {
p.vertex(rawPoints[i].x, rawPoints[i].y);
}
p.endShape();
p.fill(255, 220, 80);
p.noStroke();
const last = rawPoints[rawPoints.length - 1];
p.circle(last.x, last.y, 6);
}
// HUD / Metrics Panel
p.fill(16, 22, 32, 220);
p.stroke(255, 255, 255, 28);
p.strokeWeight(1);
p.rect(14, 14, 255, 122, 8);
p.noStroke();
p.textFont("monospace");
p.textSize(11);
p.fill(100, 220, 255);
p.text("FOURIER EPICYCLE ENGINE", 24, 32);
p.fill(210, 220, 235);
p.text("Mode [C]:      " + (mode === "complex" ? "Complex 2D" : "X/Y Separate"), 24, 50);
p.text("Order [O]:     " + (orderMode === "amplitude" ? "Amplitude" : "Frequency"), 24, 66);
p.text("Stroke [S]:    " + (showOriginal ? "Visible" : "Hidden"), 24, 82);
const activeTerms = Math.min(epicycleCount, fourierComplex.length);
p.text("Active Terms:  " + activeTerms + " / " + fourierComplex.length, 24, 98);
p.fill(rmsError > 10 ? p.color(255, 150, 100) : p.color(120, 255, 180));
p.text("RMS Error:     " + rmsError.toFixed(2) + "px (" + relErrorPct.toFixed(1) + "%)", 24, 114);
// Interactive helper hint
p.fill(255, 255, 255, 130);
p.textSize(10.5);
p.text(
isDrawing ? "Release mouse to synthesize loop..." : "Click & drag anywhere to draw a closed loop",
16,
p.height - 16
);
};
p.mousePressed = function () {
if (p.mouseX >= 0 && p.mouseX <= p.width && p.mouseY >= 0 && p.mouseY <= p.height) {
isDrawing = true;
rawPoints = [{ x: p.mouseX, y: p.mouseY }];
trail = [];
}
};
p.mouseDragged = function () {
if (isDrawing) {
const last = rawPoints[rawPoints.length - 1];
if (!last || p.dist(p.mouseX, p.mouseY, last.x, last.y) > 2.5) {
rawPoints.push({ x: p.mouseX, y: p.mouseY });
}
}
};
p.mouseReleased = function () {
if (isDrawing) {
isDrawing = false;
if (rawPoints.length >= 6) {
activeBasePoints = rawPoints.slice();
const sampleCount = ctx.params.sampleCount ?? 200;
const epicycleCount = ctx.params.epicycleCount ?? 80;
const smoothingPasses = ctx.params.smoothingPasses ?? 2;
rebuildPipeline(sampleCount, smoothingPasses, orderMode, epicycleCount);
time = 0;
trail = [];
}
rawPoints = [];
}
};
p.keyPressed = function () {
if (p.key === "c" || p.key === "C") {
mode = mode === "complex" ? "separate" : "complex";
trail = [];
} else if (p.key === "o" || p.key === "O") {
orderMode = orderMode === "amplitude" ? "frequency" : "amplitude";
const sampleCount = ctx.params.sampleCount ?? 200;
const epicycleCount = ctx.params.epicycleCount ?? 80;
const smoothingPasses = ctx.params.smoothingPasses ?? 2;
rebuildPipeline(sampleCount, smoothingPasses, orderMode, epicycleCount);
trail = [];
} else if (p.key === "s" || p.key === "S") {
showOriginal = !showOriginal;
}
};
}