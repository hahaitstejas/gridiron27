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
- [ ] A6 Fake punts/FGs harder (defense reads them, contain)
- [ ] A7 Hail Mary + trick plays folder (flea flicker, philly special-style, hook and ladder, laterals at end of game)
- [ ] A8 FG block: MLB no free middle, longer kicks block more often, user edge rusher with X dive
- [ ] A9 Juke rework (lateral cut, no backward loss, actually beats the defender)
- [ ] A10 QB: no infinite scramble/hold (pressure collapses, sack), no guaranteed 5-yd QB runs, pressure hurts accuracy
- [ ] A11 Defender jumping the QB at the LOS (cheese 5-yd passes) — keep man coverage on the receiver
- [ ] A12 Deep zones out of bounds inside the 10 (clamp landmarks to the field of play)
- [ ] A13 Kickoff: nobody moves early, offsides rule checked
- [x] A14 No huddle: same personnel; no huddle not allowed right after the two-minute warning
- [x] A15 CPU snaps too fast after a huddle (give the human time)
- [x] A16 After a timeout teams can repick the play
- [ ] A17 Timeout button mapping (hold both bumpers), 2-player pause/timeouts, 2-player controller fix, hide play name in 2P
- [ ] A18 QB slide spot; fair catch shown as an action; hit stick (RS flick) high risk/high reward
- [ ] A19 Pass rush improvements; weather effects on throwing
- [ ] A20 Overtime = current NFL rules (regular season: both possess, 10 min; playoffs)
- [ ] A21 Coach suggestions match the situation; recent plays tab; more plays
- [ ] A22 Catch buttons A secure / X run after / Y aggressive

## Phase B — menus
- [ ] B1 Remove all outlines (panels, logos, selection box) everywhere; slider focus visible
- [ ] B2 Pause: bigger graphic, comp% ring, INT, QBR
- [ ] B3 Post-game screen from the mockup (finish, highlights, player/team stats, score summary, restart, top players, score by quarter)
- [ ] B4 Team select: LT random team, A → side menu (Ready, Traits, Advanced settings: playbook, coin toss; Edit uniforms)
- [ ] B5 Settings, training, every remaining old-style screen restyled
- [ ] B6 Teams alphabetical everywhere
- [ ] B7 Sortable stat columns (X sorts), COMP% in passing, targets + catch% in receiving
- [ ] B8 Franchise hub: a few boxes that open sub-menus
- [ ] B9 Depth chart "play the backups" button

## Phase C — franchise realism
- [ ] C1 17-game NFL schedule formula only; schedule CSV import; primetime + kickoff times, short weeks, holidays, international games
- [ ] C2 Injuries: realistic rate, specific injuries, questionable/out during games, severity after, re-injury risk choice, IR
- [ ] C3 Practice squad, waivers, elevations
- [ ] C4 Weekly progression (in-season growth), morale (temporary rating effect), trade demands
- [ ] C5 CPU signs free agents; +500 generated FAs option; 300 UDFAs each season
- [ ] C6 Trades: fix one-sided trade bug, trade block + offers, draft-pick trading, view roster/depth during trades/draft/resign
- [ ] C7 Draft: better screen, draft class CSV import, scouting all year, compensatory picks
- [ ] C8 Franchise tag, Pro Bowl / All-Pro teams (raise asks), league-wide player search, leaders highlight my players
- [ ] C9 Roster CSV contract columns (salary, years); retired numbers CSV; position number rules everywhere
- [ ] C10 Coaches CSV (HC/OC/DC with tendencies) feeding the CPU play caller; game preview screen from coordinators
- [ ] C11 Score ticker banner (other games by quarter)
- [ ] C12 Uniform editor + uniforms CSV (home/away/rivalry: jersey, pants, number, number outline)
- [ ] C13 Stadiums CSV (fictional defaults), neutral championship venue each year

## Phase D — presentation
- [ ] D1 End zones: team name / city, conference + league logos; championship end zones
- [ ] D2 Glossy 3D logos
- [ ] D3 Cutscenes: coaches, fans, tunnel run-out (skippable); TD camera locks on the scorer; kickoff camera
- [ ] D4 Celebrations (TD, sack, INT, first down) incl. RS celebration wheel
- [ ] D5 Tackle falls in the right direction, referees run, animations
- [ ] D6 Dynamic lighting, holiday decorations (Thanksgiving leaves, Christmas)
- [ ] D7 RT play art zooms out to the whole field
- [ ] D8 Tush push timing bar play

## Progress log
- A1-A5, A14-A16 (commit 1): game/winprob.js (EP table, conversion rates, drive-level win probability) drives 4th downs and
  accept/decline; spike only when it helps; end-zone INT kneel; FG distances rounded up + "N-YARD ATTEMPT"; clock runs
  visibly between plays; CPU waits 5-7.5 s at the line vs a human defense; no-huddle keeps personnel, not right after the
  two-minute warning; timeouts send both teams back to the play call; both bumpers = timeout; Match.callTimeout now
  returns true (icing and CPU timeout rest never fired before).
