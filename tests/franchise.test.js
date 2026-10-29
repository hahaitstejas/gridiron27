import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { makeSchedule, standings, rank, leaders } from '../src/franchise/season.js';
import { quickSim } from '../src/franchise/quicksim.js';
import { createFranchise, simOthers, simGame, userGame, advance, currentGames } from '../src/franchise/franchise.js';

const teams = generateLeagueRosters(defaultTeams(), 2027);

describe('franchise schedule', () => {
  for (const weeks of [6, 10, 17]) {
    it(`${weeks}-week schedule: everyone plays once a week, no third meetings`, () => {
      const s = makeSchedule(teams, weeks, 3);
      expect(s).toHaveLength(weeks);
      const meet = new Map(), games = new Array(32).fill(0), home = new Array(32).fill(0);
      for (const wk of s) {
        const seen = new Set();
        for (const g of wk) {
          expect(seen.has(g.home) || seen.has(g.away)).toBe(false);
          seen.add(g.home); seen.add(g.away);
          games[g.home]++; games[g.away]++; home[g.home]++;
          const k = [g.home, g.away].sort().join('-');
          meet.set(k, (meet.get(k) || 0) + 1);
        }
        expect(seen.size).toBe(32);
      }
      expect(games.every((n) => n === weeks)).toBe(true);
      expect(Math.max(...meet.values())).toBeLessThanOrEqual(2);
      expect(Math.max(...home) - Math.min(...home)).toBeLessThanOrEqual(3);
    });
  }
});

describe('quick sim', () => {
  it('produces football scores and consistent box-score lines', () => {
    let pts = 0, n = 0;
    for (let s = 0; s < 200; s++) {
      const r = quickSim(teams[s % 32], teams[(s * 7 + 3) % 32 === s % 32 ? (s + 1) % 32 : (s * 7 + 3) % 32], s + 1);
      for (const sc of r.score) { expect(sc).toBeGreaterThanOrEqual(0); expect(sc % 1).toBe(0); pts += sc; n++; }
      const lines = Object.values(r.lines);
      const rec = lines.reduce((a, l) => a + (l.rec || 0), 0), cmp = lines.reduce((a, l) => a + (l.passCmp || 0), 0);
      expect(rec).toBe(cmp);
    }
    expect(pts / n).toBeGreaterThan(17);
    expect(pts / n).toBeLessThan(28);
  });
});

describe('franchise season', () => {
  it('runs a short season through the playoffs to a champion', () => {
    const f = createFranchise(teams, { userTeam: 20, weeks: 6, seed: 5 });
    let guard = 0;
    while (f.phase !== 'offseason' && guard++ < 50) {
      simOthers(f, teams);
      const g = userGame(f);
      if (g && !g.score) simGame(f, teams, g);
      expect(advance(f, teams)).toBe(true);
    }
    expect(f.phase).toBe('offseason');
    expect(f.playoffs.rounds).toHaveLength(4);
    expect(f.playoffs.seeds[0]).toHaveLength(7);
    expect(currentGames(f)).toHaveLength(0);
    const champ = f.history[0].champion;
    expect(f.playoffs.seeds.flat()).toContain(champ);
    const rows = rank(standings(teams, f.schedule));
    expect(rows[0].w + rows[0].l + rows[0].t).toBe(6);
    expect(leaders(f, 'passYds', 5)).toHaveLength(5);
    expect(leaders(f, 'passYds', 1)[0].value).toBeGreaterThan(700);
  });
});

describe('offseason', () => {
  it('ages, re-signs, runs free agency and the draft, and cuts every team to 53', async () => {
    const O = await import('../src/franchise/offseason.js');
    const { startNextSeason } = await import('../src/franchise/franchise.js');
    const lg = generateLeagueRosters(defaultTeams(), 99);
    const f = createFranchise(lg, { userTeam: 3, weeks: 6, seed: 9 });
    while (f.phase !== 'offseason') { simOthers(f, lg); const g = userGame(f); if (g && !g.score) simGame(f, lg, g); advance(f, lg); }
    const qb = lg[3].roster.find((p) => p.pos === 'QB');
    const age0 = qb.age;
    O.progressPlayers(f, lg);
    expect(f.offseason.step).toBe('progression');
    expect(lg[3].roster.find((p) => p.id === qb.id)?.age ?? age0 + 1).toBe(age0 + 1);
    f.offseason.step = 'resign';
    for (const p of O.expiring(lg[3]).slice(0, 2)) O.resign(lg[3], p.id);
    O.finishResigning(f, lg);
    expect(O.expiring(lg[3])).toHaveLength(0);
    expect(f.offseason.pool.length).toBeGreaterThan(20);
    O.cpuFreeAgency(f, lg);
    O.makeDraft(f, lg);
    expect(f.offseason.draft.picks).toHaveLength(224);
    O.simToUserPick(f, lg);
    const myPick = f.offseason.draft.picks[f.offseason.draft.at];
    expect(myPick.team).toBe(3);
    const choice = f.offseason.draft.cls[0].id;
    O.makePick(f, lg, choice);
    expect(lg[3].roster.some((p) => p.id === choice)).toBe(true);
    O.finishDraft(f, lg);
    O.cpuCutDowns(f, lg);
    O.cutDown(lg[3]);
    for (const t of lg) {
      expect(t.roster.length).toBeLessThanOrEqual(53);
      for (const ids of Object.values(t.depth)) for (const id of ids) expect(t.roster.some((p) => p.id === id)).toBe(true);
      for (const slot of ['QB', 'HB', 'WR', 'LT', 'C', 'LE', 'CB', 'K']) expect(t.depth[slot].length).toBeGreaterThan(0);
    }
    startNextSeason(f, lg);
    expect(f.phase).toBe('regular');
    expect(f.year).toBe(2028);
  });
});

describe('franchise injuries', () => {
  it('quick-sim injuries stick, keep players out, and heal week by week', async () => {
    const { heal } = await import('../src/franchise/franchise.js');
    const lg = generateLeagueRosters(defaultTeams(), 55);
    const f = createFranchise(lg, { userTeam: 0, weeks: 10, seed: 3 });
    let seen = null;
    for (let w = 0; w < 10 && !seen; w++) {
      simOthers(f, lg); const g = userGame(f); if (g && !g.score) simGame(f, lg, g);
      for (const t of lg) { const p = t.roster.find((q) => q.injury); if (p) seen = { p, weeks: p.injury.weeks }; }
      if (!seen) advance(f, lg);
    }
    expect(seen).not.toBeNull();
    const { quickSim } = await import('../src/franchise/quicksim.js');
    const team = lg.find((t) => t.roster.includes(seen.p));
    const opp = lg.find((t) => t !== team);
    const r = quickSim(team, opp, 99);
    expect(r.lines[seen.p.id]).toBeUndefined(); // injured players get no stats
    heal(lg);
    if (seen.weeks <= 1) expect(seen.p.injury).toBeUndefined();
    else expect(seen.p.injury.weeks).toBe(seen.weeks - 1);
  });
});

describe('franchise money', () => {
  it('sets a cap every team fits under, and keeps it through three offseasons', async () => {
    const O = await import('../src/franchise/offseason.js');
    const C = await import('../src/franchise/contracts.js');
    const { startNextSeason } = await import('../src/franchise/franchise.js');
    const lg = generateLeagueRosters(defaultTeams(), 7);
    const f = createFranchise(lg, { userTeam: 5, weeks: 6, seed: 4 });
    expect(f.cap).toBeGreaterThan(100);
    for (const t of lg) expect(C.payroll(t)).toBeLessThanOrEqual(f.cap);
    for (let season = 0; season < 3; season++) {
      while (f.phase !== 'offseason') { simOthers(f, lg); const g = userGame(f); if (g && !g.score) simGame(f, lg, g); advance(f, lg); }
      O.progressPlayers(f, lg);
      O.finishResigning(f, lg);
      O.cpuFreeAgency(f, lg);
      O.makeDraft(f, lg);
      O.finishDraft(f, lg);
      O.cpuCutDowns(f, lg);
      O.cutDown(lg[5], 53, f.cap);
      O.fillRoster(f, lg[5], 46);
      for (const t of lg) {
        expect(C.payroll(t)).toBeLessThanOrEqual(f.cap + 1e-6);
        expect(t.roster.length).toBeGreaterThanOrEqual(45);
        for (const p of t.roster) expect(p.salary).toBeGreaterThanOrEqual(C.MIN_SALARY);
      }
      startNextSeason(f, lg);
    }
  }, 30000);

  it('values stars over depth, and the CPU wants a fair deal', async () => {
    const C = await import('../src/franchise/contracts.js');
    const lg = generateLeagueRosters(defaultTeams(), 7);
    C.setupMoney(lg, 1);
    const [a, b] = lg;
    const star = [...b.roster].sort((x, y) => C.tradeValue(y) - C.tradeValue(x))[0];
    const scrub = [...a.roster].sort((x, y) => C.tradeValue(x) - C.tradeValue(y))[0];
    expect(C.tradeValue(star)).toBeGreaterThan(C.tradeValue(scrub) * 5);
    expect(C.evaluateTrade(b, [scrub], a, [star], 1e9).accept).toBe(false);
    const best = [...a.roster].sort((x, y) => C.tradeValue(y) - C.tradeValue(x)).slice(0, 3);
    expect(C.evaluateTrade(b, best, a, [scrub], 1e9).accept).toBe(true);
    C.executeTrade(a, best, b, [scrub]);
    expect(b.roster.some((p) => p.id === best[0].id)).toBe(true);
    expect(a.roster.some((p) => p.id === scrub.id)).toBe(true);
  });
});
