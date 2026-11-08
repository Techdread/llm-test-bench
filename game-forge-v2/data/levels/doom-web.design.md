Build **Coldiron Station**, an original first-person shooter inspired by Doom, as a multi-file web game. This is a full design document: build what it specifies, use its numbers, and work through the build order so that the game is playable at the end of every stage. If you run short of budget, finish the stage you are on cleanly rather than starting the next.

## 1. Pitch
The night engineer of Coldiron, a geothermal pump station sunk into a glacier, wakes to find the station's maintenance machines rewritten into hunters. Two levels, Pump Hall and Furnace Ring, take them from the intake to the furnace control room. The fun is fast movement through rooms of different heights, reading where an attack is coming from, and choosing the right gun for each machine, while the machines' own crossfire can be turned against them.

## 2. Technical frame
- Files: `index.html`, `style.css`, and classic `<script>` files in `src/`, loaded in this order: `config.js`, `levels.js`, `textures.js`, `sprites.js`, `audio.js`, `input.js`, `world.js` (sectors, doors, lifts, crushers), `physics.js`, `renderer.js`, `enemies.js`, `weapons.js`, `hud.js`, `automap.js`, `game.js`, `main.js`. No ES modules, no libraries, no external files: every texture, sprite and sound is generated in code.
- Render into a 320 × 200 `ImageData` buffer (write pixels through a `Uint32Array` view), put it on an off-screen canvas, and draw that onto the visible canvas scaled by the largest whole number that fits the window, with `imageSmoothingEnabled = false`. The chunky pixels are the look.
- A fixed-timestep simulation at 60 Hz with an accumulator; render once per animation frame. Every speed is in metres or radians per second and multiplied by the step time.
- Pause automatically when the tab loses focus or the pointer lock is released.

## 3. World, camera and movement
These rules are exact. Most failed attempts at this kind of game get one of them wrong, so implement them literally and check them with the `?debug` view (§15).
- **Units and axes.** Metres. x points east, y points north, z points up.
- **Angle.** θ in radians: θ = 0 faces east, θ grows counter-clockwise, θ = π/2 faces north. Keep θ wrapped to [0, 2π).
- **Basis vectors.** forward = (cos θ, sin θ); right = (sin θ, −cos θ).
- **Keys.** W/S or ↑/↓ move along forward; A/D strafe along right; ←/→ turn at 2.6 rad/s; Shift runs. Build the wish vector as forward·(W−S) + right·(D−A), normalise it if longer than 1, and scale by 4.5 m/s walking or 8 m/s running.
- **Mouse.** Clicking the canvas requests pointer lock. While locked, `movementX` turns the view: θ −= movementX × 0.0022 × sensitivity, so moving the mouse right turns right. No vertical look.
- **Acceleration.** Velocity approaches the wish velocity at 14 per second (v += (wish − v) × min(1, 14·dt)), so starts and stops are quick but not instant.
- **Eye height.** eyeZ = floor + 1.6 m. When the floor under the player rises (a step), eyeZ eases up at 6 m/s instead of snapping. When it drops, the player falls with gravity of 18 m/s² until landing; a fall of more than 1.5 m plays a thud and dips the view.
- **View bob.** While moving on the ground, add 0.04 × sin(distance walked × 7) to eyeZ, and move the weapon in a figure of eight.

## 4. Collision
- The player is a circle of radius 0.35 m and height 1.75 m. Enemies use the radii in §8.
- **What blocks.** An edge blocks a mover if any of these is true: it is solid (`neighbors[i] = −1`); the floor beyond is more than 0.6 m above the mover's feet; the opening, from the higher of the two floors to the lower of the two ceilings, is less than the mover's height; or it leads into a door that is not fully open.
- **Sliding.** Move in two sub-steps per tick. After each, for every blocking edge of the current sector and its neighbours that the circle overlaps, push the circle out along the edge's normal and remove the velocity component into the wall, so the player slides along it.
- **Changing sector.** When the centre crosses a portal edge, the current sector becomes that neighbour. Re-check with a point-in-convex-polygon test against the neighbours if the centre is ever outside the current sector.
- **Things.** The player collides with enemies (circles) but walks through pickups, collecting them.

## 5. The renderer
A portal renderer over convex sectors, in the style of the classic sector engines, not a raycaster on a grid: walls sit at any angle, and every sector has its own floor and ceiling height.
1. **Setup per frame.** Make arrays `top[x] = 0` and `bottom[x] = 199` for the 320 columns, and `wallDepth[x] = ∞`. Push `{sector: player's sector, x1: 0, x2: 319}` onto a queue. Count renders per sector and stop at 32, so a loop of portals cannot hang the frame.
2. **Per wall** of the sector being drawn (edge from vertex a to vertex b): transform both ends into view space, with depth = dx·cos θ + dy·sin θ and side = dx·sin θ − dy·cos θ, where (dx, dy) is the vertex minus the player position. Skip the wall if both ends have depth below 0.05. If one end does, clip the segment to depth = 0.05, keeping track of how far along the wall the cut lies for texturing.
3. **Projection.** With focal length f = 160 (a 90° field of view at 320 px), column = 160 + side·f/depth. A wall whose first column is not left of its last faces away: skip it. Clamp the wall's columns to the current queue item's x1..x2.
4. **Heights.** For each column, interpolate 1/depth linearly across the wall (perspective-correct), and compute the ceiling row = 100 − (ceil − eyeZ)·f/depth and the floor row = 100 − (floor − eyeZ)·f/depth, clamped to that column's top and bottom.
5. **Ceiling and floor.** Fill from `top[x]` to the ceiling row with this sector's ceiling, and from the floor row to `bottom[x]` with its floor. Both are textured by floor casting: for screen row y, the distance is (height difference)·f / |y − 100|, and the world point is the player position plus that distance along the ray through column x; sample the 64 × 64 texture at 1 texture per 2 m.
6. **Solid walls.** Draw the textured wall from the ceiling row to the floor row and set `wallDepth[x]`. Texture u = distance along the wall from vertex a (perspective-correct via the interpolated 1/depth), at 1 texture per 2 m; v runs from the ceiling height down.
7. **Portals.** Compute the neighbour's ceiling and floor rows. If the neighbour's ceiling is lower, draw an upper wall between the two ceiling rows; if its floor is higher, draw a lower wall between the two floor rows. Then narrow `top[x]` and `bottom[x]` to the opening, and queue the neighbour with this wall's clamped column range. A door is a sector whose ceiling moves, so it draws itself through this same rule.
8. **Light.** Each pixel's colour is multiplied by shade = sector light × clamp(1 − depth/24, 0.15, 1), and further by 0.85 for walls that run north–south, so corners read. Flickering sectors (§7) change their light.
9. **Sprites.** After the world, project every visible thing: column = 160 + side·f/depth, size = world height·f/depth, with its base on its sector's floor. Draw them far to near, column by column, only where the thing is nearer than `wallDepth[x]` and within the top/bottom limits recorded for the sector it stands in. Transparent pixels are skipped.
10. **The weapon** is drawn last, over the view, from its own sprite sheet.

## 6. Levels
The data below is exact; load it as given. Each sector is a convex polygon listed counter-clockwise; `neighbors[i]` belongs to the edge from `verts[i]` to `verts[i+1]` (wrapping), with −1 for a solid wall. Things are placed by position; work out each thing's sector from it. Angles in the data are in degrees.

**Level 1, "Pump Hall."** Up the service stairs, across the turbine gallery, up the lift to the amber keycard, and through the amber door to the control room.
```level
{
  "name": "Pump Hall",
  "vertices": [[0,0],[8,0],[8,6],[5,6],[3,6],[0,6],[5,10],[3,10],[5,11],[3,11],[5,12],[3,12],[5,13],[3,13],[-1,15],[1,13],[7,13],[9,15],[9,19],[7,21],[5,21],[3,21],[1,21],[-1,19],[-5,15],[-5,19],[11,15],[11,19],[15,15],[15,19],[5,21.5],[3,21.5],[1,21.5],[7,21.5],[7,27],[1,27]],
  "sectors": [
    {"id": 0, "name": "Intake", "floor": 0, "ceil": 4, "light": 0.85, "verts": [0, 1, 2, 3, 4, 5], "floorTex": "grate", "ceilTex": "panel", "wallTex": "rivet", "neighbors": [-1, -1, -1, 1, -1, -1]},
    {"id": 1, "name": "Service corridor", "floor": 0, "ceil": 3, "light": 0.6, "verts": [4, 3, 6, 7], "floorTex": "concrete", "ceilTex": "pipes", "wallTex": "tile", "neighbors": [0, -1, 2, -1]},
    {"id": 2, "name": "Stair 1", "floor": 0.4, "ceil": 4.2, "light": 0.6, "verts": [7, 6, 8, 9], "floorTex": "step", "ceilTex": "pipes", "wallTex": "tile", "neighbors": [1, -1, 3, -1]},
    {"id": 3, "name": "Stair 2", "floor": 0.8, "ceil": 4.2, "light": 0.65, "verts": [9, 8, 10, 11], "floorTex": "step", "ceilTex": "pipes", "wallTex": "tile", "neighbors": [2, -1, 4, -1]},
    {"id": 4, "name": "Stair 3", "floor": 1.2, "ceil": 4.2, "light": 0.7, "verts": [11, 10, 12, 13], "floorTex": "step", "ceilTex": "pipes", "wallTex": "tile", "neighbors": [3, -1, 5, -1]},
    {"id": 5, "name": "Turbine gallery", "floor": 1.2, "ceil": 6, "light": 0.9, "verts": [14, 15, 13, 12, 16, 17, 18, 19, 20, 21, 22, 23], "floorTex": "grate", "ceilTex": "girder", "wallTex": "rivet", "flicker": false, "neighbors": [-1, -1, 4, -1, -1, 7, -1, -1, 9, -1, -1, 6]},
    {"id": 6, "name": "Coolant alcove", "floor": 0.8, "ceil": 3.2, "light": 0.45, "verts": [24, 14, 23, 25], "floorTex": "coolant", "ceilTex": "panel", "wallTex": "rust", "type": "hazard", "damage": 10, "neighbors": [-1, 5, -1, -1]},
    {"id": 7, "name": "Lift", "floor": 1.2, "ceil": 6, "light": 0.8, "verts": [17, 26, 27, 18], "floorTex": "lift", "ceilTex": "girder", "wallTex": "hazard", "type": "lift", "liftTop": 2.4, "neighbors": [-1, 8, -1, 5]},
    {"id": 8, "name": "Valve ledge", "floor": 2.4, "ceil": 6, "light": 0.75, "verts": [26, 28, 29, 27], "floorTex": "grate", "ceilTex": "girder", "wallTex": "rivet", "neighbors": [-1, -1, -1, 7]},
    {"id": 9, "name": "Amber door", "floor": 1.2, "ceil": 4.2, "light": 0.7, "verts": [21, 20, 30, 31], "floorTex": "concrete", "ceilTex": "door", "wallTex": "doorframe", "type": "door", "key": "amber", "neighbors": [5, -1, 10, -1]},
    {"id": 10, "name": "Control room", "floor": 1.2, "ceil": 4, "light": 0.95, "verts": [32, 31, 30, 33, 34, 35], "floorTex": "tile", "ceilTex": "panel", "wallTex": "console", "neighbors": [-1, 9, -1, -1, -1, -1]}
  ],
  "things": [
    {"type": "player", "x": 4, "y": 2, "angle": 90},
    {"type": "ammo", "x": 6.5, "y": 1.5, "amount": 20},
    {"type": "crawler", "x": 4, "y": 8.5},
    {"type": "sentry", "x": 6, "y": 18},
    {"type": "crawler", "x": 1, "y": 16},
    {"type": "health", "x": 0.5, "y": 17, "amount": 25},
    {"type": "scattergun", "x": -3.5, "y": 17},
    {"type": "armor", "x": -4.3, "y": 15.7, "amount": 50},
    {"type": "sentry", "x": 13.5, "y": 18.5},
    {"type": "key", "x": 14, "y": 16, "key": "amber"},
    {"type": "ammo", "x": 12, "y": 16, "amount": 8},
    {"type": "crawler", "x": 2.5, "y": 24},
    {"type": "crawler", "x": 5.5, "y": 25},
    {"type": "exit", "x": 4, "y": 26.5}
  ]
}```
**Level 2, "Furnace Ring."** Through the crusher, around a solid furnace core, into the coolant channel for the crimson keycard, the armory for the cobalt one, and out through the cobalt door. A push-wall in the arrival room's west wall hides a closet with a megahealth.
```level
{
  "name": "Furnace Ring",
  "vertices": [[0,0],[6,0],[6,6],[4,6],[2,6],[0,6],[0,4],[0,2],[-0.5,2],[-0.5,4],[-4,2],[-4,4],[4,8],[2,8],[4,9.5],[2,9.5],[4,14],[2,14],[-3,14],[9,14],[5,18],[1,18],[9,18],[9,22],[9,26],[5,22],[4,26],[2,26],[-3,26],[1,22],[-3,22],[-3,18],[-9,18],[-9,22],[9.5,18],[9.5,22],[15,18],[15,22],[4,26.5],[2,26.5],[0,26.5],[6,26.5],[6,32],[0,32]],
  "sectors": [
    {"id": 0, "name": "Arrival", "floor": 0, "ceil": 4, "light": 0.8, "verts": [0, 1, 2, 3, 4, 5, 6, 7], "floorTex": "grate", "ceilTex": "panel", "wallTex": "rivet", "neighbors": [-1, -1, -1, 3, -1, -1, 1, -1]},
    {"id": 1, "name": "Secret panel", "floor": 0, "ceil": 3, "light": 0.5, "verts": [8, 7, 6, 9], "floorTex": "concrete", "ceilTex": "door", "wallTex": "rivet", "type": "door", "secret": true, "neighbors": [-1, 0, -1, 2]},
    {"id": 2, "name": "Secret closet", "floor": 0, "ceil": 3, "light": 0.35, "verts": [10, 8, 9, 11], "floorTex": "tile", "ceilTex": "panel", "wallTex": "rust", "secret": true, "neighbors": [-1, 1, -1, -1]},
    {"id": 3, "name": "Passage south", "floor": 0, "ceil": 3, "light": 0.6, "verts": [4, 3, 12, 13], "floorTex": "concrete", "ceilTex": "pipes", "wallTex": "tile", "neighbors": [0, -1, 4, -1]},
    {"id": 4, "name": "Crusher", "floor": 0, "ceil": 3, "light": 0.55, "verts": [13, 12, 14, 15], "floorTex": "hazard", "ceilTex": "crusher", "wallTex": "hazard", "type": "crusher", "damage": 40, "period": 4, "neighbors": [3, -1, 5, -1]},
    {"id": 5, "name": "Passage north", "floor": 0, "ceil": 3, "light": 0.6, "verts": [15, 14, 16, 17], "floorTex": "concrete", "ceilTex": "pipes", "wallTex": "tile", "neighbors": [4, -1, 6, -1]},
    {"id": 6, "name": "South ring", "floor": 0, "ceil": 7, "light": 0.85, "verts": [18, 17, 16, 19, 20, 21], "floorTex": "grate", "ceilTex": "girder", "wallTex": "furnace", "neighbors": [-1, 5, -1, 7, -1, 9]},
    {"id": 7, "name": "East ring", "floor": 0, "ceil": 7, "light": 0.75, "verts": [19, 22, 23, 24, 25, 20], "floorTex": "grate", "ceilTex": "girder", "wallTex": "furnace", "neighbors": [-1, 11, -1, 8, -1, 6]},
    {"id": 8, "name": "North ring", "floor": 0, "ceil": 7, "light": 0.7, "verts": [24, 26, 27, 28, 29, 25], "floorTex": "grate", "ceilTex": "girder", "wallTex": "furnace", "flicker": true, "neighbors": [-1, 13, -1, 9, -1, 7]},
    {"id": 9, "name": "West ring", "floor": 0, "ceil": 7, "light": 0.75, "verts": [28, 30, 31, 18, 21, 29], "floorTex": "grate", "ceilTex": "girder", "wallTex": "furnace", "neighbors": [-1, 10, -1, 6, -1, 8]},
    {"id": 10, "name": "Coolant channel", "floor": -0.6, "ceil": 3, "light": 0.4, "verts": [32, 31, 30, 33], "floorTex": "coolant", "ceilTex": "pipes", "wallTex": "rust", "type": "hazard", "damage": 10, "neighbors": [-1, 9, -1, -1]},
    {"id": 11, "name": "Crimson door", "floor": 0, "ceil": 3.5, "light": 0.6, "verts": [22, 34, 35, 23], "floorTex": "concrete", "ceilTex": "door", "wallTex": "doorframe", "type": "door", "key": "crimson", "neighbors": [-1, 12, -1, 7]},
    {"id": 12, "name": "Armory", "floor": 0.5, "ceil": 3.5, "light": 0.9, "verts": [34, 36, 37, 35], "floorTex": "tile", "ceilTex": "panel", "wallTex": "console", "neighbors": [-1, -1, -1, 11]},
    {"id": 13, "name": "Cobalt door", "floor": 0, "ceil": 3.5, "light": 0.6, "verts": [26, 38, 39, 27], "floorTex": "concrete", "ceilTex": "door", "wallTex": "doorframe", "type": "door", "key": "cobalt", "neighbors": [-1, 14, -1, 8]},
    {"id": 14, "name": "Exit chamber", "floor": 0, "ceil": 4, "light": 0.95, "verts": [40, 39, 38, 41, 42, 43], "floorTex": "tile", "ceilTex": "panel", "wallTex": "console", "neighbors": [-1, 13, -1, -1, -1, -1]}
  ],
  "things": [
    {"type": "player", "x": 3, "y": 2, "angle": 90},
    {"type": "health", "x": 1, "y": 5, "amount": 10},
    {"type": "megahealth", "x": -3, "y": 3, "amount": 100},
    {"type": "crawler", "x": 3, "y": 12},
    {"type": "sentry", "x": 7, "y": 15},
    {"type": "crawler", "x": 0.5, "y": 15.5},
    {"type": "brute", "x": 7.5, "y": 24},
    {"type": "crawler", "x": -2, "y": 24.5},
    {"type": "sentry", "x": 0, "y": 25},
    {"type": "ammo", "x": 6.5, "y": 16, "amount": 20},
    {"type": "shells", "x": -1.5, "y": 15, "amount": 8},
    {"type": "key", "x": -8, "y": 20, "key": "crimson"},
    {"type": "crawler", "x": -6, "y": 19},
    {"type": "crawler", "x": -6, "y": 21},
    {"type": "slag", "x": 13, "y": 19, "amount": 5},
    {"type": "slaglauncher", "x": 14, "y": 20},
    {"type": "key", "x": 12, "y": 21, "key": "cobalt"},
    {"type": "sentry", "x": 11, "y": 19},
    {"type": "brute", "x": 3, "y": 29},
    {"type": "sentry", "x": 1, "y": 31},
    {"type": "sentry", "x": 5, "y": 31},
    {"type": "exit", "x": 3, "y": 31.5}
  ]
}```

## 7. Sector behaviours
- **door:** starts closed, with its ceiling at its floor. E or Space within 1.5 m, facing it, raises the ceiling to its data ceiling at 2 m/s; it stays open 4 s, then closes at 2 m/s, and reopens if anything is beneath it. A door with `key` refuses until that key is held and shows "You need the <colour> keycard". A door with `secret` looks exactly like the wall around it (wall texture, no frame) and opens with E; finding it counts a secret.
- **lift:** its floor starts at its data floor. E while standing on it, or walking onto it from above when it is raised, moves it to `liftTop` over 1.5 s; it waits 3 s and returns. Movers on it ride with it.
- **crusher:** its ceiling cycles every `period` seconds: down to floor + 0.3 m over a third of the period, back up over a third, then waits. Anything beneath it while it is below 1.8 m takes `damage` per second, and it does not stop.
- **hazard:** standing on its floor costs `damage` health per second (armour does not help), with a green tint over the view.
- **flicker:** the light jumps between its value and 30% of it at random intervals of 0.05–0.4 s.
- **secret** sectors do not count towards "unreachable", and entering one counts the secret.

## 8. Enemies
All enemies are maintenance machines in the station's colours: no blood, they spark, smoke and come apart. Each has idle, walk (4 frames), attack (2 frames), pain and death (4 frames) animations and a wreck that stays on the floor, drawn from **8 directions**: choose the frame from the angle between the enemy's facing and the direction to the viewer, in 45° steps.

| Enemy | Health | Speed | Radius / height | Attack | Behaviour |
|---|---|---|---|---|---|
| **Crawler**, a spider-legged repair drone, yellow and black | 30 | 5 m/s | 0.3 / 0.6 m | bite, 8 damage, under 1 m, every 0.6 s | rushes straight at you, leaps the last 2 m |
| **Sentry**, a hovering ball turret with one lens | 60 | 2.5 m/s | 0.4 / 1.0 m, floats 1.2 m up | glowing bolt, 7 m/s, 15 damage, every 2 s | holds 6–12 m away, strafes sideways after each shot |
| **Brute**, a heavy loader with a slag hopper | 220 | 2 m/s | 0.7 / 2.2 m | slag ball, 9 m/s, 30 damage and a 2.5 m splash, every 3 s; slams for 25 under 1.5 m | advances steadily, never retreats |

- **Waking.** An enemy is idle until it sees the player (a line from its eyes to the player's eyes not crossing a solid wall, a closed door or a wall above the opening) within a 140° cone, or hears a shot in its sector or any sector within two portals. On waking it plays an alert chirp.
- **Chasing.** Move toward the target with the same collision and sliding as the player. If it makes no progress for 0.5 s, try 45° to the left or right for 0.6 s. Enemies use doors (they open unlocked ones) and lifts, but not keyed doors.
- **Pain.** Each hit has a chance to interrupt the enemy for 0.3 s: crawler 70%, sentry 40%, brute 10%.
- **Infighting.** Damage is always attributed to whoever caused it. An enemy hurt by an enemy of a **different** type turns on its attacker until one of them dies, then returns to the player. Bolts and slag balls hit whatever they meet first, including other enemies.
- **Difficulty** (chosen on the title screen) scales enemy damage by 0.6 / 1 / 1.4, and enemy health and fire rate by 0.8 / 1 / 1.2.

## 9. Weapons and ammunition
| Key | Weapon | Ammo | Fire | Damage | Notes |
|---|---|---|---|---|---|
| 1 | Rivet driver | rivets (1) | 3 per second | 10, hitscan | starting weapon, slight random spread 1° |
| 2 | Scattergun | shells (1) | 1 per second | 7 pellets × 6, hitscan, 8° spread | found in the Pump Hall coolant alcove |
| 3 | Arc repeater | rivets (1) | 10 per second | 8, hitscan, 2° spread | carried by the first sentry killed on Furnace Ring |
| 4 | Slag launcher | slag (1) | 1.2 per second | 80 direct + 60 splash over 3 m (falls off linearly) | projectile at 18 m/s; splash hurts the player too |

- Start with 50 rivets. Maximums: rivets 200, shells 50, slag 20. Pickups give the amount in the level data (or 10 rivets, 4 shells, 2 slag by default).
- Hitscan traces a ray from the eye along the view direction (plus spread) through the sectors and stops at the first solid wall or enemy. A hit on a wall shows a spark puff; a hit on an enemy shows sparks of its colour.
- Weapons switch with 1–4 or the mouse wheel; switching takes 0.3 s (down, then up). The weapon sprite bobs, kicks and flashes when fired, and the view kicks slightly for the scattergun and slag launcher.
- The mouse button or Ctrl fires; hold to keep firing.

## 10. Items
health (+10, or the data amount), megahealth (+100, up to 200), armour (+50, up to 100), keycards (amber, crimson, cobalt), the weapons, ammo. Items bob and spin slowly. Armour absorbs a third of damage until it runs out. The level-end tally counts kills, items and secrets as percentages, plus the time.

## 11. Art direction
Cold steel, sodium light, steam. A palette of greys and blue-greys lit by warm sodium orange, with hazard yellow, coolant green and keycard colours as the only saturated notes. Low resolution and readable: big, clear silhouettes.
- **Textures** (64 × 64, generated once into ImageData): `rivet` blue-grey plates with a rivet grid and edge highlights; `tile` off-white grimy tiles with dark grout; `rust` streaked orange-brown metal; `hazard` diagonal yellow/black stripes; `console` dark panels with small lit buttons and a faint screen glow; `furnace` dark brick with a red-orange glow along the mortar; `door` heavy shutter with horizontal ribs and a coloured stripe; `doorframe` steel with chevrons; floors `grate` (diamond mesh over darkness), `concrete`, `step` (concrete with a yellow nosing), `coolant` (green liquid, its pattern shifted every frame so it flows), `lift` (striped plate), `tile`, `hazard`; ceilings `panel`, `pipes`, `girder`, `crusher` (the underside of a press, hazard-striped).
- **Sprites**: built from simple shaded shapes into off-screen canvases at 2× and drawn at the projected size. Crawler: low yellow body, six jointed black legs, one red eye. Sentry: steel ball, a ring of lights, one large cyan lens that glows brighter before it fires. Brute: boxy orange loader with a hopper on its back and two arms; the hopper glows before it throws. Bolts are cyan glows; slag balls are orange with a trail.
- **View weapon**: drawn by the same method, large, at the bottom centre, lit by the sector's light.
- **Effects**: sparks, smoke puffs and a short screen shake on explosions. The screen flashes red when hurt (strength by damage), gold on pickups and white for the muzzle flash.

## 12. Sound
Everything synthesised with the Web Audio API through one master gain, started on the first click. M mutes; the setting persists.
- Rivet driver: a short bright noise burst with a metallic ping. Scattergun: a deep noise boom with a low thump. Arc repeater: a rapid electric crackle. Slag launcher: a heavy thunk; the explosion is low noise with a long tail.
- Crawler: skittering clicks while moving and a shriek on alert. Sentry: a rising whine before each bolt and a hum for the bolt in flight. Brute: heavy servo steps and a roar.
- Doors and lifts: a motor hum that starts and stops with them. Crushers: a slow grind and a thud. Pickups: a short bright blip, weapons a chord. Pain: a grunt-like filtered noise. Hazard floors: a sizzle.
- Sounds from the world are panned and attenuated by angle and distance to the listener.
- Ambient: a low station drone and distant water.

## 13. Screens and HUD
- **Title**: "COLDIRON STATION" in a stencilled steel style over a slow fly-through of Pump Hall; New game (difficulty: Apprentice, Engineer, Chief), Controls, Mouse sensitivity, Volume. Arrow keys and Enter, or the mouse.
- **HUD bar** (the bottom 32 px of the 320 × 200 view): health, armour, current ammo with the weapon's icon, ammo totals, the three keycards (grey until held), and a status light that is green above 60 health, orange above 25 and red below. Messages ("Picked up the scattergun", "You need the crimson keycard", "A secret!") appear top left for 2 s.
- **Automap**: Tab toggles a top-down map of the sectors the player has seen, drawn in lines: solid walls bright, steps dim, doors in their key colour. The player is an arrow, the map rotates so up is the player's facing, and + and − zoom.
- **Pause**: Esc or P, with Resume, Restart level, Quit to title.
- **Level end**: using the exit switch shows the tally screen with kills, items, secrets and time, then the next level. After Furnace Ring, a short closing text screen and the total.
- **Death**: the view drops to the floor and tints red, then "SYSTEMS DOWN — press Enter to restart the level".

## 14. Two players
From the title screen, **Split-screen** starts a two-player game on one keyboard: the 320 × 200 buffer splits into two 160 × 200 views side by side, each with its own camera (f = 80) and a compact HUD. Player 1 uses W/S/A/D to move and strafe, Q/E to turn, F to fire, R to use and 1–4 to switch weapons. Player 2 uses the arrow keys to move and turn, Right Ctrl to fire, Right Shift to use, and 7–0 to switch. Choose **Co-op** (both start at the player start, 1.2 m apart; keys are shared; the level ends when either reaches the exit) or **Deathmatch** (no enemies; spawn at random items; first to 10 frags wins). Each player sees the other as a sprite: an engineer in a hi-vis suit, orange for player 1 and teal for player 2, with 8 directions.

## 15. Configuration and debug
`src/config.js` defines one `CONFIG` object holding every number in this document: movement, collision, renderer, light, every enemy and weapon value, timings, difficulty multipliers and colours. Nothing else hard-codes these values. `?debug` in the URL shows the frame rate; the player's sector, position, angle in degrees, eyeZ and velocity; and a top-down mini-map with every sector outlined, the current one filled, the view cone, and each enemy's state and target.

## 16. Build order
Work in this order. At the end of each stage the game must load and be playable, so test each stage before starting the next.
1. **Camera, movement and renderer:** the level loader, the exact movement of §3, collision and sector changes, and the portal renderer with flat-coloured walls, floors and ceilings. Check it with `?debug`. *Playable: walk around Pump Hall, up the stairs, and fall off ledges.*
2. **Surfaces and the world:** procedural textures on walls, textured floors and ceilings, light and distance shading, doors, the lift and the hazard floor. *Playable: the whole of Pump Hall can be explored and the amber door works.*
3. **First fights:** the rivet driver, hitscan, the crawler and sentry with their sprites (8 directions), waking, chasing, pain and death, the HUD, pickups, dying and restarting. *Playable: Pump Hall as a real level.*
4. **The full arsenal:** the scattergun, arc repeater and slag launcher with splash, the brute, infighting, armour, the exit and the level tally. *Playable: a complete level with every system.*
5. **Furnace Ring:** the second level with the crusher, flickering light, the secret push-wall, two keycards and the closing screen. *Playable: the whole campaign.*
6. **Presentation and polish:** title screen and menus, difficulty, sound for everything, the automap, effects, and split-screen co-op and deathmatch.

## 17. Acceptance tests
The game is done when every one of these is true:
1. It loads with no console errors and runs at 60 fps on a desktop, scaled to the window with crisp pixels.
2. W moves the view straight ahead in the direction it faces and D slides it directly to the right; turning with the mouse right turns the view right; movement and turning speed are the same at 30 and 144 fps.
3. Walking diagonally (W+D) is no faster than walking forward.
4. With `?debug`, θ reads 90° at the start of Pump Hall and the view looks north up the service corridor.
5. Walls at angles (the turbine gallery's corners) render straight, with no gaps, flicker or walls showing through each other, from any position and angle, including when standing against a wall.
6. The three stairs show three lower walls and can be climbed; the valve ledge (1.2 m above the gallery) cannot be climbed, but the lift reaches it.
7. Sliding along a wall at a shallow angle keeps moving instead of sticking.
8. The amber door refuses without the keycard and opens with it; doors close by themselves and reopen if blocked.
9. Enemies are hidden behind walls and corners column by column, and show the correct one of their 8 views as you circle them.
10. A sentry's bolt that hits a brute makes the brute turn on the sentry.
11. The slag launcher's splash hurts enemies around the impact, and the player if they fire it at their feet.
12. The crusher hurts and the coolant floors hurt; the secret closet is found by pressing E on the arrival room's west wall, and the tally counts it.
13. Tab shows the automap of the sectors seen so far, rotating with the player.
14. Split-screen gives two independent, correctly moving views.
