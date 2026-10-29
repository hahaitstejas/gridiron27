import { describe, it, expect } from 'vitest';
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { listOffPlays, listDefPlays } from '../src/data/playbook.js';
import { PlaySim } from '../src/sim/play.js';
import { ReplayRecorder, ReplayPlayer } from '../src/replay/replay.js';

const teams = generateLeagueRosters(defaultTeams(), 2027);

describe('instant replay', () => {
  it('records a play and plays it back frame-exact', () => {
    const sim = new PlaySim({ rng: new RNG(4), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: listOffPlays()[0], defPlay: listDefPlays()[0], humanTeam: null });
    const rec = new ReplayRecorder();
    sim.snap();
    rec.capture(sim);
    const snapshots = [];
    let n = 0;
    while (!sim.finished && n < 4000) {
      sim.tick(STEP, null); rec.capture(sim); n++;
      if (n === 90) snapshots.push({ x: sim.players[3].x, z: sim.players[3].z, bx: sim.ball.x, anim: sim.players[3].anim });
    }
    const r = rec.take();
    expect(r.frames.length).toBe(n + 1);
    expect(r.duration).toBeCloseTo(n * STEP, 6);
    const pl = new ReplayPlayer(r);
    const alpha = pl.seek(90 * STEP - 1e-9); // frame 89 -> 90, alpha ~1
    expect(alpha).toBeGreaterThan(0.99);
    const g = pl.ghost.players[3];
    expect(g.x).toBeCloseTo(snapshots[0].x, 3);
    expect(g.z).toBeCloseTo(snapshots[0].z, 3);
    expect(g.anim).toBe(snapshots[0].anim);
    expect(pl.ghost.ball.x).toBeCloseTo(snapshots[0].bx, 3);
    pl.seek(1e9);
    expect(pl.t).toBeCloseTo(r.duration, 6);
  });

  it('the replay ghost offers every sim method the render code calls', async () => {
    const fs = await import('fs');
    const used = new Set();
    for (const f of fs.readdirSync('src/render')) {
      for (const m of fs.readFileSync(`src/render/${f}`, 'utf8').matchAll(/\bsim\.([a-zA-Z]+)\(/g)) used.add(m[1]);
    }
    const sim = new PlaySim({ rng: new RNG(1), teams: [teams[0], teams[1]], offIdx: 0, dir: -1, losX: 10, ballZ: 2, offPlay: listOffPlays()[0], defPlay: listDefPlays()[0], humanTeam: null });
    const rec = new ReplayRecorder();
    sim.snap(); rec.capture(sim); sim.tick(STEP, null); rec.capture(sim);
    const g = new ReplayPlayer(rec.take()).ghost;
    for (const name of used) expect(typeof g[name], `ghost.${name}`).toBe('function');
    expect(g.toLocal(4, 2)).toEqual(sim.toLocal(4, 2));
  });
});
