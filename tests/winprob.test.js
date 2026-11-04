import { describe, it, expect } from 'vitest';
import { expectedPoints, winProb, fourthOptions } from '../src/game/winprob.js';
import { fourthDecision } from '../src/ai/playcaller.js';
import { enforce } from '../src/game/penalties.js';

const team = { roster: [{ id: 1, ratings: { kickPower: 85, kickAccuracy: 80 } }], depth: { K: [1] } };
const mk = (o) => ({ yardLine: 50, toGo: 1, down: 4, score: [0, 0], timeouts: [3, 3], quarter: 1, clock: 600, possession: 0,
  settings: { quarterMinutes: 15 }, teams: [team, team], dirOf: () => 1, ...o });

describe('decision math', () => {
  it('expected points rise with field position and fall with down and distance', () => {
    expect(expectedPoints(75)).toBeGreaterThan(expectedPoints(25));
    expect(expectedPoints(40, 3, 10)).toBeLessThan(expectedPoints(40, 2, 10));
    // A defense would rather face 4th & 4 at the 30 than 3rd & 14 at the 20 (decline the holding penalty).
    expect(expectedPoints(30, 4, 4)).toBeLessThan(expectedPoints(20, 3, 14));
  });
  it('makes sensible 4th-down calls', () => {
    expect(fourthDecision(mk({ yardLine: 20, toGo: 10 }), 0).choice).toBe('punt');
    expect(fourthDecision(mk({ yardLine: 99, toGo: 1 }), 0).choice).toBe('go');
    expect(fourthDecision(mk({ yardLine: 80, toGo: 7 }), 0).choice).toBe('fg');
    expect(fourthDecision(mk({ yardLine: 30, toGo: 10, score: [7, 0], quarter: 4, clock: 60, timeouts: [3, 0] }), 0).choice).toBe('punt');
    // Down 4 with 30 seconds: a field goal doesn't help.
    expect(fourthDecision(mk({ yardLine: 75, toGo: 5, score: [0, 4], quarter: 4, clock: 30 }), 0).choice).toBe('go');
    expect(fourthDecision(mk({ yardLine: 75, toGo: 5, score: [0, 2], quarter: 4, clock: 30 }), 0).choice).toBe('fg');
    // Down 10 with 1:50 left: punting is hopeless.
    expect(fourthDecision(mk({ yardLine: 35, toGo: 13, score: [0, 10], quarter: 4, clock: 110 }), 0).choice).toBe('go');
  });
  it('win probability is sane and deterministic', () => {
    const s = { lead: 3, secs: 120, ball: 'B', yl: 25, toA: 3, toB: 3 };
    expect(winProb(s)).toBe(winProb(s));
    expect(winProb(s)).toBeGreaterThan(0.65);
    expect(winProb({ lead: -10, secs: 60, ball: 'A', yl: 25, toA: 0, toB: 3 })).toBeLessThan(0.05);
    expect(fourthOptions(1, 50).go).toBeGreaterThan(fourthOptions(1, 50).punt);
  });
  it('declines holding to force 4th & short', () => {
    // 3rd & 4 at the 30, the run gains nothing, offensive holding: decline → 4th & 4.
    const m = { yardLine: 30, down: 3, toGo: 4, firstYL: 34, possession: 0, quarter: 2, clock: 500, score: [0, 0], timeouts: [3, 3],
      settings: { quarterMinutes: 15 }, ylOf: (t, x) => x, xOf: (t, yl) => yl };
    const out = enforce(m, { type: 'holding_off', team: 0 }, { offTeam: 0, possTeam: 0, spotX: 30, touchdown: null });
    expect(out.accepted).toBe(false);
  });
});
