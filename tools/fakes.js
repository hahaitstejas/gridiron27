#!/usr/bin/env node
// Fake punts / field goals vs the CPU's return / block units: conversion rate on 4th & N and yards per try.
// Usage: node tools/fakes.js [--reps 300] [--togo 4]
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { getOffPlay } from '../src/data/playbook.js';
import { defenseForSpecial } from '../src/ai/playcaller.js';
import { PlaySim, MAX_PLAY_TIME } from '../src/sim/play.js';
import { emptyFrame } from '../src/input/actions.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null).filter(Boolean));
const reps = +(args.reps || 300), toGo = +(args.togo || 4);
const teams = generateLeagueRosters(defaultTeams(), 2027);
const STICKS = { cpu: null, straight: [0, -1], right: [0.75, -0.66], left: [-0.75, -0.66] };
for (const [id, stick] of [['st_fake_punt', 'cpu'], ['st_fake_punt', 'straight'], ['st_fake_punt', 'right'], ['st_fake_punt', 'left'], ['st_fake_punt_pass', 'cpu'], ['st_fake_fg', 'cpu']]) {
  const rng = new RNG(5);
  const human = STICKS[stick];
  let conv = 0, yds = 0, ints = 0;
  for (let i = 0; i < reps; i++) {
    const op = getOffPlay(id);
    const sim = new PlaySim({ rng, teams: [teams[i % 32], teams[(i * 7 + 3) % 32]], offIdx: 0, dir: 1, losX: rng.range(-20, 10), ballZ: 0,
      offPlay: op, defPlay: defenseForSpecial(op), humanTeam: human ? 0 : null, camDir: 1 });
    sim.snap();
    const f = emptyFrame();
    for (let t = 0; !sim.finished && t < (MAX_PLAY_TIME + 5) / STEP; t++) {
      if (human) { f.lx = sim.t > 0.4 ? human[0] : 0; f.ly = sim.t > 0.4 ? human[1] : 0; f.rt = 1; }
      sim.tick(STEP, human ? f : null);
    }
    const r = sim.result;
    const y = r.possTeam === 0 ? r.yards : 0;
    if (r.interception) ints++;
    yds += y; if (y >= toGo && r.possTeam === 0) conv++;
  }
  console.log(`${id.padEnd(18)} ${stick.padEnd(8)} convert 4th & ${toGo}: ${(conv / reps * 100).toFixed(0)}%  avg ${(yds / reps).toFixed(1)} yds  INT ${(ints / reps * 100).toFixed(0)}%`);
}
