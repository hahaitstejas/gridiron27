// In-season development, morale and trade demands (pure logic).
// - Every two weeks young players grow a little (not linearly: some weeks nothing, a good game can be worth a jump),
//   veterans past 31 can slip late in the season. A strong stat line counts, so does playing time. The offseason
//   still does the bigger age-based changes (offseason.js), at about half the old rate for young players.
// - Morale 0..100 (70 = content): winning, playing time, a fair contract and not being shopped help. It shades a
//   player's game-day ratings a little (-3..+2) and very unhappy good players ask to be traded.
import { overall, OVERALL_WEIGHTS } from '../data/positions.js';
import { marketValue } from './contracts.js';

const PHYS = ['speed', 'acceleration', 'agility', 'strength'];
const clampR = (v) => Math.max(20, Math.min(99, Math.round(v)));

/** How good a game line was for a position (0 = nothing, ~1 = a very good game). */
export function gameGrade(p, line) {
  if (!line) return 0;
  const l = line;
  switch (p.pos) {
    case 'QB': return Math.max(0, (l.passYds || 0) / 300 + (l.passTD || 0) * 0.25 - (l.int || 0) * 0.3 + (l.rushYds || 0) / 200);
    case 'HB': case 'FB': return Math.max(0, ((l.rushYds || 0) + (l.recYds || 0)) / 110 + ((l.rushTD || 0) + (l.recTD || 0)) * 0.3);
    case 'WR': case 'TE': return Math.max(0, (l.recYds || 0) / 90 + (l.recTD || 0) * 0.35 + (l.rec || 0) * 0.03);
    case 'K': return (l.fgMade || 0) * 0.25 - ((l.fgAtt || 0) - (l.fgMade || 0)) * 0.3 + 0.3;
    case 'P': return (l.punts || 0) ? 0.5 : 0.2;
    case 'T': case 'G': case 'C': return 0.6; // linemen: playing is the grade
    default: return Math.max(0, (l.tackles || 0) / 8 + (l.sacks || 0) * 0.45 + (l.defInt || 0) * 0.6 + (l.ff || 0) * 0.4);
  }
}

/**
 * A development tick (call every 2 weeks with the lines since the last tick: { rid: [line, ...] }). Returns the changes
 * [{ p, team, from, to }] for the news / a "player development" report.
 */
export function developmentTick(f, teams, rng, recent) {
  const changes = [];
  const late = f.week / Math.max(1, f.weeks);
  teams.forEach((t, ti) => {
    const starters = new Set(Object.values(t.depth || {}).flatMap((ids) => ids.slice(0, 1)));
    for (const p of t.roster) {
      if (p.career || p.injury?.ir) continue;
      const age = p.age ?? 26;
      const lines = recent[p.id] || recent[String(p.id)] || [];
      const grade = lines.reduce((a, l) => a + gameGrade(p, l), 0) / Math.max(1, lines.length);
      const plays = lines.length ? 1 : starters.has(p.id) ? 0.6 : 0.15;
      let delta = 0;
      if (age <= 26) {
        // Young: about 60% of a year's growth spread over 8 ticks, with a performance kicker and plenty of noise.
        const room = Math.max(0, (p.potOvr ?? (p.ovr + 4 + (p.pot ?? 0.5) * 10)) - p.ovr);
        const base = (age <= 23 ? 0.32 + (p.pot ?? 0.5) * 0.4 : 0.15 + (p.pot ?? 0.5) * 0.2) * Math.min(1, room / 4);
        const exp = base * (0.5 + plays * 0.6) * (1 + Math.min(1.2, grade) * 0.7);
        delta = rng.chance(Math.min(0.85, exp)) ? (rng.chance(0.18 + Math.min(0.25, grade * 0.15)) ? 2 : 1) : 0;
      } else if (age >= 31 && late > 0.4) {
        delta = rng.chance(0.06 + (age - 31) * 0.03) ? -1 : 0;
      }
      if (!delta) continue;
      const from = p.ovr;
      const keys = Object.entries(OVERALL_WEIGHTS[p.pos] || {}).sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const pool = delta > 0 ? keys.filter((k) => !PHYS.includes(k) || age <= 23) : keys.filter((k) => PHYS.includes(k)).concat('awareness');
      const k1 = rng.pick(pool.slice(0, 3)), k2 = rng.pick(pool);
      for (const k of [k1, k2]) p.ratings[k] = clampR(p.ratings[k] + delta * (k === k1 ? 1.4 : 0.9));
      p.ovr = overall(p);
      if (p.ovr !== from) {
        (p.devLog ||= []).push({ year: f.year, week: f.week, from, to: p.ovr });
        if (p.devLog.length > 12) p.devLog.shift();
        changes.push({ p, team: ti, from, to: p.ovr });
      }
    }
  });
  return changes;
}

// ---------------------------------------------------------------------------------------------------------------
// Morale.

export const moraleOf = (p) => p.morale ?? 70;

/** Game-day rating shift from morale (-3..+2): applied as `ovrAdj`-style boost in games (see moraleBoost). */
export function moraleBoost(p) {
  const m = moraleOf(p);
  return m >= 85 ? 2 : m >= 75 ? 1 : m <= 25 ? -3 : m <= 40 ? -2 : m <= 52 ? -1 : 0;
}

/** Weekly morale update for a team after its game (won: true/false/null for a tie or a bye). */
export function updateMorale(f, team, won, rng) {
  const starters = new Set(Object.values(team.depth || {}).flatMap((ids) => ids.slice(0, 1)));
  const demands = [];
  for (const p of team.roster) {
    let m = moraleOf(p);
    if (won === true) m += 2; else if (won === false) m -= 2;
    // Good players want to play; stars want to be paid like stars.
    if (p.ovr >= 76 && !starters.has(p.id)) m -= 2.5;
    if (starters.has(p.id)) m += 0.5;
    const fair = marketValue(p);
    if ((p.salary || 0) < fair * 0.6 && p.ovr >= 78) m -= 1.5;
    if (p.onBlock) m -= 1.5;
    m += (70 - m) * 0.05 + rng.gauss(0, 1.2); // drifts back toward content
    p.morale = Math.max(0, Math.min(100, Math.round(m)));
    // Trade demand: a good, unhappy player (once a season).
    if (p.morale <= 28 && p.ovr >= 74 && !p.tradeRequest && !p.career && (p.age ?? 26) <= 32) {
      p.tradeRequest = f.year;
      demands.push(p);
    }
  }
  return demands;
}

/** Team mood (average morale) for the hub. */
export const teamMorale = (team) => Math.round(team.roster.reduce((a, p) => a + moraleOf(p), 0) / Math.max(1, team.roster.length));
