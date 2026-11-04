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
- [ ] D3 Cutscenes: coaches, fans, tunnel run-out (skippable); TD camera locks on the scorer; kickoff camera
- [x] D4 Celebrations (TD, sack, INT, first down) incl. RS celebration wheel
- [x] D5 Tackle falls in the right direction, referees run, animations
- [ ] D6 Dynamic lighting, holiday decorations (Thanksgiving leaves, Christmas)
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
