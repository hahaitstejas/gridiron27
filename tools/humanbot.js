#!/usr/bin/env node
// Measures how exploitable the CPU defense is against simple scripted "human" strategies.
//   node tools/humanbot.js [--plays 200]
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { listOffPlays, listDefPlays } from '../src/data/playbook.js';
import { PlaySim } from '../src/sim/play.js';
import { emptyFrame } from '../src/input/actions.js';

const N = +(process.argv[process.argv.indexOf('--plays') + 1] || 200);
const teams = generateLeagueRosters(defaultTeams(), 2027);

// Each strategy returns an input frame for time t.
const strategies = {
  qbScramble: { plays: (p) => p.type === 'pass', input: (t) => ({ ly: t > 0.5 ? -1 : 0, rt: 1 }) },
  qbScrambleWide: { plays: (p) => p.type === 'pass', input: (t) => ({ ly: t > 0.5 ? -0.7 : 0, lx: t > 0.5 ? 0.7 : 0, rt: 1 }) },
  quickThrowA: { plays: (p) => p.type === 'pass', input: (t) => ({ press: t > 1.1 && t < 1.12 ? 'A' : null, hold: t > 1.1 && t < 1.4 ? 'A' : null }) },
  quickThrowB: { plays: (p) => p.type === 'pass', input: (t) => ({ press: t > 1.3 && t < 1.32 ? 'B' : null, hold: t > 1.3 && t < 1.6 ? 'B' : null }) },
  holdBall: { plays: (p) => p.type === 'pass', input: () => ({}) },
  runUpfield: { plays: (p) => p.type === 'run', input: (t) => ({ ly: t > 0.9 ? -1 : 0, rt: 1 }) },
};

let holdT = 0;
for (const [name, st] of Object.entries(strategies)) {
  const ops = listOffPlays().filter(st.plays);
  let yds = 0, n = 0, td = 0, big = 0, cmp = 0, att = 0, yac = 0, air = 0, ints = 0, sep = 0, sepN = 0;
  for (let i = 0; i < N; i++) {
    const rng = new RNG(1000 + i);
    const sim = new PlaySim({ rng, teams: [teams[i % 32], teams[(i + 7) % 32]], offIdx: 0, dir: 1, losX: -25, ballZ: 0,
      offPlay: ops[i % ops.length], defPlay: listDefPlays()[i % listDefPlays().length], humanTeam: 0 });
    sim.snap();
    const f = emptyFrame();
    let k = 0;
    while (!sim.finished && k < 3000) {
      const s = st.input(sim.t);
      f.lx = s.lx || 0; f.ly = s.ly || 0; f.rt = s.rt || 0;
      for (const b in f.pressed) { f.pressed[b] = false; f.down[b] = false; }
      if (s.press) f.pressed[s.press] = true;
      if (s.hold) f.down[s.hold] = true;
      const wasAir = sim.ball.state === 'air';
      sim.tick(STEP, f);
      k++;
      if (wasAir && sim.ball.state !== 'air' && sim.ball.intended >= 0) {
        const r = sim.players[sim.ball.intended];
        let md = 99; for (const d of sim.players) if (d.team !== 0) md = Math.min(md, Math.hypot(d.x - r.x, d.z - r.z));
        sep += md; sepN++;
      }
    }
    const r = sim.result;
    if (r.passAttempt) att++; if (r.complete) { cmp++; yac += r.spotX - r.catchX; air += r.catchX - r.losX; } if (r.interception) ints++;
    if (name === 'holdBall') { holdT = (holdT || 0) + r.duration; }
    n++; yds += r.yards; if (r.touchdown === 0) td++; if (r.yards >= 20) big++;
  }
  if (name === 'holdBall') console.log(`holdBall: avg time until play ends ${(holdT / n).toFixed(2)}s`);
  console.log(`${name.padEnd(16)} avg ${(yds / n).toFixed(1)} yds  20+ yd plays ${(100 * big / n).toFixed(0)}%  TD ${td}/${n}` + (att ? `  cmp ${cmp}/${att} air ${(air / Math.max(1, cmp)).toFixed(1)} yac ${(yac / Math.max(1, cmp)).toFixed(1)} int ${ints} sep@arrival ${(sep / Math.max(1, sepN)).toFixed(1)}` : ''));
}
