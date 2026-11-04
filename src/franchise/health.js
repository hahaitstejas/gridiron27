// Player health in a franchise (pure logic): specific injuries with realistic recovery ranges, game-day statuses
// (questionable / doubtful / out), practice injuries during the week, injured reserve and re-injury risk.
// NFL reference points used for tuning: a team has ~5-8 players on injured reserve at a time and ~1.5 new injuries a
// game that cost game time; soft-tissue injuries (hamstrings, ankles) are the most common, ACL/Achilles tears the
// season-enders; linemen and backs get hurt the most, kickers almost never.
import { RNG } from '../core/rng.js';

// [name, body part, min weeks, max weeks, weight, IR-worthy]. Weeks are games missed.
export const INJURIES = [
  ['Ankle sprain', 'ankle', 0, 2, 14], ['High ankle sprain', 'ankle', 2, 6, 7], ['Hamstring strain', 'hamstring', 1, 4, 13],
  ['Groin strain', 'groin', 1, 3, 5], ['Calf strain', 'calf', 1, 3, 4], ['Quad strain', 'thigh', 1, 3, 3],
  ['Concussion', 'head', 1, 2, 7], ['Shoulder sprain', 'shoulder', 0, 3, 6], ['AC joint sprain', 'shoulder', 1, 4, 3],
  ['MCL sprain', 'knee', 2, 6, 6], ['Torn meniscus', 'knee', 3, 7, 3], ['Torn ACL', 'knee', 17, 17, 2.2],
  ['Torn Achilles', 'achilles', 17, 17, 1.2], ['Torn pectoral', 'chest', 10, 17, 0.8], ['Broken hand', 'hand', 2, 5, 2],
  ['Broken fibula', 'leg', 8, 14, 0.8], ['Turf toe', 'toe', 1, 5, 3], ['Back spasms', 'back', 0, 2, 4], ['Rib contusion', 'ribs', 0, 3, 4],
  ['Neck stinger', 'neck', 0, 1, 3], ['Lisfranc sprain', 'foot', 6, 12, 0.8], ['Thumb sprain', 'hand', 0, 3, 2], ['Hip pointer', 'hip', 0, 2, 3],
  ['Elbow sprain', 'elbow', 1, 3, 2], ['Knee bruise', 'knee', 0, 1, 4], ['Illness', 'illness', 0, 1, 2],
];
// How often each position gets hurt (relative).
const POS_RISK = { QB: 0.8, HB: 1.5, FB: 1.1, WR: 1.15, TE: 1.15, T: 1.2, G: 1.2, C: 1.0, DE: 1.2, DT: 1.2, OLB: 1.2, MLB: 1.1, CB: 1.2, FS: 1.0, SS: 1.1, K: 0.1, P: 0.08 };
export const IR_MIN = 4; // games a player on injured reserve must miss
export const IR_RETURNS = 8; // players a team may bring back from IR per season

/** A new injury: { name, part, weeks, total, severe }. `practice` injuries skew to soft tissue. */
export function rollSpecific(rng, practice = false) {
  const pool = practice ? INJURIES.filter((x) => ['hamstring', 'groin', 'calf', 'thigh', 'ankle', 'back', 'illness', 'knee'].includes(x[1]) && x[3] < 10) : INJURIES;
  const [name, part, lo, hi] = rng.weighted(pool, (x) => x[4]);
  const weeks = lo === hi ? lo : rng.int(lo, hi);
  return { name, part, weeks, total: weeks, severe: weeks >= 8 };
}

/** Game-day status for a player who has `weeks` left: Out, Doubtful (1 week, mostly doesn't play), Questionable. */
export function gameStatus(inj) {
  if (!inj) return null;
  if (inj.ir) return inj.weeks >= 10 ? 'IR (season)' : 'IR';
  if (inj.weeks >= 2) return 'Out';
  if (inj.weeks === 1) return 'Doubtful';
  return inj.questionable ? 'Questionable' : null;
}

/** Re-injury risk band for a player coming back early or playing questionable. */
export function reinjuryRisk(inj) {
  if (!inj) return 'none';
  const r = (inj.weeks || 0) + (inj.questionable ? 0.5 : 0) + (inj.part === 'hamstring' || inj.part === 'ankle' ? 0.6 : 0);
  return r >= 2 ? 'high' : r >= 1 ? 'medium' : 'low';
}

/** Chance a risk band turns into a real setback in a game he plays. */
export const RISK_CHANCE = { none: 0, low: 0.05, medium: 0.15, high: 0.32 };

/** Weight for who gets hurt on a team (starters play more snaps; position risk). */
export function injuryWeight(p, starter) {
  return (POS_RISK[p.pos] ?? 1) * (starter ? 1 : 0.35) * (1 + Math.max(0, (p.age || 26) - 29) * 0.06);
}

/**
 * Practice / mid-week injuries for one team (called each week): ~0.3 a team a week, plus questionable tags for the
 * banged-up. Returns the new injuries [{ rid, ...injury }].
 */
export function weeklyHealth(team, rng, rate = 1) {
  const out = [];
  const starters = new Set(Object.values(team.depth || {}).flatMap((ids) => ids.slice(0, 2)));
  const healthy = team.roster.filter((p) => !p.injury);
  // Lingering knocks: some healthy starters show up as questionable (they nearly always play).
  for (const p of healthy) if (starters.has(p.id) && rng.chance(0.012 * rate)) p.injury = { name: rng.pick(['Knee bruise', 'Ankle soreness', 'Shoulder soreness', 'Illness']), part: 'minor', weeks: 0, total: 0, questionable: true };
  if (rng.chance(0.3 * rate) && healthy.length) {
    const p = rng.weighted(healthy, (q) => injuryWeight(q, starters.has(q.id)));
    const inj = rollSpecific(rng, true);
    if (inj.weeks === 0) inj.questionable = true;
    p.injury = { ...inj, practice: true };
    out.push({ rid: p.id, ...p.injury });
  }
  return out;
}

/** A week passes: injuries heal (IR players can't come back before IR_MIN), questionable tags clear. */
export function healWeek(team) {
  for (const p of team.roster) {
    const inj = p.injury;
    if (!inj) continue;
    if (inj.weeks > 0) inj.weeks--;
    if (inj.ir) inj.irWeeks = (inj.irWeeks || 0) + 1;
    if (inj.weeks <= 0 && !inj.ir) {
      if (inj.questionable || inj.total === 0) delete p.injury;
      else { delete p.injury; }
    }
  }
}

/** Put a player on injured reserve (he must miss 4+ games; he no longer counts against the 53). */
export function placeOnIR(team, p) {
  if (!p?.injury || p.injury.weeks < IR_MIN && !p.injury.severe) return false;
  p.injury.ir = true;
  p.injury.irWeeks = 0;
  team.ir = (team.ir || 0) + 1;
  return true;
}

/** Can he come back from IR now (healed, 4 games served, a designation left)? */
export function canActivate(team, p) {
  const inj = p.injury;
  return !!inj?.ir && inj.weeks <= 0 && (inj.irWeeks || 0) >= IR_MIN && (team.irReturns || 0) < IR_RETURNS;
}

export function activateFromIR(team, p) {
  if (!canActivate(team, p)) return false;
  delete p.injury;
  team.irReturns = (team.irReturns || 0) + 1;
  return true;
}

/** Roster spots that count against the 53 (injured reserve doesn't). */
export const activeCount = (team) => team.roster.filter((p) => !p.injury?.ir && !p.practiceSquad).length;

/** Players who can't play this week (Out / IR; Doubtful players sit 75% of the time). */
export function unavailableIds(team, rng = null) {
  return team.roster.filter((p) => p.injury && (p.injury.ir || p.injury.sit || p.injury.weeks >= 2 || (p.injury.weeks === 1 && (!rng || rng.chance(0.75))))).map((p) => p.id);
}

/** The CPU puts long-term injuries on IR (keeping the roster at 53 active). */
export function cpuInjuredReserve(team) {
  let n = 0;
  for (const p of team.roster) if (p.injury && !p.injury.ir && (p.injury.weeks >= IR_MIN || p.injury.severe) && !p.career) { if (placeOnIR(team, p)) n++; }
  return n;
}

/** Plain text: "Torn ACL — out for the season", "Hamstring strain — out 2-3 weeks". */
export function injuryLine(inj) {
  if (!inj) return '';
  if (inj.weeks >= 10 || inj.severe && inj.weeks >= 8) return `${inj.name} — out for the season`;
  if (inj.weeks <= 0) return `${inj.name} — questionable`;
  const hi = inj.weeks + (inj.weeks >= 3 ? 1 : 0);
  return `${inj.name} — out ${inj.weeks === hi ? inj.weeks : `${inj.weeks}-${hi}`} week${hi > 1 ? 's' : ''}`;
}

export { RNG };
