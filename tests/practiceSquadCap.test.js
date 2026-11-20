import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { createFranchise, releasedPlayer } from '../src/franchise/franchise.js';
import { posLevels } from '../src/franchise/freeAgents.js';
import { psEligible, addToPS, promoteFromPS, promoteAsk } from '../src/franchise/practiceSquad.js';
import { payroll, deadMoney } from '../src/franchise/contracts.js';
import { releasePlayer } from '../src/data/rosterOps.js';

// The "practice squad cheese": sign a star to the practice squad for $0.25M, then sign him to the 53 for the
// minimum. Practice squads now only take fringe players, moving up pays the player's in-season asking price within
// the cap, and cutting a player leaves dead money.
describe('practice squad and dead money', () => {
  const lg = generateLeagueRosters(defaultTeams(), 2031);
  const f = createFranchise(lg, { userTeam: 3, weeks: 10, seed: 6 });
  const me = lg[3];
  const levels = posLevels(lg);

  it('a starter-level free agent will not sign to the practice squad', () => {
    const star = [...f.freeAgents].sort((a, b) => b.ovr - a.ovr)[0];
    star.ovr = levels[star.pos] + 2;
    expect(psEligible(me, star, levels)).toBe(false);
    expect(addToPS(me, star, levels)).toBe(false);
    const fringe = f.freeAgents.find((p) => p.ovr <= levels[p.pos] - 10 && (p.age ?? 30) <= 24);
    if (fringe) expect(psEligible({ ps: [] }, fringe, levels)).toBe(true);
  });

  it('moving up to the 53 pays his asking price and needs cap room', () => {
    const t = { roster: [...me.roster], ps: [], depth: me.depth };
    while (t.roster.length > 52) t.roster.pop();
    const p = { ...f.freeAgents[0], id: 99001, ratings: { ...f.freeAgents[0].ratings }, practiceSquad: true, salary: 0.25 };
    t.ps.push(p);
    expect(promoteFromPS(t, p, payroll(t) + 0.1)).toBe(false); // no room for his ask
    expect(t.ps).toContain(p);
    const ask = promoteAsk(p);
    expect(promoteFromPS(t, p, payroll(t) + ask + 1)).toBe(true);
    expect(p.salary).toBe(ask);
  });

  it('cutting a player leaves dead money on the cap', () => {
    const p = [...me.roster].sort((a, b) => b.salary - a.salary)[0];
    p.years = 3;
    const before = payroll(me);
    const dead = deadMoney(f, p);
    expect(dead).toBeGreaterThan(p.salary); // all of this season plus prorated later years
    releasePlayer(me, p.id);
    releasedPlayer(f, lg, me, p);
    expect(me.deadCap).toBeCloseTo(dead, 5);
    expect(payroll(me)).toBeCloseTo(before - p.salary + dead, 5);
  });
});
