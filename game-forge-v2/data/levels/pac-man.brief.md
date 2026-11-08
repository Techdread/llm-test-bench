Build **Lantern Burrow**, an original maze-chase arcade game inspired by Pac-Man, as a multi-file web game (index.html, style.css, src/*.js with classic script tags, Canvas 2D). This is a brief: every numbered requirement must work and be visible on screen, not just described in a comment. Keep to this scope: ONE maze, levels that repeat it with rising difficulty.

**The game.** Pip, a mole with a miner's lantern, gathers glow-seeds in an underground burrow while four beetles hunt her. Eating a sunberry dazzles the beetles so Pip can catch them. Clear every seed and sunberry to finish the level.

**Requirements**
1. **The maze is this exact grid** (19 × 21 tiles). Store it as an array of strings and derive ROWS and COLS from it. `#` wall, `.` glow-seed, `o` sunberry, `P` Pip's start, `-` nest gate (beetles only), `N` nest, space = empty corridor. Row 9 is a tunnel: leaving one side brings you in on the other.
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
2. **Movement on the grid.** Pip and the beetles move tile to tile with smooth tweening between tile centres and turn only at a centre. Arrow keys or WASD. A turn pressed early is remembered for 0.3 s and taken at the next opening, so cornering feels responsive. Pip stops at walls; she never overlaps one.
3. **Four beetles with different minds.** At every tile centre a beetle picks the open direction (never reversing) that brings it closest, in a straight line, to its target tile. Targets in hunt mode: **Rook** (red stag beetle) Pip's tile; **Wisp** (pink firefly) 4 tiles ahead of Pip; **Tumble** (teal dung beetle) the point that Rook's position mirrors through the tile 2 ahead of Pip; **Dozer** (amber ladybird) Pip's tile when more than 8 tiles away, otherwise its home corner. In patrol mode each heads for its own corner (Rook top-right, Wisp top-left, Tumble bottom-right, Dozer bottom-left).
4. **Patrol and hunt waves.** Beetles alternate: patrol 7 s, hunt 20 s, patrol 7 s, hunt 20 s, patrol 5 s, then hunt for good. Every switch reverses all beetles once. The current mode is shown as a small label in the HUD.
5. **The nest.** Rook starts outside, Wisp leaves at once, Tumble after 30 seeds, Dozer after 60. If Pip eats nothing for 4 s, the next beetle leaves anyway. Beetles leave and re-enter only through the gate.
6. **Sunberries.** Eating one dazzles every beetle outside the nest for 6 s: they turn pale blue, reverse, slow to half speed and wander randomly at junctions. They flash white for the last 2 s. Catching a dazzled beetle scores 200, 400, 800, 1600 in a row; it becomes a pair of eyes that races back to the nest and revives.
7. **Scoring and lives.** Seed 10, sunberry 50. Three lives; an extra life at 10,000. A beetle touching Pip costs a life, and everyone returns to their start after a short death animation. Score, high score, lives and level are always shown.
8. **Levels.** Clearing the maze flashes the walls four times and starts the next level, with these speeds in tiles per second: Pip 6.0 / beetles 5.6 / dazzle 6 s on level 1; 6.4 / 6.0 / 5 s on level 2; 6.6 / 6.3 / 4 s on level 3; then 6.8 / 6.6 / 3 s. Beetles move at half speed in the tunnel.
9. **Look.** Night underground, all drawn procedurally on the canvas at 24 px per tile: dark soil background #1b1410; walls as rounded packed-earth tunnels (fill #6b4a2f, edge #a8784a); glow-seeds as small warm-yellow dots (#ffd76a) with a soft glow; sunberries as pulsing orange berries (#ff9a3c). Pip is a round grey-violet mole (#4a4250) with a pink nose and a little lantern, and her claws animate as she moves. Each beetle has its own silhouette, not just its own colour (pincers, glowing tail, a ball, spots), with two-frame leg animation.
10. **Sound.** Synthesise every sound with the Web Audio API, with no files: alternating blips for seeds, a low whoosh for a sunberry, a warble while beetles are dazzled, a rising arpeggio for a catch, a falling slide when Pip is caught, and a short original jingle at the start. M toggles mute.
11. **Screens.** A title screen (name, controls, high score, "Press Enter"), READY! for 2 s before play, P or Esc to pause, and a game-over screen that keeps the best five scores in localStorage.
12. **Tuning in one place.** Every number above (speeds, timings, scores, release counts) lives in src/config.js, and the game reads it from there.

**Done when:** the game loads without console errors; Pip can clear the maze; each beetle visibly takes a different route; the tunnel wraps; a sunberry turns beetles blue and they flash before recovering; catching beetles in a row scores 200 to 1600; losing all lives shows game over; and the next level is faster.
