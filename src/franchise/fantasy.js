// Fantasy draft (pure logic): a new franchise where every player in the league goes into one pool and the teams
// draft new rosters in a snake draft (53 rounds). State lives on the franchise (`f.fantasy`) so the draft survives
// a reload; the franchise hub shows the draft until it's done, then contracts and the cap are redone.
import { RNG } from '../core/rng.js';
import { addPlayer } from '../data/rosterOps.js';
import { buildDepthChart } from '../data/depthChart.js';
import { overall } from '../data/positions.js';
import { setupMoney } from './contracts.js';

export const FANTASY_ROUNDS = 53;
// Roster shape each team drafts toward (sums to 53).
export const TARGET = { QB: 3, HB: 4, FB: 1, WR: 5, TE: 3, T: 4, G: 4, C: 2, DE: 4, DT: 4, OLB: 4, MLB: 3, CB: 6, FS: 2, SS: 2, K: 1, P: 1 };
// How much a team cares about its first one at a position (starters matter, a backup kicker doesn't).
const STARTERS = { QB: 1, HB: 1, WR: 3, TE: 1, T: 2, G: 2, C: 1, DE: 2, DT: 2, OLB: 2, MLB: 1, CB: 3, FS: 1, SS: 1, K: 1, P: 1, FB: 0 };

/** Empty every roster into the pool and set the draft order (random, snake). Call on a fresh franchise. */
export function startFantasyDraft(f, teams, seed = 1) {
  const rng = new RNG(seed);
  const pool = [];
  for (const t of teams) {
    for (const p of t.roster) pool.push(p);
    t.roster = [];
    t.depth = {};
  }
  const order = teams.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
  pool.sort((a, b) => (b.ovr ?? overall(b)) - (a.ovr ?? overall(a)));
  f.fantasy = { order, pick: 0, total: Math.min(FANTASY_ROUNDS * teams.length, pool.length), pool, log: [] };
  return f.fantasy;
}

/** The team on the clock (snake order: reversed every other round). */
export function onTheClock(d) {
  const n = d.order.length, round = Math.floor(d.pick / n), i = d.pick % n;
  return d.order[round % 2 ? n - 1 - i : i];
}
export const roundOf = (d) => Math.floor(d.pick / d.order.length) + 1;
export const draftDone = (d) => !d || d.pick >= d.total;

function counts(team) {
  const c = {};
  for (const p of team.roster) c[p.pos] = (c[p.pos] || 0) + 1;
  return c;
}

/** How much this team wants this player: overall, plus need at his position, minus age. */
export function draftValue(team, p) {
  const c = counts(team)[p.pos] || 0;
  const target = TARGET[p.pos] ?? 1;
  let v = p.ovr ?? overall(p);
  if (c >= target) v -= 25; // full at that spot
  else if (c < (STARTERS[p.pos] ?? 0)) v += p.pos === 'QB' ? 10 : 6; // still need a starter
  if (p.pos === 'K' || p.pos === 'P') v -= c ? 30 : 8; // specialists go late
  v -= Math.max(0, (p.age ?? 26) - 29) * 1.2;
  return v;
}

/** The CPU's choice (also "auto-pick" for the human). */
export function bestPick(d, team) {
  let best = null, bv = -1e9;
  for (const p of d.pool.slice(0, 160)) { // the pool is sorted by overall; the top of it is enough
    const v = draftValue(team, p);
    if (v > bv) { bv = v; best = p; }
  }
  return best || d.pool[0];
}

/** Draft `p` (or the best pick) for the team on the clock. */
export function makeFantasyPick(f, teams, p = null) {
  const d = f.fantasy;
  if (draftDone(d)) return null;
  const ti = onTheClock(d), team = teams[ti];
  const pick = p || bestPick(d, team);
  d.pool.splice(d.pool.indexOf(pick), 1);
  addPlayer(team, pick);
  if (ti === f.userTeam || d.log.length < 64) d.log.unshift({ pick: d.pick + 1, round: roundOf(d), team: ti, name: `${pick.first} ${pick.last}`, pos: pick.pos, ovr: pick.ovr });
  if (d.log.length > 80) d.log.length = 80;
  d.pick++;
  return pick;
}

/** CPU teams pick until the human is on the clock (or the draft ends). */
export function simToUser(f, teams) {
  const d = f.fantasy;
  while (!draftDone(d) && onTheClock(d) !== f.userTeam) makeFantasyPick(f, teams);
}

/** Everyone left auto-drafts (the human too); then depth charts, contracts and the cap. */
export function finishFantasyDraft(f, teams) {
  const d = f.fantasy;
  while (!draftDone(d)) makeFantasyPick(f, teams);
  for (const t of teams) t.depth = buildDepthChart(t.roster);
  f.cap = setupMoney(teams, f.seed);
  for (const p of d.pool) (f.freeAgents ||= []).push(p); // anyone undrafted is a free agent
  f.fantasy = { done: true, undrafted: d.pool.length };
}
