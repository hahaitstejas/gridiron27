# Gridiron 27: handoff for a new Claude Code session

Paste this whole file into the new session as the first message, or tell it: "read HANDOFF.md in the repo first."

## Who and how

- The owner is the GitHub user `hahaitstejas`. The repo is `hahaitstejas/gridiron27` (public), and you push straight to `main`.
- **Reply style:** caveman mode for the whole chat. Use short, simple words. Use the `caveman:caveman` skill if it is available.
- **Commands for the owner:** give each one as its own `bash` block. Their Mac update routine is:
  ```bash
  git pull origin main
  ```
  ```bash
  npm install
  ```
  ```bash
  npm run dev
  ```
  If the pull complains about `package-lock.json`, have them run `git checkout -- package-lock.json` first.
- **Work style:** they want you to keep going on long lists without asking. Show them screenshots of visual work (send the files). Be honest about what you verified and what you didn't.

## Hard rules (also in CLAUDE.md, which is the full developer guide: read it)

- **No NFL / NFLPA / EA / Madden IP anywhere in the repo.** That covers code, commit messages and docs. Don't name the reference game or real broadcasters either. Reference pictures are for layout ideas only; use our own marks and names (for example the slot marks TNG / SNG / MNG instead of a broadcaster's).
- **Outside assets** must be CC0 or free for any use, and each one goes in `src/assets/CREDITS.md` and on Settings → Credits.
- **Personal content** stays in git-ignored `public/local/` only.
- **Never put secrets** or the user's email in files or messages.
- **The sim is pure and deterministic.** The `src/core`, `sim`, `ai`, `game` and `data` folders have no DOM or Three.js code and no `Math.random()`; everything goes through the seeded `RNG`.
- **Before every commit**, run `npx vitest run` (161 tests now) and `npm run build`. Gameplay changes also need `npm run sim -- --plays 2000` and `npm run bot`; check the targets in CLAUDE.md "Conventions".
- **Commit message footer:**
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <the session URL the harness gives you>
  ```
- **License:** all rights reserved (LICENSE file; package.json says "UNLICENSED").
- **Update CLAUDE.md** when you add a system; keep it the source of truth.

## Testing tips (cloud container)

- **Browser:** Playwright plus Chromium are preinstalled. Load them from a script outside the repo with:
  ```js
  import { createRequire } from 'module'; const { chromium } = createRequire('/home/user/gridiron27/package.json')('playwright');
  ```
- **Dev server for scripts:** run it on a different port, `npx vite --port 5199`. Dev hooks are on `window.__g27`: `startGame`, `session`, `hud`, `renderer`, `screens`, `speed`.
  - `window.__g27.speed = 0` freezes a game so you can fake state and screenshot it.
  - Faking `session.state = 'presnap'` without a sim crashes the loop; use `'playcall'`.
- **Speed:** the software-rendered browser (SwiftShader) is very slow. Full screenshots of live games often time out, so clip screenshots to the area you need.
- **Vite reloads:** editing files reloads the page and kills long runs. For long rig runs, serve a static build instead.
- **Prime-time scorebugs** in a test page: `startGame({home:3,away:9,side:'home'}, { gameDay: { slot: 'TNF'|'SNF'|'MNF', prime: true }, noIntro: true })`.

## Where things stand (latest commits on main)

All of the following is pushed:

1. **UPDATE 5.0 franchise:**
   - Practice-squad cheese fixed: dead money, the practice-squad eligibility gap, and moving a player up costs cap.
   - Contract talks (`franchise/negotiation.js`).
   - Stronger trade AI (`teamMode`, fit multipliers).
   - Game Preview team matchup with league ranks.
   - Manage Roster morale / health / cap rings.
2. **2-player no tells:** hidden play call with an LT peek, masked menus, decoy icons, and neutral hints.
3. **Button mapping:** Settings → Button Mapping, for the controller and the keyboard.
4. **Drawn portraits** for players without a photo (`ui/faces.js` `portraitSrc`).
5. **5.1 gameplay fixes:**
   - The QB can't run around the backfield forever.
   - A free rusher gets picked up.
   - The CPU no longer throws the ball away with a clean pocket.
6. **Animation pass 2** (render only, `render/players.js`):
   - stances
   - QB carriage, play-action and handoff
   - line engagement and visible rush moves
   - catch variety (one-handed, basket)
   - footwork accents: DB hip flip, break-on-ball drive, plant on hard cuts, LB crossover (`footwork` / `footworkPost`, counter at `renderer.players.fwCount`)

   These were not checked by eye in this container; ask the owner to watch them on their Mac.
7. **Broadcast touches:**
   - red line of scrimmage on 4th down
   - on-turf down & distance tag before the snap
   - touchdown lower third
   - callout pills
   - "TEAM 42 YARD FG" chip
   - zone labels in the play art
   - blue hexagon player ring
   - draft pick grades
8. **Prime-time scorebugs** (`ui/hud.js` `primeBug`, CSS `.bx-*` / `.sl-*` / `.sh-*`), rebuilt from the owner's reference screenshots:
   - `box` (Sunday night and big games), `slim` (Monday night), `shield` (Thursday night, openers, international).
   - Sized in vw for a 1280-wide screen. Fonts are only Oswald (big numbers) and Saira Condensed. The shield layout has a passer stat tab.
   - The slot comes from `broadcastPackage()` in main.js (`hud.pkg`), with an intro shield badge.
   - Between plays, the scorebug sometimes shows a stat comparison (`bugStat`).
9. **League ticker:** the "Around the League" bar (`#scoreticker`) is always the bottom 28 px; `.with-ticker` lifts the scorebug above it.
10. **Pause → Play History** (`match.playLog`).
11. **Removed at the owner's request:** the on-screen play-by-play strip (`hud.pbp`, PLAY/DRIVE) no longer shows, and drive messages are ignored.
12. **README** is concise, with the play link first. The website (GitHub Pages) and the itch build exist (`npm run build:itch`). Remind the owner to re-upload `release/gridiron27-itch.zip` after big updates.

## The owner's reference material (Google Drive)

- **Folder:** "Gridiron 27" (id `1j1Gbb754L0aj0Xq4tu2x-nmQMPk8td7T`). It holds screenshots of menus and in-game UI, plus gameplay videos (low resolution; one 82 MB clip is over the 10 MB download limit).
- **Updates doc:** "Gridiron 27 Updates (Prompt)" (id `18TqfctQHvZvmepzDUorN4qUkOHma3AQ4J8-d3vxGU90`) lists bugs and next steps. Check it for new items.
- **Notes:** my notes on all the pictures are in `UPDATE_PLAN.md` under "5.0 visual notes" and "Animation reference notes".

## Done in the Nov 21 session (branch `claude/caveman-todo-list-0fkyjw`, not yet on main)

- Crowd noise meter: teal box top-left, big thin dB number, 20-segment bar.
- Scorebug notes for line adjustments (AUDIBLE, OFFENSE FLIPPED, HOT ROUTE, SLIDE LEFT, NO HUDDLE...; 2P: generic).
- Celebration picker: list bottom-left with a time bar.
- Field goal panel (kicker, wind arrow) + curved kick meter beside the kicker.
- Post-game final-score banner (team-color halves); game-stats header card.
- Milestone watch bar over the scorebug.
- Draft: next teams on the clock, grades, NEED fit, scouting report, pick strip.
- In-season contract extensions (Contracts & Cap → A).
- Checked: the between-play stat swap shows on the regular afternoon bar too.

## 3D / animation pass (same branch, after the owner's console reference picture)

- Side key light per time of day (soft high sun by day, crisp dusk, short soft night shadows), lower fill, stronger rim.
- Turf light pools + stronger mow sheen; night haze.
- Console camera for human games: 23 back / 10.2 up / 46 deg presnap (owner chose this "console type").
- Stands: seat rows, stair aisles, tunnels, two decks with a fascia; sideline staff, photographers, benches, coolers.
- Jersey sheen; help-ups after the whistle.
- Skipped: GTAO / SSAO (the override-material pass would draw our GPU-skinned players in the bind pose); CMU backward /
  sideways clips (upright walking, worse than our low backpedal / shuffle poses).

## To do next (in rough order)

1. Owner feedback on all of the above (screenshots were taken in the container; ask them to watch a game on the Mac).
   3D next: brighter / more detailed stands (railings, seat colors), depth of field on close shots, player skin / face detail.
2. Holdouts (players who want a new deal mid-season) if the owner wants them.
3. More animation (optional):
   - more mocap clips (CMU, `tools/mocap.mjs`)
   - paired tackles: both players land together and slide about 1 yd
   - cuts and DB footwork tuning after the owner watches them
4. Owner's decisions:
   - Analytics: not yet.
   - Phones and commentary: Phase 5, later.
