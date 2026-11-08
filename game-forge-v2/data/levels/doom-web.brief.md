Build **Coldiron Station**, an original first-person shooter inspired by Doom, as a multi-file web game (index.html, style.css, src/*.js with classic script tags, Canvas 2D, no libraries). This is a brief: every numbered requirement must work and be visible on screen. Keep to this scope: ONE level, two enemy types, two weapons. The player is the night engineer of a flooded geothermal pump station whose maintenance machines have turned hostile.

**Requirements**
1. **The level is this exact data.** Units are metres. x points east, y points north, z points up. Each sector is a convex polygon with its vertices listed counter-clockwise, its own floor and ceiling height, and a light level from 0 to 1. `neighbors[i]` belongs to the edge from `verts[i]` to `verts[i+1]` (wrapping): −1 is a solid wall, otherwise the edge is an open portal into that sector. `type` is `door` (keyed with `key`), `lift` (floor rises to `liftTop`) or `hazard` (`damage` per second while standing on it).
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
2. **Camera and movement, exactly.** The player has position (x, y), a sector, and an angle θ in radians: θ = 0 faces east and θ grows counter-clockwise, so θ = π/2 faces north. Forward is (cos θ, sin θ); right is (sin θ, −cos θ). W/S or ↑/↓ move along forward, A/D strafe along right, ←/→ turn at 2.6 rad/s, and the mouse turns while the pointer is locked (click the canvas to lock): moving the mouse right turns right, by 0.0022 rad per pixel. Walk at 4.5 m/s, run at 8 m/s with Shift, and normalise diagonal movement. Every speed is multiplied by the frame time, so movement and turning are the same at any frame rate. The eye is 1.6 m above the floor and eases up a step over 0.1 s instead of snapping.
3. **Collision.** The player is a circle of radius 0.35 m. An edge blocks if it is solid, if the floor beyond is more than 0.6 m higher, if the gap between the higher floor and lower ceiling is under 1.8 m, or if it leads into a closed door. Blocked movement slides along the wall rather than stopping dead. When the player's centre crosses a portal, their sector becomes the neighbour. Stepping off a ledge falls under gravity (18 m/s²).
4. **A sector renderer, not a raycaster.** Render into a 320 × 200 pixel buffer (ImageData) scaled up to fill the window with crisp pixels, at a horizontal field of view of 90° (focal length f = 160). Transform each vertex into view space: depth = dx·cos θ + dy·sin θ and side = dx·sin θ − dy·cos θ. Clip walls at depth 0.05 before projecting to column = 160 + side·f/depth and row = 100 − (z − eyeZ)·f/depth. Draw the player's sector, then each visible portal's sector clipped to that portal's columns, keeping a per-column top and bottom limit so nearer geometry hides farther geometry. For a portal, draw the upper wall where the next ceiling is lower and the lower wall where the next floor is higher (this is what makes stairs, ledges and the lift look right). Walls can sit at any angle.
5. **Surfaces and light.** Walls are textured with procedurally generated 64 × 64 textures (riveted plate, tiles, rust, hazard stripes, a console, a door), mapped by distance along the wall, perspective-correct, at 1 texture per 2 m. Floors and ceilings are flat colours per texture name. Everything is shaded by the sector's light times a distance falloff, clamped between 0.15 and 1 at 24 m, so corridors fade into the dark.
6. **Doors, the key and the lift.** E or Space within 1.5 m of a door opens it: its ceiling rises to the open height at 2 m/s, stays 4 s, then closes unless something is under it. The amber door shows "You need the amber keycard" until the key is picked up. Standing on the lift and pressing E raises it to 2.4 m over 1.5 s; it waits 3 s and lowers. The coolant alcove hurts 10 per second.
7. **Two enemy types.** **Crawler:** a spider-legged maintenance drone; 30 health; runs at 5 m/s, bites for 8 at under 1 m. **Sentry:** a hovering turret; 60 health; keeps 6–12 m away, fires a slow glowing bolt (7 m/s, 15 damage) every 2 s, which can be dodged. Both are billboard sprites drawn procedurally into off-screen canvases (idle, two walk frames, attack, pain, death and a wreck that stays on the floor). They are clipped by walls column by column and drawn far to near. Each wakes when it sees the player (a line of sight not blocked by solid walls or closed doors) or when a shot is fired in its sector or the next, then chases with wall sliding.
8. **Two weapons.** **Rivet driver** (key 1): hitscan, 10 damage, 3 shots a second, uses rivets. **Scattergun** (key 2, picked up in the coolant alcove): 7 hitscan pellets of 6 damage spread over 8°, one shot a second, uses shells (the pickup gives 8). The weapon is drawn at the bottom of the view, bobs as the player walks, and kicks with a muzzle flash when fired. A crosshair marks the centre.
9. **Pickups and HUD.** Health, armour, ammo and the key are spinning sprites collected by walking over them. Armour absorbs a third of incoming damage. The HUD bar shows health, armour, current ammo, the amber key when held, and a status light that turns orange, then red, as health falls. The screen flashes red when hurt and gold on a pickup.
10. **Win and lose.** Using the exit switch in the control room ends the level with a tally: kills, items, time. Dying shows "SYSTEMS DOWN — press Enter" and restarts the level.
11. **Sound.** Synthesise every sound with the Web Audio API, with no files: the rivet driver's crack, the scattergun's boom, enemy alert chirps, the crawler's skitter, the sentry's bolt hum, door and lift motors, pickups, pain and death. M mutes.
12. **Tuning in one place.** Every number above lives in src/config.js, and the game reads it from there. `?debug` shows the frame rate, the player's sector, position and angle, and a small top-down map of the level with the view cone.

**Done when:** it loads without console errors; W moves the view straight ahead in the direction it faces and D slides it to the right, at the same speed at 30 and 144 fps; the mouse turns the view smoothly after one click; the stairs, the raised ledge and the lift visibly change height and can be climbed, while the ledge cannot be reached without the lift; walls never vanish or show through each other when you turn near a corner; the amber door refuses without the key and opens with it; both enemy types hunt the player and can be killed; and reaching the exit shows the tally.
