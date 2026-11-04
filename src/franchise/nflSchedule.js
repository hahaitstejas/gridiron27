// The 17-game schedule by the NFL's formula (pure logic). 32 teams, 2 conferences x 4 divisions:
//   6  division games (home and away vs each rival)
//   4  vs every team of one division in the same conference (3-year rotation)
//   4  vs every team of one division in the other conference (4-year rotation)
//   2  vs the same-place finishers of the two other same-conference divisions
//   1  vs the same-place finisher of an other-conference division not otherwise played (the "17th game")
// spread over 18 weeks with one bye per team (weeks 5-14). Leagues that don't have that shape (edited conferences)
// fall back to a balanced random schedule. Games carry `day`/`time`/`slot` (prime time, holidays, international)
// filled in by assignSlots().
import { RNG } from '../core/rng.js';

export const SEASON_WEEKS = 18;

/** Conference / division structure: { confs: [c0, c1], div: [conf][div] -> [team idx x4] } or null if not 2x4x4. */
export function leagueStructure(teams) {
  const confs = [...new Set(teams.map((t) => t.conference))].sort();
  if (confs.length !== 2) return null;
  const div = confs.map((c) => {
    const ds = [...new Set(teams.filter((t) => t.conference === c).map((t) => t.division))].sort();
    return ds.map((d) => teams.map((t, i) => (t.conference === c && t.division === d ? i : -1)).filter((i) => i >= 0));
  });
  if (div.some((c) => c.length !== 4 || c.some((d) => d.length !== 4))) return null;
  return { confs, div };
}

/**
 * Opponents for each team for `year` (0-based season index) given last season's division ranks (`place[team]` 0..3;
 * defaults to the order in the division). Returns [{ home, away }] (272 games).
 */
export function nflMatchups(teams, year, place = null) {
  const L = leagueStructure(teams);
  if (!L) return null;
  const pl = (i) => (place ? place[i] : null) ?? L.div.flat().find((d) => d.includes(i)).indexOf(i);
  const games = [];
  const add = (h, a) => games.push({ home: h, away: a });
  // Division: home and away.
  for (const conf of L.div) for (const d of conf) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { add(d[i], d[j]); add(d[j], d[i]); }
  // Same-conference division rotation (3-year): pairs of divisions (0-1,2-3), (0-2,1-3), (0-3,1-2).
  const rot3 = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]][year % 3];
  const playedIn = new Set(); // "conf:div:conf:div" pairs whose teams meet as whole divisions
  const fullDiv = (A, B, flip) => {
    // 4x4: each team plays 2 home, 2 away (alternate by position).
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ((i + j + flip) % 2 ? add(A[i], B[j]) : add(B[j], A[i]));
  };
  for (let c = 0; c < 2; c++) for (const [x, y] of rot3) { fullDiv(L.div[c][x], L.div[c][y], year % 2); playedIn.add(`${c}:${x}:${c}:${y}`); playedIn.add(`${c}:${y}:${c}:${x}`); }
  // Other-conference division rotation (4-year): division d of conf 0 plays division (d + year) % 4 of conf 1.
  const cross = (d) => (d + year) % 4;
  for (let d = 0; d < 4; d++) fullDiv(L.div[0][d], L.div[1][cross(d)], (year + 1) % 2);
  // Same-place games vs the two remaining same-conference divisions.
  for (let c = 0; c < 2; c++) {
    for (let d = 0; d < 4; d++) {
      const mate = rot3.find((pr) => pr.includes(d));
      const other = mate[0] === d ? mate[1] : mate[0];
      for (let e = d + 1; e < 4; e++) {
        if (e === other) continue;
        for (const t of L.div[c][d]) {
          const opp = L.div[c][e].find((u) => pl(u) === pl(t));
          if (opp === undefined) continue;
          ((d + e + year) % 2 ? add(t, opp) : add(opp, t));
        }
      }
    }
  }
  // 17th game: vs the same-place team of the other-conference division two steps over in the rotation.
  for (let d = 0; d < 4; d++) {
    const e = (d + year + 2) % 4;
    for (const t of L.div[0][d]) {
      const opp = L.div[1][e].find((u) => pl(u) === pl(t));
      if (opp === undefined) continue;
      // AFC/NFC alternate hosting the 17th game by year (here: conference 0 hosts in even years).
      (year % 2 === 0 ? add(t, opp) : add(opp, t));
    }
  }
  return games;
}

/**
 * Spread the season's games over 18 weeks: every team plays once a week except one bye (weeks 5-14, 2-6 teams a
 * week), no team plays the same opponent in back-to-back weeks, division games cluster late as in the NFL.
 */
export function placeInWeeks(games, nTeams, seed = 1, weeks = SEASON_WEEKS) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = new RNG(seed * 131 + attempt);
    const out = tryPlace(games, nTeams, rng, weeks);
    if (out) return out;
  }
  return null;
}

function tryPlace(games, n, rng, weeks) {
  // Byes: weeks 5..14 (index 4..13); 32 teams -> 3-4 per week, always an even number.
  const order = shuffle([...Array(n).keys()], rng);
  const byeWeek = new Array(n).fill(-1);
  // Byes over weeks 5-14, an even number each week (32 teams: six weeks of 4, four weeks of 2).
  const counts = new Array(10).fill(0);
  for (let t = 0, w = 0; t < n; t += 2, w = (w + 1) % 10) counts[w] += 2;
  let k = 0;
  shuffle(counts, rng).forEach((c, i) => { for (let j = 0; j < c && k < n; j++) byeWeek[order[k++]] = 4 + i; });
  const left = games.map((g, i) => ({ ...g, i }));
  const sched = [];
  let last = new Map();
  for (let w = 0; w < weeks; w++) {
    const active = [...Array(n).keys()].filter((t) => byeWeek[t] !== w);
    const pick = matchWeekGames(active, left, rng, last, w, weeks);
    if (!pick) return null;
    last = new Map();
    for (const g of pick) { last.set(g.home, g.away); last.set(g.away, g.home); left.splice(left.indexOf(g), 1); }
    sched.push(pick.map((g) => ({ home: g.home, away: g.away, score: null })));
  }
  return left.length ? null : sched;
}

function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** A set of remaining games covering every active team exactly once (randomized backtracking). */
function matchWeekGames(active, left, rng, last, w, weeks) {
  const by = new Map(active.map((t) => [t, []]));
  for (const g of left) if (by.has(g.home) && by.has(g.away)) { by.get(g.home).push(g); by.get(g.away).push(g); }
  const remainingFor = (t) => left.filter((g) => g.home === t || g.away === t).length;
  const free = new Set(active);
  const chosen = [];
  let steps = 0;
  const rec = () => {
    if (!free.size) return true;
    if (++steps > 4000) return false;
    // Most constrained team first; teams with many games left must play now.
    let best = null, opts = null;
    for (const t of free) {
      const o = by.get(t).filter((g) => free.has(g.home) && free.has(g.away) && last.get(g.home) !== g.away);
      if (!best || o.length < opts.length || (o.length === opts.length && remainingFor(t) > remainingFor(best))) { best = t; opts = o; }
      if (!o.length) return false;
    }
    // Division games late in the season, others early (soft), plus noise.
    const late = w / weeks;
    const div = (g) => g.div ? 1 : 0;
    const ranked = shuffle([...opts], rng).sort((a, b) => (div(b) - div(a)) * (late > 0.7 ? 1 : late < 0.25 ? -1 : 0));
    for (const g of ranked) {
      free.delete(g.home); free.delete(g.away); chosen.push(g);
      if (rec()) return true;
      chosen.pop(); free.add(g.home); free.add(g.away);
    }
    return false;
  };
  return rec() ? chosen : null;
}

/** The whole regular season, NFL style; null when the league isn't 2 conferences x 4 divisions x 4 teams. */
export function nflSchedule(teams, year, seed, place = null) {
  const games = nflMatchups(teams, year, place);
  if (!games) return null;
  const sameDiv = (a, b) => teams[a].conference === teams[b].conference && teams[a].division === teams[b].division;
  for (const g of games) g.div = sameDiv(g.home, g.away);
  const sched = placeInWeeks(games, teams.length, seed);
  return sched;
}

// ---------------------------------------------------------------------------------------------------------------
// Kickoff times, prime time, holidays and international games.

export const INTERNATIONAL = [
  { city: 'London', stadium: 'Thames Arena' }, { city: 'Munich', stadium: 'Isar Park' },
  { city: 'Mexico City', stadium: 'Estadio del Valle' }, { city: 'São Paulo', stadium: 'Arena Paulista' },
];

/** The season opener: the Thursday after the first Monday of September (Labor Day). */
export function openerDate(year) {
  const d = new Date(Date.UTC(year, 8, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 3);
  return d;
}
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Give every game a day, date, kickoff time and slot. `strength[team]` (0..1, e.g. last season's win % blended with
 * the roster rating) decides who gets the prime-time games; each team gets at most 5. `venues` = international sites
 * (stadiums.csv can rename them). Mutates and returns the schedule.
 */
export function assignSlots(sched, teams, { year, seed = 1, strength = null, champion = null, venues = INTERNATIONAL } = {}) {
  const rng = new RNG(seed * 17 + 3);
  const str = (t) => strength?.[t] ?? 0.5;
  const prime = new Array(teams.length).fill(0);
  const appeal = (g) => str(g.home) + str(g.away) + rng.next() * 0.35 - (prime[g.home] + prime[g.away]) * 0.25;
  const thursday = openerDate(year);
  const intlWeeks = new Set();
  while (intlWeeks.size < Math.min(venues.length, 4)) intlWeeks.add(rng.int(3, 9));
  let intlIdx = 0;
  let mondayLast = new Set();
  const lastDay = new Map(); // team -> Date of his previous game (short weeks)
  sched.forEach((week, w) => {
    const sun = addDays(thursday, w * 7 + 3);
    const set = (g, dayOff, time, slot = null) => { g.date = iso(addDays(sun, dayOff)); g.day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(dayOff % 7 + 7) % 7]; g.time = time; g.slot = slot; };
    const pool = [...week].sort((a, b) => appeal(b) - appeal(a));
    const take = (pred = () => true) => { const i = pool.findIndex((g) => pred(g) && prime[g.home] < 5 && prime[g.away] < 5); return i >= 0 ? pool.splice(i, 1)[0] : pool.length ? pool.shift() : null; };
    const usePrime = (g) => { if (g) { prime[g.home]++; prime[g.away]++; } return g; };
    const thu = addDays(sun, -3);
    const thanksgiving = thu.getUTCMonth() === 10 && thu.getUTCDate() >= 22 && thu.getUTCDate() <= 28;
    const notAfterMonday = (g) => !mondayLast.has(g.home) && !mondayLast.has(g.away); // no Monday-to-Thursday turnarounds
    const xmas = (() => { for (let k = -3; k <= 3; k++) { const d = addDays(sun, k); if (d.getUTCMonth() === 11 && d.getUTCDate() === 25) return k; } return null; })();
    if (w === 0) { const g = usePrime(take((x) => champion !== null && x.home === champion) || take()); if (g) set(g, -3, '8:20 PM', 'Opener'); }
    else if (thanksgiving) { for (const t of ['12:30 PM', '4:30 PM', '8:20 PM']) { const g = take(notAfterMonday); if (g) { if (t === '8:20 PM') usePrime(g); set(g, -3, t, 'Thanksgiving'); } } }
    else if (w < sched.length - 1) { const g = usePrime(take(notAfterMonday)); if (g) set(g, -3, '8:15 PM', 'TNF'); }
    if (xmas !== null && w > 0) { for (const t of ['1:00 PM', '4:30 PM', '8:15 PM']) { const g = take(); if (g) set(g, xmas, t, 'Christmas'); } }
    if (intlWeeks.has(w) && intlIdx < venues.length) { const g = take(); if (g) { const v = venues[intlIdx++]; set(g, 0, v.city === 'London' || v.city === 'Munich' ? '9:30 AM' : '1:00 PM', 'International'); g.venue = v; } }
    mondayLast = new Set();
    if (w < sched.length - 1) { const s = usePrime(take()); if (s) set(s, 0, '8:20 PM', 'SNF'); const mo = usePrime(take()); if (mo) { set(mo, 1, '8:15 PM', 'MNF'); mondayLast.add(mo.home); mondayLast.add(mo.away); } }
    else { const s = usePrime(take()); if (s) set(s, 0, '8:20 PM', 'SNF'); }
    for (const g of pool) set(g, 0, rng.next() < 0.68 ? '1:00 PM' : rng.next() < 0.5 ? '4:05 PM' : '4:25 PM', null);
    // Short weeks: a Thursday (or holiday) game four days after a Sunday game.
    for (const g of week) {
      const d = new Date(`${g.date}T12:00:00Z`);
      for (const t of [g.home, g.away]) {
        const prev = lastDay.get(t);
        if (prev && (d - prev) / 864e5 <= 5.5 && g.day !== 'Sun' && g.day !== 'Mon') (g.short ||= []).push(t);
        lastDay.set(t, d);
      }
    }
    week.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : timeVal(a.time) - timeVal(b.time)));
  });
  return sched;
}
const timeVal = (t) => { const m = /(\d+):(\d+) (AM|PM)/.exec(t || '1:00 PM'); return ((+m[1] % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + +m[2]; };

/** "Thu 9/11 · 8:15 PM" style label. */
export function gameWhen(g) {
  if (!g?.date) return '';
  const [, mo, da] = g.date.split('-');
  return `${g.day} ${+mo}/${+da} · ${g.time}`;
}

/** Holiday look for a game ('thanksgiving' | 'christmas' | null), from its date. */
export function holidayOf(g) {
  if (!g?.date) return null;
  const [, mo, da] = g.date.split('-').map(Number);
  if (g.slot === 'Thanksgiving' || (mo === 11 && da >= 22 && da <= 28 && g.day === 'Thu')) return 'thanksgiving';
  if (g.slot === 'Christmas' || (mo === 12 && da >= 24 && da <= 26)) return 'christmas';
  return null;
}

/** A prime-time (night) game? */
export const isPrimetime = (g) => /PM/.test(g?.time || '') && timeVal(g.time) >= 19 * 60;
