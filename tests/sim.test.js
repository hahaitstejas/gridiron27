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
      // Forward progress: the spot is where his progress stopped, never behind the ball.
      if (r.forwardProgress) { expect((r.spotX - r.ballSpotX) * sim.dir).toBeGreaterThan(0); continue; }
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

describe('pre-snap motion and coverage calls', () => {
  const op = listOffPlays().find((p) => p.type === 'pass' && p.formation.startsWith('gun'));
  const man = listDefPlays().find((p) => p.coverage === 'man' && !/blitz|cover0/.test(p.id));

  it('a receiver in motion crosses the formation and his man follows him', () => {
    const sim = new PlaySim({ rng: new RNG(4), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: op, defPlay: man, humanTeam: null });
    const rec = sim.motionCandidates().filter((p) => p.pos === 'WR').sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    const defender = sim.defense().find((d) => sim.manMatch.get(d.id)?.id === rec.id);
    const z0 = rec.z;
    expect(sim.startMotion(rec.id, true)).toBe(true);
    for (let i = 0; i < 480; i++) sim.tick(STEP, null);
    expect(Math.sign(rec.z)).toBe(-Math.sign(z0));
    if (defender) expect(Math.abs(defender.z - rec.z)).toBeLessThan(4);
    sim.snap();
    let n = 0;
    while (!sim.finished && n < 4000) { sim.tick(STEP, null); n++; }
    expect(sim.result).toBeTruthy();
  });

  it('press corners line up at the line, off corners deep', () => {
    const depth = (cover) => {
      const sim = new PlaySim({ rng: new RNG(4), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: op, defPlay: man, humanTeam: null, defAdj: { cover } });
      return sim.defense().filter((d) => d.slot === 'LCB' || d.slot === 'RCB').map((d) => sim.toLocal(d.x, d.z).down);
    };
    for (const d of depth('press')) expect(d).toBeLessThan(2);
    for (const d of depth('off')) expect(d).toBeGreaterThanOrEqual(7.9);
  });
});

describe('weather', () => {
  it('conditions are deterministic; rain makes the ball slick; wind pushes a punt', async () => {
    const { makeConditions } = await import('../src/game/weather.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const a = makeConditions(new RNG(5), 'rain', 'day'), b = makeConditions(new RNG(5), 'rain', 'day');
    expect(a).toEqual(b);
    expect(a.type).toBe('rain');
    const op = listOffPlays()[0], dp = listDefPlays()[0];
    const dry = new PlaySim({ rng: new RNG(1), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: op, defPlay: dp, humanTeam: null });
    const wet = new PlaySim({ rng: new RNG(1), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: op, defPlay: dp, humanTeam: null, weather: { type: 'rain', wind: { x: 0, z: 0 }, time: 'night' } });
    const wr = dry.offense().find((p) => p.pos === 'WR');
    expect(wet.R(wet.players[wr.id], 'catching')).toBeLessThan(dry.R(wr, 'catching'));
    const punt = (wind) => {
      const sim = new PlaySim({ rng: new RNG(3), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: getOffPlay('st_punt'), defPlay: getDefPlay('st_punt_return'), humanTeam: null, weather: { type: 'clear', wind, time: 'day' } });
      sim.snap();
      let n = 0, z = null;
      while (!sim.finished && n < 3000) { sim.tick(STEP, null); n++; if (sim.ball.state === 'kick') z = sim.ball.z; else if (z !== null) break; }
      return z;
    };
    expect(punt({ x: 0, z: 8 }) - punt({ x: 0, z: 0 })).toBeGreaterThan(2);
  });
});

describe('custom plays (playbook editor)', () => {
  it('every formation builds working pass and run plays, and they register as My Plays', async () => {
    const C = await import('../src/data/customPlays.js');
    const { testPlay } = await import('../src/game/playtest.js');
    const { listOffPlays: list } = await import('../src/data/playbook.js');
    const specs = [];
    for (const f of C.customFormations()) {
      const pass = C.newSpec(`t_${f}_p`, f);
      pass.pa = true; pass.boot = 1;
      const r1 = testPlay(C.buildPlay(pass), [teams[0], teams[1]], 2);
      expect(r1.ok, `${f} pass: ${r1.error}`).toBe(true);
      for (const carrier of ['QB', ...C.eligibleSlots(f).filter((e) => e.pos === 'HB' || e.pos === 'FB').map((e) => e.slot)]) {
        const run = { ...C.newSpec(`t_${f}_r_${carrier}`, f), type: 'run' };
        run.run = { carrier, side: -1, gap: 'outside', scheme: 'gap' };
        const r2 = testPlay(C.buildPlay(run), [teams[0], teams[1]], 2);
        expect(r2.ok, `${f} run ${carrier}: ${r2.error}`).toBe(true);
        specs.push(run);
      }
      specs.push(pass);
    }
    C.registerCustomPlays(specs);
    expect(list().filter((p) => p.custom)).toHaveLength(specs.length);
    C.registerCustomPlays([]);
    expect(list().some((p) => p.custom)).toBe(false);
  }, 60000);
});

describe('gameplay extras', () => {
  const run = (op, dp, seed, opts = {}) => {
    const sim = new PlaySim({ rng: new RNG(seed), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: op, defPlay: dp, humanTeam: null, ...opts });
    return sim;
  };
  it('fake punt / fake FG run as scrimmage plays against the kicking defenses', async () => {
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const { defenseForSpecial } = await import('../src/ai/playcaller.js');
    for (const id of ['st_fake_punt', 'st_fake_punt_pass', 'st_fake_fg']) {
      const op = getOffPlay(id);
      const dp = defenseForSpecial(op);
      expect(dp.id).toMatch(/^st_/);
      for (let s = 1; s <= 4; s++) {
        const sim = run(op, dp, s);
        expect(sim.isKick).toBe(false);
        sim.snap();
        let n = 0;
        while (!sim.finished && n < 4000) { sim.tick(STEP, null); n++; }
        expect(sim.result, id).toBeTruthy();
      }
    }
  });

  it('speed option pitches; placed passes and pump fakes work for the human QB', async () => {
    const { getOffPlay } = await import('../src/data/playbook.js');
    const dp = listDefPlays().find((d) => d.coverage === 'zone');
    let pitched = 0;
    for (let s = 1; s <= 6; s++) {
      const sim = run(getOffPlay('spread_speed_option'), dp, s);
      sim.snap();
      let n = 0;
      while (!sim.finished && n < 4000) { sim.tick(STEP, null); if (sim.events.some((e) => e.type === 'pitch')) pitched++; n++; }
    }
    expect(pitched).toBeGreaterThan(2);
    // Human QB: pump fake (LS) then a high pass (LB held) to the A receiver.
    const op = listOffPlays().find((p) => p.type === 'pass' && p.formation === 'gun_doubles');
    const sim = run(op, dp, 3, { humanTeam: 0 });
    sim.snap();
    const frame = (o = {}) => ({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, down: {}, pressed: {}, released: {}, held: {}, flick: {}, ...o });
    for (let i = 0; i < 50; i++) sim.tick(STEP, frame());
    sim.tick(STEP, frame({ pressed: { LS: true } }));
    expect(sim.events.some((e) => e.type === 'pumpFake')).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick(STEP, frame());
    sim.tick(STEP, frame({ pressed: { A: true }, down: { A: true, LB: true } }));
    for (let i = 0; i < 20 && !sim.passThrown; i++) sim.tick(STEP, frame({ down: { LB: true } }));
    expect(sim.passThrown).toBe(true);
    expect(sim.ball.place).toBe('high');
  });
});

describe('dynamic kickoff', async () => {
  const { RNG } = await import('../src/core/rng.js');
  const { STEP } = await import('../src/core/constants.js');
  const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
  const { PlaySim } = await import('../src/sim/play.js');
  const { generateLeagueRosters } = await import('../src/data/generator.js');
  const { defaultTeams } = await import('../src/data/teams.js');
  const lg = generateLeagueRosters(defaultTeams(), 6);
  it('lines up at the receiving 40 and the setup zone, nobody moves until the ball lands, short kicks die at the 40', async () => {
    const sim = new PlaySim({ rng: new RNG(4), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -15, ballZ: 0, offPlay: getOffPlay('st_kickoff'), defPlay: getDefPlay('st_kick_return') });
    const loc = (p) => sim.toLocal(p.x, p.z).down;
    const cover = sim.offense().filter((p) => p.slot !== 'K');
    expect(cover.every((p) => Math.abs(loc(p) - 24.5) < 0.6)).toBe(true); // the receiving 40
    const setup = sim.defense().filter((p) => !/^KR/.test(p.slot));
    expect(setup.length).toBe(9);
    expect(setup.every((p) => loc(p) >= 30 && loc(p) <= 35)).toBe(true); // their 30 to 35
    sim.snap();
    const start = new Map(sim.players.map((p) => [p.id, { x: p.x, z: p.z }]));
    let landed = false, moved = 0;
    for (let k = 0; k < 2000 && !sim.finished; k++) {
      sim.tick(STEP, null);
      if (sim.events.some((e) => e.type === 'kickLanded' || e.type === 'kickCaught')) landed = true;
      if (!landed && sim.ball.state === 'kick') for (const p of [...cover, ...setup]) moved = Math.max(moved, Math.hypot(p.x - start.get(p.id).x, p.z - start.get(p.id).z));
    }
    expect(moved).toBeLessThan(1.5);
    // A kick that lands around the receiving 35 (short of the landing zone): dead, ball at the 40.
    const { launchKick } = await import('../src/sim/kicking.js');
    const s2 = new PlaySim({ rng: new RNG(5), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -15, ballZ: 0, offPlay: getOffPlay('st_squib'), defPlay: getDefPlay('st_kick_return') });
    s2.snap();
    launchKick(s2, s2.players[s2.kick.kickerId], { type: 'squib', power: 0.6, accuracy: 0, aim: 0 });
    for (let k = 0; k < 2000 && !s2.finished; k++) s2.tick(STEP, null);
    expect(s2.result.kickShort).toBe(true);
  });
  it('onside kicks keep the old alignment with the hands team', async () => {
    const { defenseForSpecial } = await import('../src/ai/playcaller.js');
    expect(getOffPlay('st_onside').formation).toBe('kickoff_onside');
    expect(defenseForSpecial(getOffPlay('st_onside')).id).toBe('st_onside_return');
    expect(defenseForSpecial(getOffPlay('st_kickoff')).id).toBe('st_kick_return');
  });
});
