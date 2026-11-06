# Gridiron 27: handoff for a new Claude Code chat

Paste this into a new chat. The repo's `CLAUDE.md` is loaded automatically and has the full architecture, so this file only covers what came from the conversation: the rules, the user's preferences, the state of the work and what is still open.

## Project
- Gridiron 27 is an original 3D American football game: Three.js and Vite, plain JavaScript ES modules.
- Repo: `hahaitstejas/gridiron27`. It is **public**. Work on the branch `main` and push there.
- The user plays it on an M3 MacBook Air, in Chrome, with an Xbox controller. Their repo is `~/gridiron27`.
- After every push, give them these steps:
  ```bash
  git checkout -- package-lock.json   # npm install on their Mac edits it and blocks the pull otherwise
  git pull origin main
  npm install                          # only when dependencies changed
  npm run dev                          # http://localhost:5173
  ```
- The Mac app (Electron, `npm run app:build`) currently shows only helmets. The user said to ignore that for now.

## Rules that always apply
- Never commit any NFL, NFLPA, EA or Madden names, logos, teams or other IP. The repo is public.
- Personal content goes in `public/local/`, which is git-ignored, and is never committed. That includes:
  - real player names and the user's league CSVs (e.g. `league_4.csv`, which has ESPN logo and headshot URLs)
  - logos and faces
  - the personal app icon `public/local/app-icon.png`
- Outside art or animation data must be CC0 or public domain (MakeHuman CC0, CMU mocap), and must be listed in `src/assets/CREDITS.md`.
- Madden is the visual and feature reference. Copy layouts and ideas, never their assets.
- Sim, ai, game and data code stays pure and deterministic: no DOM, and no `Math.random`.
- After gameplay changes, run `npm test`, `npm run build`, `npm run games -- --games 4` and `npm run fuzz`. Keep the numbers in CLAUDE.md's "Conventions" section.
- Commit messages end with the attribution lines the system gives you. Never put model names in commits.
- The user's email is for identification only. Don't put it in files.

## How the user likes to work
- They write short, informal messages with typos. They send numbered or bulleted fix lists, often with screenshots or Google Slides PDFs of mockups. Yellow boxes in their mockups are notes to you, not UI.
- "Don't add features just because they're in my design": only build what the game already has or what they asked for.
- Menus should look like a modern console game:
  - The current style is **monochrome** (black, white and gray), with Oswald for display type and Saira Condensed for body text.
  - No outlines, filled panels, the focused item white.
  - Team colors only on team screens.
  - Team lists are always **alphabetical by team name**.
- They asked for caveman-style short replies (`/caveman:caveman`), so keep chat replies brief.
- They want realism (NFL rules and studies) and Madden-like presentation.
- They test in the browser, not the app.

## What was done in this chat (newest last)
1. **Image relay** `/remote?u=` (dev server + Electron, `tools/remote-images.cjs`): web logos and face photos load without CORS problems.
2. **`[LEAGUE]` section in league.csv**: league name, championship name, league logo and conference logo links (`data/leagueBook.js`).
3. **Freezes during plays:**
   - face photos are decoded once and kept as 96 px copies
   - smaller face atlas
   - the HUD no longer forces a page layout every frame
   - the user later said "freezing has gone away"
4. **Cameras:** a wide camera for a human on offense or defense, and on kicks (`CameraRig.wideView`); bigger midfield logo; the play name is no longer shown at the top.
5. **Stats:** TFL for defenders, FUM / FL for runners and receivers.
6. **Menus and franchise rules:**
   - teams alphabetical everywhere
   - `Nav.memory`: backing out returns to the row you picked
   - a career player is no longer the automatic starter (`slotCareer`)
   - championship MVP award
7. **UPDATE 3.1 redesign, from the user's 10-slide PDF:**
   - load-in screen: GRIDIRON [league logo] 27, "PRESS ANY BUTTON"
   - see-through play-call band
   - league logo in the scorebug, and a TOUCHDOWN / FIELD GOAL takeover of the scorebug
   - hold-RT names and a down & distance / play-clock badge
   - replay stripe bumper
   - franchise team pick (`ui/teamPick.js`)
   - franchise hub tabs: Gameday, Weekly Hub, Manage Roster, Front Office, League, plus a News Center ticker
   - standings as team-colored division columns
   - league leaders overview
   - draft board
   - a global style sweep
   - `el()` now sets CSS variables with `setProperty`
8. **Last user batch:**
   - soundtrack removed (the user hated it)
   - kick return: the camera and the stick both face upfield from the line (`sim.camDir = -sim.dir`); the stick used to be reversed
   - timeout = **both triggers** (LT+RT) or View; bumpers no longer
   - kneel pose instead of a forward dive (`p.kneeling`, anim `kneel`)
   - opening cut-down to 53, extras to the practice squad or free agency (`trimRosters`)
   - roster team picker 8 across
9. **Home menu rebuilt from the user's reference image, in black and white:**
   - a thin left icon rail: wordmark at the top, then Quick Play / Franchise / Edit League, then Settings at the bottom
   - the selected mode's crumbs, big title, one line and sub-mode cards, shown on the darkened stadium
   - a black hint bar
   - `el.navTo = { left: el }` pins a direction in nav

## Still open / ideas the user asked for (not done)
- Finish the UI redesign everywhere in the same monochrome style:
  - Weekly Hub story cards
  - Quick Play Team Select as a carousel
  - post-game screen
  - roster editor, player card and depth chart, laid out by position group
  - pause menu
  - Training / Scenarios
  - Playbook editor
  - Tournament
  - Career
- "Look up Madden 27 gameplay and replicate the realism": an ongoing goal. YouTube can't be watched from the cloud box.
- UPDATE_PLAN items not done:
  - C2: ragdoll-ish physics falls
  - D1: stadium upper deck, suites, sideline detail
  - D2: broadcast cuts between plays, lower-thirds with photos
- Possible freeze leftovers:
  - the catch pulse-ring shader compiles on first use (fix: precompile with `renderer.compile`)
  - the review box innerHTML is rewritten every frame
- Mac app shows only helmets (deferred).
- College football mode: a future idea only. The user said not to start it.
- Kneel pose, kick-return controls and the trigger timeout were never tested with a real controller. Ask the user how they feel.

## Testing tricks used here
- Headless Chromium works: SwiftShader, `require('playwright')` via `createRequire`. Set `localStorage g27.settings = {"graphics":"low","intro":false}`.
- Keyboard mapping:
  - WASD = left stick (moves through menus)
  - arrows = right stick
  - J / Space = A, K = B, U = X, I = Y, Q = LB, O = RB
  - Shift = RT, E = LT, Enter / Esc = Menu, T = View
- Handy page hooks:
  - `__g27.startGame({...__g27.prefs, side:'home'}, {practice:{side:'offense',yardLine:25,down:1,toGo:10,after:'reset'}})`
  - `__g27.franchiseUI.newFranchise()`
  - `__g27.league.onRosters()`
  - `import('/src/franchise/offseason.js')` to jump to the draft
- Screenshots under SwiftShader are slow. Keep runs short, or they time out.
