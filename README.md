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

### Controls
| | Xbox | Keyboard |
|---|---|---|
| Menus: move · select · back · tabs | D-pad / left stick · A · B · LB/RB | WASD or 1–4 · J · K · Q/O |
| Play call: flip play · timeout | X · View | U · T |
| Snap | A | J or Space |
| Pause | Menu | Enter / Esc |
| Move | Left stick | W A S D |
| Sprint | RT | Shift |
| Throw to receiver | A B X Y RB (tap = lob, hold = bullet) | J K U I O |
| Throw away | RS click | R |
| Juke / truck / hit stick | Right stick ← → / ↑ | Arrow keys |
| Stiff arm · Spin · Dive (QB: slide) · Hurdle | A · B · X · Y | J · K · U · I |
| Switch defender (pre-snap and during the play) | B | K |
| Defense: dive tackle · strip · swat/catch | X · Y · A | U · I · J |
| Kick meter: start · power · accuracy | A · A · A | J · J · J |
| Returner: fair catch · kneel in end zone | Y · X | I · U |
| Audible (pre-snap) | X, then A/B/X/Y/RB | U, then J/K/U/I/O |
| Hot route (pre-snap) | Y, receiver button, then left stick (A = block) | I, receiver key, then WASD |
| Instant replay (between plays) | RS click | R |
| Depth chart (pause menu → Coaching) | A pick up / drop, ▲▼ move, X remove | J, W/S, U |
| Controls panel | — | H |

Kicks use a three-press meter: press A to start the kicker, A again to set power on the way up, and A a
third time as the needle comes back to set accuracy (closest to the line = straightest).

**Practice** (main menu) runs any play from any spot and situation with no clock. **Settings** has the camera (standard / wide / tight / high), name tags, the post-play stat card and automatic replays of big plays.

Debug: `http://localhost:5173/?auto&speed=6` watches a full CPU-vs-CPU game at 6x speed
(`&q=1` for 1-minute quarters).

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
