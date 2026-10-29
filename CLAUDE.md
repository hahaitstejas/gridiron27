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
npm run games -- --games 16 --quarter 15  # headless full CPU-vs-CPU games (rules/clock invariants, box-score averages)
npm run export-league  # write editable league spreadsheets to public/local/ (see below)
npm run bot          # scripted 'human' exploits vs CPU defense  (-- --difficulty rookie|pro|allpro|legend)
npm run build        # production build to dist/
```

URL flags (dev server):
- `?auto&speed=6` — full CPU-vs-CPU game in the browser at 6x real time (debug); `&q=1` = 1-minute quarters.
- `?play` — skip the menus straight into a game (`&side=home|away|cpu`). `?seed=N` — fixed RNG seed.
- `?home=9&away=28` — team index or abbreviation (`?home=CHI`).

Optional browser smoke test (needs Playwright: `npm i -D playwright && npx playwright install chromium`):
`node tools/smoke.mjs http://localhost:5173/ test-output` — drives the menus, a stretch of a human game (play
calls, snaps, kicks), the pause menu and a full 1-minute-quarter CPU game; fails on console errors.

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

### Game layer (`src/game`)
- `match.js` → `Match`: pure rules/game state — quarter, clock, score, possession, `phase`
  (`kickoff | scrimmage | try`), down/distance, yard line (`yardLine` = 0–100 from the possessing team's own
  goal), timeouts, two-minute warning, halftime, overtime (both teams possess, then sudden death), team and
  player stats (an accepted flag wipes the play's stats; `playStatLines()` feeds the post-play stat card). `applyResult(result)` consumes a `PlaySim.result` and moves the game on. `dirOf(team)` /
  `xOf(team, yl)` / `ylOf(team, x)` map between yard lines and world x (home attacks +x in Q1/Q3).
- `penalties.js`: foul table, enforcement (half the distance, automatic first downs, loss of down, spot
  fouls), accept/decline by `expectedPoints()`, pre-snap fouls.
- `session.js` → `GameSession`: drives one game — states `playcall → presnap → live → post` (→ `over`).
  Gets play calls from the human (`humanChoose`) or `ai/playcaller.js`, builds each `PlaySim`, runs the
  play clock / runoff (accelerated clock option), enforces fouls via `penalties.js`, then `match.applyResult`.
  Emits `message`, `flag`, `result`, `gameOver` plus the sim's events. The UI only reads it.
- Special teams live in the sim (`sim/kicking.js`): kick meter (`METER`), kick physics/flight, field-goal
  plane, returns, fair catches, touchbacks, onside kicks. Special plays/formations are in
  `playbooks/special.json` (ids `st_*`; `listOffPlays()`/`listDefPlays()` hide them unless `all=true`).
- `fatigue.js`: player energy across a game. Each snap costs energy by position and effort (carriers, routes,
  rushers); players on the sideline recover (more on timeouts, quarter breaks, full at halftime). The session
  passes the energy maps to each `PlaySim`, whose `place()` sits a tired HB/WR/TE/DL/LB for the next fresher
  player on the depth chart (`ROTATE_AT`); tired players lose some speed/strength (`TIRING` ratings). Starters
  stay in longer late in close games, in the two-minute drill and on the goal line. Snap counts are in the
  player stats (`snaps`). Typical shares: HB1 ~70%, WR1/2 ~93%, WR3 ~60%, starting DL ~80-90%; QB/OL ~100%.
- `audibles.js`: pre-snap audibles (offense X → A quick / B deep / X run left / Y run right / RB flip, all from
  the current formation; defense X → A zone / B man / X blitz / Y deep shell) and hot routes (Y → receiver
  button → stick up go / down hitch / in slant / out quick out, A = block). The session swaps the play and
  re-lines up (`rebuildPresnap`) without restarting the CPU's snap count; `play.hot` lists hot routes.
- Coaching: the pause menu (games and practice) opens the depth chart editor for the human team. It edits
  `team.depth` in place (`placeInDepth` / `removeFromDepth` / `eligibleForSlot` in `data/depthChart.js`), so the
  next snap uses it; it shows each player's overall at that spot and his current energy. Not saved to disk yet.
- `boxscore.js`: full player stats by category (`STAT_TABS`: passing incl. passer rating, rushing, receiving,
  defense, kicking) from `match.stats.players`; `statRows(m, tab, team)`. Shown by `ui/statsScreen.js` from the
  final screen (Full Stats) and the pause menu (Game Stats, also in practice): LB/RB category, X team filter.
- Practice mode: `GameSession` with `settings.practice = { side, yardLine, down, toGo, after: 'reset'|'continue' }`
  — no clocks, no penalties, fresh legs every rep; `practiceReset()` puts the ball back after each play (or when
  the drive ends). Set up from the main menu (`Screens.practice`).
- `ai/playcaller.js`: CPU play calls (situational run/pass, 4th down, FG range, 2-pt chart, kneel/spike,
  clock management, timeouts). `ai/difficulty.js`: Rookie / Pro / All-Pro / Legend — rating boosts per side
  plus CPU reaction, accuracy, tackling, fumbles, blitz rate and play-call smarts.

### Settings
Settings (prefs in localStorage `g27.settings`, `DEFAULT_PREFS` in `ui/screens.js`): camera (standard / wide /
tight / high — `CameraRig.zoom` and the `sky` mode), name tags, post-play stat card, auto replay of big plays
(touchdowns, interceptions, big hits, onside recoveries; not in practice).

### Instant replay (`src/replay/replay.js`)
`ReplayRecorder` stores one compact `Float32Array` frame per sim tick (player x/z/facing/anim/state/velocity/
move, ball) from the snap to the end of the play; the session keeps the last one (`session.lastReplay`, not
recorded in `fast` mode). `ReplayPlayer.seek(t)` fills a ghost sim (`.ghost`) that `GameRenderer.drawSim()`
draws as usual; `renderReplay()` is an orbit camera around `player.focus()`. Opened with RS click between plays
or from the pause menu (app state `replay`).

Players carry a `task` (`route`, `pass_block`, `run_block`, `stalk`, `escort`, `carrier`, `qb_pass`,
`rush`, `man`, `zone`, `pursue`, `ball`, …) that the AI modules interpret. Ratings drive everything via
`sim.R(player, key)` (which also applies difficulty boosts).

## File layout

```
index.html, vite.config.js, package.json
src/main.js            boot, app states (title/menu/game/paused/over), fixed-step session loop, render, HUD
src/core/              constants (field dims), rng (seeded), math helpers, event emitter
src/input/             gamepad.js (Xbox standard mapping, dead zones, rumble), keyboard.js (fallback),
                       actions.js (ControllerState with latched edges + RS flicks), input.js (manager, "Press A")
src/sim/               play.js (PlaySim), entities.js, movement.js (accel/agility steering, collisions),
                       blocking.js (engagements, shedding, pass-rush moves), passing.js (throws, flight,
                       catch/INT/deflection), tackling.js (tackles, broken tackles, ball-carrier moves),
                       human.js (controller → player), anim.js (animation state selection), kicking.js (kick
                       meter, kick flight, returns, special-teams AI), fouls.js (in-play penalty flags)
src/ai/                offense.js (QB drop/handoff, protection, run blocking, routes, escort), qb.js (reads),
                       carrier.js (lane finding + moves), defense.js (man matching, zones, rush, pursuit),
                       zones.js (zone landmarks), playcaller.js (CPU play calling), difficulty.js (tiers)
src/game/              match.js (rules, clock, score, stats), penalties.js (enforcement), session.js (game loop),
                       fatigue.js (player energy + rotation), audibles.js (audibles + hot routes), boxscore.js (stat tables)
src/data/              teams.js (32 original teams), names.js, csv.js (teams/roster/depth CSV), localLeague.js (loads public/local/), positions.js (ratings, templates, overall),
                       generator.js (players/rosters), depthChart.js, routes.js, playbook.js (loader + mirror),
                       playbooks/*.json (formations, offense, defense, special)
src/replay/replay.js   instant replay recorder + ghost-sim player
src/render/            renderer.js (WebGL, lights, adaptive pixel ratio), stadium.js, fieldTexture.js,
                       players.js (instanced low-poly players + procedural poses), camera.js, lines.js, logo.js
src/render/renderer.js also draws the kick aim arrow, penalty flag and the menu orbit camera.
src/ui/                nav.js (controller/keyboard menu focus), screens.js (title, main menu, Play Now setup,
                       controls, settings, pause, game-over box score; prefs in localStorage `g27.settings`),
                       playcall.js (play-call screen), playart.js (canvas play diagrams), depthEditor.js (pause →
                       Coaching: Depth Chart; edits team.depth live via data/depthChart.js helpers), statsScreen.js (full
                       player stats), hud.js (score bug,
                       banners, flag box, ticker, post-play stat card, name tags, receiver icons, kick meter, help, FPS), style.css
tools/autosim.js       headless CPU-vs-CPU plays;  tools/gamesim.js  full games;  tools/humanbot.js  exploit checks;
                       tools/separation.js  receiver openness;  tools/export-league.js;  tools/smoke.mjs  browser smoke test
tests/                 Vitest unit tests
```
Planned (later phases): `src/franchise`, more of `src/ui` (editors),
`src/data/storage.js`.

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
sit, whip, zig, out_up, screen, rb_screen`); suffix `_l`/`_r` forces a side. Non-routes: `block`, `stalk`.
Pass plays may add `"pa": true` (play action: the QB fakes to the back, which then blocks; linebackers and
safeties bite) and `"boot": 1 | -1` (QB rolls out to that side). Run plays add `"run": { "carrier": "RB", "aim": [1, 1.5], "mesh": [-4.2, 0.6], "scheme": "zone"|"gap",
"side": 1|-1, "pull": ["RG"] }`. `mirrorOffPlay()` flips any play.

### Special teams (`special.json`)
Same shape as the other playbooks, with `formations.offense/defense` and `offense`/`defense` play lists.
Offense: `st_kickoff`, `st_squib`, `st_onside`, `st_punt`, `st_fg` (also the PAT), `st_kneel`, `st_spike`;
defense: `st_kick_return`, `st_punt_return`, `st_fg_block`. Plays carry `"type": "kickoff" | "punt" | "fg" |
"kneel" | "spike"`; the session picks the matching defense automatically.

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
LB→OLB, ILB→MLB, NB→CB, S→FS, OT→T, OG→G, EDGE→DE, NT→DT, and the depth slot names LT/RT→T,
LG/RG→G, LE/RE→DE, LOLB/ROLB→OLB); height in inches, weight in lbs. Only `team`,
`first`, `last`, `pos` are required. Blank/missing ratings use the position template; blank `number` keeps
or auto-assigns a number. A file may list just a few players: each one replaces the best generated player
at that position and is **pinned** to the top of the depth chart in file order (e.g. list CBs as
CB1, CB2, nickel, CB4). Implemented in `src/data/csv.js` (`parseCSV`, `importRosterRows`, `exportRosterCSV`).

### Local league spreadsheets (git-ignored, personal use)
`npm run export-league` writes `public/local/teams.csv`, `roster.csv`, `depth.csv` (keeping any edits already
there and backing up the old files to `public/local/backup-*/`). The game loads whichever exist at startup,
in the order teams → roster → depth (`src/data/localLeague.js`). **`public/local/` is git-ignored: personal
content (e.g. real player names, logo images) must stay there and never be committed — this repo is public;
see the IP rule at the top.**
- `teams.csv`: `id,city,name,abbr,primary,secondary,accent,conference,division,logo_shape,logo_text,logo_image,play_as`.
  Rows are matched by `id` (0–31). Colors are hex. `conference` = Liberty|Frontier, `division` = East|North|
  South|West. `logo_shape` = circle|shield|diamond|hex|star|triangle. `logo_image` = optional file name in
  `public/local/logos/` (PNG/JPG/SVG) that replaces the generated logo. `play_as = Y` picks your team.
  If you change an `abbr`, change the `team` column in roster.csv/depth.csv to match.
- `roster.csv`: format above. A team with 40+ rows is a **full roster** (replaces the generated one);
  fewer rows = partial (pinned starters).
- `depth.csv`: `team,slot,players[,names]` — `players` = jersey numbers in order, space separated;
  `names` is informational only. Slots: QB HB FB WR TE LT LG C RG RT LE RE DT LOLB MLB ROLB CB FS SS K P KR PR.
  Formations use WR1–3, TE1–2, CB1–3 (CB3 = nickel), DT1–2, etc. Unlisted slots are filled automatically.
Home team priority: `?home=<index|abbr>` > `play_as` > the single team in a partial roster file > default.

## Phase status
- [x] **Phase 1** — Vite/Three.js setup, stadium (field paint, end zones, goalposts, stands, animated crowd,
  light towers, video boards), instanced players with procedural animation, Xbox controller + keyboard,
  playable plays (3 pass, 2 run) with snap, passing (lob/bullet, lead), running with moves, blocking,
  coverage, tackling; play defense too; CPU-vs-CPU auto mode; headless autosim + unit tests.
- [x] **Phase 2** — Play Now: menus (title, main, setup, settings, controls, pause, box score), full rules
  (downs, clock + accelerated clock, two-minute warning, halftime, OT, timeouts), kickoffs/punts/FGs/PATs/
  2-pt tries with a 3-press kick meter, returns and fair catches, fumbles, penalties with enforcement,
  play-call screen (formation → play, flip, suggestions), CPU play calling, 4 difficulty tiers, score bug.
- [x] **Phase 3** — 17 offensive / 8 defensive formations, 131 offensive / 53 defensive plays (play action,
  bootlegs, screens), audibles + hot routes, instant replay (manual + auto on big plays),
  Practice mode, settings (camera, name tags, stat card, auto replay); plus fatigue-based rotation.
- [ ] Phase 4 — league data, roster/team editors, CSV import/export, saves
- [ ] Phase 5 — Franchise mode

## Conventions
- Match the existing style: small modules, plain functions, short comments explaining *why*.
- Keep new plays/formations in the JSON playbooks, not in code.
- After changing gameplay logic, run `npm run sim -- --plays 2000` and `npm run bot` and check the numbers
  still look like football and that there are no invariant violations. Current targets (CPU vs CPU):
  completion ~60-65%, INT ~2.5-3%, sack ~6-8%, pressure ~20-30%, median YAC ~1-3, 3.5-4.5 yds/carry.
  Bot targets: blind quick throws should average well under 15 yds/play, a tapped (lob) throw to the open man
  ~60-65% / ~7 yds (bullets a bit better), mindless QB scrambles ~2-4 yds,
  a QB who just holds the ball should be sacked in ~4-5 s (currently ~6 s; mindless upfield runs ~6-7 yds are
  a little high). Full games (`npm run games -- --games 16`): ~22-26
  pts and ~350-410 yds per team, ~4 penalties a game, FG make ~95% inside 30 / ~65% from 50+, no invariant
  violations. Every play is exercised by `npm test` against several opponents; `npm run sim -- --plays 600
  --only "screen|draw"` checks a subset (each play's ypp should look like football). Known high: CPU completion ~70% and kickoff-return TDs ~2% of kickoffs.
- Ball spotting: the dead-ball spot and the goal-line plane use the **ball's** position
  (`PlaySim.carrierBallPos`), which moves forward as a tackled runner falls (matching the animation). A QB
  slide is spotted where the slide began.
- Player speed: `maxSpeed = 3.5 + SPD * 0.0718` yd/s (SPD 56 lineman ~7.5, 90 CB ~10.0); `accel = 3 + ACC * 0.11`.
  Ball carriers run at 95% of top speed. Ratings must create visible differences.
