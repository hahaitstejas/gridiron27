import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { buildDepthChart, fbFallback } from '../src/data/depthChart.js';
import { createFranchise, weekInBetween } from '../src/franchise/franchise.js';
import { releasePlayer } from '../src/data/rosterOps.js';

describe('Update 1.1', () => {
  it('no fullback: the third tight end plays FB before a halfback', () => {
    const teams = generateLeagueRosters(defaultTeams(), 4);
    const t = teams[3];
    t.roster = t.roster.filter((p) => p.pos !== 'FB');
    t.depth = buildDepthChart(t.roster);
    const tes = t.roster.filter((p) => p.pos === 'TE').length;
    const first = t.roster.find((p) => p.id === fbFallback(t)[0]);
    expect(first.pos).toBe(tes >= 3 ? 'TE' : 'HB');
    expect(t.depth.FB[0]).toBe(first.id);
  });

  it('CPU teams always have a kicker and a punter', () => {
    const teams = generateLeagueRosters(defaultTeams(), 5);
    const f = createFranchise(teams, { userTeam: 0, seed: 2 });
    for (const p of teams[7].roster.filter((q) => q.pos === 'K')) releasePlayer(teams[7], p.id);
    for (const p of teams[8].roster.filter((q) => q.pos === 'P')) p.injury = { name: 'Hamstring strain', weeks: 3 };
    weekInBetween(f, teams);
    expect(teams[7].roster.some((p) => p.pos === 'K')).toBe(true);
    const k = teams[7].roster.find((p) => p.id === teams[7].depth.K[0]);
    expect(k.pos).toBe('K');
    const pt = teams[8].roster.find((p) => p.id === teams[8].depth.P[0]);
    expect(pt.pos).toBe('P');
    expect(pt.injury?.weeks > 0).toBe(false);
  });
});

describe('practice squad', () => {
  it('undoing an elevation gives it back; releasing makes him a free agent', async () => {
    const { addToPS, elevate, unelevate, releaseFromPS } = await import('../src/franchise/practiceSquad.js');
    const { generatePlayer } = await import('../src/data/generator.js');
    const { RNG } = await import('../src/core/rng.js');
    const teams = generateLeagueRosters(defaultTeams(), 6);
    const t = teams[0];
    const p = generatePlayer('WR', new RNG(1), -10, { age: 22 });
    addToPS(t, p);
    const n = t.roster.length;
    expect(elevate(t, p)).toBe(true);
    expect(t.roster.length).toBe(n + 1);
    expect(unelevate(t, p)).toBe(true);
    expect(t.roster.length).toBe(n);
    expect(p.elevations).toBe(0);
    expect(Object.values(t.depth).some((ids) => ids.includes(p.id))).toBe(false);
    const pool = [];
    elevate(t, p);
    expect(releaseFromPS(t, p, (q) => pool.push(q))).toBe(true);
    expect(pool).toEqual([p]);
    expect(t.ps.includes(p)).toBe(false);
    expect(t.roster.includes(p)).toBe(false);
  });
});

describe('names', () => {
  it('generated leagues never use a blocked (real) name', async () => {
    const { blockedName, FIRST_NAMES, LAST_NAMES } = await import('../src/data/names.js');
    expect(blockedName('Caleb', 'Williams')).toBe(true);
    const teams = generateLeagueRosters(defaultTeams(), 11);
    expect(teams.flatMap((t) => t.roster).some((p) => blockedName(p.first, p.last))).toBe(false);
    expect(FIRST_NAMES.length * LAST_NAMES.length).toBeGreaterThan(1000);
  });
});

describe('pre-snap movement', () => {
  it('a human defender walks around before the snap but never into the neutral zone', async () => {
    const { PlaySim } = await import('../src/sim/play.js');
    const { RNG } = await import('../src/core/rng.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const lg = generateLeagueRosters(defaultTeams(), 3);
    const sim = new PlaySim({ rng: new RNG(2), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -10, ballZ: 0, offPlay: getOffPlay('ace_inside_zone'), defPlay: getDefPlay('43_cover3'), humanTeam: 1, camDir: -1 });
    const me = sim.players[sim.controlledId];
    expect(me.team).toBe(1);
    const x0 = me.x, z0 = me.z;
    // Stick "up" for the defense's camera = toward the offense; hold it for 4 seconds.
    const f = { lx: 0.4, ly: -1, rx: 0, ry: 0, lt: 0, rt: 0, down: {}, pressed: {}, released: {}, held: {}, flick: {} };
    for (let k = 0; k < 240; k++) sim.tick(STEP, f);
    expect(Math.hypot(me.x - x0, me.z - z0)).toBeGreaterThan(1);
    expect(sim.toLocal(me.x, me.z).down).toBeGreaterThanOrEqual(0.9);
    sim.snap();
    for (let k = 0; k < 600 && !sim.finished; k++) sim.tick(STEP, null);
    expect(sim.state === 'dead' || sim.finished).toBe(true);
  });
});

describe('league book (one spreadsheet)', () => {
  it('round-trips the league through one file with sections', async () => {
    const { exportLeagueBook, importLeagueBook, isLeagueBook, splitLeagueBook } = await import('../src/data/leagueBook.js');
    const { ensureCoaches } = await import('../src/data/extraCSV.js');
    const a = generateLeagueRosters(defaultTeams(), 21);
    ensureCoaches(a, 3);
    a[4].city = 'Harbor Point'; a[4].roster[0].last = 'Testerson'; a[4].roster[0].ratings.speed = 97;
    a[2].retired = [{ number: 12, player: 'Old Star' }];
    const text = exportLeagueBook(a, { playAs: 4 });
    expect(isLeagueBook(text)).toBe(true);
    expect(Object.keys(splitLeagueBook(text))).toEqual(['TEAMS', 'ROSTER', 'DEPTH', 'COACHES', 'UNIFORMS', 'STADIUMS', 'RETIRED_NUMBERS', 'FREE_AGENTS', 'SCHEDULE']);
    // Spreadsheet apps pad marker rows with commas and add blank rows: still fine.
    const padded = text.replace(/^\[(\w+)\]$/gm, '[$1],,,,').replace(/\n\[/g, '\n,,,\n[');
    const b = generateLeagueRosters(defaultTeams(), 99);
    const r = importLeagueBook(b, padded);
    expect(r.playAs).toBe(4);
    expect(b[4].city).toBe('Harbor Point');
    expect(b[4].roster.some((p) => p.last === 'Testerson' && p.ratings.speed === 97)).toBe(true);
    expect(b[2].retired).toEqual([{ number: 12, player: 'Old Star' }]);
    expect(b[5].coaches.hc.name).toBe(a[5].coaches.hc.name);
    expect(r.freeAgents).toBe(null);
    expect(r.problems.filter((p) => !/depth/i.test(p))).toEqual([]);
  });
});

describe('RPO', () => {
  it('the CPU QB both hands off and pulls; a human holding LT always pulls and can throw', async () => {
    const { PlaySim } = await import('../src/sim/play.js');
    const { RNG } = await import('../src/core/rng.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, listDefPlays } = await import('../src/data/playbook.js');
    const lg = generateLeagueRosters(defaultTeams(), 8);
    let pulls = 0, gives = 0;
    for (let i = 0; i < 40; i++) {
      const sim = new PlaySim({ rng: new RNG(50 + i), teams: [lg[i % 32], lg[(i + 3) % 32]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: getOffPlay('rpo_iz_slant'), defPlay: listDefPlays()[i % listDefPlays().length], humanTeam: null });
      sim.snap();
      for (let k = 0; k < 900 && !sim.finished; k++) { sim.tick(STEP, null); if (sim.events.some((e) => e.type === 'rpoPull')) pulls++; if (sim.events.some((e) => e.type === 'handoff')) gives++; }
    }
    expect(pulls).toBeGreaterThan(3);
    expect(gives).toBeGreaterThan(3);
    const sim = new PlaySim({ rng: new RNG(5), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: getOffPlay('rpo_iz_slant'), defPlay: listDefPlays()[0], humanTeam: 0 });
    sim.snap();
    const f = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 1, rt: 0, down: {}, pressed: {}, released: {}, held: {}, flick: {} };
    let pulled = false;
    for (let k = 0; k < 60; k++) { sim.tick(STEP, f); if (sim.events.some((e) => e.type === 'rpoPull')) pulled = true; }
    expect(pulled).toBe(true);
    expect(sim.offPlay.type).toBe('pass');
  });
});

describe('audible packages', () => {
  it('the audible menu uses the saved package for that formation', async () => {
    const { offenseAudibles, setAudiblePackages, defaultPackage } = await import('../src/game/audibles.js');
    const { getOffPlay, listOffPlays } = await import('../src/data/playbook.js');
    const play = getOffPlay('ace_inside_zone');
    const def = defaultPackage('off', 'singleback_ace');
    expect(Object.keys(def).length).toBeGreaterThan(2);
    const ace = listOffPlays().filter((p) => p.formation === 'singleback_ace').map((p) => p.id);
    setAudiblePackages({ off: { singleback_ace: { A: 'ace_seams', B: 'ace_smash', X: 'ace_power_l', Y: 'ace_counter' } } });
    const opts = offenseAudibles(play);
    expect(opts.map((o) => o.btn)).toEqual(['A', 'B', 'X', 'Y', 'RB']);
    expect(opts[0].play.id).toBe('ace_seams');
    expect(ace.includes('ace_seams')).toBe(true);
    setAudiblePackages({});
    expect(offenseAudibles(play).length).toBeGreaterThan(2);
  });
});
