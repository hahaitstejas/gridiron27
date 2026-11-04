// Practice squads and waivers (pure logic), modeled on current NFL rules:
//  - 16 practice-squad players per team (`team.ps`), kept apart from the 53-man roster and the depth chart.
//    Up to 6 may be veterans; the rest must be young (here: 2 or fewer pro seasons, or 24 and under).
//  - Game-day elevations: up to 2 practice-squad players per game join the active roster for that game only; a player
//    can be elevated 3 times a season, after that he has to be signed to the 53.
//  - Other teams can sign your practice-squad players to their 53 (they leave with a raise).
//  - Waivers: a released player with fewer than 4 pro seasons goes on waivers for a week; teams claim in reverse
//    order of the standings (worst first). Vested veterans become free agents right away.
import { addPlayer, releasePlayer } from '../data/rosterOps.js';
import { DEPTH_SLOTS } from '../data/depthChart.js';

export const PS_MAX = 16;
export const PS_VETERANS = 6;
export const ELEVATE_PER_GAME = 2;
export const ELEVATE_MAX = 3;
export const PS_SALARY = 0.25; // $M a season
const ROSTER_MAX = 53;

/** Pro seasons a player has (rookie = 0). */
export const proYears = (p) => p.proYears ?? Math.max(0, (p.age ?? 23) - 22);
export const isVeteranPS = (p) => proYears(p) > 2 && (p.age ?? 23) > 24;
const vested = (p) => proYears(p) >= 4;

export function psEligible(team, p) {
  const ps = team.ps || [];
  if (ps.length >= PS_MAX || p.career) return false;
  return !isVeteranPS(p) || ps.filter(isVeteranPS).length < PS_VETERANS;
}

/** Move a player (from the roster or the free agents) onto the practice squad. */
export function addToPS(team, p) {
  if (!psEligible(team, p)) return false;
  if (team.roster.includes(p)) releasePlayer(team, p.id);
  p.practiceSquad = true;
  p.elevations ||= 0;
  p.salary = PS_SALARY; p.years = 1;
  (team.ps ||= []).push(p);
  return true;
}

/** Sign a practice-squad player to the 53 (needs a spot). */
export function promoteFromPS(team, p) {
  const ps = team.ps || [];
  const i = ps.indexOf(p);
  if (i < 0 || activeRoster(team) >= ROSTER_MAX) return false;
  ps.splice(i, 1);
  delete p.practiceSquad; delete p.elevated;
  p.salary = Math.max(p.salary || 0, 0.9); p.years = Math.max(p.years || 1, 1);
  addPlayer(team, p);
  return true;
}

const activeRoster = (team) => team.roster.filter((p) => !p.injury?.ir && !p.elevated).length;

/** Game-day elevation: he plays this game from the practice squad (max 2 a game, 3 times a season each). */
export function elevate(team, p) {
  const ps = team.ps || [];
  if (!ps.includes(p) || (p.elevations || 0) >= ELEVATE_MAX) return false;
  if (team.roster.filter((q) => q.elevated).length >= ELEVATE_PER_GAME) return false;
  p.elevated = true;
  p.elevations = (p.elevations || 0) + 1;
  team.roster.push(p);
  // He goes to the bottom of every depth slot his position fits (the coaching staff's chart stays as it was).
  for (const [slot, pos] of Object.entries(DEPTH_SLOTS)) if (pos.includes(p.pos)) (team.depth[slot] ||= []).push(p.id);
  return true;
}

/** Undo an elevation before the game (it doesn't count against his three). */
export function unelevate(team, p) {
  if (!p.elevated) return false;
  delete p.elevated;
  p.elevations = Math.max(0, (p.elevations || 1) - 1);
  team.roster = team.roster.filter((q) => q !== p);
  for (const slot of Object.keys(team.depth)) team.depth[slot] = team.depth[slot].filter((id) => id !== p.id);
  return true;
}

/** Let a practice-squad player go: he's a free agent right away (no waivers for the practice squad). */
export function releaseFromPS(team, p, toFreeAgency) {
  if (p.elevated) unelevate(team, p);
  const i = (team.ps || []).indexOf(p);
  if (i < 0) return false;
  team.ps.splice(i, 1);
  delete p.practiceSquad;
  toFreeAgency(p);
  return true;
}

/** After the game the elevated players revert to the practice squad. */
export function revertElevations(team) {
  const back = team.roster.filter((p) => p.elevated);
  if (!back.length) return;
  team.roster = team.roster.filter((p) => !p.elevated);
  for (const p of back) delete p.elevated;
  for (const slot of Object.keys(team.depth)) team.depth[slot] = team.depth[slot].filter((id) => !back.some((p) => p.id === id));
}

/**
 * The CPU's game-day elevations: fill holes left by injuries (a position with fewer healthy players than the depth
 * chart needs) with the best practice-squad player there.
 */
export function cpuElevations(team) {
  const need = { QB: 2, HB: 2, WR: 5, TE: 2, T: 3, G: 3, C: 2, DE: 3, DT: 3, OLB: 3, MLB: 2, CB: 4, FS: 2, SS: 2, K: 1, P: 1 };
  const healthy = (pos) => team.roster.filter((p) => p.pos === pos && !(p.injury?.weeks > 0) && !p.injury?.ir).length;
  let n = 0;
  for (const [pos, k] of Object.entries(need)) {
    if (n >= ELEVATE_PER_GAME || healthy(pos) >= k) continue;
    const c = (team.ps || []).filter((p) => p.pos === pos && (p.elevations || 0) < ELEVATE_MAX).sort((a, b) => b.ovr - a.ovr)[0];
    if (c && elevate(team, c)) n++;
  }
  return n;
}

/** CPU teams keep 16 on the practice squad: the best young free agents (rebuilding depth). */
export function cpuFillPS(team, pool) {
  const out = [];
  pool.sort((a, b) => psValue(b) - psValue(a));
  for (let i = 0; i < pool.length && (team.ps || []).length < PS_MAX; i++) {
    const p = pool[i];
    if (psEligible(team, p)) { pool.splice(i--, 1); addToPS(team, p); out.push(p); }
  }
  return out;
}
const psValue = (p) => p.ovr + Math.max(0, 25 - (p.age ?? 25)) * 1.5 + (p.pot ?? 0) * 0.05;

// ---------------------------------------------------------------------------------------------------------------
// Waivers.

/** Put a released player on waivers (or straight to free agency when he's a vested veteran). */
export function release(f, team, p, toFreeAgency) {
  delete p.practiceSquad; delete p.elevated;
  if (vested(p) && !f.afterDeadline) { toFreeAgency(p); return 'fa'; }
  (f.waivers ||= []).push({ p, from: f.teamsIdx?.(team) ?? null, week: f.week, claims: [] });
  return 'waivers';
}

/** Waiver order: worst record first (ties: earlier pick in the draft order). */
export function waiverOrder(f, rows) {
  return [...rows].sort((a, b) => a.pct - b.pct || a.pf - a.pa - (b.pf - b.pa)).map((r) => r.team);
}

/**
 * Process the wire at the end of the week: each player goes to the highest-priority team that claimed him (the user's
 * claim counts like everyone's); CPU teams claim when he'd start or clearly upgrade a backup and fits the cap.
 * Unclaimed players become free agents. Returns [{ p, to }] (to = team index or null).
 */
export function processWaivers(f, teams, order, { fits, toFreeAgency }) {
  const out = [];
  for (const w of f.waivers || []) {
    let to = null;
    for (const ti of order) {
      if (ti === w.from) continue;
      const t = teams[ti];
      const userClaim = ti === f.userTeam && w.claims.includes(ti);
      const cpuWants = ti !== f.userTeam && wantsClaim(t, w.p);
      if ((userClaim || cpuWants) && activeRoster(t) < ROSTER_MAX && fits(t, w.p.salary || 0.9)) { to = ti; break; }
    }
    if (to !== null) { addPlayer(teams[to], w.p); } else toFreeAgency(w.p);
    out.push({ p: w.p, to });
  }
  f.waivers = [];
  return out;
}

function wantsClaim(team, p) {
  const same = team.roster.filter((q) => q.pos === p.pos).sort((a, b) => b.ovr - a.ovr);
  const backup = same[1] || same[0];
  return !backup || p.ovr >= backup.ovr + 3 || (p.age ?? 30) <= 24 && p.ovr >= (same[same.length - 1]?.ovr ?? 0) + 4;
}

/** CPU teams poach a practice-squad player now and then (a starter-quality need elsewhere). */
export function cpuPoach(f, teams, rng, { fits }) {
  const out = [];
  if (!rng.chance(0.25)) return out;
  const ti = rng.int(0, teams.length - 1);
  const t = teams[ti];
  if (activeRoster(t) >= ROSTER_MAX) return out;
  for (let k = 0; k < teams.length; k++) {
    if (k === ti) continue;
    const c = (teams[k].ps || []).find((p) => wantsClaim(t, p) && p.ovr >= 66);
    if (c && fits(t, 1.0)) {
      teams[k].ps.splice(teams[k].ps.indexOf(c), 1);
      delete c.practiceSquad; c.salary = 1.0; c.years = 1;
      addPlayer(t, c);
      out.push({ p: c, from: k, to: ti });
      break;
    }
  }
  return out;
}

/** New season: elevation counts reset. */
export function resetPSSeason(teams) {
  for (const t of teams) { for (const p of t.ps || []) p.elevations = 0; t.irReturns = 0; }
}
