import { describe, it, expect } from 'vitest';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { GameSession } from '../src/game/session.js';
import { Booth } from '../src/game/booth.js';
import { voiceClips } from '../src/game/voiceLines.js';

const teams = generateLeagueRosters(defaultTeams(), 61);
const ids = voiceClips().map((c) => c.id);

describe('commentary booth (recorded clips)', () => {
  it('has unique clip ids and fewer than 700 of them (itch.io caps a game at 1000 files)', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThan(700);
  });
  it('calls a whole CPU game live: throws, catches, breakaways, results, the analyst; only real clips', () => {
    const s = new GameSession({ teams: [teams[3], teams[9]], settings: { quarterMinutes: 3 }, humanTeam: null, seed: 11, fast: true });
    const booth = new Booth(ids, 3);
    const calls = [];
    for (let i = 0; i < 300000 && !s.match.over; i++) {
      s.tick(STEP, null);
      for (const e of s.events.splice(0)) calls.push(...booth.onEvent(e, { match: s.match, sim: s.sim, teams: s.teams }).map((c) => ({ ...c, ev: e.type })));
      calls.push(...booth.tick(s.sim).map((c) => ({ ...c, ev: 'tick' })));
    }
    expect(s.match.over).toBe(true);
    const have = new Set(ids);
    for (const c of calls) for (const p of c.parts) expect(have.has(p)).toBe(true);
    const by = (ev) => calls.filter((c) => c.ev === ev).length;
    expect(by('throw')).toBeGreaterThan(5);
    expect(by('catch')).toBeGreaterThan(5);
    expect(by('result')).toBeGreaterThan(20);
    expect(calls.some((c) => c.who === 'color')).toBe(true);
    expect(calls.some((c) => c.parts.some((p) => p.startsWith('name_')))).toBe(true);
  });
  it("stays quiet about what it has no clip for (a custom league's names)", () => {
    const booth = new Booth(ids.filter((id) => !id.startsWith('name_')), 5);
    const sim = { players: [{ name: 'Z. Zzyzx' }], isKick: false };
    const calls = booth.onEvent({ type: 'catch', player: 0 }, { sim });
    expect(calls.length).toBe(1);
    expect(calls[0].parts.every((p) => !p.startsWith('name_'))).toBe(true);
  });
});
