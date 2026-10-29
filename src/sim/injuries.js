// Injuries (pure logic). A tackle can hurt the ball carrier (rarely the tackler); severity is how long
// he's out: this game only (weeks 0), a few weeks, or the season. Rates scale with the "injuries" slider.

export const INJURY_TYPES = ['ankle sprain', 'knee sprain', 'hamstring', 'shoulder', 'concussion', 'ribs', 'wrist', 'foot', 'groin', 'back'];

/** Chance a tackle injures the ball carrier: bigger hits and older players get hurt more. */
export function injuryChance(p, power, bigHit, rate = 1) {
  const age = p.age || 26;
  return rate * 0.0035 * (1 + Math.max(0, power - 0.6) * 1.5) * (bigHit ? 3 : 1) * (1 + Math.max(0, age - 30) * 0.08);
}

/** Type and weeks out for a new injury. */
export function rollInjury(rng) {
  const type = rng.pick(INJURY_TYPES);
  const r = rng.next();
  const weeks = r < 0.4 ? 0 : r < 0.72 ? rng.int(1, 2) : r < 0.94 ? rng.int(3, 6) : rng.int(8, 17);
  return { type, weeks };
}

/** Short description: "out for the game", "out 3 weeks", "out for the season". */
export function injuryText(weeks) {
  if (weeks <= 0) return 'out for the game';
  if (weeks >= 8) return 'out for the season';
  return `out ${weeks} week${weeks > 1 ? 's' : ''}`;
}
