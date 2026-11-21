# Update 1.0 — phase plan and progress log

Decisions from the user: check-ins every 4 h; franchise seasons are 17 games only (NFL schedule formula);
stadiums ship fictional, real names via git-ignored `public/local/stadiums.csv`. College version: not yet.
No NFL/EA/Madden names or IP (use "traits" not "X-Factors"; mockup names are placeholders).

## Phase A — the user's listed fixes (gameplay + CPU logic)
- [x] A1 4th-down decisions from a win-probability / EP model (time, score, timeouts, field position)
- [x] A2 Penalty accept/decline by EP incl. down (decline to force 4th & short); audit every situation
- [x] A3 CPU clock management: no spike-then-punt, end-of-half logic, kneel on end-zone INT
- [x] A4 FG distance whole yards rounded up everywhere ("53-yard attempt")
- [x] A5 Clock display ticks smoothly (no 8:26 → 8:14 jumps), runoff visible
- [x] A6 Fake punts/FGs harder (defense reads them, contain)
- [x] A7 Hail Mary + trick plays folder (flea flicker, philly special-style, hook and ladder, laterals at end of game)
- [x] A8 FG block: MLB no free middle, longer kicks block more often, user edge rusher with X dive
- [x] A9 Juke rework (lateral cut, no backward loss, actually beats the defender)
- [x] A10 QB: no infinite scramble/hold (pressure collapses, sack), no guaranteed 5-yd QB runs, pressure hurts accuracy
- [x] A11 Defender jumping the QB at the LOS (cheese 5-yd passes) — keep man coverage on the receiver
- [x] A12 Deep zones out of bounds inside the 10 (clamp landmarks to the field of play)
- [x] A13 Kickoff: nobody moves early, offsides rule checked
- [x] A14 No huddle: same personnel; no huddle not allowed right after the two-minute warning
- [x] A15 CPU snaps too fast after a huddle (give the human time)
- [x] A16 After a timeout teams can repick the play
- [x] A17 Timeout button mapping (hold both bumpers), 2-player pause/timeouts, 2-player controller fix, hide play name in 2P
- [x] A18 QB slide spot; fair catch shown as an action; hit stick (RS flick) high risk/high reward
- [x] A19 Pass rush improvements; weather effects on throwing
- [x] A20 Overtime = current NFL rules (regular season: both possess, 10 min; playoffs)
- [x] A21 Coach suggestions match the situation; recent plays tab; more plays
- [x] A22 Catch buttons A secure / X run after / Y aggressive

## Phase B — menus
- [x] B1 Remove all outlines (panels, logos, selection box) everywhere; slider focus visible
- [x] B2 Pause: bigger graphic, comp% ring, INT, QBR
- [x] B3 Post-game screen from the mockup (finish, highlights, player/team stats, score summary, restart, top players, score by quarter)
- [x] B4 Team select: LT random team, A → side menu (Ready, Traits, Advanced settings: playbook, coin toss; Edit uniforms)
- [x] B5 Settings, training, every remaining old-style screen restyled
- [x] B6 Teams alphabetical everywhere
- [x] B7 Sortable stat columns (X sorts), COMP% in passing, targets + catch% in receiving
- [x] B8 Franchise hub: a few boxes that open sub-menus
- [x] B9 Depth chart "play the backups" button

## Phase C — franchise realism
- [x] C1 17-game NFL schedule formula only; schedule CSV import; primetime + kickoff times, short weeks, holidays, international games
- [x] C2 Injuries: realistic rate, specific injuries, questionable/out during games, severity after, re-injury risk choice, IR
- [x] C3 Practice squad, waivers, elevations
- [x] C4 Weekly progression (in-season growth), morale (temporary rating effect), trade demands
- [x] C5 CPU signs free agents; +500 generated FAs option; 300 UDFAs each season
- [x] C6 Trades: fix one-sided trade bug, trade block + offers, draft-pick trading, view roster/depth during trades/draft/resign
- [x] C7 Draft: better screen, draft class CSV import, scouting all year, compensatory picks
- [x] C8 Franchise tag, Pro Bowl / All-Pro teams (raise asks), league-wide player search, leaders highlight my players
- [x] C9 Roster CSV contract columns (salary, years); retired numbers CSV; position number rules everywhere
- [x] C10 Coaches CSV (HC/OC/DC with tendencies) feeding the CPU play caller; game preview screen from coordinators
- [x] C11 Score ticker banner (other games by quarter)
- [x] C12 Uniform editor + uniforms CSV (home/away/rivalry: jersey, pants, number, number outline)
- [x] C13 Stadiums CSV (fictional defaults), neutral championship venue each year

## Phase D — presentation
- [x] D1 End zones: team name / city, conference + league logos; championship end zones
- [x] D2 Glossy 3D logos
- [x] D3 Cutscenes: coaches, fans, tunnel run-out (skippable); TD camera locks on the scorer; kickoff camera
- [x] D4 Celebrations (TD, sack, INT, first down) incl. RS celebration wheel
- [x] D5 Tackle falls in the right direction, referees run, animations
- [x] D6 Dynamic lighting, holiday decorations (Thanksgiving leaves, Christmas)
- [x] D7 RT play art zooms out to the whole field
- [x] D8 Tush push timing bar play

## Progress log
- A1-A5, A14-A16 (commit 1): game/winprob.js (EP table, conversion rates, drive-level win probability) drives 4th downs and
  accept/decline; spike only when it helps; end-zone INT kneel; FG distances rounded up + "N-YARD ATTEMPT"; clock runs
  visibly between plays; CPU waits 5-7.5 s at the line vs a human defense; no-huddle keeps personnel, not right after the
  two-minute warning; timeouts send both teams back to the play call; both bumpers = timeout; Match.callTimeout now
  returns true (icing and CPU timeout rest never fired before).
- A6, A7, A21, A22 (commit 2): fakes read by the return/block unit (contain, jammers on gunners, spy; tools/fakes.js);
  sim/tricks.js: laterals (LB as a carrier, CPU last-gasp), Hail Mary, flea flicker, hook and ladder, throwback,
  swap special (QB catches), WR reverse in a "Trick Plays" folder; defenses don't fall for the same trick twice;
  suggestions skip runs in a no-timeout drill; Recent tab; catch buttons A secure / X run after / Y aggressive.
- A8, A9 (commit 3): FG block: you're the edge rusher (B8, comes free outside the wing), X dives across the kick
  (~6% blocked with good timing), long kicks get blocked more, the interior wall holds; juke = plant + lateral cut
  that never loses ground and can make the man in front stumble; CPU jukes no longer step backward. Retune: tackle
  base 0.80, catch base 0.545 → ~26.5 pts, 373 yds, 4.4 ypc.
- A10-A12 (commit 4): coverage holds until the QB crosses the line (only a free zone defender comes up); after 4 s
  the defense plasters and sends extra rushers (hold-the-ball sack ~5 s); zone defenders react fast to a QB crossing;
  the CPU puts a spy on a human QB who keeps scrambling; pressure / fading away / getting hit ruin throws; nobody lines
  up past his own end line.
- commit 5: kickoff players frozen until the ball lands (human too); slide spot; fair-catch arm wave; hit stick =
  more whiffs, more fumbles; pass rush leverage for humans; rain/snow hurt throwing; OT: 15-min playoff periods with
  3 timeouts, OT two-minute warning; Team Select rebuilt (each controller moves its own icon, ▲▼ alphabetical teams,
  LT random, side menu: Ready / Star Players / Playbook style / Coin toss / Uniform), 2 players either side, menus
  answer both pads, no play name shown in 2P; uniforms.js (home/away/alt); coin toss choice; playbook styles feed the
  CPU caller; no outlines anywhere; pause screen bigger with comp% ring, INT, rating; post-game screen from the mockup
  (highlight reel, score by quarter, score summary, team stats, restart); targets, CMP%, CTH%, FG% and sortable stat
  columns (◀▶ + X). New standalone franchise modules (wired in later): nflSchedule.js, health.js, practiceSquad.js,
  development.js.
- commits 6-7: franchise schedule (nflSchedule.js), injuries (health.js), practice squad + waivers, development +
  morale + trade requests, CPU in-season signings, +500 / 300 UDFA pools; hub = 4 boxes (Season, Team, Front Office,
  League) with sub-menus; injury report with IR, practice squad, waiver wire, player search, game preview. TODO in C1:
  schedule CSV import. TODO C8: leaders highlight.
- commit 8: trades.js — draft-pick ownership (2 drafts ahead), pick values, deals with players + picks, the roster
  screen's Trade opens the real trade screen (no more one-way gifts), trade block + weekly offers (accept/decline), CPU
  contenders buy veterans with picks, compensatory picks (rounds 3-7), team pickers alphabetical. TODO: draft-day
  trade-up offers in the draft screen (draftDayOffers exists), viewing roster/depth from re-sign/draft/trade screens.
- commit 9: draft class all season (draftClass.js: 3 scouting points a week, CSV import with POT, leftover points carry
  into the draft), draft board shows your roster needs, trade-down offers on the clock; jersey number rules + retired
  numbers; roster.csv salary/years/expires/exp columns (rookies get 4-year deals); extraCSV.js: retired_numbers,
  coaches (tendencies feed the CPU: run %, 4th downs, long FGs, blitz), uniforms, stadiums (neutral championship site by
  year, international venues), schedule.csv import/export; fictional coaching staffs by default; championship venue
  rotates. Also loaded from public/local/ at startup.
- commit 10: honors.js (All-Pro 1st/2nd teams, Pro Bowl per conference; honors raise asking prices), franchise tag (Y on
  the re-sign screen, CPU tags stars), roster needs on re-sign/free-agency screens, your players highlighted grey,
  around-the-league score ticker in franchise games.
- commit 11: depth chart X = play the backups / Y = starters back; uniform editor (home/away/alt) in Teams & Logos; settings/training checked in the no-outline style.
- commit 12: end zones (team name / city, conference + league logos; championship: each team's name and logo), glossy 3D logos in menus and the HUD.
- commit 13: RT play art pulls the camera up and back over the whole formation; Tush Push play with a timing bar (A in the green) that sets the surge.
- commit 14: celebrations (first-down point, sack, pick, TD wheel on RS: Dance/Flex/Spike/Team), tackle falls away from the tackler, officials stride instead of sliding.
- commit 15: intro with run-out (teams jog out of the tunnels), head coach close-up, crowd shot (captions), fixed single-angle TD camera, wide kickoff/return camera; every team gets a fictional coaching staff.
- commit 16: dynamic lighting (touchdown light show, dusk games darken as they go), Thanksgiving leaves and Christmas flurries in franchise holiday games.

## Update 1.1 (user's list) + leftovers from 1.0
- [x] E1 No fullback on the roster: the 3rd/4th tight end plays FB (then a back)
- [x] E2 More 13-personnel (1 RB, 3 TE) formations and plays (and 12/22 variety)
- [x] E3 Timeouts obvious: banner, referee signal, board flash, scorebug timeout bars blink
- [x] E4 Post-game screen decluttered
- [x] E5 FG block: the user's edge rusher shouldn't get through every time (wing chips him; harder dive)
- [x] E6 Post-game injury list shows the player's name; pause → Coaching opens Depth Chart + Injury Center
- [x] E7 Practice squad: release players; un-elevate before the game
- [x] E8 Moving around pre-snap (human defender can reposition; CPU defense shifts/creeps)
- [x] E9 CPU (and the user's) rosters always have a K and a P (sign one; never a back kicking)
- [x] E10 Dynamic kickoff: the kicker can't cross midfield before the ball lands; nobody can stop the return early
- [x] E11 In-game depth chart shows who's hurt (and why a player isn't playing)
- [x] L1 Short-week fatigue + prime-time pressure in played franchise games
- [x] L2 Mindless QB scrambles closer to 3-4 yds

## Update 1.2 (user's picks from the ideas list)
Phase A — playbook and trick plays
- [x] A1 Trick Plays: Wildcat (direct snap to a back), two-QB set (QB2 as a receiver / passer), fake spike
- [x] A2 RPOs: run/pass read after the snap (QB reads a defender: handoff or quick throw)
- [x] A3 Designed screens: linemen release, a timed window (HB, WR tunnel, TE screens)
- [x] A4 Route options: option routes break in/out/sit by the defender's leverage
- [x] A5 Audible packages live in the playbook: pick your audibles per formation (editable; the in-game audible menu uses them)
Phase B — QB play and reads
- [x] B1 Pocket movement: step up / slide / climb on the stick in the pocket; pocket-presence feel (awareness)
- [x] B2 Pre-snap reads: hold a button to see the likely coverage (shell, man/zone) with confidence by QB awareness
Phase C — defense
- [x] C1 Bracket coverage (double the best receiver; CPU brackets your star)
- [x] C2 Press-bail (show press, bail at the snap)
- [x] C3 Simulated pressure / creepers: show 6-8 at the line, an unknown number actually come
- [x] C4 Pick-six / turnover returns: the defense turns into blockers with a convoy
Phase D — special teams
- [x] D1 Aim kickoffs and punts before the snap (direction + coffin corner / pooch)
- [x] D2 Return schemes: kick return left / right / middle wall; punt return Block / Return / Safe
- [x] D3 Scoop and score on blocked punts / FGs (live ball, defense can return it)
- [x] D4 Kickoff out of bounds: receiving team chooses the ball at the 40 or a re-kick from 5 yards back
Phase E — physics and realism (as much as possible)
- [x] E1 Gang tackles / pile pushes (forward progress by the pile)
- [x] E2 Stiff-arm contest, hurdles, pylon dives, ball-security arm (carry in the outside arm, switch with RS)
- [x] E3 Tipped passes at the line (rushers' hands up), deflections into the air, more realistic ball physics
- [x] E4 Footing: slips on hard cuts in rain/snow, field surface (grass / turf) affecting speed and injuries
- [x] E5 Sideline toe-tap / drag-feet catches, momentum carries runners out of bounds, diving catches
- [x] E6 Momentum & mass in collisions (bigger players move smaller ones, trucks, stumbles after contact)
- [x] E7 Fatigue visuals (hands on knees), muddy / grass-stained uniforms over the game
Phase F — presentation
- [x] F1 Win-probability graph (post-game panel, plus key-plays list)
- [x] F2 Broadcast camera packages: All-22, skycam, end zone, sideline cable cam (Settings + in-game cycle)
Phase G — modes and customization
- [x] G1 Local co-op on the same team (2 humans on offense or defense together)
- [x] G2 Uniform creator (jersey / pants / helmet / stripes / numbers; home / away / alt)
- [x] G3 Stadium creator (seat colors, roof, end zone art, field logo, name)
- [x] G4 Play designer upgrades: drag routes visually, option routes, defensive play designer, share-codes
- [x] G5 Face / body options for created players; mod packs (JSON formations / plays / rules / uniforms)
- [x] G6 One combined league spreadsheet: every CSV (teams, roster, depth, coaches, uniforms, stadiums, retired,
      schedule, free agents) in a single file with sections; import / export / public/local/league.csv

## Update 2.0: Realism (graphics, animation, gameplay feel)
Goal (user): features are solid; now make it look and move like a real broadcast game. All art stays original / procedural.
- [x] R1 Player bodies: one smooth skinned body per player (GPU skinning from a bone texture, instanced), muscled
      profiles, jersey over shoulder pads, numbers / names printed on the jersey, fabric / helmet clearcoat materials,
      better helmet + facemask cage + cleats; shadows skinned too.
- [x] R2 Field: realistic grass (blade noise, mowing stripes every 5 yds, normal / roughness), crisp painted lines, worn
      areas between the hashes; higher-res texture with anisotropy.
- [x] R3 Lighting + post: softer shadows, contact shadows under players, bloom on lights, broadcast color grade, SMAA;
      adaptive quality.
- [x] R4 Camera: broadcast default behind the offense, lower and tighter (like a TV game), smooth framing of the play.
- [x] R5 Animation: real stances (3-point, 2-point WR split, QB under center / gun, RB), gait with lean and arm pump by
      speed, accel / decel / cut lean, QB drop steps + throwing motion, blocking engagements (hands inside, leverage),
      wrap tackles, catches, backpedal / turn and run for DBs, foot planting (less sliding).
- [x] R6 Stadium + crowd: people-shaped crowd with variety and motion, stadium tiers / ribbon boards / sideline detail.
- [x] R7 Gameplay feel: momentum, turning radius at speed, plant-and-cut, collision reactions (already in the sim: agility-limited
      lateral acceleration = wider turns at speed, 1.6x braking, momentum knock-downs; now visible through the gait's lean).

## Update 3.0: Realism II (real people, motion capture, contact, broadcast)
User: "do all of this" (Phases A-D), check-ins every 4 h from 6:11 PM Central. Outside assets are allowed only when they are
public domain / free for any use (CC0, CMU mocap); each one is listed with its license in `public/assets/CREDITS.md`.
Sources reachable from the container: public GitHub repos (git clone), npm. Polyhaven / ambientCG are blocked by the
environment's network policy (the user can allow them in the environment settings).
- [x] A1 Human base mesh: a public-domain human (MakeHuman CC0 base mesh) shaped into a football build (pads, pants, socks,
      gloves as regions), skinned to our 13-bone skeleton (weights from the bone distance / MakeHuman weights), drop-in for
      render/body.js (same bone texture, regions, numbers); LOD (the procedural body far away).
- [x] A2 Materials: jersey mesh / stretch fabric, pants sheen, rubber gloves, skin subsurface look, sweat sheen late in games;
      grass from a CC0 texture set if reachable (else improved procedural), painted-line roughness; GTAO ambient occlusion
      (High), contact shadows. Done: contact shadows (instanced soft patch per figure), sweat sheen (`setSweat`); GTAO skipped (its
      depth pass would ignore our GPU skinning), textures blocked (see above).
- [x] B1 Mocap pipeline: tools/mocap.js reads CMU BVH (data from github.com/una-dinosauria/cmu-mocap, free for any use),
      retargets to our skeleton (joint angles per bone), loops / trims, writes compact clips to src/render/clips/*.json.
- [x] B2 Locomotion from mocap: walk / jog / run / sprint / backpedal / shuffle clips blended by speed and direction (phase
      matched), with the gait's planted feet and IK on top; procedural poses stay for stances, signals and anything without a clip.
      Done: 7 forward clips 1.65-5.77 yd/s (CMU tops out there; faster = the top clip exaggerated). TODO later: backpedal /
      shuffle clips (69_34.., 69_42..).
- [x] B3 Action clips: throw (CMU football throw), catch, jump, fall / stumble, celebrations; blended into the current poses. Done: action-clip pipeline
      in tools/mocap.mjs (`ACTIONS`, key = peak hand speed); no CMU throw is a usable QB release (33_01/34_01 underhand,
      33_02's peak is a catch), so the hand-built throw stays; catches use the arm IK.
- [x] C1 Paired contact: tackles where both bodies move together (wrap, drive back, twist down), blocks with hands on the
      chest and leverage, gang tackles / piles; render-side alignment of the two players. Done: tacklers close to wrap distance and face the runner (`wrapTarget`,
      gang tacklers too), blockers' hands reach the other man's chest by distance and both square up.
- [ ] C2 Physics falls (next): simple per-body ragdoll-ish fall (momentum + ground contact) so no two tackles look the same.
- [ ] D1 Stadium: upper deck, suites ring, roof fascia, sideline benches / tents / cameras, end-zone seating detail.
- [ ] D2 Broadcast: camera cuts between plays (huddle close-up, sideline, crowd, coach), better replay angles, a lower-third
      for players with stats (face photo), field-level shot after big plays.
- [x] Extra (user priority: player look): helmet / facemask / chin strap, V-neck, sleeve + sock stripes, gloves, printed
      numbers as projected patches, athletic-mesh fabric normal map, drape / tuck / knee wrinkle shading, big helmet logos.

## Update 5.0: Realism III (animation, franchise realism, controls)
User's list: every animation item, better contract talks, more realism, stronger trade AI, button remapping,
analytics; practice-squad loophole; no tells in 2-player; later: phones, commentary.
Done: practice squad / dead money (d67adc2, bd4b596), 2-player no tells (903b4e4, bd4b596).

### Animation reference notes (user's console-football clips, 30 fps, low resolution; reference only, nothing copied)
- Line at the snap: OL fire out of 3-point / 2-point stances with hips low; within ~0.2 s they're chest to chest with
  a DL, hands inside on the pads, heads up, feet wide and choppy. Pairs drift as a unit; a beaten blocker turns his
  hips and gets shoved aside; bodies end up on the ground at the line on runs (piles of 3-5).
- QB: under center he's bent at the knees and waist, hands under; shotgun = hands out at the belt, knees bent. On the
  drop the ball rides high at the chest in both hands, shoulders turned side-on; hands off with the far arm extended
  into the back's pocket (back: inside arm up, outside arm under).
- Tackle (sideline, ~0.5 s): the tackler leaves his feet at ~1.5 yd, arms wrap the waist/thighs, both bodies rotate
  and land together, they SLIDE ~1 yd on the turf after landing, the runner's legs kick up, the ball arm stays tucked.
  Gang tacklers arrive late and drop onto the pile, knees first.
- Catch: receiver turns his chest to the ball, arms extended forward with hands together ~0.3 s before it arrives;
  defender jumps with BOTH arms straight up to bat it; a loose ball draws players bending deep at the waist.
- Runner: ball tucked high and tight, strong forward lean in the first steps, long strides in the open; pursuit runs
  with arms pumping hard and a lower trunk.
- Presnap: receivers in a staggered 2-point stance (one foot back, hands on thighs or loose), linebackers with
  hands on knees, DBs bent with weight forward, DL in 3/4-point stances with the hips higher than the shoulders.

### Animation slices (one commit each; stances keyed to position / formation only, never the play call: no 2P tells)
1. Stances  2. QB drops / play action / throw on the run  3. Line engagement + visible rush moves
4. Paired tackles (wrap + land together + slide)  5. Catch variety  6. Cuts / DB footwork  7. More mocap (if reachable)
Every new anim name: HOLD / HOLD_TIME, FAST_FADE, GAIT_ANIMS / noGait, LIMP_ANIMS, REACH_ANIMS, MOCAP_ANIMS,
Presentation proxies, replay encoding.

### 5.0 visual notes (the user's Drive folder, Nov 20 screenshots; reference only: our own designs, no copied marks)
In game: blue line of scrimmage + yellow line to gain (LOS red on 4th down); a slanted down & distance / play clock tag on
the turf beside the ball pre-snap, colored per broadcast package; time-slot packages (afternoon / Sunday night / Monday night /
Thursday night: scorebug colors + an intro shield badge on a tunnel road); top-right callout pills with the button
("POSSESSION CATCH!", contextual tips); celebration picker as a list bottom-left; touchdown lower third = full-width team-color
band, team name over a giant TOUCHDOWN; field goal panel (FIELD GOAL, wind mph + arrow, aim) + a "TEAM 42 YARD FG" chip + a
curved meter by the kicker; scorebug middle swaps to a stat comparison between plays (4th down conversions 0 0) and short
banners ("DEFENSE FLIPPED"); crowd dB meter; bottom ticker with milestones + progress bar; defensive play art labels each zone
(DEEP ZONE / HOOK CURL / CURL FLAT); controlled player = hexagon (done), names white (done).
Menus: final-score banner (two team halves, FINAL, score); post-game player stats = header photo card + LT/RT chips + table;
play history list (pause); gameday: the better OVR/OFF/DEF badge green, giant faded team letters behind logos; matchup page
(team stat ranks both sides + each side's top 3 players); team-info page (my rankings with league rank + top prospects for
needs); manage roster: morale / health / cap-space rings with a cap breakdown (salaries, dead cap); roster table with
morale + contract columns and a player card side panel; draft: board of picks in team colors, on-the-clock panel with next
teams, pick ticker, prospect table (rank, projection, talent, scout % bar, archetype, letter grades), scouting report
(notes, top fits, key ratings as letter grades, team needs with grade / active / required), a pick grade after your
selection (GOOD PICK + letter, true-value rank vs pick), draft class table; playoff bracket board; QB sneak timing meter.

### Game Play 9 reference (the user's 50-min Monday-night game, 1,503 frames at 1 per 2 s; reference only: our own designs, no copied marks)
Seen, roughly in order. [have] = already in Gridiron 27, [new] = added Nov 21, [todo] = not yet.
- Pregame: publisher / league logo stings (skip: their IP); stadium drone / firework show forming the home logo [todo]; tunnel
  close-ups of players walking out (helmet on, smoke, team lights) [have: run-out, could be closer]; team run-out through a giant
  inflatable / smoke [todo]; team logo card in team color [new: `hud.logoCard`]; head-coach lower thirds on the sideline (name, "Nth season
  as head coach", record) [new: `hud.introCard('coach')`]; "MONDAY NIGHT PRIMETIME" title card [have: package badge]; starting QB card ("LAST SEASON" stats,
  photo) over a sideline shot [new: `introCard('qb')`, ratings instead of last season].
- Between plays: play-call screen over the huddle [have]; close-ups of players walking back / talking after the whistle [have:
  spotlight on big plays, help-ups, reactions]; coach with the play sheet [new: pose `playsheet`]; the huddle from low [have].
- Touchdown: full-screen stylized TOUCHDOWN title (scorer under a spotlight, team logos either side) [new: `hud.tdTitle`], then a scorer card
  (team-color pattern, FIRST name thin / LAST bold, POS #, headshot) [new]; linemen walking off with a SCORING DRIVE banner (plays /
  yards / time) [new: `#drivecard`, `hud.pendingDrive`, shown at the next kickoff call].
- Kicks: behind-the-kicker shot with the landing zone / meter [have]; "IT'S GOOD" on the ribbon boards [have: board flash].
- Halftime: a studio-like stat board (each team's QB / HB / top receiver lines with headshots, score, records) then a
  "HALFTIME REPORT" card [new: `Screens.halftimeBoard` → the halftime report].
- End: scorebug over an aerial stadium shot, MONDAY NIGHT PRIMETIME outro, final stats screen [have: post-game].
