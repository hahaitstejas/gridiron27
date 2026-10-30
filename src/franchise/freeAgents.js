// In-season free agents (pure logic): players without a team that anyone can sign during the season (`f.freeAgents`).
// The pool starts as generated veterans (or the user's free_agents CSV), gains everyone a team releases, rolls into
// the offseason's free-agent pool and gets the offseason's leftovers back for the next season.
import { RNG } from '../core/rng.js';
import { generatePlayer } from '../data/generator.js';
import { addPlayer, releasePlayer } from '../data/rosterOps.js';
import { overall } from '../data/positions.js';
import { marketValue, fits, MIN_SALARY } from './contracts.js';

export const ROSTER_MAX = 53;
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

/** The next season: whoever is left in the offseason pool is the in-season pool (best 80). */
export function poolAfterOffseason(f, pool) {
  f.freeAgents = sortPool([...(pool || [])]).slice(0, 80);
}
