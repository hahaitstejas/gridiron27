# Gridiron 27 — developer guide

Original browser-based 3D American football game (Three.js + Vite, plain JavaScript ES modules).
**No NFL / NFLPA / EA / Madden names, logos, teams or other IP anywhere** — all teams, players,
logos and branding are original or procedurally generated.

## Run / test

```bash
npm install          # once
npm run dev          # http://localhost:5173 (Chrome or Safari)
npm test             # Vitest unit tests (tests/*.test.js), headless
npm run sim -- --plays 1000 --seed 3   # headless CPU-vs-CPU play runner with invariant checks + stats
npm run bot          # scripted 'human' exploits (blind throws, QB scrambles, holding the ball) vs CPU defense
npm run build        # production build to dist/
```

URL flags (dev server):
- `?auto&speed=6` — CPU vs CPU in the browser, sim running 6x real time (debug).
- `?autostart` — skip the "Press A" screen. `?seed=N` — fixed RNG seed. `?home=9&away=28` — team indices.

Optional browser smoke test (needs Playwright: `npm i -D playwright && npx playwright install chromium`):
`node tools/smoke.mjs http://localhost:5173/ test-output` — drives offense, runs, defense and auto mode and
fails on console errors.

In-game: `H` toggles the controls panel, `` ` `` toggles the FPS / draw-call overlay.

## Architecture

The core rule: **simulation is pure logic and never touches Three.js or the DOM.** `src/core`, `src/sim`,
`src/ai`, `src/data`, `src/game` must stay importable from Node (the autosim and the tests depend on this).
Rendering (`src/render`), UI (`src/ui`), input and audio only *read* sim state.

- Fixed 60 Hz simulation step (`STEP` in `core/constants.js`); the renderer interpolates between ticks
  using each entity's `px/pz/pfacing` (previous tick) and `x/z/facing`.
- All randomness goes through the seeded `RNG` (`core/rng.js`). **Never use `Math.random()` in sim/ai/game
  code** — determinism is what makes the autosim reproducible and replays possible.
- Input edges (pressed/released/flick) are latched until a sim step consumes them, so taps aren't lost.

### Coordinates
World units are **yards**. `x` runs along the field (goal lines at x = ±50, end lines at ±60), `z` across it
(sidelines at ±26.67, hashes at ±3.08), `y` up. Each play has an offense direction `dir` (+1 attacks +x).
Plays and formations are authored in the **offense frame**: `[downfield, lateral]` relative to the ball,
lateral positive = offense's right. `PlaySim.toWorld(down, lat)` / `toLocal(x, z)` convert.
The human's stick maps relative to the camera direction `camDir` (camera sits behind the human's side).

### Play lifecycle (`sim/play.js` → `PlaySim`)
`presnap` → `snap()` → `live` → whistle → `dead` (1.6 s wind-down, then `finished`).
Each tick: ball update → offense AI → defense AI → human input → moves → blocking → integrate → collisions
→ tackles → rules (out of bounds, TD, safety, QB past LOS). `result` holds spot, yards, scoring, turnover
and stat attributions (passer, receiver, tackler…). `sim.events` lists what happened this tick (snap, throw,
catch, tackle, bigHit, brokenTackle, interception, touchdown…) for UI/audio.

Players carry a `task` (`route`, `pass_block`, `run_block`, `stalk`, `escort`, `carrier`, `qb_pass`,
`rush`, `man`, `zone`, `pursue`, `ball`, …) that the AI modules interpret. Ratings drive everything via
`sim.R(player, key)` (which also applies difficulty boosts).

## File layout

```
index.html, vite.config.js, package.json
src/main.js            boot + main loop (fixed-step sim, render, HUD)
src/core/              constants (field dims), rng (seeded), math helpers, event emitter
src/input/             gamepad.js (Xbox standard mapping, dead zones, rumble), keyboard.js (fallback),
                       actions.js (ControllerState with latched edges + RS flicks), input.js (manager, "Press A")
src/sim/               play.js (PlaySim), entities.js, movement.js (accel/agility steering, collisions),
                       blocking.js (engagements, shedding, pass-rush moves), passing.js (throws, flight,
                       catch/INT/deflection), tackling.js (tackles, broken tackles, ball-carrier moves),
                       human.js (controller → player), anim.js (animation state selection)
src/ai/                offense.js (QB drop/handoff, protection, run blocking, routes, escort), qb.js (reads),
                       carrier.js (lane finding + moves), defense.js (man matching, zones, rush, pursuit),
                       zones.js (zone landmarks)
src/game/drive.js      Phase 1 drive loop (downs/distance, resets). Replaced by full game state in Phase 2.
src/data/              teams.js (32 original teams), names.js, csv.js (roster CSV), localRoster.js, positions.js (ratings, templates, overall),
                       generator.js (players/rosters), depthChart.js, routes.js, playbook.js (loader + mirror),
                       playbooks/*.json (formations, offense, defense)
src/render/            renderer.js (WebGL, lights, adaptive pixel ratio), stadium.js, fieldTexture.js,
                       players.js (instanced low-poly players + procedural poses), camera.js, lines.js, logo.js
src/ui/                hud.js (connect screen, mini score bug, receiver icons, banners, help), style.css
tools/autosim.js       headless CPU-vs-CPU runner;  tools/humanbot.js  exploit checks;  tools/smoke.mjs  browser smoke test
tests/                 Vitest unit tests
```
Planned (later phases): `src/audio`, `src/replay`, `src/franchise`, more of `src/ui` (menus, play-call
screen, editors), `src/data/storage.js` + `csv.js`.

## Performance notes (target: 60 fps on an M3 MacBook Air, Chrome + Safari)
- Players are ~15 `InstancedMesh` draw calls total; posing uses a preallocated matrix pool (no per-frame GC).
- Crowd is one instanced mesh (~15k boxes) animated in the vertex shader; stands/walls/posts are merged.
- One shadow-casting directional light (2048 map) that follows the ball.
- `GameRenderer.adapt()` lowers the pixel ratio if average frame time > 18.5 ms and raises it back when idle.
- Measured: ~0.4 ms JS per frame (sim + pose), ~45 draw calls, ~240k triangles.

## Data formats

### Ratings
0–99. Keys (CSV short code): speed SPD, acceleration ACC, agility AGI, strength STR, awareness AWR,
catching CTH, carrying CAR, breakTackle BTK, throwPower THP, throwAccuracy THA, runBlock RBK, passBlock PBK,
passRush PRS, blockShed BSH, tackling TAK, hitPower POW, coverage COV, routeRunning RTE, kickPower KPW,
kickAccuracy KAC. Overall is derived per position (`data/positions.js: overall()`).

### Formations (`src/data/playbooks/formations.json`)
```json
"gun_trips_te": { "name": "Gun Trips TE", "family": "Shotgun",
  "players": [ { "s": "QB", "p": "QB", "d": 0, "at": [-5, 0] }, ... 11 total ] }
```
`s` = slot id used by plays (QB, RB, FB, LT, LG, C, RG, RT, X, Z, Y, H…; defense LE, LDT, RDT, RE, LOLB,
MLB, ROLB, LCB, RCB, NB, FS, SS), `p` = depth-chart slot, `d` = depth index, `at` = [downfield, lateral]
from the ball. Defense `align: "L1" | "R1" | "slot"` lines a DB up over a receiver.

### Offensive plays (`offense.json`)
```json
{ "id": "gun_trips_slants", "name": "Slants", "formation": "gun_trips_te", "type": "pass",
  "concept": "Slants", "dropback": 3,
  "routes": { "X": "slant", "Z": "slant", "H": "slant", "Y": "flat", "RB": "block" },
  "read": ["H", "Z", "X", "Y"] }
```
Routes come from `src/data/routes.js` (`go, fade, seam, slant, quick_out, out, deep_out, in, dig, drag,
shallow, cross, curl, hitch, stick, comeback, post, skinny_post, corner, flat, arrow, swing, wheel, angle,
sit, whip, zig, out_up, screen`); suffix `_l`/`_r` forces a side. Non-routes: `block`, `stalk`.
Run plays add `"run": { "carrier": "RB", "aim": [1, 1.5], "mesh": [-4.2, 0.6], "scheme": "zone"|"gap",
"side": 1|-1, "pull": ["RG"] }`. `mirrorOffPlay()` flips any play.

### Defensive plays (`defense.json`)
```json
{ "id": "43_cover3", "name": "Cover 3", "formation": "43_base", "coverage": "zone",
  "assign": { "LE": "rush", "MLB": "zone:hook_middle", "LCB": "zone:deep_third_l", ... } }
```
Assignments: `rush`, `blitz`, `spy`, `zone:<id>` (ids in `src/ai/zones.js`), `man:L1|L2|L3|R1|R2|R3|RB|TE`
(L1 = outermost receiver on the offense's left). Man rules are hints: `matchMan()` resolves them against
the actual alignment and defenders shift pre-snap to their man.

### Roster CSV (Phase 4 — format fixed now so tools can target it)
One row per player, UTF-8, comma separated, header row required, quoted fields allowed:
```
team,first,last,pos,number,age,height,weight,college,SPD,ACC,AGI,STR,AWR,CTH,CAR,BTK,THP,THA,RBK,PBK,PRS,BSH,TAK,POW,COV,RTE,KPW,KAC
BOS,Marcus,Hale,QB,12,27,75,221,Granite U,72,75,70,58,80,40,60,50,90,85,30,30,30,30,30,30,30,30,30,30
```
`team` = team abbreviation; `pos` ∈ QB HB FB WR TE T G C DE DT OLB MLB CB FS SS K P (aliases accepted: RB→HB,
LB→OLB, ILB→MLB, NB→CB, S→FS, OT→T, OG→G, EDGE→DE, NT→DT); height in inches, weight in lbs. Only `team`,
`first`, `last`, `pos` are required. Blank/missing ratings use the position template; blank `number` keeps
or auto-assigns a number. A file may list just a few players: each one replaces the best generated player
at that position and is **pinned** to the top of the depth chart in file order (e.g. list CBs as
CB1, CB2, nickel, CB4). Implemented in `src/data/csv.js` (`parseCSV`, `importRosterRows`, `exportRosterCSV`).

**Local roster override:** if `public/local/roster.csv` exists it is imported at startup and its first team
becomes the home team. `public/local/` is git-ignored — personal rosters (e.g. real player names) must stay
there and never be committed (this repo is public; see the IP rule at the top).

## Phase status
- [x] **Phase 1** — Vite/Three.js setup, stadium (field paint, end zones, goalposts, stands, animated crowd,
  light towers, video boards), instanced players with procedural animation, Xbox controller + keyboard,
  playable plays (3 pass, 2 run) with snap, passing (lob/bullet, lead), running with moves, blocking,
  coverage, tackling; play defense too; CPU-vs-CPU auto mode; headless autosim + unit tests.
- [ ] Phase 2 — full Play Now game (rules, clock, kicking meter, play-call screen, CPU AI/difficulty,
  penalties, score bug)
- [ ] Phase 3 — large playbooks, audibles/hot routes, replay, audio, Practice mode, settings
- [ ] Phase 4 — league data, roster/team editors, CSV import/export, saves
- [ ] Phase 5 — Franchise mode

## Conventions
- Match the existing style: small modules, plain functions, short comments explaining *why*.
- Keep new plays/formations in the JSON playbooks, not in code.
- After changing gameplay logic, run `npm run sim -- --plays 2000` and `npm run bot` and check the numbers
  still look like football and that there are no invariant violations. Current targets (CPU vs CPU):
  completion ~60-65%, INT ~2.5-3%, sack ~6-8%, pressure ~20-30%, median YAC ~1-3, 3.5-4.5 yds/carry.
  Bot targets: blind quick throws should average well under 15 yds/play, mindless QB scrambles ~2-4 yds,
  a QB who just holds the ball should be sacked in ~4-5 s.
- Player speed: `maxSpeed = 3.5 + SPD * 0.0718` yd/s (SPD 56 lineman ~7.5, 90 CB ~10.0); `accel = 3 + ACC * 0.11`.
  Ball carriers run at 95% of top speed. Ratings must create visible differences.
