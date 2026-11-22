import { describe, it, expect } from 'vitest';
import { shouldKneel } from '../src/ai/playcaller.js';

const m = (o) => ({ score: [17, 14], timeouts: [3, 0], down: 1, quarter: 4, clock: 100, yardLine: 30, ...o });

describe('victory formation (UPDATE 5.4 clock management)', () => {
  it('kneels out the clock from 1st down when the defense has no timeouts', () => {
    expect(shouldKneel(m({ clock: 110 }), 0)).toBe(true);
    expect(shouldKneel(m({ clock: 125 }), 0)).toBe(false);
  });
  it('never kneels on 4th down with time left (it hands the ball over)', () => {
    expect(shouldKneel(m({ down: 4, clock: 30 }), 0)).toBe(false);
    expect(shouldKneel(m({ down: 4, clock: 2 }), 0)).toBe(true);
  });
  it('each defensive timeout costs one play-clock runoff', () => {
    expect(shouldKneel(m({ clock: 80, timeouts: [3, 1] }), 0)).toBe(true);
    expect(shouldKneel(m({ clock: 80, timeouts: [3, 2] }), 0)).toBe(false);
  });
  it('does not kneel when trailing or tied', () => {
    expect(shouldKneel(m({ score: [14, 14], clock: 20 }), 0)).toBe(false);
  });
});
