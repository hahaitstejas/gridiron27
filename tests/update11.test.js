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
