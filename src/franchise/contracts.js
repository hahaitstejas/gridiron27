// Franchise money (pure logic): salaries in $M per season, the salary cap, rookie deals and trade value.
// Salaries live on the player (`p.salary`, with `p.years` left); a team's payroll is its roster's sum.
import { RNG } from '../core/rng.js';
import { overall } from '../data/positions.js';
import { tradePlayer } from '../data/rosterOps.js';

export const SALARY_CAP = 230;
export const MIN_SALARY = 0.75;

// Premium positions get paid more for the same overall.
const POS_PAY = { QB: 1.7, DE: 1.2, WR: 1.1, T: 1.05, CB: 1.05, DT: 1.0, OLB: 0.95, MLB: 0.85, FS: 0.8, SS: 0.8, G: 0.8, C: 0.75, TE: 0.8, HB: 0.65, FB: 0.25, K: 0.3, P: 0.25 };

const round05 = (v) => Math.round(v * 20) / 20;

/** What a player would ask for on the open market ($M / season). */
export function marketValue(p) {
  const ovr = p.ovr ?? overall(p);
  const x = Math.max(0, Math.min(1.3, (ovr - 58) / 35));
  let v = MIN_SALARY + Math.pow(x, 2.4) * 28 * (POS_PAY[p.pos] ?? 0.8);
  const age = p.age || 26;
  if (age > 30) v *= Math.pow(0.85, age - 30); // teams won't pay for decline
  // Recent Pro Bowls and All-Pro nods: he wants to be paid like it (franchise/honors.js).
  if (p.honors?.length) {
    const last = Math.max(...p.honors.map((x) => x.year));
    for (const x of p.honors) if (x.year >= last - 2) v *= x.h === 'All-Pro' ? 1.12 : x.h === 'All-Pro 2nd team' ? 1.07 : 1.04;
  }
  return round05(Math.max(MIN_SALARY, v));
}

/** Rookie scale by overall pick number (1 = first pick): ~9M down to the minimum. */
export function rookieSalary(overallPick) {
  return round05(Math.max(MIN_SALARY, 9 * Math.pow(0.975, overallPick - 1)));
}

/**
 * Set up money for a franchise: every player without a deal gets one near his market value, the cap is
 * set from the league's median payroll (so it fits any league's ratings), and teams over the cap have
 * their starting deals scaled down to fit. Returns the cap.
 */
export function setupMoney(teams, seed = 1, year = null) {
  const rng = new RNG(seed);
  for (const t of teams) for (const p of t.roster) {
    if (p.salary === undefined) p.salary = round05(Math.max(MIN_SALARY, marketValue(p) * rng.range(0.75, 1.15)));
    // Years left: from the CSV (years, or the year it expires), else by age: rookies are on 4-year deals.
    if (p.years === undefined && p.contractExpires && year) p.years = Math.max(1, p.contractExpires - year + 1);
    if (p.years === undefined) p.years = (p.age ?? 26) <= 22 ? 4 : (p.age ?? 26) <= 24 ? rng.int(2, 4) : rng.int(1, 4);
  }
  const pays = teams.map(payroll).sort((a, b) => a - b);
  const cap = Math.max(120, Math.round(pays[Math.floor(pays.length / 2)] * 1.12 / 5) * 5);
  for (const t of teams) {
    const pay = payroll(t);
    if (pay <= cap * 0.97) continue;
    const k = (cap * 0.97 - MIN_SALARY * t.roster.length) / (pay - MIN_SALARY * t.roster.length);
    for (const p of t.roster) p.salary = round05(MIN_SALARY + (p.salary - MIN_SALARY) * k);
  }
  return cap;
}

export function payroll(team) {
  return team.roster.reduce((s, p) => s + (p.salary || 0), 0) + (team.deadCap || 0);
}

/**
 * Dead money for cutting a player. In season: what's left of this year's salary (guaranteed once the season starts) now,
 * plus a quarter of each later year (prorated bonus) on next season's cap. In the offseason (the cap being planned is
 * next season's) only the bonus share: a quarter of each remaining year. Without it, cutting a starter and signing a
 * cheap replacement was a free way around the cap.
 * Returns { now, next }: `now` lands on the cap being counted (`team.deadCap`), `next` on next season's (`team.deadNext`).
 */
export function deadSplit(f, p) {
  const s = p.salary || 0, yrs = Math.max(1, p.years || 1);
  if (f.phase === 'offseason') return { now: round05(0.25 * s * Math.min(3, yrs)), next: 0 };
  const left = f.phase === 'regular' ? Math.max(0, (f.weeks - f.week) / Math.max(1, f.weeks)) : 0;
  return { now: round05(s * left), next: round05(0.25 * s * Math.min(3, yrs - 1)) };
}
/** Total dead money for cutting him now ($M, this season + later). */
export function deadMoney(f, p) { const d = deadSplit(f, p); return round05(d.now + d.next); }

/** Charge a release to the cap. Returns the amount counted against the current cap. */
export function chargeRelease(f, team, p) {
  if (!f || p.career || p.practiceSquad) return 0;
  const d = deadSplit(f, p);
  team.deadCap = round05((team.deadCap || 0) + d.now);
  team.deadNext = round05((team.deadNext || 0) + d.next);
  return d.now;
}

/** The season is over: the cap being planned is next season's, so its dead money (`deadNext`) becomes the current one. */
export function rollDeadMoney(teams) { for (const t of teams) { t.deadCap = t.deadNext || 0; t.deadNext = 0; } }

export function capSpace(team, cap = SALARY_CAP) {
  return cap - payroll(team);
}

export const money = (v) => `$${v >= 10 ? v.toFixed(1) : v.toFixed(2)}M`;

/** Can `team` add `salary` (optionally after `freed` leaves) and stay under the cap? */
export function fits(team, salary, freed = 0, cap = SALARY_CAP) {
  return payroll(team) - freed + salary <= cap + 1e-6;
}

/**
 * Trade value: what a player is worth to a team in "points". Overall dominates (nonlinear: stars are
 * worth a lot more than depth), youth and potential add, a contract above market value subtracts.
 */
// Calibrated on real veteran trades in draft-pick terms (a 1st round pick = 10, see trades.js ROUND_VALUE): a young star
// receiver (~88-90) ~ a 1st + 3rd (A.J. Brown), an elite 28-year-old (~94) ~ a 1st + 2nd + more (Tyreek Hill), elite young
// defenders ~ two 1sts (Ramsey, Mack), a good starting edge (~84) ~ a 2nd (Sweat). Value doubles about every 5 overall,
// so two good players never add up to one star.
export function tradeValue(p) {
  const ovr = p.ovr ?? overall(p);
  let v = 11 * Math.exp(0.15 * (ovr - 90)) * Math.min(1.5, Math.max(p.pos === 'K' || p.pos === 'P' || p.pos === 'FB' ? 0.12 : 0.45, POS_PAY[p.pos] ?? 0.8)); // backs cheap, specialists cheaper (late picks), QBs / edges dear
  const age = (p.age || 26) - (p.pos === 'QB' ? 4 : p.pos === 'K' || p.pos === 'P' ? 6 : 0); // QBs and kickers age slower
  v *= age <= 24 ? 1.25 : age <= 27 ? 1.1 : age <= 28 ? 1 : age <= 30 ? 0.85 : 0.85 * Math.pow(0.75, age - 30);
  v *= 1 + ((p.pot ?? 0.5) - 0.5) * (age <= 25 ? 0.5 : 0.1);
  v -= Math.max(0, (p.salary || 0) - marketValue(p)) * 0.25;
  return Math.max(0.05, v);
}

/**
 * Would `cpuTeam` accept getting `gets` (players from `other`) for giving up `gives` (its own)?
 * It wants a little more value back than it sends, and both teams must stay under the cap.
 */
export function evaluateTrade(cpuTeam, gets, other, gives, cap = SALARY_CAP) {
  const sum = (list, fn) => list.reduce((s, p) => s + fn(p), 0);
  const vGets = sum(gets, tradeValue), vGives = sum(gives, tradeValue);
  const sGets = sum(gets, (p) => p.salary || 0), sGives = sum(gives, (p) => p.salary || 0);
  const capOk = fits(cpuTeam, sGets, sGives, cap) && fits(other, sGives, sGets, cap);
  const accept = capOk && gets.length > 0 && gives.length > 0 && vGets >= vGives * 1.08;
  return { accept, capOk, vGets, vGives, ratio: vGives ? vGets / (vGives * 1.08) : 0 };
}

/** Swap players between two teams (depth charts kept valid by rosterOps). */
export function executeTrade(teamA, giveA, teamB, giveB) {
  for (const p of giveA) tradePlayer(teamA, teamB, p.id);
  for (const p of giveB) tradePlayer(teamB, teamA, p.id);
}

/**
 * CPU teams make a trade or two between themselves during the regular season (before the deadline):
 * a team swaps a surplus player for a need at another position, if the values are close.
 * Returns transaction lines.
 */
export function cpuTrades(f, teams, rng, cap = SALARY_CAP) {
  const out = [];
  const cpu = teams.map((_, i) => i).filter((i) => i !== f.userTeam);
  const tries = rng.int(0, 9) === 0 ? 1 : 0; // player-for-player swaps are rare (most real trades are for picks: trades.js cpuPickTrade)
  for (let k = 0; k < tries; k++) {
    const a = teams[rng.pick(cpu)], b = teams[rng.pick(cpu)];
    if (a === b) continue;
    // Each side offers a decent non-starter-quality player; look for a fair pair.
    const pool = (t) => [...t.roster].filter((p) => !p.injury && p.ovr >= 62 && !p.career).sort(() => rng.next() - 0.5).slice(0, 12);
    let best = null;
    for (const pa of pool(a)) for (const pb of pool(b)) {
      if (pa.pos === pb.pos) continue;
      const r = tradeValue(pa) / tradeValue(pb);
      if (r < 0.92 || r > 1.08) continue;
      if (!fits(a, pb.salary || 0, pa.salary || 0, cap) || !fits(b, pa.salary || 0, pb.salary || 0, cap)) continue;
      const d = Math.abs(1 - r);
      if (!best || d < best.d) best = { pa, pb, d };
    }
    if (!best) continue;
    executeTrade(a, [best.pa], b, [best.pb]);
    out.push(`${a.abbr} trades ${best.pa.pos} ${best.pa.first} ${best.pa.last} to ${b.abbr} for ${best.pb.pos} ${best.pb.first} ${best.pb.last}`);
  }
  return out;
}
