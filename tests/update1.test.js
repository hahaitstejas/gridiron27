import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { createFranchise, simOthers, userGame, simGame, advance } from '../src/franchise/franchise.js';
import { RNG } from '../src/core/rng.js';

describe('Update 1.0 franchise systems', () => {
  it('injuries happen at NFL-like rates, with IR, and the CPU signs free agents', () => {
    const teams = generateLeagueRosters(defaultTeams(), 9);
    const f = createFranchise(teams, { userTeam: 2, seed: 3 });
    for (let w = 0; w < 10; w++) { simOthers(f, teams); const g = userGame(f); if (g && !g.score) simGame(f, teams, g); advance(f, teams); }
    const out = teams.map((t) => t.roster.filter((p) => p.injury && (p.injury.weeks > 0 || p.injury.ir)).length);
    const avg = out.reduce((a, b) => a + b, 0) / teams.length;
    expect(avg).toBeGreaterThan(2);
    expect(avg).toBeLessThan(12);
    expect(teams.some((t) => t.roster.some((p) => p.injury?.ir))).toBe(true);
    expect(f.transactions.some((t) => / sign /.test(t.text))).toBe(true);
    expect(teams[0].roster.every((p) => typeof p.injury?.name === 'string' || !p.injury)).toBe(true);
  }, 60000);

  it('practice squad elevations are limited and revert after the game', async () => {
    const { addToPS, elevate, revertElevations, PS_MAX } = await import('../src/franchise/practiceSquad.js');
    const { generatePool } = await import('../src/franchise/freeAgents.js');
    const teams = generateLeagueRosters(defaultTeams(), 4);
    const t = teams[0];
    const pool = generatePool(30, 5, { udfa: true });
    for (const p of pool) addToPS(t, p);
    expect(t.ps.length).toBe(PS_MAX);
    const n = t.roster.length;
    expect(elevate(t, t.ps[0])).toBe(true);
    expect(elevate(t, t.ps[1])).toBe(true);
    expect(elevate(t, t.ps[2])).toBe(false); // two a game
    expect(t.roster.length).toBe(n + 2);
    revertElevations(t);
    expect(t.roster.length).toBe(n);
    expect(t.ps.length).toBe(PS_MAX);
  });

  it('trades need value both ways and picks change hands', async () => {
    const { ensurePicks, picksOf, evaluateDeal, executeDeal } = await import('../src/franchise/trades.js');
    const teams = generateLeagueRosters(defaultTeams(), 6);
    const f = createFranchise(teams, { userTeam: 0, seed: 2 });
    ensurePicks(f, teams);
    expect(picksOf(f, 0).length).toBe(14);
    const star = [...teams[1].roster].sort((a, b) => b.ovr - a.ovr)[0];
    // Nothing for a star: refused.
    expect(evaluateDeal(f, teams, 1, { players: [], picks: [] }, 0, { players: [star], picks: [] }).accept).toBe(false);
    const first = picksOf(f, 0).find((p) => p.round === 7);
    expect(evaluateDeal(f, teams, 1, { players: [], picks: [first] }, 0, { players: [star], picks: [] }).accept).toBe(false);
    executeDeal(f, teams, 0, { players: [], picks: [first] }, 1, { players: [], picks: [] });
    expect(picksOf(f, 1).some((p) => p.round === 7 && p.orig === 0)).toBe(true);
  });

  it('jersey numbers follow position rules and retired numbers', async () => {
    const { freeNumber } = await import('../src/data/league.js');
    const { numberAllowed } = await import('../src/data/positions.js');
    const t = { roster: [], retired: [{ number: 12 }] };
    const n = freeNumber(t, 12, 'QB');
    expect(n).not.toBe(12);
    expect(numberAllowed('QB', n)).toBe(true);
    expect(numberAllowed('T', 12)).toBe(false);
    expect(freeNumber(t, 99, 'G')).toBeGreaterThanOrEqual(50);
  });

  it('honors and the franchise tag', async () => {
    const { selectHonors, tagSalary, applyTag } = await import('../src/franchise/honors.js');
    const teams = generateLeagueRosters(defaultTeams(), 8);
    const f = createFranchise(teams, { userTeam: 0, seed: 4 });
    for (const t of teams) for (const q of t.roster) f.stats[q.id] = { gp: 17 }; // a full season played
    const h = selectHonors(f, teams);
    expect(h.allPro.length).toBeGreaterThan(20);
    expect(h.proBowl).toHaveLength(2);
    const p = teams[0].roster[0]; p.years = 0;
    const price = tagSalary(teams, p);
    expect(applyTag(f, teams, teams[0], p).ok).toBe(true);
    expect(p.salary).toBe(price);
    const q = teams[0].roster[1]; q.years = 0;
    expect(applyTag(f, teams, teams[0], q).ok).toBe(false); // once a year
  });

  it('spreadsheets: coaches, uniforms, schedule', async () => {
    const X = await import('../src/data/extraCSV.js');
    const { parseCSV } = await import('../src/data/csv.js');
    const teams = defaultTeams();
    const a = teams[0].abbr, b = teams[1].abbr;
    X.importCoaches(teams, parseCSV(`team,role,first,last,run_pct,go_for_it\n${a},HC,Pat,Doe,,90\n${a},OC,Lee,Ray,60,`));
    expect(teams[0].coach.aggr).toBeGreaterThan(0.5);
    expect(teams[0].coach.runPct).toBe(60);
    X.importUniforms(teams, parseCSV(`team,kind,jersey,pants,number,number_outline,helmet\n${a},alt,#000000,#111111,#ffffff,#ff0000,#000000`));
    expect(teams[0].uniforms.alt.jersey).toBe('#000000');
    const { weeks, skipped } = X.scheduleFromRows(teams, parseCSV(`week,away,home\n1,${a},${b}\n2,${b},${a}`));
    expect(weeks).toHaveLength(2); expect(skipped).toHaveLength(0);
    expect(X.extraKind(parseCSV('team,number,player\nX,1,Y'))).toBe('retired');
  });
});
