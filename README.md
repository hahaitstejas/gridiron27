# Gridiron 27

An original 3D American football game that runs in the browser (Three.js + Vite), played with an
Xbox controller or the keyboard. All teams, players and branding are fictional.

## Play it

Requires [Node.js](https://nodejs.org) 20.19+ (the current LTS is fine).

```bash
git clone https://github.com/hahaitstejas/gridiron27.git
cd gridiron27
npm install
npm run dev
```

Open **http://localhost:5173** in Chrome or Safari. Turn on your Xbox controller (paired over Bluetooth)
and press **A** — or press **Enter** to use the keyboard. Pick **Play Now**, choose teams, which side you
control, difficulty (Rookie / Pro / All-Pro / Legend), quarter length and penalties, then **Start Game**.

**No wifi?** Build one self-contained file once:

```bash
npm run build:offline
```

Then double-click `dist-offline/Gridiron27.html` (or drag it onto Chrome / Safari) anytime: no server, no internet.
Copy it anywhere you like. A file opened from disk keeps its own saves, so to bring your league over use
League → Saves & Files → Export, then Import in the offline copy.

### Controls
| | Xbox | Keyboard |
|---|---|---|
| Menus: move · select · back · tabs | D-pad / left stick · A · B · LB/RB | WASD or 1–4 · J · K · Q/O |
| Play call: formation · more plays · call the left/middle/right play | LB/RB · stick ◀▶ (▲▼ jumps a group) · X / A / Y | Q/O · A/D · U / J / I |
| Play call: flip · no huddle · timeout | RT · LS click · View | Shift · F · T |
| Snap | A | J or Space |
| Pause | Menu | Enter / Esc |
| Move | Left stick | W A S D |
| Sprint | RT | Shift |
| Throw to receiver | A B X Y RB (tap = lob, hold = bullet) | J K U I O |
| Throw away | RS click | R |
| High / low pass | hold LB / LT while throwing | Q / E |
| Pump fake | LS click | F |
| Pass-rush moves (defense, engaged with a blocker) | A bull rush · X swim · Y spin · RS ↓ rip (rating contest vs the blocker) | J · U · I · ↓ |
| Option: pitch / keep | LB pitches (speed option); hold LT through the mesh to keep (zone read) | Q / E |
| Juke / truck / hit stick | Right stick ← → / ↑ | Arrow keys |
| Stiff arm · Spin · Dive (QB: slide) · Hurdle | A · B · X · Y | J · K · U · I |
| Switch defender (pre-snap and during the play) | B | K |
| Defense: dive tackle · strip · swat/catch | X · Y · A | U · I · J |
| Kick meter: start · power · accuracy | A · A · A | J · J · J |
| Returner: fair catch · kneel in end zone | Y · X | I · U |
| Penalty against the CPU: accept / decline | A / X | J / U |
| Spike (at the line) | B | K |
| No-huddle: rerun last play (play-call screen) | Y | I |
| Timeout (between plays) | View (or Share) | T |
| Audible (pre-snap) | X, then A/B/X/Y/RB | U, then J/K/U/I/O |
| Hot route (pre-snap) | Y, receiver button, then left stick (A = block) | I, receiver key, then WASD |
| Motion (pre-snap, offense) | RB, receiver button, then left stick (toward the ball = across) | O, receiver key, then A/D |
| Coverage (pre-snap, defense) | LB, then A press / B off / X shade inside / Y shade outside / RB reset | Q, then the same keys |
| Instant replay (between plays) | RS click | R |
| Depth chart (pause menu → Coaching) | A pick up / drop, ▲▼ move, X remove | J, W/S, U |
| Controls panel | — | H |

Kicks use a three-press meter: press A to start the kicker, A again to set power on the way up, and A a
third time as the needle comes back to set accuracy (closest to the line = straightest).

**Practice** (main menu) runs any play from any spot and situation with no clock. **Settings** has the camera (standard / wide / tight / high), name tags, the post-play stat card and automatic replays of big plays.

Debug: `http://localhost:5173/?auto&speed=6` watches a full CPU-vs-CPU game at 6x speed
(`&q=1` for 1-minute quarters).

### Two players
Play Now → **You play as: 2 players**. Player 1 (home) uses the first controller (or the keyboard), player 2 (away)
presses A on a second controller when asked. Each picks their own plays and controls their own team.

### Playbook editor
League → **Playbook**: design your own plays. Pick a formation, give every receiver a route (or a block), the
primary read, QB drop, play action or a bootleg, or build a run (ball carrier, direction, hole, zone or power
blocking). Test runs it against CPU defenses. Your plays appear in the **My Plays** tab when you call a play.

### Trick plays
Zone read and speed option, jet sweep (the snap button starts the motion, the ball is snapped as he reaches the QB),
designed QB runs, and fake punts / a fake field goal in the Special Teams tab on 4th down. The CPU calls QB runs
only with a mobile quarterback and fakes now and then on 4th and short.

### League identity
League → Teams & Logos → **League & Conferences**: rename the league, the championship game and both conferences,
and build or upload a league logo. It's painted at both 25-yard lines, and at midfield in the championship game.

### Weather
Play Now has Weather (clear, rain, snow, windy, random) and Time of day (day, dusk, night, random). Rain makes the ball
slippery, snow slows footing, and wind pushes kicks and deep passes (the kick hint shows it). Franchise games get
their own weather, with snow late in the season.

### Franchise
Main menu → **Franchise**: pick your team and season length (6, 10 or 17 games). Play your games or sim them,
follow standings, results and league leaders, make the playoffs, then run the offseason: progression and
retirements, re-sign players, free agency, a 7-round draft and cut-downs to 53. Several franchises can be saved;
the Franchise menu lists them.
Money: every player has a salary and contract years under a salary cap (Contracts & Cap in the hub). Trade with CPU
teams before the deadline (they want fair value and both teams must fit under the cap); CPU teams trade too
(Transactions). Re-signing, free agents and cut-downs all have to fit under the cap.
News follows the league (big results, injuries, trades, records); awards (MVP, Player and Rookie of the Year) are
handed out after the regular season; league records and past champions are kept. In the draft you see scouting
estimates: spend scouting points (X) to reveal a prospect's real overall and potential.

### Your league
Main menu → **League**: edit rosters (every player and rating, add, trade, release), teams and logos (logo builder
or your own image), depth charts, and save your league (it autosaves; Saves & Files also backs it up to a file).
Spreadsheets exports/imports the CSV files below from inside the game.

### Customize your league with spreadsheets (personal use)
```bash
npm run export-league
```
creates `public/local/teams.csv`, `roster.csv` and `depth.csv`. Open them in Numbers, Excel or Google Sheets,
edit team names/colors, players, numbers, ratings and depth charts, save as CSV (same names), and reload the
game. That folder is not uploaded to GitHub.

See [CLAUDE.md](CLAUDE.md) for architecture, data formats and testing.
