function sketch(p, ctx) {
let pads = [];
let ripples = [];
let flies = [];
let currentPadIndex = 0;
let targetPadIndex = 1;
let state = "rest";
let stateTimer = 0;
let lastPadCount = -1;
p.setup = function() {
p.createCanvas(600, 600);
p.randomSeed(ctx.seed);
p.noiseSeed(ctx.seed);
};
function buildPads(count) {
pads = [];
for (let i = 0; i < count; i++) {
const angle = (i / count) * p.TWO_PI + p.random(-0.2, 0.2);
const dist = p.random(140, 210);
const x = 300 + p.cos(angle) * dist;
const y = 300 + p.sin(angle) * (dist * 0.82);
pads.push({
x: x,
y: y,
baseRadius: p.random(46, 62),
notchAngle: p.random(0, p.TWO_PI),
notchWidth: p.random(0.35, 0.5),
hasFlower: i % 2 === 0,
flowerPetals: p.floor(p.random(6, 9)),
flowerColor: i % 4 === 0 ? "#f8bbd0" : "#ffffff",
bobPhase: p.random(100)
});
}
flies = [];
for (let i = 0; i < 14; i++) {
flies.push({
x: p.random(600),
y: p.random(600),
seedX: p.random(1000),
seedY: p.random(1000),
size: p.random(2, 4)
});
}
}
function addRipple(x, y, maxR, intensity) {
ripples.push({
x: x,
y: y,
r: 6,
maxR: maxR,
life: 1.0,
decay: p.random(0.015, 0.025),
intensity: intensity
});
}
p.draw = function() {
const jumpSpeed = ctx.params.jumpSpeed ?? 1.0;
const jumpHeight = ctx.params.jumpHeight ?? 140;
const padCount = ctx.params.padCount ?? 8;
const frogSize = ctx.params.frogSize ?? 32;
const rippleIntensity = ctx.params.rippleIntensity ?? 1.0;
if (padCount !== lastPadCount) {
buildPads(padCount);
currentPadIndex = 0;
targetPadIndex = 1 % pads.length;
state = "rest";
stateTimer = 0;
lastPadCount = padCount;
}
// Pond water background
p.background(18, 52, 60);
p.noStroke();
for (let r = 580; r > 100; r -= 90) {
p.fill(24, 68, 78, 45);
p.circle(300, 300, r + p.sin(p.frameCount * 0.02 + r) * 15);
}
// Water caustics / light currents
p.stroke(64, 160, 175, 20);
p.strokeWeight(1.5);
p.noFill();
for (let i = 0; i < 6; i++) {
const yLine = 70 + i * 90;
p.beginShape();
for (let x = 0; x <= 600; x += 40) {
const n = p.noise(x * 0.005, yLine * 0.005, p.frameCount * 0.008);
p.curveVertex(x, yLine + (n - 0.5) * 45);
}
p.endShape();
}
// Update & draw ripples
for (let i = ripples.length - 1; i >= 0; i--) {
const rip = ripples[i];
rip.r += 1.8;
rip.life -= rip.decay;
if (rip.life <= 0 || rip.r >= rip.maxR) {
ripples.splice(i, 1);
continue;
}
p.noFill();
p.stroke(140, 225, 235, rip.life * 130 * rip.intensity);
p.strokeWeight(1.8);
p.ellipse(rip.x, rip.y, rip.r * 2, rip.r * 1.3);
p.stroke(180, 245, 255, rip.life * 60 * rip.intensity);
p.strokeWeight(1.0);
p.ellipse(rip.x, rip.y, rip.r * 1.4, rip.r * 0.9);
}
// Floating fireflies/bugs
for (let fly of flies) {
fly.x = (fly.x + (p.noise(fly.seedX + p.frameCount * 0.006) - 0.49) * 2.5 + 600) % 600;
fly.y = (fly.y + (p.noise(fly.seedY + p.frameCount * 0.006) - 0.49) * 2.5 + 600) % 600;
const glow = p.sin(p.frameCount * 0.08 + fly.seedX) * 0.5 + 0.5;
p.noStroke();
p.fill(220, 255, 170, glow * 180);
p.circle(fly.x, fly.y, fly.size * (1 + glow * 0.6));
}
// Draw Lily Pads
for (let i = 0; i < pads.length; i++) {
const pad = pads[i];
const bob = p.sin(p.frameCount * 0.035 + pad.bobPhase) * 3;
const px = pad.x;
const py = pad.y + bob;
const pr = pad.baseRadius;
// Drop shadow in water
p.noStroke();
p.fill(8, 28, 34, 130);
p.ellipse(px + 4, py + 8, pr * 2.1, pr * 1.7);
// Pad body
p.push();
p.translate(px, py);
p.rotate(pad.notchAngle);
// Pad dark rim
p.fill(38, 110, 52);
p.arc(0, 0, pr * 2, pr * 1.6, pad.notchWidth, p.TWO_PI - pad.notchWidth, p.PIE);
// Pad top surface
p.fill(56, 142, 60);
p.arc(0, 0, pr * 1.88, pr * 1.5, pad.notchWidth + 0.03, p.TWO_PI - pad.notchWidth - 0.03, p.PIE);
// Radial veins
p.stroke(82, 175, 88, 140);
p.strokeWeight(1.2);
for (let a = pad.notchWidth + 0.4; a < p.TWO_PI - pad.notchWidth; a += 0.65) {
const vx = p.cos(a) * (pr * 0.85);
const vy = p.sin(a) * (pr * 0.68);
p.line(0, 0, vx, vy);
}
p.pop();
// Lily flower
if (pad.hasFlower) {
p.push();
p.translate(px + pr * 0.45, py - pr * 0.25);
p.noStroke();
for (let pIdx = 0; pIdx < pad.flowerPetals; pIdx++) {
p.push();
p.rotate((pIdx / pad.flowerPetals) * p.TWO_PI);
p.fill(pad.flowerColor);
p.ellipse(0, 7, 6, 13);
p.fill(248, 187, 208, 160);
p.ellipse(0, 5, 4, 8);
p.pop();
}
p.fill(255, 213, 79);
p.circle(0, 0, 7);
p.pop();
}
}
// Frog Jump Logic & State
const restDuration = 45 / jumpSpeed;
const jumpDuration = 32 / jumpSpeed;
stateTimer++;
let frogX = 0;
let frogY = 0;
let frogZ = 0;
let frogAngle = 0;
let frogProgress = 0;
let crouch = 0;
const fromPad = pads[currentPadIndex];
const toPad = pads[targetPadIndex];
const dx = toPad.x - fromPad.x;
const dy = toPad.y - fromPad.y;
const targetAngle = p.atan2(dy, dx) + p.HALF_PI;
if (state === "rest") {
frogX = fromPad.x;
frogY = fromPad.y + p.sin(p.frameCount * 0.035 + fromPad.bobPhase) * 3;
frogZ = 0;
frogAngle = targetAngle;
const restFrac = stateTimer / restDuration;
if (restFrac > 0.72) {
// Crouch anticipation before jump
crouch = p.map(restFrac, 0.72, 1.0, 0, 1.0);
}
if (stateTimer >= restDuration) {
state = "jump";
stateTimer = 0;
addRipple(fromPad.x, fromPad.y, fromPad.baseRadius * 1.5, rippleIntensity);
}
} else if (state === "jump") {
frogProgress = stateTimer / jumpDuration;
const t = p.constrain(frogProgress, 0, 1);
// Smooth parabolic arc
const curX = p.lerp(fromPad.x, toPad.x, t);
const curY = p.lerp(fromPad.y, toPad.y, t);
frogX = curX;
frogY = curY;
frogZ = p.sin(t * p.PI) * jumpHeight;
frogAngle = targetAngle;
if (t >= 1.0) {
state = "rest";
stateTimer = 0;
currentPadIndex = targetPadIndex;
targetPadIndex = (targetPadIndex + 1) % pads.length;
addRipple(toPad.x, toPad.y, toPad.baseRadius * 1.6, rippleIntensity * 1.2);
}
}
// Frog Shadow
p.push();
p.noStroke();
const shadowAlpha = p.map(frogZ, 0, jumpHeight, 140, 35);
const shadowScale = p.map(frogZ, 0, jumpHeight, 1.0, 0.6);
p.fill(8, 24, 30, shadowAlpha);
p.ellipse(frogX, frogY + 6, frogSize * 1.3 * shadowScale, frogSize * 0.9 * shadowScale);
p.pop();
// Draw Frog
p.push();
p.translate(frogX, frogY - frogZ);
p.rotate(frogAngle);
const baseScale = frogSize / 32;
p.scale(baseScale);
// Dynamic deformations during leap & crouch
let stretchY = 1.0;
let stretchX = 1.0;
let legExtension = 0;
if (state === "jump") {
const midT = p.sin(frogProgress * p.PI);
stretchY = 1.0 + midT * 0.35;
stretchX = 1.0 - midT * 0.2;
legExtension = midT;
} else {
stretchY = 1.0 - crouch * 0.25;
stretchX = 1.0 + crouch * 0.2;
}
// Hind legs
p.stroke(46, 125, 50);
p.strokeWeight(5.5);
p.strokeCap(p.ROUND);
p.strokeJoin(p.ROUND);
p.noFill();
// Left hind leg
const kickL = p.map(legExtension, 0, 1, 0, 24);
p.beginShape();
p.vertex(-10 * stretchX, 8 * stretchY);
p.vertex(-18 * stretchX - kickL * 0.2, 18 * stretchY + kickL * 0.6);
p.vertex(-12 * stretchX - kickL * 0.3, 24 * stretchY + kickL * 1.2);
p.endShape();
// Left webbed foot
p.fill(46, 125, 50);
p.noStroke();
p.push();
p.translate(-12 * stretchX - kickL * 0.3, 24 * stretchY + kickL * 1.2);
p.triangle(-6, 2, 6, 2, 0, 9);
p.pop();
// Right hind leg
p.stroke(46, 125, 50);
p.strokeWeight(5.5);
p.noFill();
p.beginShape();
p.vertex(10 * stretchX, 8 * stretchY);
p.vertex(18 * stretchX + kickL * 0.2, 18 * stretchY + kickL * 0.6);
p.vertex(12 * stretchX + kickL * 0.3, 24 * stretchY + kickL * 1.2);
p.endShape();
// Right webbed foot
p.fill(46, 125, 50);
p.noStroke();
p.push();
p.translate(12 * stretchX + kickL * 0.3, 24 * stretchY + kickL * 1.2);
p.triangle(-6, 2, 6, 2, 0, 9);
p.pop();
// Front arms
p.stroke(56, 142, 60);
p.strokeWeight(4.2);
p.noFill();
const reach = p.map(legExtension, 0, 1, 0, -10);
// Left arm
p.beginShape();
p.vertex(-11 * stretchX, -4 * stretchY);
p.vertex(-19 * stretchX, -10 * stretchY + reach * 0.8);
p.vertex(-16 * stretchX, -18 * stretchY + reach);
p.endShape();
// Right arm
p.beginShape();
p.vertex(11 * stretchX, -4 * stretchY);
p.vertex(19 * stretchX, -10 * stretchY + reach * 0.8);
p.vertex(16 * stretchX, -18 * stretchY + reach);
p.endShape();
// Frog Main Body
p.noStroke();
p.fill(76, 175, 80);
p.ellipse(0, 0, 26 * stretchX, 34 * stretchY);
// Cream / Yellowish Belly
p.fill(220, 237, 200, 210);
p.ellipse(0, 3 * stretchY, 17 * stretchX, 22 * stretchY);
// Throat breathing pulse during rest
if (state === "rest") {
const throatBreath = p.sin(p.frameCount * 0.15) * 2.5;
p.fill(238, 255, 65, 140);
p.ellipse(0, -9 * stretchY, (10 + throatBreath) * stretchX, 8 * stretchY);
}
// Spots on back
p.fill(46, 125, 50, 180);
p.circle(-4 * stretchX, 4 * stretchY, 3.2);
p.circle(5 * stretchX, 6 * stretchY, 4.0);
p.circle(1 * stretchX, 12 * stretchY, 3.0);
p.circle(-5 * stretchX, 10 * stretchY, 2.5);
// Eye sockets
p.fill(56, 142, 60);
p.circle(-9 * stretchX, -13 * stretchY, 11);
p.circle(9 * stretchX, -13 * stretchY, 11);
// Eyeballs
p.fill(255, 235, 59);
p.circle(-9 * stretchX, -14 * stretchY, 8);
p.circle(9 * stretchX, -14 * stretchY, 8);
// Pupils
p.fill(20, 30, 20);
p.ellipse(-9 * stretchX, -14 * stretchY, 4.5, 6);
p.ellipse(9 * stretchX, -14 * stretchY, 4.5, 6);
// Eye sparkle / specular highlight
p.fill(255);
p.circle(-10.2 * stretchX, -15.5 * stretchY, 2.2);
p.circle(7.8 * stretchX, -15.5 * stretchY, 2.2);
p.pop();
};
}