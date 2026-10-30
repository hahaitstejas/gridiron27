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
