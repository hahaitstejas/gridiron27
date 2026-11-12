# Third-party assets (public domain / free for any use)

| File | Source | License |
|---|---|---|
| `human.json` (player body: mesh, shape deltas, skin weights; built by `tools/buildhuman.mjs`) | MakeHuman base mesh hm08, macrodetails targets (`universal-male-young-maxmuscle-*`), default skeleton and weights — https://github.com/makehumancommunity/makehuman | CC0 1.0 (released Sept. 2020 by Data Collection AB, Joel Palmius, Jonas Hauquier) |
| `clips/*.json` (motion clips, built by `tools/mocap.mjs`) | CMU Graphics Lab Motion Capture Database (BVH conversion by Bruce Hahne) — http://mocap.cs.cmu.edu, https://github.com/una-dinosauria/cmu-mocap | Free for research and commercial use. "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." |
| `env/hochsal_field_1k.hdr` (outdoor sky / grass / sun image-based light for the players) | Poly Haven, "Hochsal Field" by Greg Zaal — https://polyhaven.com/a/hochsal_field | CC0 1.0 |
| `helmet.json` (helmet shell, facemask, chin strap / padding / fixings, built by `tools/blender/export_helmet.py` from `art/blendswap/American Football Helmet.zip`) | "American Football Helmet" by Noseferrit, BlendSwap #76058 — https://blendswap.com/blend/13688 (NFL logos in its preview textures are NOT used: only the CC0 geometry) | CC0 1.0 |
| `art/blendswap/American Football Uniform.zip` (reference for jersey / pants construction) | "American Football Uniform" by ds89, BlendSwap #89935 — https://blendswap.com/blend/20659 | CC0 1.0 |
| `art/sketchfab/american_football_player.zip` (reference for uniform / cleat construction; shape only, its brand-mark textures are NOT used) | "American Football Player" by Stuffed Dog Digital, Sketchfab | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ (credit: Stuffed Dog Digital) |
| `cleat.json` (one cleat, ~2.2k tris, built by `tools/buildcleat.mjs` from the glTF in `art/sketchfab/american_football_player.zip`; geometry only, its textures are NOT used) | "American Football Player" by Stuffed Dog Digital, Sketchfab | CC BY 4.0 — credit: Stuffed Dog Digital |
| `fabric_normal.jpg` (jersey / pants knit normal map, 512 px copy of the 1K NormalGL map) | "Fabric030" from ambientCG — https://ambientcg.com/a/Fabric030 | CC0 1.0 |
| `jersey_fold.png` (soft cloth-fold height map in our jersey coordinates, built by `tools/bakefolds.mjs`; shape of the shirt only, no textures) | "American Football Player" by Stuffed Dog Digital, Sketchfab | CC BY 4.0 — credit: Stuffed Dog Digital |
