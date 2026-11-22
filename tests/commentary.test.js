import { describe, it, expect } from 'vitest';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { GameSession } from '../src/game/session.js';
import { Commentary } from '../src/game/commentary.js';

const teams = generateLeagueRosters(defaultTeams(), 61);

describe('commentary brain', () => {
  it('calls a whole CPU game without errors, with both voices and no undefined names', () => {
    const s = new GameSession({ teams: [teams[3], teams[9]], settings: { quarterMinutes: 2 }, humanTeam: null, seed: 11, fast: true });
    const booth = new Commentary(3);
    const lines = [];
    let t = 0;
    for (let i = 0; i < 200000 && !s.match.over; i++) {
      s.tick(STEP, null);
      t += STEP;
      for (const e of s.events.splice(0)) lines.push(...booth.onEvent(e, { match: s.match, sim: s.sim, teams: s.teams, now: t }));
    }
    expect(s.match.over).toBe(true);
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.some((l) => l.who === 'pbp')).toBe(true);
    expect(lines.some((l) => l.who === 'color')).toBe(true);
    for (const l of lines) expect(l.text).not.toMatch(/undefined|null|NaN/);
  });
});
