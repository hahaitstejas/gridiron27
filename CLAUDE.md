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
npm run fuzz         # random-input (button masher) human / career / 2-player games: no crashes, every game ends
npm run build        # production build to dist/
npm run build:offline  # ONE self-contained file: dist-offline/Gridiron27.html (double-click, no server, no wifi)
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
  fouls), accept/decline by `expectedPoints()`, pre-snap fouls. In-play fouls by the CPU against the human are the
  human's choice: the session waits in state `penalty` (`pendingPenalty` with `describeChoice()` lines for accept /
  decline and the recommended pick) until A (accept) or X (decline) → `choosePenalty()` → `completePlay()`. Fouls
  by the human, CPU-vs-CPU and fast/headless games still decide automatically.
  Defensive offsides is a live foul (`offsides_live`): `rollPresnapFoul` → the session snaps anyway, puts the jumper across
  the line and flags it (`jumpOffsides`) = a free play for the offense. The scorebug shows FLAG while any foul is on the
  field (`sim.fouls`) and during the accept/decline choice. False start / delay of game still kill the play.
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
  Motion (offense RB → receiver button → stick: toward the ball = across, away = wider): `PlaySim.startMotion(id, across)`
  moves him along the line before the snap (`updateMotion`; man defenders follow via `alignMan(sim, dt)`); he keeps
  his speed at the snap and his route starts where he is. The CPU offense motions ~30% of plays when a human is
  playing. Coverage (defense LB): `session.defAdj = { cover: 'press'|'off', shade: 'in'|'out' }` → `PlaySim.defAdj`;
  press corners line up at 1 yd and jam at the snap (`pressJams`: win = receiver slowed, lose = corner a step
  behind), off = 8 yds; shade sets man leverage (`leverage()`) and pinches/widens underneath zones. The CPU defense
  calls its own (`cpuCoverageCall` in `audibles.js`).
- Coaching: the pause menu (games and practice) opens the depth chart editor for the human team. It edits
  `team.depth` in place (`placeInDepth` / `removeFromDepth` / `eligibleForSlot` in `data/depthChart.js`), so the
  next snap uses it; it shows each player's overall at that spot and his current energy. Edits autosave (league save).
- `boxscore.js`: full player stats by category (`STAT_TABS`: passing incl. passer rating, rushing, receiving,
  defense, kicking) from `match.stats.players`; `statRows(m, tab, team)`. Shown by `ui/statsScreen.js` from the
  final screen (Full Stats) and the pause menu (Game Stats, also in practice): LB/RB category, X team filter.
- Play-call screen (`ui/playcall.js`): a formation strip (LB/RB; Suggested, My Plays, every formation by family, Special
  Teams; ▲▼ jumps a family), three big dark diagrams per page (◀▶ pages) picked with X / A / Y, PASS/RUN (ZONE/MAN)
  badges and per-game `session.callStats` ("N CALLS | avg yds"); RT flips, View = timeout.
- Tempo: on the play-call screen LS click = no-huddle (`session.noHuddle()` reruns `lastOffPlay`, no accelerated-clock
  runoff); at the line B = spike (`session.spike()` swaps in `st_spike` and snaps). View (or the Share button,
  gamepad button 17) calls a timeout between plays; the pause menu has Call Timeout too.
- Injuries (`sim/injuries.js`): each successful tackle may hurt the carrier (`injuryChance`: power, big hits, age;
  rarely the tackler) when `cfg.injuryRate` > 0 (league "Injuries" slider, 0 = off, never in practice). `rollInjury`:
  ~40% out for the game, else 1–6 weeks, ~6% the season. The session collects `sim.injuries` into `session.injuries`
  and passes `unavailable` ids to later plays (`place()` skips them); `settings.unavailable` seeds players already hurt.
  Franchise: `recordGame(..., injuries)` sets `player.injury = { type, weeks }`, `heal()` runs each week/round,
  quick-sims skip injured players and roll their own injuries; hub → Injury Report.
- Local 2-player: `GameSession({ humanTeams: [0, 1] })` (Play Now → "2 players"; P1 = home with pad 1 + keyboard,
  P2 = away with a second pad claimed by pressing A, `InputManager({ keyboard: false, other })`). The session's
  `humanTeam` getter is the human the UI serves right now (the play caller, the penalty chooser, else the offense);
  `inputFor(input, team)` splits `{ perTeam: true, 0: frame, 1: frame }`. `PlaySim` keeps `controlled[team]` per
  human and runs human control in each team's context (`withHuman`); two rings show both controlled players.
  Difficulty boosts don't apply (no CPU side).
- Practice mode: `GameSession` with `settings.practice = { side, yardLine, down, toGo, after: 'reset'|'continue' }`
  — no clocks, no penalties, fresh legs every rep; `practiceReset()` puts the ball back after each play (or when
  the drive ends). Set up from the main menu (`Screens.practice`).
- `ai/playcaller.js`: CPU play calls (situational run/pass, 4th down, FG range, 2-pt chart, kneel/spike,
  clock management, timeouts). `ai/difficulty.js`: Rookie / Pro / All-Pro / Legend — rating boosts per side
  plus CPU reaction, accuracy, tackling, fumbles, blitz rate and play-call smarts.

### League management (Phase 4)
Main menu → League (`ui/league.js` → `LeagueUI`):
- **Saves** (`data/league.js` + `data/storage.js`): `serializeLeague()` turns the league (teams, colors, logos incl.
  uploaded images as `logo.dataUrl`, rosters, depth charts, play-as team) into JSON; `deserializeLeague()` rebuilds
  and repairs it (missing depth slots rebuilt, unknown ids dropped, overall recomputed, `setNextPlayerId` past the
  highest id). Stored in IndexedDB (`gridiron27`/`saves`, localStorage fallback) under named slots; the active slot
  (`localStorage g27.activeSave`) loads at startup **instead of** the `public/local/` spreadsheets. Every editor
  calls `league.changed()` → autosave ~1 s later (the first edit creates "My League"). Saves & Files: save, save
  as, rename, load, delete (X), export/import a `.g27.json` file, start over with the default league.
- **Rosters** (`ui/rosterEditor.js`, edits via `data/rosterOps.js`: `addPlayer`, `releasePlayer`, `tradePlayer`,
  `changePosition` keep depth charts valid): team roster by position (LB/RB team), player card with name,
  number, position, age, height, weight, college and all 20 ratings (◀▶, hold to repeat; A types a value), live
  overall, add (X), trade, release.
- **Teams & Logos** (`ui/teamEditor.js`): city, name, abbreviation, conference/division, colors, your team, logo
  builder (shape, letters, colors, or an uploaded image downscaled to 256 px) with a live logo + score-bug preview.
- **Depth Charts**: the depth editor for any team.
- **Spreadsheets** (`ui/spreadsheets.js`): download teams/roster/depth CSVs (same formats as below), import one
  (type detected by its columns, with a summary of problems), or re-apply the files in `public/local/`.
Text fields use the browser's prompt dialog (needs a keyboard).

- **Playbook** (`ui/playbookEditor.js`, logic in `data/customPlays.js`): "My Plays" — a small spec (formation, per-slot
  routes or block, primary read, drop, play action, bootleg; or a run: carrier incl. QB keeper, side, hole, zone/gap)
  → `buildPlay()` (same shape as offense.json, `custom: true`, `rev` for the diagram cache). Stored per browser in
  localStorage `g27.playbook` (not in league saves), registered at boot (`registerCustomPlays` → `setCustomPlays`).
  The play-call screen shows them in a "My Plays" tab; the CPU play caller and audible menus ignore them.
  `game/playtest.js` `testPlay()` runs a play headless (editor's Test / save check).

### Franchise mode (Phase 5, `src/franchise/` + `ui/franchise.js`, `ui/offseason.js`)
The franchise state is plain JSON stored in the league save (`league.franchise`, `serializeLeague({ franchise })`),
so a franchise is a save slot: New Franchise copies the current league into a new slot; the Franchise menu lists
saves that hold one (`listSaves()` → `franchise` info). State: `{ userTeam, year, weeks, week, phase:
'regular'|'playoffs'|'offseason', schedule[week][{home, away, score}], stats{rid: season totals}, playoffs{seeds,
rounds}, history[], seed, offseason{step, …} }`.
- `season.js`: `makeSchedule` (6/10/17 weeks; one game a week each, division rivals twice in long seasons, home/
  away balanced), `standings`/`rank` (win %, division, conference, point differential), `seeds` (4 division winners
  + 3 wild cards per conference), `nextPlayoffRound` (wild card → divisional → conference → championship),
  `addStats`/`leaders`.
- `quicksim.js`: `quickSim(home, away, seed)` — scores from `teamRatings()` off/def (+1.5 home field, ~22 pts/team),
  then team totals split into box-score lines for the depth chart's players (same fields as Match stats). CPU
  games and "Sim this game" use it; games the human plays record their real Match stats (`matchToResult`). The
  session gets `franchiseGame`; the final screen's button returns to the hub (`FranchiseUI.recordPlayed`).
- Hub Team Stats (`FranchiseUI.teamStatsScreen`): season totals in `f.stats` shown with the end-of-game `STAT_TABS`
  (+ GP), your team or the whole league (X).
- `franchise.js`: `createFranchise`, `currentGames`, `userGame`, `simGame`, `simOthers`, `advance` (week → playoffs →
  rounds → offseason), `startNextSeason`.
- `contracts.js` (money): `p.salary` ($M/season) + `p.years`; `marketValue(p)` by overall, position (QB premium) and age;
  `setupMoney()` gives everyone a deal and sets `f.cap` from the league's median payroll (×1.12, so any league's
  ratings fit), squeezing over-cap teams; `payroll`/`fits`; rookie scale by pick; `tradeValue` (stars ≫ depth, youth,
  bad contracts subtract); `evaluateTrade(cpuTeam, gets, other, gives, cap)` (CPU wants ≥1.08× value, both under the
  cap); `cpuTrades` (CPU-CPU swaps before the deadline, 60% of the season). Hub: Contracts & Cap, Trade (pick a team,
  A toggles players, LB/RB switches roster, interest meter), Transactions (`f.transactions`, `logTransaction`).
  Offseason: re-signing at the asking price within the cap (`projectedPayroll`), free agents cost their asking price,
  cut-downs also get under the cap (`cutDown(team, 53, cap)`), short rosters refill with affordable FAs (`fillRoster`).
  Old saves get money on load (`upgradeFranchise`).
- `extras.js`: news feed (`addNews`, `f.news`: notable results, your games, injuries to your players / stars, trades,
  awards, records, draft headlines, the champion), records (`f.records.game/season` for `RECORD_CATS`, announced only
  after the first season, `recordsSince`), awards at the end of the regular season (`giveAwards`: MVP, OPOY, DPOY,
  offensive/defensive rookie of the year from `p.rookieYear`; `f.awards[year]`), draft scouting (`setupScouting`: each
  prospect's shown overall is a range around a hidden error, potential '?', `SCOUT_POINTS` per draft reveal the truth
  with X; the CPU drafts on true value). Hub: News, Awards & Records (awards, season/game records, champions).
- `offseason.js`: steps summary → progression (`progressPlayers`: age +1, growth/decline by age and hidden `pot`,
  retirements, contract `years`--) → resign (`expiring`, `resign`, `finishResigning` → free-agent pool) →
  freeagency (`signFreeAgent`, `cpuFreeAgency` by `needs`) → draft (`makeDraft`: 224 picks, worst record first,
  rookie class; `makePick`, `simToUserPick`, `finishDraft`) → cutdown (`cutDown` to 53 keeping position minimums)
  → `startNextSeason`.

### Traits (`data/traits.js`)
Original star abilities derived from ratings at eligible positions (`traitsOf(p)`, no save data; ~9% of players): Sure Hands,
Route Technician, Bruiser, Pocket Poise, Cannon, Edge Bender, Brick Wall, Lockdown, Ballhawk, Enforcer, Big Leg. Sim players
carry `traits` (entities.js); hooks use `has(p, id)` in passing.js (accuracy, pPlay, pInt, contest), tackling.js, blocking.js
(shed contest, rush moves), kicking.js. When the trait's own bonus decided the roll the sim emits `trait` → HUD ticker
"★ Sure Hands: K. Long". Shown on the roster player card and My Player (with what the rest need: a career goal).

### Career mode (`franchise/career.js`, `ui/career.js`)
A franchise with `f.career = { rid, xp, points, spent, games[] }` (Franchise menu → New Career: name, position from
`CAREER_POSITIONS`, number, team). `createCareerPlayer` adds a 21-year-old starter flagged `p.career` (never retired, cut,
CPU-traded or offered in your trades; re-signs himself; only age fades him, growth comes from points). Every game he
plays or sims gives `gameXP(line)` (`awardCareerGame` from `recordGame`), `XP_PER_POINT` = 100; My Player (hub) spends
points on `careerKeys(pos)` at `upgradeCost(v)`. In games `settings.lockPlayer = rid`: `session.calls(team)` — the human
calls plays only as QB (offense) / MLB (defense) and the CPU snaps otherwise; `lockOn(sim)` sets `sim.lockId` (no B
switch, no control change on catches/turnovers) or, when he isn't on the field (kicks: unless he's the kicker/returner),
runs the snap CPU vs CPU (`session.watching`, main.js fast-forwards 4x). The camera keeps him in the shot.

### Trick plays and QB controls
- Run styles (`run.style`): `read` (zone read: at the mesh the QB reads the backside end, `readKeep()` in offense.js; the
  human holds LT to keep), `speed_option` (QB keeps toward the edge with the back in `pitch_trail`; `PlaySim.pitchOption()`
  on LB or automatically when a defender closes / he reaches the edge), `jet` (play `motion: { slot, across, depth, speed }`:
  the session's snap starts the motion and snaps when he reaches the QB, `jetWait`), `draw`, `pitch`. QB carriers
  (`qb_keep`): a sneak only straight ahead from under center; otherwise a designed run after a short ride.
- The CPU only calls QB-run / option plays with a mobile QB (speed ≥ 76, `qbRun` in playcaller.js).
- Fakes (`special.json`, `fake: 'punt'|'fg'`, formations `punt_fake` / `fg_fake`): scrimmage plays the defense reads as a
  kick (`defenseForSpecial`); unassigned special-teams defenders rush up front / zone behind (`fakeKickAssign`). Hidden
  from the normal lists (`isScrimmagePlay`), offered in the 4th-down Special Teams tab; the CPU fakes ~3% on 4th & short.
- Pass rush (user DL/edge engaged with a blocker): `RUSH_MOVES` in blocking.js — A / RS↑ bull rush (strength; drives
  the blocker back, may shed), X swim, Y spin, RS↓ rip (pass rush / agility); odds from the rating contest, get-off
  bonus, double teams hurt; fail = lost ground and a longer cooldown. Holding the stick gives a little leverage.
  `npm run bot` userEdgeMoves vs userEdgeStick measures it (~16% vs ~7% sacks).
- Catch types (ball in the air to the user's receiver, `b.catchType`): Y aggressive (traffic ×0.55, no run after), X run after
  catch (traffic ×1.35, full speed after), B possession (+6% clean, feet in at the sideline). Defense: Y = go for the pick
  (`b.pickT`: big INT bonus, fewer swats). `npm run bot` smartTapAggressive / RAC / Possession.
- Defensive hot routes (Y at the line, on the controlled defender; `DEF_HOT` / `defHotRoute` in audibles.js): A blitz, X QB
  spy, Y hook zone (side by alignment), B deep middle, RB flat zone; the session rebuilds the play and keeps him controlled.
- Hard count (`session.hardCount()`, LT at the line, once per play, not vs a human defense): ~5% a CPU lineman jumps (forced
  `offsides` → free play; less vs high-awareness lines), 4% your own lineman false-starts.
- Passing: hold LB (high) / LT (low) while throwing (`b.place`: harder for defenders to play, -5% catch, no YAC);
  LS click = pump fake (coverage defenders may freeze ~0.4 s, less with awareness).

### Menus (look and navigation)
The main menu is a hub (`Screens.mainMenu(handlers, info)`): a featured Play Now tile with the current matchup, tiles for
Franchise / Practice / League / Playbook and a small row (Settings, Controls, Saves), your team in the top bar.
Original line-art icons (`ICONS` in screens.js). Tiles use `Nav.set(items, { spatial: true })`: the stick moves to the
nearest item in that direction by on-screen rectangles (any layout). Shared style (end of style.css): slanted panels
(`--skew`), gold focus edge, `--accent` = your team's primary color (set by the hub), stripe background, fixed bottom
hint bar (`.setup-help`). The design is our own; don't copy other games' menus or trade dress.

### Fonts
Saira Condensed everywhere (the user's pick): menus, HUD, scorebug and canvas text (field numbers, end zones, jerseys,
logos, video boards, play diagrams). Bundled with `@fontsource/saira-condensed` (imported at the top of main.js; OFL,
offline); main.js waits for `document.fonts.load` before the renderer paints its canvases. CSS roles `--fd` / `--fc` /
`--fb` at the top of style.css. The post-play stat card sits top-left (clear of the scorebug).

### League identity (`data/leagueInfo.js`)
`LEAGUE = { name, championship, logo }` plus the two conference names (written into `CONFERENCES` in place, so every
screen picks them up; the last `PLAYOFF_ROUND_NAMES` entry follows `championship`). Saved in the league file (`info`,
applied by `deserializeLeague` → `setLeagueInfo`). Edited in League → Teams & Logos → "League & Conferences" card
(`leagueEditor` in teamEditor.js, shares `rowKit` with the team editor; logo builder or uploaded image). The field
(`makeFieldCanvas(home, away, { championship })`) paints the league logo at both 25-yard lines and, in the
championship game (`renderer.setTeams(..., { championship })` from startGame), at midfield.

### Scorebug
`Hud.renderBug()`: a full-width bar along the bottom (layout from the user's design): GRIDIRON 27 | away logo panel |
`(rec) AWY [timeout bars] • score × score • HOM (rec)` (dot = possession) | home logo panel | quarter, clock and a boxed
play clock | down & distance, which turns into a yellow FLAG while a foul is on the field. Records come from
`session.records` (franchise games, else 0-0).

### Settings
Settings (prefs in localStorage `g27.settings`, `DEFAULT_PREFS` in `ui/screens.js`): camera (standard / wide /
tight / high — `CameraRig.zoom` and the `sky` mode), name tags, post-play stat card, auto replay of big plays
(touchdowns, interceptions, big hits, onside recoveries; not in practice).

Gameplay sliders (Settings → Gameplay sliders, `prefs.sliders`, `SLIDER_KEYS`/`defaultSliders()` in `ui/screens.js`):
`{ user: {...}, cpu: {...}, penalties, fatigue }`, 0–100 with 50 = default. The session hands each `PlaySim` per-team
sets (`slidersFor(team)`: user set for human teams); `sim.sl(team, key)` maps a slider to -1..1. Effects: QB accuracy
(throw scatter), pass/run blocking and pass rush/run defense (block shed rate), WR catching, interceptions, pass
coverage (reaction delay), tackling, fumbles, FG/punt/kickoff power and accuracy; penalties scale the foul rate,
fatigue scales energy costs.

### Weather and time of day (`game/weather.js`, `render/weather.js`)
Conditions `{ type: 'clear'|'rain'|'snow', wind: {x, z} yd/s (world frame), time: 'day'|'dusk'|'night' }` from
`makeConditions(rng, weather, time, late)` (Play Now: Weather / Time of day options; franchise: `gameConditions(f, g)`,
snow only late in the season). The session passes them to each `PlaySim` (`cfg.weather`): `WEATHER_MODS` take points off
ratings in `R()` (rain: catching, carrying, accuracy; snow: footing, kick power), wind accelerates kicked balls in
flight (`WIND_PUSH`, landing prediction included) and adds drift + scatter to deep passes. `GameRenderer.setConditions()`
sets lights, fog, sky gradient (stadium `sky` uniforms), light-tower lamps, the snow layer on the field and
`Precipitation` (rain streaks / snow points, one draw call each, animated in the vertex shader around the camera).
The kick hint shows the wind (arrow from the camera's view). `npm run games -- --weather rain` measures the effect.

### Offline single file
`npm run build:offline` (vite mode `offline`, `vite-plugin-singlefile`, then `tools/offline.mjs` renames it) inlines all JS,
CSS and the Saira fonts into `dist-offline/Gridiron27.html` (git-ignored, ~1.5 MB). It never copies `public/` and skips the
`public/local/` spreadsheet fetches on `file:` (`localLeague.js`): a file opened from disk is its own browser origin, so
bring a league over with League → Saves & Files → export / import `.g27.json`.

### Presentation (Phase 6, render-only: `render/presentation.js`, `render/players.js`)
- Players: capsule limbs, lathe torso, PBR materials with a `RoomEnvironment` env map (players only), facemask, shoulder
  caps, numbers on chest/back/shoulders. Poses crossfade (`blend()`: 0.12 s for fast anims, 0.22 s otherwise); falls keep
  their direction (`FALL`). Catch / pick / huddle / clap poses and officials' signals (`sig_*`).
- `Presentation.frame(session, sim, dt)` returns `{ display, refs, ballAt }` proxies the renderer draws instead of the sim:
  between plays the teams get up, jog to huddles (`HUDDLE_DELAY`), break with a clap and run to the formation during
  the session's line-up window (`LINEUP_T` in session.js: a human can't snap before it ends). Seven officials (`CREW`)
  follow the ball, signal touchdowns / incompletions / first downs / flags, and the referee faces the camera to announce
  an enforced penalty (`SIGNAL` per foul type). The sim never sees any of this.
- `passCallout` (main.js): CAUGHT / INTERCEPTED / DROPPED / BROKEN UP… callout plus a pulse ring on the player.
- Pause menu: hub-style tiles under a situation banner (`Screens.pause({ game })`, `pauseInfo` in main.js).
- Touchdowns: the scorer does one of `CEL_STYLES` (spike, point, flex, leap) facing the field, teammates gather in an arc
  behind him and `CameraRig.update(..., { shot })` cuts to a close-up (`Presentation.celebration()`); the session holds
  `post` 3 s after a TD (not fast/practice) so it plays before the PAT call.
- Pregame intro (`render/intro.js` `introShot(t)`, app state `intro` in main.js, `Hud.intro()` lower-third): sweep, midfield
  dolly, crane to the kickoff; A/B/X/Menu skips; Settings → Pregame intro; never in practice or sped-up games.
- Play-by-play: `Match.applyResult` → `afterResult()` sets `match.lastPlayText` ("3rd & 4 at CHI 35: … · FIRST DOWN", rich
  `describePlay(..., true)`) and, when a drive ends (snapshot `before.drive`, since a punt/turnover already starts the next
  one), pushes `match.drives[]` `{ team, plays, yards, secs, result, start }` and says a `drive` message. HUD: `pbp()` strip
  above the scorebug (PLAY / DRIVE), `halfCard()` team stats at halftime (replaces the banner).
- Chain crew (`render/lines.js` `makeChains`): poles at the line and the line to gain, chain, down marker (`lines.set(los,
  first, down)`), on the home sideline between the officials and the bench. Sidelines: `Presentation.bench` (10 reserves +
  a coach per team, colored by `PlayerRenderer.extra`). Replay angles: `REPLAY_ANGLES` in main.js (LB/RB).
- Video boards: `stadium.setBoardGame(h, a, { score, q, clock, down, flash })` from `boardFrame()` in main.js (repaints on
  change; flashes TOUCHDOWN / FIELD GOAL / INTERCEPTION in team color). Seats tint toward the home color. Names on jersey
  backs: `PlayerRenderer.nameCanvas` atlas (one row per instance). Loose balls bounce erratically (play.js `updateBall`).
- Penalties: `Hud.flag()` is a referee announcement card (foul name, who, enforcement) at the top center.

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
src/data/              teams.js (32 original teams), names.js, csv.js (teams/roster/depth CSV), localLeague.js (loads public/local/),
                       league.js (save format), storage.js (IndexedDB saves, file download/upload), rosterOps.js (roster edits),
                       positions.js (ratings, templates, overall),
                       generator.js (players/rosters), depthChart.js, routes.js, playbook.js (loader + mirror),
                       playbooks/*.json (formations, offense, defense, special)
src/franchise/         season.js (schedule, standings, playoffs, stats), quicksim.js (fast results + box scores),
                       franchise.js (season state machine), offseason.js (progression, contracts, FA, draft, cuts)
src/replay/replay.js   instant replay recorder + ghost-sim player
src/render/            renderer.js (WebGL, lights, adaptive pixel ratio), stadium.js, fieldTexture.js,
                       players.js (instanced low-poly players + procedural poses), camera.js, lines.js, logo.js
src/render/renderer.js also draws the kick aim arrow, penalty flag and the menu orbit camera.
src/ui/                nav.js (controller/keyboard menu focus), screens.js (title, main menu, Play Now setup,
                       controls, settings, pause, game-over box score; prefs in localStorage `g27.settings`),
                       playcall.js (play-call screen), playart.js (canvas play diagrams), depthEditor.js (pause →
                       Coaching: Depth Chart; edits team.depth live via data/depthChart.js helpers), statsScreen.js (full
                       player stats), league.js (League menu + saves), rosterEditor.js, teamEditor.js (+ logo builder),
                       spreadsheets.js (CSV import/export), franchise.js (franchise menu, hub, standings, schedule,
                       bracket, leaders), offseason.js (offseason steps), hud.js (score bug,
                       banners, flag box, ticker, post-play stat card, name tags, receiver icons, kick meter, help, FPS), style.css
tools/autosim.js       headless CPU-vs-CPU plays;  tools/gamesim.js  full games;  tools/humanbot.js  exploit checks;
                       tools/separation.js  receiver openness;  tools/export-league.js;  tools/smoke.mjs  browser smoke test
tests/                 Vitest unit tests
```

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
kickAccuracy KAC. Overall is derived per position (`data/positions.js: overall()`): the weighted average of that
position's key ratings, plus an optional per-player offset `ovrAdj` set from an `OVR` column in roster.csv. Overall
is for display and depth-chart ordering only: gameplay reads the individual ratings.

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

### Roster CSV
One row per player, UTF-8, comma separated, header row required, quoted fields allowed:
```
team,first,last,pos,number,age,height,weight,college,SPD,ACC,AGI,STR,AWR,CTH,CAR,BTK,THP,THA,RBK,PBK,PRS,BSH,TAK,POW,COV,RTE,KPW,KAC
BOS,Marcus,Hale,QB,12,27,75,221,Granite U,72,75,70,58,80,40,60,50,90,85,30,30,30,30,30,30,30,30,30,30
```
`team` = team abbreviation; `pos` ∈ QB HB FB WR TE T G C DE DT OLB MLB CB FS SS K P (aliases accepted: RB→HB,
LB→OLB, ILB→MLB, NB→CB, S→FS, OT→T, OG→G, EDGE→DE, NT→DT, and the depth slot names LT/RT→T,
LG/RG→G, LE/RE→DE, LOLB/ROLB→OLB); height in inches, weight in lbs. Only `team`,
`first`, `last`, `pos` are required. An optional `OVR` column sets the displayed overall (exports include it). Blank/missing ratings use the position template; blank `number` keeps
or auto-assigns a number. A file may list just a few players: each one replaces the best generated player
at that position and is **pinned** to the top of the depth chart in file order (e.g. list CBs as
CB1, CB2, nickel, CB4). Implemented in `src/data/csv.js` (`parseCSV`, `importRosterRows`, `exportRosterCSV`).

### Local league spreadsheets (git-ignored, personal use)
`npm run export-league` writes `public/local/teams.csv`, `roster.csv`, `depth.csv` (keeping any edits already
there and backing up the old files to `public/local/backup-*/`); League → Spreadsheets does the same from inside
the game (as downloads). Without a league save, the game loads whichever exist at startup,
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
- [x] **Phase 4** — League menu: save slots with autosave and .json export/import, roster editor (all fields and
  ratings, add/trade/release), team editor + logo builder (shapes, letters, colors, image upload), depth charts for
  any team, in-game CSV export/import.
- [x] **Phase 5** — Franchise mode: seasons (6/10/17 games), play or quick-sim games, standings, schedule & results,
  league leaders, 14-team playoffs and a championship, offseason with progression/retirements, contracts, free
  agency, a 7-round draft and cut-downs, multiple franchises (save slots). Also: broadcast-style score bug,
  no-huddle (Y) and spike (B), timeouts from the pause menu / View / Share.

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
  --only "screen|draw"` checks a subset (each play's ypp should look like football). Known high: kickoff-return TDs ~2% of kickoffs. (Oct 2026 retune: catch base 0.57, INT base 0.045, catch-secure step → 66% cmp, 2.0% INT, 24.7 pts.)
- Forward progress (`PlaySim.forwardProgress`): while a free defender is within 0.9 yd of the runner, the furthest
  point the ball reached is kept (`c.fp`); a tackle behind it is spotted there (`result.forwardProgress`), and being
  driven back 2+ yards in contact blows the whistle (not for a QB in the pocket). 0.35 s free resets it.
- Ball spotting: the dead-ball spot and the goal-line plane use the **ball's** position
  (`PlaySim.carrierBallPos`), which moves forward as a tackled runner falls (matching the animation). A QB
  slide is spotted where the slide began.
- Player speed: `maxSpeed = 3.5 + SPD * 0.0718` yd/s (SPD 56 lineman ~7.5, 90 CB ~10.0); `accel = 3 + ACC * 0.11`.
  Ball carriers run at 95% of top speed. Ratings must create visible differences.
