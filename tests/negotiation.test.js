import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { createFranchise } from '../src/franchise/franchise.js';
import { talksWith, makeOffer, PATIENCE, canExtend, offerExtension, extStore } from '../src/franchise/negotiation.js';
import { progressPlayers, expiring } from '../src/franchise/offseason.js';

describe('contract talks', () => {
  const lg = generateLeagueRosters(defaultTeams(), 2033);
  const f = createFranchise(lg, { userTeam: 2, weeks: 6, seed: 4 });
  f.offseason = {};
  const team = lg[2];
  const players = [...team.roster].sort((a, b) => b.ovr - a.ovr);

  it('meeting his ask signs him at those terms', () => {
    const p = players[0];
    const t = talksWith(f, p);
    const r = makeOffer(f, lg, team, p, { salary: t.salary, years: t.years });
    expect(r.result).toBe('accept');
    expect(t.done).toEqual({ salary: t.salary, years: t.years });
  });

  it('a near miss gets a counter that comes toward the offer', () => {
    const p = players[1];
    const t = talksWith(f, p);
    const ask = t.salary;
    const r = makeOffer(f, lg, team, p, { salary: Math.round(ask * 0.9 * 20) / 20, years: t.years });
    expect(['counter', 'accept']).toContain(r.result);
    if (r.result === 'counter') { expect(t.salary).toBeLessThan(ask); expect(t.patience).toBe(PATIENCE - 1); }
  });

  it('lowball after lowball and he walks', () => {
    const p = players[2];
    const t = talksWith(f, p);
    let r;
    for (let k = 0; k < 4 && t.patience > 0; k++) r = makeOffer(f, lg, team, p, { salary: t.salary * 0.5, years: t.years });
    expect(r.result).toBe('walk');
    expect(t.walked).toBe(true);
  });
});

describe('in-season extensions', () => {
  const lg = generateLeagueRosters(defaultTeams(), 2041);
  const f = createFranchise(lg, { userTeam: 3, weeks: 6, seed: 9 });
  const team = lg[3];
  const p = [...team.roster].filter((q) => (q.age ?? 27) <= 29).sort((a, b) => b.ovr - a.ovr)[0];
  p.years = 1;

  it('a player in his last year can be extended; the deal waits for next season', () => {
    expect(canExtend(f, p)).toBe(true);
    const t = talksWith(f, p, extStore(f));
    const salaryNow = p.salary;
    const r = offerExtension(f, lg, team, p, { salary: t.salary, years: t.years });
    expect(r.result).toBe('accept');
    expect(p.ext).toEqual({ salary: t.salary, years: t.years });
    expect(p.salary).toBe(salaryNow);
    expect(canExtend(f, p)).toBe(false);
    // Extension talks don't touch the offseason re-signing talks.
    expect(f.offseason?.talks?.[p.id]).toBeUndefined();
  });

  it('the extension takes over when his contract runs out', () => {
    const want = { ...p.ext };
    f.phase = 'offseason'; f.offseason = { step: 'summary' };
    progressPlayers(f, lg);
    if (!team.roster.includes(p)) return; // retired (not expected at <= 30)
    expect(p.ext).toBeUndefined();
    expect(p.salary).toBe(want.salary);
    expect(p.years).toBe(want.years);
    expect(expiring(team)).not.toContain(p);
  });
});
