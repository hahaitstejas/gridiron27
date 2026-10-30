import { describe, it, expect } from 'vitest';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { GameSession } from '../src/game/session.js';
import { SCENARIOS, scenarioFinal } from '../src/game/scenarios.js';

const teams = generateLeagueRosters(defaultTeams(), 61);

describe('scenarios', () => {
  it('start in their situation and end with a verdict', () => {
    for (const sc of SCENARIOS) {
      const s = new GameSession({ teams: [teams[3], teams[4]], settings: { quarterMinutes: 15, scenario: { id: sc.id } }, seed: 12, fast: true });
      const m = s.match;
      expect(m.quarter).toBe(sc.quarter);
      expect(m.clock).toBe(sc.clock);
      expect(m.score).toEqual(sc.score);
      expect(m.possession).toBe(sc.side === 'you' ? 0 : 1);
      expect(m.yardLine).toBe(sc.yardLine);
      if (sc.down) expect(m.down).toBe(sc.down);
      for (let k = 0; k < 2e6 && s.state !== 'over'; k++) s.tick(STEP, null);
      expect(s.state).toBe('over');
      const v = s.scenario.result || scenarioFinal(m);
      expect(typeof v.success).toBe('boolean');
      if (sc.goal === 'stop' && v.success) expect(m.score[1]).toBe(sc.score[1]);
      if (sc.goal === 'td' && v.success) expect(m.score[0]).toBeGreaterThanOrEqual(sc.score[0] + 6);
    }
  }, 60000);
});

describe('CPU clock management', () => {
  it('ices the kicker before a late tying field goal, once, and the kick still happens', async () => {
    const { wantsIce, cpuTempo } = await import('../src/ai/playcaller.js');
    const { RNG } = await import('../src/core/rng.js');
    const s = new GameSession({ teams: [teams[5], teams[6]], settings: { quarterMinutes: 15 }, seed: 3, fast: true });
    const m = s.match;
    m.quarter = 4; m.clock = 20; m.score = [20, 22]; m.timeouts = [0, 2];
    m.newPossession(0, 75, 0); m.down = 4; m.toGo = 8; m.firstYL = 83;
    expect(wantsIce(m, 1, 0)).toBe(true);
    s.enterPlaycall();
    let iced = 0, kicked = false;
    for (let k = 0; k < 20000 && s.state !== 'over' && !kicked; k++) {
      s.tick(STEP, null);
      for (const e of s.events) { if (e.type === 'iced') iced++; if (e.type === 'kick') kicked = true; }
    }
    expect(iced).toBe(1);
    expect(m.timeouts[1]).toBe(1);
    expect(kicked).toBe(true);
    // Down two scores late: hurry-up tempo even before the two-minute warning.
    m.quarter = 4; m.clock = 280; m.score = [3, 20];
    expect(cpuTempo(m, 0, new RNG(1))).toBeLessThan(20);
  });
});

describe('home crowd', () => {
  it('is loud for the visitors on big downs, quiet for the home offense and at neutral sites', async () => {
    const { crowdNoise } = await import('../src/game/penalties.js');
    const m = { possession: 1, phase: 'scrimmage', down: 3, quarter: 4, score: [17, 14], yardLine: 85, settings: {} };
    expect(crowdNoise(m)).toBeGreaterThan(0.9);
    expect(crowdNoise({ ...m, down: 1, quarter: 1, yardLine: 30 })).toBeLessThan(0.3);
    expect(crowdNoise({ ...m, possession: 0 })).toBe(0);
    expect(crowdNoise({ ...m, settings: { neutral: true } })).toBe(0);
  });
});
