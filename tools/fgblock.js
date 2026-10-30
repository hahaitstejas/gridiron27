#!/usr/bin/env node
// Blocked field goals: CPU vs CPU, a human kicker (fast / slow meter) vs the CPU rush, and a human rusher
// steering at the holder (with and without a swat press). node tools/fgblock.js [--n 400]
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { getOffPlay, getDefPlay } from '../src/data/playbook.js';
import { PlaySim } from '../src/sim/play.js';
import { emptyFrame } from '../src/input/actions.js';

const ni = process.argv.indexOf('--n');
const N = ni > 0 ? +process.argv[ni + 1] : 400;
const teams = generateLeagueRosters(defaultTeams(), 2027);

function run(name, { human = null, meter = null, rush = null, yl = 25 }) {
  let blocked = 0, through = 0, good = 0;
  for (let i = 0; i < N; i++) {
    const losX = 50 - yl; // yards from the goal line the offense attacks (+x)
    const sim = new PlaySim({ rng: new RNG(7000 + i), teams: [teams[i % 32], teams[(i + 5) % 32]], offIdx: 0, dir: 1, losX, ballZ: 0,
      offPlay: getOffPlay('st_fg'), defPlay: getDefPlay('st_fg_block'), humanTeam: human, camDir: 1 });
    let me = null;
    if (rush) {
      const rs = sim.players.filter((p) => p.team === 1 && p.task?.type !== 'returner');
      me = rs[i % rs.length];
      sim.controlledId = me.id;
    }
    sim.snap();
    const f = emptyFrame();
    let k = 0, near = false, pressed = 0;
    while (!sim.finished && k < 2400) {
      for (const b in f.pressed) { f.pressed[b] = false; f.down[b] = false; }
      f.lx = 0; f.ly = 0; f.rt = 0;
      if (meter && sim.meter) {
        const m = sim.meter;
        if (m.phase === 'power' && m.value >= meter.power) f.pressed.A = true;
        if (m.phase === 'accuracy' && m.t >= meter.accWait && m.needle <= 0.08 + meter.err) f.pressed.A = true;
      }
      if (rush) {
        me = sim.players[sim.controlledId];
        const kk = sim.players[sim.kick?.kickerId];
        const h = sim.bySlot(0, 'H');
        const tgt = h || kk;
        if (tgt && me) {
          const dx = tgt.x + 1.2 - me.x, dz = tgt.z - me.z, l = Math.hypot(dx, dz) || 1;
          f.ly = -dx / l; f.lx = dz / l; f.rt = 1;
          if (l < 2.5 && !sim.kick?.launched) near = true;
          if (rush.swat && l < 2.6 && sim.ball.state === 'kick' && sim.ball.t < 0.3 && pressed < 1) { f.pressed[rush.swat] = true; pressed++; }
          if (rush.swat && l < 2.4 && !sim.kick?.launched && sim.t % 0.25 < STEP) f.pressed[rush.swat] = true;
        }
      }
      sim.tick(STEP, f); k++;
    }
    if (sim.kick?.blocked) blocked++;
    if (near) through++;
    if (sim.kick?.fgGood) good++;
  }
  console.log(`${name.padEnd(26)} blocked ${(100 * blocked / N).toFixed(1)}%  good ${(100 * good / N).toFixed(0)}%` + (rush ? `  got close ${(100 * through / N).toFixed(0)}%` : ''));
}

run('cpu 35yd', { yl: 18 });
run('cpu 50yd', { yl: 33 });
run('human kick fast meter', { human: 0, meter: { power: 0.85, accWait: 0, err: 0 } });
run('human kick slow meter', { human: 0, meter: { power: 0.98, accWait: 0.5, err: -0.05 } });
run('human rusher, stick only', { human: 1, rush: {} });
run('human rusher + A swat', { human: 1, rush: { swat: 'A' } });
