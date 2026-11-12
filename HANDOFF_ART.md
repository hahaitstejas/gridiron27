# Gridiron 27 — handoff for the next chat (player-art overhaul)

Paste this whole file as the first message of the new chat. It carries the project rules, what was done, what is open, and the
scheduled 2:31 AM check-in. (`CLAUDE.md` in the repo is the full developer guide and loads automatically: this file is the
state of the art work and the user's preferences.)

## Who / what
- Gridiron 27: an original 3D American football game (Three.js + Vite, plain JS ES modules). Repo `hahaitstejas/gridiron27`
  (public). Work and push on `main`, it is cloned at `/home/user/gridiron27`. The user plays on an M3 MacBook Air in Chrome with an
  Xbox controller.
- The user's goal right now: make the on-field player visuals as good as the Madden 27 reference they showed (Madden = a quality
  reference only, never copy assets or names). They have said repeatedly it is still far from Madden. They want substantial, honest
  progress and no small cosmetic additions that do not move the rendered player.

## Standing rules (still in force)
- Never commit NFL / NFLPA / EA / Madden names, logos, teams or other IP. Real brand marks in outside models/textures (Under
  Armour, "Cougars", NFL logos in previews) must never ship: use SHAPE only, never the textures.
- Outside assets: CC0 / public domain, or CC-BY with a credit line (the user has OK'd CC-BY). Mixamo clips only as a local,
  git-ignored copy in `public/local/mixamo/` (its terms forbid redistributing the files; the repo is public). Rapier physics (MIT)
  was approved for render-side ragdoll falls/tackle piles only, not for the game rules. Every outside asset goes in
  `src/assets/CREDITS.md` with source and license.
- Personal content only in `public/local/` (git-ignored). Never put the user's email, a GitHub token or any secret in a file
  or message (the user pasted a token once by mistake: it was revoked, keep every token out of everything).
- sim / ai / game / data code stays pure and deterministic (no DOM, no `Math.random`). All the art work is render-only
  (`src/render`, `tools/`, `src/assets`).
- Checks before every commit: `npx vitest run` (138 tests) and `npm run build`. For gameplay changes also `npm run games --
  --games 4` and `npm run fuzz`.
- Commit messages end with the attribution lines from the latest system reminder (never model names in the message body).
  Push to `main` (`git push -q origin main`).
- Replies: short and plain. After each push give the update steps as three SEPARATE bash blocks:
  `git checkout -- package-lock.json`, `git pull origin main`, `npm run dev`.
- Judge visual work critically with real in-game screenshots next to the reference, not by "the feature exists". LOOK at a page or
  image before commenting on it (the user was rightly annoyed when I judged a Meshy post I could not open).
- Menus are monochrome (Oswald + Saira Condensed, no outlines, focused item white). Done, do not redo.

## Environment
- Use the cloud environment named `gridiron27` (created in this chat). Its network allowlist: dl.polyhaven.org,
  api.polyhaven.com, ambientcg.com, acg-download.struffelproductions.com, blendswap.com, www.turbosquid.com, free3d.com,
  img.blendswap.com, api.sketchfab.com, media.sketchfab.com. More hosts need `update_environment` (the user approves a prompt).
  Its setup script installs Blender (`apt-get install -y --no-install-recommends blender`) but it is untested on a fresh
  session: if `which blender` is empty run that command by hand (Blender 4.0.2; headless needs Cycles, there is no GPU/EGL:
  `scene.render.engine = 'CYCLES'`).
- The dev server dies after ~2 h: restart with `cd /home/user/gridiron27 && (nohup npx vite --port 5173 --strictPort > /tmp/vite.log 2>&1 &)`.
- MakeHuman source data for rebuilding the body: `/home/user/makehumancommunity/makehuman/makehuman/data` (sparse clone). If it is
  missing: `git clone --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman.git` into
  `/home/user/makehumancommunity/`, then `git sparse-checkout set makehuman/data/3dobjs makehuman/data/targets/macrodetails
  makehuman/data/rigs makehuman/data/targets/bodyproportions`. `node tools/buildhuman.mjs` rewrites `src/assets/human.json`.
- Playwright + Chromium are preinstalled (software GL: slow, use generous waits; graphics pref `high`). Screenshot helpers are in
  `tools/shots/` (set `OUT=/some/dir`): `builds.mjs` (four players lined up at midfield, several camera views: edit the `views`
  object), `snap.mjs` (one QB close-up), `poses.mjs` (put one player in any anim), `err.mjs` (prints shader/page errors: run it
  after every shader edit), `blender-preview.sh` (clay turnaround of the body builds: `BUILDS="WR:0.07,OL:0.93"
  tools/shots/blender-preview.sh src/assets/human.json name 1.3`).
  Gotchas: place the camera with `rig.debug = {p, l}` AND `rig.pos.set(...)`/`rig.look.set(...)` (the rig lerps slowly under
  software GL, shots taken mid-glide look like the wrong angle); put the ball far away (`sim.ball.x = 70`) so heads face
  forward; set `p.face = null`; remember a GLSL snippet inside the body shader JS template literal must not contain backticks,
  and `y` is not in scope outside the `if (vPart > -0.5)` block (use `vBindY`).

## What was done in this chat (all pushed to main; last art commit `2ffe780`, then the user's `art/sketchfab` upload commit)
- Menus finished (post-game, trade, brackets, Weekly Hub); `showDrills` / `showScenarios` crash fixed (home-menu cards passed no
  settings).
- Field-goal camera behind the kicker, kneeling holder, warm sunlit turf (from the Madden video the user uploaded).
- Animations: pass-set, low backpedal / shuffle poses.
- Player body (`tools/buildhuman.mjs` -> `src/assets/human.json`, shader in `src/render/body.js`):
  own mass profiles per weight (`bulk` 0..1 = slim WR .. 320 lb lineman), athletic base (deltoids, biceps, quads, calves, V-taper),
  real shoulder-pad construction (cantilever cap + front/back plates pushed outward from the torso axis), torso under the jersey
  reshaped per slab to a clean rounded box (no pecs), pants/socks cling, hip pads, cleats shaped from the bare foot with a sole,
  towel moved to the hip. Root causes worth remembering: the old "boxy jersey" outline fill (`FILL = false`) made a shelf under
  the pads; pushing vertices by the sign of z tears the surface at the sides (push radially instead); chest vertices carry
  shoulder-bone weight so selecting by weight skipped the pecs.
- Cloth folds shader (`gFold` height field: drape, hem tuck, underarm, hip/knee bunching, bumps the normal), skin: no cloth weave +
  warm rim, painted face (eyes, brows, nose, mouth, stubble/beard by instance), wrist tape, jersey mesh pattern, thigh/knee pads
  shaded, mid-arm jersey sleeves over long undershirt sleeves, leg stripe only on the outside.
- Lighting: key light follows the camera (renderer.js), CC0 Poly Haven HDRI (`src/assets/env/hochsal_field_1k.hdr`) as the
  players' environment map.
- Helmet: the CC0 BlendSwap helmet (Noseferrit #76058, `art/blendswap/American Football Helmet.zip`) extracted by
  `tools/blender/export_helmet.py` into `src/assets/helmet.json` (shell 2.6k / facemask 3k / strap+padding 2.4k tris + a logo
  patch projected onto the shell). Wired in `players.js` via `helmetPart()`. NO crown stripe (the user does not want one).
  Possible follow-up: trim helmet triangles (~8k per helmet x 22 players) if frame rate suffers.
- Assets in the repo: `art/blendswap/` (helmet CC0, uniform CC0 by ds89 #89935: unused so far), `art/sketchfab/american_football_player.zip`
  ("American Football Player" by Stuffed Dog Digital, CC BY 4.0 — credit line still to be added to CREDITS.md).
  The Sketchfab glTF has 21 meshes: 0 shoes (23.8k tris, both), 1 pants, 9 jersey (37.8k), 5 body, `covers_*` 11-17 (~235k tris:
  probably pads/equipment, inspect), helmet 18-20; fitted jersey with mesh side panels, seams, hem trim, pants with thigh and knee
  pads, taped fingers, sleeve, wrist band, cleats. Its textures show brand marks: shape only.
- Rejected on purpose: Tripo / Meshy AI models (unclear free license, no rig, baked mesh, brand risk; Meshy needs a paid plan to
  download), 3dpassion scans (real NFL players, editorial-only), the stylized "free basic hands" Sketchfab model.

## Open work, in order
1. (2:31 AM check-in, below) UNIFORM from the Sketchfab model: line it up with our body, measure how its jersey / pads / pants
   surfaces differ from ours in our (angle, height) coordinates (jersey `vBody` = angle around the torso with front = PI/2 and
   height 0..1; legs: cosine around the leg, 1 = outside), bake into height/bump maps and shape deltas (pads, mesh panels, seams,
   folds), plus proportions (shoulder width, waist, thigh/calf).
2. CLEATS: extract Sketchfab mesh 0, one shoe, our foot-bone space (toe toward +z, sole at y=0), 1.5-2k tris, mirror, replace
   `cleatGeometry()` / the shoe part in `players.js`, keep team cleat color. No textures.
3. HANDS (no new download): the fingers get melted by the meshoptimizer simplification in `tools/buildhuman.mjs` and the 13-bone
   skeleton has no finger joints. Keep hand triangles from being simplified (vertex lock / simplify hands separately), pose a
   relaxed curl in the bind pose, layer glove / wrist-tape shapes. Adding finger bones: only propose it.
4. Real fabric textures (ambientCG CC0), proportions + skin pass, final side-by-side against the Madden reference image
   (`/root/.claude/uploads/c29d6cc5-04a0-55be-9450-e5b35022bb67/cb846d4e-image.jpg` if that path still exists; otherwise ask the user to re-send).
5. Later: paired tackle animations, running/cuts, Rapier ragdoll falls, Mixamo clips converted locally (user downloads FBX no-skin 30 fps
   into `public/local/mixamo/`), goalposts with flags and padded base.
- Honest status: slightly better than before, still nowhere near the reference (the user said so). The biggest remaining gaps:
  hands, scanned-quality faces/skin, cloth/material richness, movement.

## Scheduled check-in (it must be recreated in the new chat)
The old chat's check-in (trigger `trig_01BDxJWJqRCM4UFeZpPwhYCE`, 2026-11-12 02:31 America/Chicago = 08:31 UTC) was bound to the old
session and has been disabled so it does not fire twice. In the new chat do this FIRST: call `send_later` with
`at: "2026-11-12T02:31:00[America/Chicago]"` (the Central time zone was inferred from the user's file timestamps: confirm it if you can) and
as `message` the instruction "2:31 AM check-in: resume the Gridiron 27 player-art overhaul: do the open work above in order
(uniform from the Sketchfab model, then cleats, then hands, then the rest). Start with git status and git log -3." If that time has already
passed when the new chat starts, skip scheduling and just start working. Tell the user plainly what you scheduled.

## Check list for each piece of work
- Blender render of the body/part, then an in-game screenshot next to the reference, then `err.mjs`, tests, build, commit, push,
  short report, update commands in three bash blocks. Credit new assets in `src/assets/CREDITS.md`. Update `CLAUDE.md` with a short note.
