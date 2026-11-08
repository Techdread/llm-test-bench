Build **Lantern Burrow**, an original maze-chase arcade game inspired by Pac-Man, as a multi-file web game. This is a full design document: build what it specifies, use its numbers, and work through the build order so that the game is playable at the end of every stage. If you run short of budget, finish the stage you are on cleanly rather than starting the next.

## 1. Pitch
Pip, a mole with a miner's lantern, gathers glow-seeds through three underground burrows while four beetles hunt her. A sunberry turns the tables for a few seconds. The fun is reading four different pursuers at once and steering them with your route: cornering cleanly, baiting one beetle away, and saving sunberries for when the beetles crowd close.

## 2. Technical frame
- Files: `index.html`, `style.css`, and classic `<script>` files in `src/`, loaded in this order: `config.js`, `mazes.js`, `audio.js`, `input.js`, `entities.js`, `ai.js`, `render.js`, `game.js`, `main.js`. No ES modules, no libraries, no external files.
- One `<canvas>`. Logical size 19 × 24 tiles at 24 px per tile (456 × 576): 2 tile rows of HUD on top, 21 rows of maze, 1 row of lives and fruit below. Scale by the largest whole number that fits the window, by sizing the canvas to the scaled size and scaling the drawing context, so shapes stay crisp instead of being stretched.
- A fixed-timestep update at 120 Hz with an accumulator, rendering every animation frame. All speeds are in tiles per second and must be frame-rate independent.
- Keep logical tile positions separate from drawn pixel positions. Derive `ROWS = maze.length` and `COLS = maze[0].length`; never hard-code them.
- Pause automatically when the tab loses focus.

## 3. Mazes
Each maze is 19 × 21 tiles. `#` wall, `.` glow-seed, `o` sunberry, `P` Pip's start (no seed), `-` nest gate, `N` nest interior, space = empty corridor (no seed). A row whose edge tiles are open is a tunnel: leaving one side enters the other. Beetles start at nest centre (Rook on the tile above the gate, outside). Use the mazes exactly as given.

**Maze 1, "Root Cellar"** (levels 1–2): 140 seeds, tunnel on row 9.
```maze
###################
#o.......#.......o#
#.##.###.#.###.##.#
#.##.#.......#.##.#
#....#.#####.#....#
####.#...#...#.####
####.###.#.###.####
####.#       #.####
####.# ##-## #.####
    .  #NNN#  .    
####.# ##### #.####
####.#       #.####
####.# ##### #.####
#........#........#
#.##.###.#.###.##.#
#o.#.....P.....#.o#
##.#.#.#####.#.#.##
#....#...#...#....#
#.######.#.######.#
#.................#
###################
```
**Maze 2, "Cricket Hollow"** (levels 3–5): 151 seeds, tunnels on rows 7 and 17.
```maze
###################
#o..#.........#..o#
#.#.#.###.###.#.#.#
#.#...#.....#...#.#
#.###.#.###.#.###.#
#.................#
###.#.#######.#.###
   .#         #.   
###.## ##-## ##.###
#...## #NNN# ##...#
#.#.## ##### ##.#.#
#.#.#         #.#.#
#.#.#.#######.#.#.#
#.................#
#.###.#.###.#.###.#
#o..#.#..P..#.#..o#
###.#.#.###.#.#.###
   ...#.....#...   
###.####.#.####.###
###.............###
###################
```
**Maze 3, "Glowcap Deep"** (levels 6 and up, then alternating 2 and 3): 160 seeds, tunnel on row 7.
```maze
###################
#o..##.......##..o#
#.#.##.#.#.#.##.#.#
#.#....#...#....#.#
#...##.#.#.#.##...#
###.#.........#.###
###.#.#######.#.###
   .#         #.   
###.## ##-## ##.###
#...## #NNN# ##...#
#.#.## ##### ##.#.#
#.#.#         #.#.#
#.#.#.#######.#.#.#
#...#.........#...#
#.#...##.#.##...#.#
#o#.#....P....#.#o#
#.#.#.##.#.##.#.#.#
#...#.........#...#
#.###.#######.###.#
#.................#
###################
```
Corner targets for patrol mode, in tile coordinates (column, row), are just outside the maze so beetles circle the nearest block: Rook (20, −1), Wisp (−2, −1), Tumble (20, 22), Dozer (−2, 22).

## 4. Characters
**Pip** (player). Round body, grey-violet #4a4250, lighter belly #6d6478, pink nose #ff8fa3 pointing the way she faces, two front claws that paddle while moving (4-frame cycle, 10 frames per second), a small brass lantern #d9a441 with a soft radial glow (#ffd76a at 25% alpha, radius 1.5 tiles). The glow is decoration only: the whole maze is always visible. Facing changes instantly; the body squashes 10% on each turn for one frame.

**Beetles.** Each is 22 px, with six legs in a two-frame walk and eyes that look in the direction of travel. The silhouette, not only the colour, tells them apart:
| Beetle | Colour | Silhouette | Personality, in hunt mode |
|---|---|---|---|
| Rook | #e0483e | stag beetle: big forward pincers | targets Pip's tile |
| Wisp | #f28cc8 | slim firefly: glowing tail pulsing #fff3a0 | targets 4 tiles ahead of Pip's facing |
| Tumble | #3fb8a8 | dung beetle pushing a small ball | takes the tile 2 ahead of Pip, then doubles the vector from Rook to it; targets that point |
| Dozer | #f0a030 | round ladybird with black spots | targets Pip's tile while more than 8 tiles away (straight line), otherwise its patrol corner |

**Dazzled beetle:** body #9ad0ff, eyes become small worried dots, legs scramble at double rate. For the last 2 seconds of the dazzle it flashes between #9ad0ff and #ffffff every 0.2 s, more urgently from the last 0.6 s.
**Eyes:** a caught beetle is only its two eyes, which travel back to the nest at 12 tiles per second, enter through the gate, and revive at nest centre after 1 s.

## 5. Movement rules
- Entities sit on tile centres and move along corridors. Pip can reverse at any time; other turns are taken only at a tile centre.
- Input buffering: the last direction pressed is held for 0.3 s and applied at the first tile centre where that direction is open. Holding a key keeps it buffered indefinitely.
- Pip slows by 10% on a tile that still has a seed (she stops to gather it). Beetles move at half speed in tunnel rows beyond the outer walls.
- Collision between Pip and a beetle is checked twice per update, before and after moving, using distance between centres below 0.6 tiles, so fast entities can never pass through each other.
- Beetle steering: at each tile centre, list the open directions except straight back (the gate is open only to beetles leaving the nest or eyes returning). Choose the one whose next tile is closest to the target in straight-line distance; break ties in the order up, left, down, right. In patrol and hunt mode, beetles may not turn up from row 7 between columns 7 and 11 (the corridor just above the nest gate); this gives Pip a safer lane there. Dazzled beetles and eyes ignore this rule.
- Dazzled beetles pick uniformly at random among the allowed directions, from a seeded random generator (seed in config) so a run can be replayed.

## 6. Modes and timing
Beetles share one mode clock that pauses while they are dazzled. Each switch between patrol and hunt reverses every beetle outside the nest once; entering dazzle also reverses them. Leaving dazzle does not.

| Levels | Patrol | Hunt | Patrol | Hunt | Patrol | Hunt | Patrol | Hunt |
|---|---|---|---|---|---|---|---|---|
| 1 | 7 | 20 | 7 | 20 | 5 | 20 | 5 | forever |
| 2–4 | 7 | 20 | 7 | 20 | 5 | 60 | 1 | forever |
| 5+ | 5 | 20 | 5 | 20 | 5 | 60 | 1 | forever |

**Rook's temper:** when 20 seeds remain, Rook gains 5% speed; at 10 remaining, another 5%, and from then on he hunts even during patrol. His temper ends if Pip loses a life, until the remaining beetles have all left the nest again.

**Nest release:** Rook starts outside. Wisp leaves immediately. Tumble leaves after 30 seeds (level 1), 0 from level 2. Dozer leaves after 60 seeds (level 1), 50 (level 2), 0 from level 3. After a lost life, a shared counter releases them at 7, 17 and 32 seeds. In every case, if Pip eats nothing for 4 s (3 s from level 5), the next beetle leaves. Waiting beetles bob up and down in the nest.

## 7. Difficulty table
Speeds in tiles per second. Dazzle in seconds; "flash" is the last part of it.
| Level | Pip | Beetles | Dazzled | Tunnel | Dazzle | Flash | Bonus mushroom (points) |
|---|---|---|---|---|---|---|---|
| 1 | 6.0 | 5.6 | 3.0 | 2.8 | 6 | 2 | Button cap (100) |
| 2 | 6.4 | 6.0 | 3.2 | 3.0 | 5 | 2 | Chanterelle (300) |
| 3–4 | 6.6 | 6.3 | 3.3 | 3.1 | 4 | 2 | Morel (500) |
| 5–6 | 6.8 | 6.6 | 3.4 | 3.3 | 3 | 1.5 | Truffle (700) |
| 7–8 | 7.0 | 6.9 | 3.5 | 3.4 | 2 | 1 | Glowcap (1000) |
| 9–11 | 7.0 | 7.0 | 3.5 | 3.5 | 1 | 0.6 | Moon morel (2000) |
| 12+ | 7.0 | 7.0 | — | 3.5 | 0 | 0 | Star truffle (5000) |
From level 12 a sunberry still scores 50 and reverses the beetles but does not dazzle them.

## 8. Scoring, lives, items
- Glow-seed 10. Sunberry 50. Dazzled beetles caught on one sunberry: 200, 400, 800, 1600; the value floats up from the catch point for 1 s, and the game freezes for 0.5 s on each catch (Pip hidden, beetle replaced by the number).
- A bonus mushroom appears below the nest gate (row 11, column 9) when 50 and again when 110 seeds have been eaten, for a random 9–10 s. The last seven levels' mushrooms are drawn in the bottom row.
- Three lives at the start; one extra life at 10,000 points only. Lives are drawn as small Pips in the bottom row.
- High score: the best five scores with three-letter initials in localStorage (`lantern-burrow-scores`). Initials are entered with arrow keys (up/down change a letter, right/Enter move on).

## 9. Game flow
State machine: `TITLE → READY → PLAYING ⇄ PAUSED`; `PLAYING → CAUGHT → READY` (or `GAME_OVER`); `PLAYING → CLEAR → (INTERMISSION) → READY`; `GAME_OVER → INITIALS → TITLE`.
- **Title:** the game name in large warm-yellow letters, the four beetles walking across with their names and colours, controls, the top-five table, "Press Enter".
- **Ready:** maze shown, "READY!" in yellow under the nest for 2 s (4 s with the start jingle at the very start of a game); nothing moves.
- **Caught:** everything freezes for 1 s, beetles vanish, Pip curls up and spins down into the soil over 1.5 s with the falling sound, then READY (or game over when no lives remain).
- **Clear:** freeze for 1 s, then the walls flash between their colour and #f4e6c8 four times over 2 s.
- **Intermissions** after levels 2 and 5, 6–8 s each, skippable with Enter: (1) Rook chases Pip across the screen, Pip comes back the other way chasing a dazzled Rook with an enormous lantern; (2) Wisp's glowing tail goes out halfway across, and she runs back in a panic.
- **Pause:** P or Esc; dim the screen and show "PAUSED", with "M mute" and "Esc resume".
- **Game over:** "GAME OVER" in red under the nest for 3 s, then initials entry if the score qualifies.

## 10. Art direction
A cosy, warm underground at night: earthy browns, lantern yellows, readable at a glance. Everything drawn with canvas paths, no image files.
- Background #1b1410 with a faint noise of slightly lighter soil specks (#241a14), generated once into an off-screen canvas.
- Walls: draw the outline of each connected wall region with rounded corners (radius 6 px), fill #6b4a2f, a 2 px inner edge #a8784a on the top and left sides, and a few roots (#8a6440, 1 px curves) that hang from wall edges at seeded positions. Cache the walls in an off-screen canvas; redraw only for the clear flash.
- Glow-seeds: 3 px #ffd76a dots with a 6 px glow at 20% alpha. Sunberries: 9 px #ff9a3c berries with a leaf, pulsing in size ±15% twice a second.
- Nest: a darker chamber (#120d0a) with a gate drawn as a woven root bar (#c49a6c).
- HUD: score and "HIGH SCORE" in a chunky rounded font (system `ui-rounded`, falling back to sans-serif), warm white #f4e6c8; the current mode label (PATROL / HUNT / DAZZLED) in a small pill at top right, coloured green, red and blue.
- Everything should read clearly at the smallest scale: never rely on colour alone.

## 11. Sound
All sounds synthesised with the Web Audio API through one master gain; M toggles mute and the setting persists. Start the audio context on the first key press.
- Seed: alternate two short square blips (A5 then E5, 40 ms each).
- Sunberry: low sine whoosh sweeping 200 → 90 Hz over 0.3 s.
- Dazzled: a soft looping two-note triangle warble while any beetle is dazzled.
- Catch: rising four-note arpeggio, faster for each catch in a row.
- Eyes returning: a quick high pulsing tone while any eyes are travelling.
- Caught: a falling slide from 600 to 80 Hz over 1.2 s, then two thumps.
- Extra life: a bright three-note chime.
- Start jingle (original): a short, cheerful eight-note melody, about 4 s, two voices.
- Background: a quiet low hum whose pitch rises as fewer seeds remain.

## 12. Configuration
`src/config.js` defines one `CONFIG` object holding every number in this document: speeds, the difficulty and mode tables, scores, release counts, timings, colours, the random seed and the 0.3 s turn buffer. Nothing else hard-codes these values. Append `?debug` to the URL to show each beetle's target tile as a coloured cross, its mode, and the frame rate.

## 13. Build order
Work in this order. At the end of each stage the game must load and be playable, so test each stage before starting the next.
1. **Maze and movement:** canvas scaling, the maze from data, Pip with buffered turns and tunnels, seeds and score. *Playable: a seed-gathering toy.*
2. **First hunter:** Rook with target steering, collision, lives, CAUGHT and READY states, game over and restart. *Playable: a chase.*
3. **All four beetles:** Wisp, Tumble and Dozer targets, patrol corners, the mode table with reversals, nest release rules. *Playable: the real game on one maze.*
4. **Turning the tables:** sunberries, dazzle with flashing, catch chain scoring, eyes returning, clear flash, levels and the difficulty table, Rook's temper. *Playable: the full rule set.*
5. **Presentation:** title, pause, game over, initials and top-five table, all sounds, HUD mode pill. *Playable: a complete arcade game.*
6. **Content and polish:** mazes 2 and 3 in the level schedule, bonus mushrooms, extra life, intermissions, roots and soil texture, `?debug` overlay.

## 14. Acceptance tests
The game is done when every one of these is true:
1. It loads with no console errors, and the canvas scales to the window without blurring.
2. Pip turns into a side corridor when the turn is pressed up to 0.3 s before the junction.
3. Pip never enters a wall, and the beetles never cross the nest gate except when leaving or as eyes.
4. In the `?debug` view, the four beetles' targets are in four different places in hunt mode and at the four corners in patrol mode.
5. Every beetle reverses at each mode switch, and the HUD pill changes.
6. With a stopwatch, the first patrol lasts 7 s on level 1.
7. Tumble and Dozer stay in the nest on level 1 until 30 and 60 seeds, or until Pip has eaten nothing for 4 s.
8. A sunberry turns all beetles outside the nest pale blue; they flash for the last 2 s and recover.
9. Four catches on one sunberry score 200, 400, 800 and 1600.
10. Caught beetles return to the nest as eyes and come out again.
11. Leaving through a tunnel brings Pip in on the other side, and beetles slow down inside it.
12. Clearing maze 1 twice leads to maze 2 on level 3, and Pip and the beetles are faster on each new level.
13. Losing the last life shows GAME OVER, and a qualifying score is entered and kept after reloading the page.
14. M mutes and P pauses; switching tabs pauses the game.
