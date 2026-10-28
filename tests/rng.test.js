import { describe, it, expect } from 'vitest';
import { RNG } from '../src/core/rng.js';

describe('RNG', () => {
  it('is reproducible and in range', () => {
    const a = new RNG(9), b = new RNG(9);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('int() covers both ends', () => {
    const r = new RNG(1);
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });
});
