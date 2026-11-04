// In-season free agents (pure logic): players without a team that anyone can sign during the season (`f.freeAgents`).
// The pool starts as generated veterans (or the user's free_agents CSV), gains everyone a team releases, rolls into
// the offseason's free-agent pool and gets the offseason's leftovers back for the next season.
import { RNG } from '../core/rng.js';
import { generatePlayer } from '../data/generator.js';
import { addPlayer, releasePlayer } from '../data/rosterOps.js';
import { overall } from '../data/positions.js';
import { marketValue, fits, MIN_SALARY } from './contracts.js';

export const ROSTER_MAX = 53;
const STARTERS = { QB: 1, HB: 1, FB: 1, WR: 3, TE: 1, T: 2, G: 2, C: 1, DE: 2, DT: 2, OLB: 2, MLB: 1, CB: 3, FS: 1, SS: 1, K: 1, P: 1 };
// A realistic in-season pool: mostly depth players, a few useful veterans, every position covered.
const MIX = { QB: 4, HB: 4, FB: 1, WR: 6, TE: 3, T: 4, G: 4, C: 2, DE: 4, DT: 4, OLB: 4, MLB: 2, CB: 5, FS: 2, SS: 2, K: 2, P: 2 };

export function seedFreeAgents(f, seed = 1) {
  const rng = new RNG(seed);
  const out = [];
  for (const [pos, n] of Object.entries(MIX)) {
    for (let i = 0; i < n; i++) {
      const p = generatePlayer(pos, rng, rng.range(-16, -4), { age: rng.int(24, 33) });
      p.ovr = overall(p);
      out.push(p);
    }
  }
  f.freeAgents = sortPool(out);
  return f.freeAgents;
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
 * and old. `udfa` = this year's undrafted rookies (21-23). Used for the "+500 created free agents" option when a
 * franchise starts and the 300 undrafted free agents added each season after the draft.
 */
export function generatePool(n, seed, { udfa = false } = {}) {
  const rng = new RNG(seed);
  const weights = Object.entries(MIX);
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total, pos = 'WR';
    for (const [p, w] of weights) { if ((r -= w) <= 0) { pos = p; break; } }
    const age = udfa ? rng.int(21, 23) : rng.int(22, 31);
    const p = generatePlayer(pos, rng, rng.range(udfa ? -22 : -24, udfa ? -8 : -10), { age });
    p.ovr = overall(p);
    if (udfa) { p.rookieYear = true; p.proYears = 0; p.pot = rng.range(0.2, 0.9); }
    out.push(p);
  }
  return out;
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
