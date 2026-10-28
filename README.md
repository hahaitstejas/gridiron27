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
and press **A** — or press **Enter** to use the keyboard.

### Controls (Phase 1)
| | Xbox | Keyboard |
|---|---|---|
| Move | Left stick | W A S D |
| Snap / stiff arm / swat | A | J or Space |
| Throw to receiver | A B X Y RB (tap = lob, hold = bullet) | J K U I O |
| Change play (pre-snap) | X | U |
| Play defense / offense (pre-snap) | LB | Q |
| Sprint | RT | Shift |
| Juke / truck / hit stick | Right stick ← → / ↑ | Arrow keys |
| Spin · Dive · Hurdle | B · X · Y | K · U · I |
| Switch defender | B | K |
| Throw away | RS click | R |
| Controls panel | — | H |

Debug: `http://localhost:5173/?auto&speed=6` watches CPU vs CPU at 6x speed.

### Customize your league (personal use)
```bash
npm run export-league
```
creates `public/local/teams.csv`, `roster.csv` and `depth.csv`. Open them in Numbers, Excel or Google Sheets,
edit team names/colors, players, numbers, ratings and depth charts, save as CSV (same names), and reload the
game. That folder is not uploaded to GitHub.

See [CLAUDE.md](CLAUDE.md) for architecture, data formats and testing.
