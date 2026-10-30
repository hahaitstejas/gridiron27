import { describe, it, expect } from 'vitest';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { GameSession } from '../src/game/session.js';
import { DRILLS, DRILL_IDS, medalFor } from '../src/game/drills.js';

const teams = generateLeagueRosters(defaultTeams(), 44);

describe('skills drills', () => {
  it('every drill runs its reps from the right spot and ends with a score', () => {
    for (const id of DRILL_IDS) {
      const s = new GameSession({ teams: [teams[1], teams[2]], settings: { quarterMinutes: 5, drill: { id }, drillAuto: true, penalties: false }, humanTeam: 0, seed: 5 });
      const spots = [];
      let over = false;
      for (let k = 0; k < 60 * 60 * 20 && !over; k++) {
        if (s.state === 'presnap' && s.presnapT === 0) spots.push(s.match.yardLine);
        s.tick(STEP, null);
        for (const e of s.events) if (e.type === 'gameOver') over = true;
      }
      expect(over).toBe(true);
      expect(s.drill.log.length).toBe(DRILLS[id].reps);
      expect(s.drill.score).toBe(s.drill.log.reduce((a, l) => a + l.pts, 0));
      // Defense drills: the human's side is on defense, the CPU has the ball.
      expect(s.match.possession).toBe(DRILLS[id].side === 'offense' ? 0 : 1);
      if (id === 'kicking') expect(spots.slice(0, 3)).toEqual([92, 87, 82]); // 25, 30, 35 yd kicks
    }
  }, 120000);
  it('medals follow the thresholds', () => {
    const [b, sv, g] = DRILLS.passing.medals;
    expect(medalFor('passing', b - 1)).toBe(-1);
    expect(medalFor('passing', b)).toBe(0);
    expect(medalFor('passing', sv)).toBe(1);
    expect(medalFor('passing', g + 500)).toBe(2);
  });
});
