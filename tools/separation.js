#!/usr/bin/env node
// How open do receivers get? Samples every route runner's separation (distance to the nearest
// defender) through the play and reports the share of time they are "open".
//   node tools/separation.js [--plays 300]
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { listOffPlays, listDefPlays } from '../src/data/playbook.js';
import { PlaySim } from '../src/sim/play.js';
import { emptyFrame } from '../src/input/actions.js';

const pi = process.argv.indexOf('--plays');
const N = pi > 0 ? +process.argv[pi + 1] : 300;
const teams = generateLeagueRosters(defaultTeams(), 2027);
const ops = listOffPlays().filter((p) => p.type === 'pass');
const byDef = {};
let best3 = 0, best3n = 0;
for (let i = 0; i < N; i++) {
  const dp = listDefPlays()[i % listDefPlays().length];
  // Human offense that never throws, so we watch the whole route tree develop.
  const sim = new PlaySim({ rng: new RNG(i), teams: [teams[i % 32], teams[(i + 3) % 32]], offIdx: 0, dir: 1, losX: -25, ballZ: 0, offPlay: ops[i % ops.length], defPlay: dp, humanTeam: 0 });
  sim.snap();
  const f = emptyFrame();
  const o = (byDef[dp.id] ||= { samples: 0, open2: 0, open3: 0, sum: 0 });
  let k = 0;
  while (!sim.finished && sim.t < 3.2 && k < 400) {
    sim.tick(STEP, f); k++;
    if (k % 6 || sim.t < 1.2) continue;
    let bestSep = 0;
    for (const r of sim.players) {
      if (r.team !== 0 || r.task?.type !== 'route') continue;
      let md = 99;
      for (const d of sim.players) if (d.team === 1 && d.state !== 'down') md = Math.min(md, Math.hypot(d.x - r.x, d.z - r.z));
      o.samples++; o.sum += Math.min(md, 10);
      if (md > 2) o.open2++;
      if (md > 3) o.open3++;
      bestSep = Math.max(bestSep, md);
    }
    if (sim.t > 1.8 && sim.t < 2.6) { best3n++; if (bestSep > 3) best3++; }
  }
}
for (const [id, o] of Object.entries(byDef)) {
  console.log(`${id.padEnd(22)} avg sep ${(o.sum / o.samples).toFixed(1)} yd   open >2yd ${(100 * o.open2 / o.samples).toFixed(0)}%   >3yd ${(100 * o.open3 / o.samples).toFixed(0)}%`);
}
console.log(`At 1.8-2.6s after the snap, someone is open by 3+ yds ${(100 * best3 / best3n).toFixed(0)}% of the time`);
