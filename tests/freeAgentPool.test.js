import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { createFranchise } from '../src/franchise/franchise.js';
import { addGeneratedFreeAgents, posLevels, topUpPool, tamePool } from '../src/franchise/freeAgents.js';
import { cpuFillPS } from '../src/franchise/practiceSquad.js';

describe('free-agent pool', () => {
  it('covers every position and stays below the league starters', () => {
    const teams = generateLeagueRosters(defaultTeams(), 11);
    const f = createFranchise(teams, { userTeam: 2, weeks: 6, seed: 5 });
    const lv = posLevels(teams);
    addGeneratedFreeAgents(f, 800, 15, { levels: lv });
    for (const t of teams) cpuFillPS(t, f.freeAgents);
    topUpPool(f, lv, 25);
    const by = {};
    for (const p of f.freeAgents) (by[p.pos] ||= []).push(p.ovr);
    for (const pos of Object.keys(lv)) {
      expect(by[pos]?.length ?? 0).toBeGreaterThanOrEqual(20);
      expect(Math.max(...by[pos])).toBeLessThan(lv[pos]);
    }
  });

  it('tames an old save once', () => {
    const teams = generateLeagueRosters(defaultTeams(), 12);
    const f = createFranchise(teams, { userTeam: 1, weeks: 6, seed: 2 });
    const wr = f.freeAgents.find((p) => p.pos === 'WR');
    for (const k of Object.keys(wr.ratings)) wr.ratings[k] = 95;
    wr.ovr = 95;
    f.faTamed = false;
    expect(tamePool(f, teams)).toBeGreaterThan(0);
    expect(wr.ovr).toBeLessThan(posLevels(teams).WR);
    expect(tamePool(f, teams)).toBe(0);
  });
});

describe('trade finder', () => {
  it('prices a target with a package the CPU accepts', async () => {
    const { ensurePicks, cheapestPackage, evaluateDeal } = await import('../src/franchise/trades.js');
    const teams = generateLeagueRosters(defaultTeams(), 13);
    const f = createFranchise(teams, { userTeam: 0, weeks: 6, seed: 4 });
    ensurePicks(f, teams);
    const wr = [...teams[5].roster].filter((p) => p.pos === 'WR').sort((a, b) => b.ovr - a.ovr)[1];
    const pkg = cheapestPackage(f, teams, 5, wr, 0);
    expect(pkg).not.toBeNull();
    expect(pkg.players.length + pkg.picks.length).toBeLessThanOrEqual(3);
    expect(evaluateDeal(f, teams, 5, { players: pkg.players, picks: pkg.picks }, 0, { players: [wr], picks: [] }).accept).toBe(true);
  });
});
