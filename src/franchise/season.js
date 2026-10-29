// Franchise season: schedule, standings, playoffs and season stats. Pure logic on plain JSON so the
// whole franchise saves as-is. Teams are referred to by their index in the league's teams array.
import { RNG } from '../core/rng.js';

export const SEASON_LENGTHS = [6, 10, 17];
export const STAT_FIELDS = ['passAtt', 'passCmp', 'passYds', 'passTD', 'int', 'rushAtt', 'rushYds', 'rushTD', 'rec', 'recYds', 'recTD',
  'tackles', 'sacks', 'defInt', 'ff', 'fgAtt', 'fgMade', 'xpAtt', 'xpMade', 'punts', 'puntYds'];

/**
 * Weekly schedule: every team plays once a week, never the same opponent twice in a row, at most twice
 * (division rivals) or once (everyone else) per season, home/away balanced.
 */
export function makeSchedule(teams, weeks, seed = 1) {
  const rng = new RNG(seed);
  const n = teams.length;
  const sameDiv = (a, b) => teams[a].conference === teams[b].conference && teams[a].division === teams[b].division;
  const met = new Map(); // "a-b" -> times played
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const homeCount = new Array(n).fill(0);
  const schedule = [];
  for (let w = 0; w < weeks; w++) {
    let pairs = null;
    for (let attempt = 0; attempt < 400 && !pairs; attempt++) pairs = matchWeek(n, rng, (a, b) => {
      const k = met.get(key(a, b)) || 0;
      const cap = sameDiv(a, b) && weeks >= 12 ? 2 : 1;
      if (k >= cap && attempt < 300) return -1; // relax after many failures (short leagues / odd edits)
      // Prefer division rivals early enough that each pair meets twice in a full season.
      return 1 + (sameDiv(a, b) && weeks >= 12 ? 3 : 0) - k * 2 + rng.next();
    });
    schedule.push(pairs.map(([a, b]) => {
      met.set(key(a, b), (met.get(key(a, b)) || 0) + 1);
      const home = homeCount[a] <= homeCount[b] ? a : b;
      const away = home === a ? b : a;
      homeCount[home]++;
      return { home, away, score: null };
    }));
  }
  return schedule;
}

/** Random perfect matching on n teams using pair scores (score < 0 = not allowed); null if stuck. */
function matchWeek(n, rng, score) {
  const free = new Set([...Array(n).keys()]);
  const pairs = [];
  while (free.size) {
    // Pair the team with the fewest options first.
    let best = null, bestOpts = null;
    for (const a of free) {
      const opts = [...free].filter((b) => b !== a && score(a, b) >= 0);
      if (!best || opts.length < bestOpts.length) { best = a; bestOpts = opts; }
    }
    if (!bestOpts.length) return null;
    const b = rng.weighted(bestOpts, (x) => Math.max(0.05, score(best, x)));
    pairs.push([best, b]);
    free.delete(best); free.delete(b);
  }
  return pairs;
}

/** Standings rows for every team: { team, w, l, t, pf, pa, pct, divW, divL, confW, confL }. */
export function standings(teams, schedule, upToWeek = schedule.length) {
  const rows = teams.map((_, i) => ({ team: i, w: 0, l: 0, t: 0, pf: 0, pa: 0, divW: 0, divL: 0, confW: 0, confL: 0 }));
  const sameDiv = (a, b) => teams[a].conference === teams[b].conference && teams[a].division === teams[b].division;
  for (let w = 0; w < upToWeek; w++) {
    for (const g of schedule[w] || []) {
      if (!g.score) continue;
      const [hs, as] = g.score;
      const H = rows[g.home], A = rows[g.away];
      H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
      const res = hs > as ? [1, 0] : hs < as ? [0, 1] : [0.5, 0.5];
      for (const [r, won, opp] of [[H, res[0], g.away], [A, res[1], g.home]]) {
        if (won === 1) r.w++; else if (won === 0) r.l++; else r.t++;
        const conf = teams[r.team].conference === teams[opp].conference;
        if (sameDiv(r.team, opp)) { if (won === 1) r.divW++; else if (won === 0) r.divL++; }
        if (conf) { if (won === 1) r.confW++; else if (won === 0) r.confL++; }
      }
    }
  }
  for (const r of rows) r.pct = r.w + r.l + r.t ? (r.w + r.t * 0.5) / (r.w + r.l + r.t) : 0;
  return rows;
}

/** Sort standings rows best first: win %, division record, conference record, point differential. */
export function rank(rows) {
  return [...rows].sort((a, b) => b.pct - a.pct || (b.divW - b.divL) - (a.divW - a.divL) || (b.confW - b.confL) - (a.confW - a.confL)
    || (b.pf - b.pa) - (a.pf - a.pa) || a.team - b.team);
}

/** Playoff seeds for a conference: 4 division winners (1–4) then 3 wild cards (5–7). */
export function seeds(teams, rows, conference) {
  const conf = rows.filter((r) => teams[r.team].conference === conference);
  const winners = [];
  for (let d = 0; d < 4; d++) {
    const div = rank(conf.filter((r) => teams[r.team].division === d));
    if (div.length) winners.push(div[0]);
  }
  const rankedWinners = rank(winners);
  const rest = rank(conf.filter((r) => !winners.includes(r))).slice(0, 7 - rankedWinners.length);
  return [...rankedWinners, ...rest].map((r) => r.team);
}

/**
 * Next playoff round, given the bracket so far. Rounds: wild card (2v7, 3v6, 4v5; 1 has a bye),
 * divisional (1 vs lowest seed left), conference championship, then the championship game.
 * bracket = { seeds: [[...7], [...7]], rounds: [[{home, away, conf, seedH, seedA, score}]] }.
 */
export function nextPlayoffRound(bracket) {
  const r = bracket.rounds.length;
  const winner = (g) => (g.score[0] >= g.score[1] ? { team: g.home, seed: g.seedH } : { team: g.away, seed: g.seedA });
  const game = (conf, a, b) => (a.seed <= b.seed
    ? { home: a.team, away: b.team, seedH: a.seed, seedA: b.seed, conf, score: null }
    : { home: b.team, away: a.team, seedH: b.seed, seedA: a.seed, conf, score: null });
  if (r === 0) {
    return [0, 1].flatMap((c) => {
      const s = bracket.seeds[c].map((team, i) => ({ team, seed: i + 1 }));
      return [game(c, s[1], s[6]), game(c, s[2], s[5]), game(c, s[3], s[4])];
    });
  }
  const prev = bracket.rounds[r - 1];
  if (r === 1) {
    return [0, 1].flatMap((c) => {
      const alive = [{ team: bracket.seeds[c][0], seed: 1 }, ...prev.filter((g) => g.conf === c).map(winner)].sort((a, b) => a.seed - b.seed);
      return [game(c, alive[0], alive[3]), game(c, alive[1], alive[2])];
    });
  }
  if (r === 2) return [0, 1].map((c) => { const w = prev.filter((g) => g.conf === c).map(winner); return game(c, w[0], w[1]); });
  if (r === 3) {
    const [a, b] = prev.map(winner);
    return [{ home: a.team, away: b.team, seedH: a.seed, seedA: b.seed, conf: -1, neutral: true, score: null }];
  }
  return null;
}

export const PLAYOFF_ROUND_NAMES = ['Wild Card', 'Divisional', 'Conference Championship', 'Gridiron Championship'];

export function championOf(bracket) {
  const last = bracket.rounds[3]?.[0];
  if (!last?.score) return null;
  return last.score[0] >= last.score[1] ? last.home : last.away;
}

/** Add one game's player stat lines ({ rid: {field: n} }) to the season totals. */
export function addStats(season, lines, info) {
  for (const [rid, line] of Object.entries(lines)) {
    const s = (season.stats[rid] ||= { gp: 0, ...Object.fromEntries(STAT_FIELDS.map((f) => [f, 0])), ...info(rid) });
    s.gp++;
    for (const f of STAT_FIELDS) s[f] += line[f] || 0;
  }
}

/** Leaders in one stat: [{ rid, name, team, pos, value }] best first. */
export function leaders(season, field, n = 10, min = () => true) {
  return Object.entries(season.stats)
    .filter(([, s]) => s[field] > 0 && min(s))
    .sort((a, b) => b[1][field] - a[1][field])
    .slice(0, n)
    .map(([rid, s]) => ({ rid: +rid, name: s.name, team: s.team, pos: s.pos, value: Math.round(s[field] * 10) / 10, s }));
}
