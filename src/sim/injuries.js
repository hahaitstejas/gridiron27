import { rollSpecific } from '../franchise/health.js';
// Injuries (pure logic). A tackle can hurt the ball carrier (rarely the tackler); severity is how long
// he's out: this game only (weeks 0), a few weeks, or the season. Rates scale with the "injuries" slider.

export const INJURY_TYPES = ['ankle sprain', 'knee sprain', 'hamstring', 'shoulder', 'concussion', 'ribs', 'wrist', 'foot', 'groin', 'back'];

/** Chance a tackle injures the ball carrier: bigger hits and older players get hurt more. */
export function injuryChance(p, power, bigHit, rate = 1) {
  const age = p.age || 26;
  return rate * 0.009 * (1 + Math.max(0, power - 0.6) * 1.5) * (bigHit ? 3 : 1) * (1 + Math.max(0, age - 30) * 0.08);
}

/** Type and weeks out for a new injury (a specific one: franchise/health.js has the catalog). */
export function rollInjury(rng) {
  const inj = rollSpecific(rng);
  return { type: inj.name, name: inj.name, part: inj.part, weeks: inj.weeks, total: inj.total, severe: inj.severe };
}

/** Short description: "out for the game", "out 3 weeks", "out for the season". */
export function injuryText(weeks) {
  if (weeks <= 0) return 'out for the game';
  if (weeks >= 8) return 'out for the season';
  return `out ${weeks} week${weeks > 1 ? 's' : ''}`;
}
