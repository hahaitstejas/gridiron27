import { describe, it, expect } from 'vitest';
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { ROSTER_COUNTS } from '../src/data/positions.js';
import { listOffPlays, listDefPlays, mirrorOffPlay, getOffFormation } from '../src/data/playbook.js';
import { PlaySim } from '../src/sim/play.js';
import { flightTime } from '../src/sim/passing.js';

const teams = generateLeagueRosters(defaultTeams(), 2027);

function runPlay(seed, op, dp, opts = {}) {
  const sim = new PlaySim({ rng: new RNG(seed), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: op, defPlay: dp, humanTeam: null, ...opts });
  sim.snap();
  let n = 0;
  while (!sim.finished && n < 4000) { sim.tick(STEP, null); n++; }
  return sim;
}

describe('league data', () => {
  it('has 32 teams in 2 conferences x 4 divisions', () => {
    expect(teams).toHaveLength(32);
    const keys = new Set(teams.map((t) => `${t.conference}-${t.division}`));
    expect(keys.size).toBe(8);
    expect(new Set(teams.map((t) => t.abbr)).size).toBe(32);
  });
  it('generates 53-man rosters with unique numbers and a depth chart', () => {
    const total = Object.values(ROSTER_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(53);
    for (const t of teams) {
      expect(t.roster).toHaveLength(53);
      expect(new Set(t.roster.map((p) => p.number)).size).toBe(53);
      for (const slot of ['QB', 'HB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LE', 'RE', 'DT', 'MLB', 'CB', 'FS', 'SS', 'K', 'P']) {
        expect(t.depth[slot]?.length, `${t.abbr} ${slot}`).toBeGreaterThan(0);
      }
      expect(t.depth.LT[0]).not.toBe(t.depth.RT[0]);
    }
  });
});

describe('playbook', () => {
  it('every play references a formation with 11 players', () => {
    for (const p of listOffPlays()) expect(getOffFormation(p.formation)?.players).toHaveLength(11);
  });
  it('mirrors plays left/right', () => {
    const run = listOffPlays().find((p) => p.type === 'run');
    const m = mirrorOffPlay(run);
    expect(m.run.aim[1]).toBe(-run.run.aim[1]);
    expect(m.run.side).toBe(-(run.run.side || 1));
    const f = getOffFormation(m.formation);
    expect(f.players[0].at[1]).toBe(-getOffFormation(run.formation).players[0].at[1]);
  });
});

describe('play simulation', () => {
  it('every play ends with a valid result against a spread of opponents', () => {
    // Every offensive play against 6 defenses and every defensive play against 6 offenses
    // (the full cross product is ~7000 plays, too slow for a unit test).
    const offs = listOffPlays(), defs = listDefPlays();
    const pairs = [];
    offs.forEach((op, i) => { for (let k = 0; k < 6; k++) pairs.push([op, defs[(i * 7 + k * 9) % defs.length]]); });
    defs.forEach((dp, i) => { for (let k = 0; k < 6; k++) pairs.push([offs[(i * 11 + k * 23) % offs.length], dp]); });
    for (const [op, dp] of pairs) {
      const sim = runPlay(5, op, dp);
      expect(sim.result, `${op.id} vs ${dp.id}`).toBeTruthy();
      expect(sim.result.reason).not.toBe('timeout');
      expect(Math.abs(sim.result.spotX)).toBeLessThanOrEqual(60);
      for (const p of sim.players) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    }
  }, 60000);

  it('is deterministic for a given seed', () => {
    const op = listOffPlays()[0], dp = listDefPlays()[0];
    const a = runPlay(42, op, dp).result, b = runPlay(42, op, dp).result;
    expect(a.spotX).toBe(b.spotX);
    expect(a.reason).toBe(b.reason);
  });
  it('scores a touchdown when the carrier crosses the goal line', () => {
    const op = listOffPlays().find((p) => p.type === 'run');
    let tds = 0;
    for (let s = 0; s < 40; s++) {
      const sim = runPlay(s, op, listDefPlays()[1], { losX: 49 });
      if (sim.result.touchdown === 0) { tds++; expect(sim.result.yards).toBeCloseTo(1, 5); }
    }
    expect(tds).toBeGreaterThan(5);
  });
  it('flight time grows with distance and lobs hang longer than bullets', () => {
    expect(flightTime(30, 'bullet', 90)).toBeGreaterThan(flightTime(10, 'bullet', 90));
    expect(flightTime(20, 'lob', 90)).toBeGreaterThan(flightTime(20, 'bullet', 90));
  });
});

describe('ball spotting', () => {
  it('spots a tackled runner where the ball is, ahead of his feet', () => {
    const op = listOffPlays().find((p) => p.type === 'run');
    for (let s = 0; s < 20; s++) {
      const sim = runPlay(s, op, listDefPlays()[0]);
      const r = sim.result;
      if (r.reason !== 'tackle') continue;
      const c = sim.players[r.carrierId];
      // Ball is spotted ahead of the carrier's feet in his facing direction (he falls forward).
      const ahead = (r.spotX - c.x) * Math.cos(c.facing) + (r.spotZ - c.z) * Math.sin(c.facing);
      expect(ahead).toBeGreaterThan(0.5);
      expect(ahead).toBeLessThan(1.6);
    }
  });
  it('spots a QB slide where the slide begins', async () => {
    const { startMove } = await import('../src/sim/tackling.js');
    const op = listOffPlays().find((p) => p.type === 'pass');
    const sim = new PlaySim({ rng: new RNG(1), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: op, defPlay: listDefPlays()[2], humanTeam: null });
    sim.snap();
    while (sim.ball.state !== 'held') sim.tick(STEP, null);
    // Put the QB in the open field running upfield, defenders far away, then slide.
    const qb = sim.bySlot(0, 'QB');
    qb.x = -10; qb.z = 0; qb.vx = 8; qb.vz = 0; qb.facing = 0;
    for (const d of sim.defense()) { d.x = 20; d.z = d.z * 0.1; }
    sim.setRunner(qb, 'scramble');
    sim.tick(STEP, null);
    const slideAt = sim.carrierBallPos(qb).x;
    expect(startMove(sim, qb, 'slide')).toBe(true);
    let n = 0;
    while (!sim.finished && n++ < 2000) sim.tick(STEP, null);
    expect(sim.result.reason).toBe('tackle');
    expect(sim.result.spotX).toBeCloseTo(slideAt, 1);
    expect(qb.x).toBeGreaterThan(slideAt); // he kept sliding forward, but the spot is where he started
  });
});

describe('special teams results', () => {
  it('a mis-hit human kickoff still travels and the play ends', () => {
    const op = listOffPlays(true).find((p) => p.id === 'st_kickoff');
    const dp = listDefPlays(true).find((p) => p.id === 'st_kick_return');
    for (let s = 0; s < 4; s++) {
      const sim = new PlaySim({ rng: new RNG(s), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -15, ballZ: 0, offPlay: op, defPlay: dp, humanTeam: 0 });
      sim.snap();
      Object.assign(sim.meter, { phase: 'done', power: 0.02, accuracy: 0 });
      let n = 0;
      while (!sim.finished && n < 4000) { sim.tick(STEP, null); n++; }
      expect(sim.finished).toBe(true);
      expect(sim.t).toBeLessThan(15);
      expect(sim.result.kickDistance).toBeGreaterThan(25);
    }
  });

  it('reports kickoffs as kickoffs with the receiving team in possession', () => {
    const op = listOffPlays(true).find((p) => p.id === 'st_kickoff');
    const dp = listDefPlays(true).find((p) => p.id === 'st_kick_return');
    for (let s = 0; s < 10; s++) {
      const r = runPlay(s, op, dp, { losX: -15 }).result;
      expect(r.kickType).toBe('kickoff');
      if (r.touchdown === null && !r.onside) expect(r.possTeam).toBe(1);
    }
  });
});

describe('gameplay sliders', () => {
  it('move the needle: offense sliders at 100 beat sliders at 0', () => {
    const passes = listOffPlays().filter((p) => p.type === 'pass').slice(0, 12);
    const defs = listDefPlays().slice(0, 6);
    const run = (v) => {
      const sl = { qbAccuracy: v, catching: v, passBlocking: v };
      let cmp = 0, att = 0, yds = 0;
      for (let i = 0; i < 120; i++) {
        const sim = runPlay(500 + i, passes[i % passes.length], defs[i % defs.length], { sliders: [sl, null] });
        const r = sim.result;
        if (r.passAttempt) { att++; if (r.complete) cmp++; }
        yds += r.yards || 0;
      }
      return { pct: cmp / Math.max(1, att), yds };
    };
    const lo = run(0), hi = run(100);
    expect(hi.pct).toBeGreaterThan(lo.pct + 0.08);
    expect(hi.yds).toBeGreaterThan(lo.yds);
  }, 60000);
});
