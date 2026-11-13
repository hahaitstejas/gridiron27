// In-season free agents (pure logic): players without a team that anyone can sign during the season (`f.freeAgents`).
// The pool starts as generated veterans (or the user's free_agents CSV), gains everyone a team releases, rolls into
// the offseason's free-agent pool and gets the offseason's leftovers back for the next season.
import { RNG } from '../core/rng.js';
import { generatePlayer } from '../data/generator.js';
import { addPlayer, releasePlayer } from '../data/rosterOps.js';
import { overall, OVERALL_WEIGHTS } from '../data/positions.js';
import { marketValue, fits, MIN_SALARY } from './contracts.js';

export const ROSTER_MAX = 53;
const STARTERS = { QB: 1, HB: 1, FB: 1, WR: 3, TE: 1, T: 2, G: 2, C: 1, DE: 2, DT: 2, OLB: 2, MLB: 1, CB: 3, FS: 1, SS: 1, K: 1, P: 1 };
// A realistic in-season pool: mostly depth players, a few useful veterans, every position covered.
const MIX = { QB: 4, HB: 4, FB: 1, WR: 6, TE: 3, T: 4, G: 4, C: 2, DE: 4, DT: 4, OLB: 4, MLB: 2, CB: 5, FS: 2, SS: 2, K: 2, P: 2 };

// Generated free agents are aimed at an overall relative to the league's own starters at that position: one quality
// offset made speed positions (WR / HB / CB) barely worse than starters while TE / LB / S sank, because physical
// ratings only take a third of it. Every position also gets a floor in the count (MIX alone gave 53 WRs to 10 SS).
const POS_FLOOR = 0.35; // share of an even split blended into MIX

/**
 * The league's level at each position: the median, over teams, of its last starter's overall there (WR3, CB3, the
 * second DE...). Works on any league's rating scale (an imported league with lower or higher numbers).
 */
export function posLevels(teams) {
  const out = {};
  for (const pos of Object.keys(MIX)) {
    const vals = [];
    for (const t of teams || []) {
      const v = (t.roster || []).filter((p) => p.pos === pos).map((p) => p.ovr ?? overall(p)).sort((a, b) => b - a);
      if (v.length) vals.push(v[Math.min(v.length - 1, (STARTERS[pos] || 1) - 1)]);
    }
    vals.sort((a, b) => a - b);
    out[pos] = vals.length ? vals[vals.length >> 1] : 74;
  }
  return out;
}

/** Nudge a player's position ratings (all of them, physical too) until his overall is `target`. */
export function fitOverall(p, target) {
  const keys = Object.keys(OVERALL_WEIGHTS[p.pos] || {});
  for (let i = 0; i < 40; i++) {
    const d = target - overall(p);
    if (!d) break;
    const step = Math.sign(d) * Math.min(Math.abs(d), 3);
    for (const k of keys) p.ratings[k] = Math.max(15, Math.min(99, Math.round(p.ratings[k] + step)));
  }
  p.ovr = overall(p);
  return p;
}

/** How far under the league's level at his position a free agent sits: mostly 6-20, a rare useful one 3-5. */
function faGap(rng, min, spread) { return Math.min(32, min + Math.abs(rng.gauss(0, spread))); }

const levelOf = (levels, pos) => (levels && levels[pos]) || 74;

export function seedFreeAgents(f, seed = 1, levels = null) {
  const rng = new RNG(seed);
  const out = [];
  for (const [pos, n] of Object.entries(MIX)) {
    for (let i = 0; i < Math.max(2, n); i++) {
      const p = generatePlayer(pos, rng, rng.range(-16, -4), { age: rng.int(24, 33) });
      fitOverall(p, Math.round(levelOf(levels, pos) - faGap(rng, 3, 8)));
      p.gen = true;
      out.push(p);
    }
  }
  f.freeAgents = sortPool(out);
  return f.freeAgents;
}

/**
 * Once for saves made before the fix: generated free agents who sit at or above the league's level at their position
 * come down to a fringe level (released players who were starters somewhere can't be told apart in old saves, so the
 * line is the league's median starter: nobody in the pool should be better than that).
 */
export function tamePool(f, teams) {
  if (f.faTamed) return 0;
  f.faTamed = true;
  const levels = posLevels(teams), rng = new RNG((f.seed || 1) + 77);
  let n = 0;
  for (const p of f.freeAgents || []) {
    const lv = levelOf(levels, p.pos);
    if ((p.ovr ?? overall(p)) > lv - 3) { fitOverall(p, Math.round(lv - faGap(rng, 3, 7))); n++; }
  }
  topUpPool(f, levels, (f.seed || 1) + 78); // and fill the positions that ran dry
  return n;
}

const sortPool = (pool) => pool.sort((a, b) => b.ovr - a.ovr);

/** In-season asking price: a one-year deal, cheaper than the summer market (he wants a job now). */
export function inSeasonAsk(p) { return Math.max(MIN_SALARY, Math.round(marketValue(p) * 0.6 * 20) / 20); }

/** Replace the pool with imported players (the user's CSV of current free agents). */
export function setFreeAgents(f, players) {
  for (const p of players) { delete p.pinned; p.salary = undefined; p.years = undefined; }
  f.freeAgents = sortPool([...players]);
  return f.freeAgents;
}

/** A released player joins the pool. */
export function addFreeAgent(f, p) {
  delete p.pinned;
  if (p.career) return; // the career player is never released into the pool
  (f.freeAgents ||= []).push(p);
  sortPool(f.freeAgents);
}

/**
 * Sign a free agent now. With a full roster, `releaseId` names who goes (he joins the pool, his salary comes off).
 * Returns { ok, reason, player, released }.
 */
export function signInSeason(f, team, id, releaseId = null, cap = f.cap) {
  const pool = f.freeAgents || [];
  const i = pool.findIndex((p) => p.id === id);
  if (i < 0) return { ok: false, reason: 'He already signed somewhere else.' };
  const ask = inSeasonAsk(pool[i]);
  const out = releaseId !== null ? team.roster.find((p) => p.id === releaseId) : null;
  if (team.roster.length >= ROSTER_MAX && !out) return { ok: false, reason: 'roster-full' };
  if (out?.career) return { ok: false, reason: 'You can\'t release your own player.' };
  if (!fits(team, ask, out?.salary || 0, cap)) return { ok: false, reason: `Not enough cap space ($${ask.toFixed(1)}M asked).` };
  if (out) { releasePlayer(team, out.id); addFreeAgent(f, out); }
  const [p] = pool.splice(pool.indexOf(pool.find((q) => q.id === id)), 1);
  p.salary = ask;
  p.years = 1;
  addPlayer(team, p);
  return { ok: true, player: p, released: out || null };
}

/** The offseason starts: this season's free agents join the offseason pool. */
export function poolForOffseason(f) {
  const pool = f.freeAgents || [];
  f.freeAgents = [];
  return pool;
}

/** The next season: whoever is left in the offseason pool is the in-season pool (plus this year's undrafted). */
export function poolAfterOffseason(f, pool) {
  f.freeAgents = sortPool([...(pool || [])]).slice(0, 900);
}

/**
 * Generated depth players for the pool: `n` of them, mostly fringe NFL quality (ovr ~45-66), every position, young
 * and old. `udfa` = this year's undrafted rookies (21-23). Used for the "+800 created free agents" option when a
 * franchise starts and the 300 undrafted free agents added each season after the draft.
 */
export function generatePool(n, seed, { udfa = false, levels = null } = {}) {
  const rng = new RNG(seed);
  const total = Object.values(MIX).reduce((a, w) => a + w, 0), npos = Object.keys(MIX).length;
  const weights = Object.entries(MIX).map(([p, w]) => [p, (1 - POS_FLOOR) * w / total + POS_FLOOR / npos]);
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = rng.next(), pos = 'WR';
    for (const [p, w] of weights) { if ((r -= w) <= 0) { pos = p; break; } }
    const age = udfa ? rng.int(21, 23) : rng.int(22, 31);
    const p = generatePlayer(pos, rng, rng.range(udfa ? -22 : -24, udfa ? -8 : -10), { age });
    fitOverall(p, Math.round(levelOf(levels, pos) - (udfa ? faGap(rng, 9, 7) : faGap(rng, 6, 8))));
    p.gen = true;
    if (udfa) { p.rookieYear = true; p.proYears = 0; p.pot = rng.range(0.2, 0.9); }
    out.push(p);
  }
  return out;
}

/** After the practice squads fill up: generate more at any position with fewer than `min` free agents left. */
export function topUpPool(f, levels, seed, min = 20) {
  const rng = new RNG(seed);
  const have = {};
  for (const p of f.freeAgents || []) have[p.pos] = (have[p.pos] || 0) + 1;
  for (const pos of Object.keys(MIX)) {
    for (let i = have[pos] || 0; i < min; i++) {
      const p = generatePlayer(pos, rng, rng.range(-24, -10), { age: rng.int(22, 31) });
      fitOverall(p, Math.round(levelOf(levels, pos) - faGap(rng, 6, 8)));
      p.gen = true;
      (f.freeAgents ||= []).push(p);
    }
  }
  sortPool(f.freeAgents);
}

/** Add generated players to the in-season pool. */
export function addGeneratedFreeAgents(f, n, seed, opts) {
  f.freeAgents = sortPool([...(f.freeAgents || []), ...generatePool(n, seed, opts)]);
  return f.freeAgents;
}

/**
 * CPU teams use free agency during the season: a team short of 53 signs the best player it can afford at its
 * thinnest position; a team whose starter (or injured starter's backup) is clearly worse than an available veteran
 * signs him and lets its worst player at that spot go. About half the teams look each week.
 */
export function cpuSignFreeAgents(f, teams, rng, cap = f.cap) {
  const pool = f.freeAgents || [];
  if (!pool.length) return [];
  const moves = [];
  teams.forEach((t, ti) => {
    if (ti === f.userTeam || !rng.chance(0.5)) return;
    const active = t.roster.filter((p) => !p.injury?.ir);
    const byPos = (pos) => active.filter((p) => p.pos === pos && !(p.injury?.weeks > 0)).sort((a, b) => b.ovr - a.ovr);
    let target = null, cut = null;
    if (active.length < ROSTER_MAX) {
      const thin = Object.entries(MIX).map(([pos, k]) => [pos, byPos(pos).length / Math.max(1, k)]).sort((a, b) => a[1] - b[1])[0][0];
      target = pool.find((p) => p.pos === thin && fits(t, inSeasonAsk(p), 0, cap)) || null;
    }
    if (!target) {
      for (const p of pool.slice(0, 60)) {
        const mine = byPos(p.pos);
        const k = STARTERS[p.pos] ?? 1;
        const starter = mine[k - 1], backup = mine[k];
        const upgrade = !starter || p.ovr >= starter.ovr + 1 || (backup && p.ovr >= backup.ovr + 5) || (!backup && p.ovr >= 60);
        if (!upgrade) continue;
        const worst = t.roster.filter((q) => q.pos === p.pos && !q.career && !q.injury?.ir).sort((a, b) => a.ovr - b.ovr)[0];
        const free = active.length >= ROSTER_MAX ? worst : null;
        if (active.length >= ROSTER_MAX && !free) continue;
        if (!fits(t, inSeasonAsk(p), free?.salary || 0, cap)) continue;
        target = p; cut = free; break;
      }
    }
    if (!target) return;
    const r = signInSeason(f, t, target.id, cut?.id ?? null, cap);
    if (r.ok) moves.push({ team: ti, player: r.player, released: r.released });
  });
  return moves;
}

/**
 * Every team needs a healthy kicker and punter (otherwise a back ends up kicking PATs). A CPU team without one signs
 * the best available specialist (cap permitting, else a minimum deal; a full roster lets its worst non-starter go);
 * if the pool has none, a generated veteran. `teamsToCheck` = team indexes (default: the CPU teams).
 * Returns [{ team, player, released }].
 */
export function ensureSpecialists(f, teams, rng, teamsToCheck = null) {
  const moves = [];
  const which = teamsToCheck ?? teams.map((_, i) => i).filter((i) => i !== f.userTeam);
  for (const ti of which) {
    const t = teams[ti];
    for (const pos of ['K', 'P']) {
      const healthy = t.roster.filter((p) => p.pos === pos && !p.injury?.ir && !(p.injury?.weeks > 0));
      if (healthy.length) {
        // Make sure the healthy one is on top of the depth chart (a hurt kicker would leave the spot to anyone).
        const best = healthy.sort((a, b) => b.ovr - a.ovr)[0];
        if (t.depth[pos]?.[0] !== best.id && !t.roster.find((p) => p.id === t.depth[pos]?.[0] && p.pos === pos && !(p.injury?.weeks > 0))) {
          t.depth[pos] = [best.id, ...(t.depth[pos] || []).filter((id) => id !== best.id)];
        }
        continue;
      }
      f.freeAgents ||= [];
      let p = f.freeAgents.filter((q) => q.pos === pos).sort((a, b) => b.ovr - a.ovr)[0];
      if (!p) {
        p = generatePlayer(pos, rng, rng.range(-14, -6), { age: rng.int(25, 34) });
        p.ovr = overall(p);
        f.freeAgents.push(p);
      }
      let cut = null;
      if (t.roster.length >= ROSTER_MAX) {
        const starters = new Set(Object.values(t.depth || {}).flatMap((ids) => ids.slice(0, 1)));
        cut = t.roster.filter((q) => !q.career && !starters.has(q.id) && !['K', 'P', 'QB'].includes(q.pos)).sort((a, b) => a.ovr - b.ovr)[0] || null;
      }
      let r = signInSeason(f, t, p.id, cut?.id ?? null, f.cap);
      if (!r.ok && r.reason !== 'roster-full') {
        // Can't afford his in-season ask: he takes the minimum (a team must field a kicker).
        r = signInSeason(f, t, p.id, cut?.id ?? null, Infinity);
        if (r.ok) r.player.salary = MIN_SALARY;
      }
      if (!r.ok) continue;
      t.depth[pos] = [r.player.id, ...(t.depth[pos] || []).filter((id) => id !== r.player.id)];
      moves.push({ team: ti, player: r.player, released: r.released });
    }
  }
  return moves;
}
