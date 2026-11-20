# Gridiron 27

A 3D American football game you play in your browser. Controller or keyboard. All teams, players and leagues are fictional.

## Play now

**[▶ hahaitstejas.github.io/gridiron27](https://hahaitstejas.github.io/gridiron27/)**: no install, no account.
Also on **[itch.io](https://hahaitstejas.itch.io/gridiron-27)**. Desktop Chrome, Edge or Safari.

Press any button, pick **Play Now**, choose two teams, play. Your first game shows the basic controls; press **H** in a
game for all of them. Saves stay in your browser.

## Controls (the essentials)

| | Controller | Keyboard |
|---|---|---|
| Move · sprint | Left stick · RT | WASD · Shift |
| Pick a play · snap | X / A / Y · A | U / J / I · J or Space |
| Throw to a receiver | his button (tap = lob, hold = bullet) | J K U I O |
| Juke · truck | Right stick ◀▶ · ▲ | Arrow keys |
| Switch defender | B | K |
| Timeout · pause | View / both triggers · Menu | T · Esc |

Everything else (audibles, hot routes, coverage calls, rush moves, catch types) is on the in-game **H** panel and in
Settings → Controls.

## Modes

- **Quick Play**: any two teams, vs the CPU (4 difficulties) or a friend on one screen (no peeking: calls stay hidden).
- **Franchise**: seasons, playoffs, trades, free agency, contracts and the cap, the draft, the offseason. Also a single
  season, a tournament and **Career** (one player, earn your way up).
- **Practice**: any play from any spot, skills drills with medals, late-game scenarios.
- **Edit League**: rosters, ratings, teams, logos, uniforms, depth charts, your own plays.

## Run it yourself

Needs [Node.js](https://nodejs.org) 20.19+.

```bash
git clone https://github.com/hahaitstejas/gridiron27.git
cd gridiron27
npm install
npm run dev
```

Then open **http://localhost:5173**. No internet later? `npm run build:offline` makes one file,
`dist-offline/Gridiron27.html`, that you can double-click anywhere.

**Your own league:** `npm run export-league` writes editable spreadsheets to `public/local/` (teams, rosters, depth
charts, uniforms, stadiums, coaches); edit them in any spreadsheet app and reload. That folder never leaves your computer.

Developers: see [CLAUDE.md](CLAUDE.md) for architecture, data formats and tests. Credits for third-party art and motion
data are in Settings → Credits and [src/assets/CREDITS.md](src/assets/CREDITS.md).

© 2026 hahaitstejas. All rights reserved (see [LICENSE](LICENSE)).
