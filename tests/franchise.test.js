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
