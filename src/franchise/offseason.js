// Franchise offseason (pure logic): progression and retirements, contracts, free agency, the draft and
// cut-downs. Steps run in order; f.offseason.step says where the user is:
//   summary -> progression -> resign -> freeagency -> draft -> cutdown -> (next season)
import { RNG } from '../core/rng.js';
import { generatePlayer } from '../data/generator.js';
import { OVERALL_WEIGHTS, ROSTER_COUNTS, overall } from '../data/positions.js';
import { addPlayer, releasePlayer } from '../data/rosterOps.js';
import { standings, rank } from './season.js';
import { SALARY_CAP, MIN_SALARY, marketValue, rookieSalary, payroll, fits, tradeValue } from './contracts.js';

const capOf = (f) => f.cap ?? SALARY_CAP;

export const OFFSEASON_STEPS = ['summary', 'progression', 'resign', 'freeagency', 'draft', 'cutdown'];
export const ROSTER_LIMIT = 53;
const PHYS = ['speed', 'acceleration', 'agility', 'strength'];
const clampR = (v) => Math.max(20, Math.min(99, Math.round(v)));
const rngOf = (f) => new RNG((f.seed += 7));

/** Hidden growth potential (0..1) and contract length, for players created before franchise mode. */
function ensureContract(p, rng) {
  if (p.pot === undefined) p.pot = Math.max(0, Math.min(1, rng.gauss(0.5, 0.22)));
  if (p.years === undefined) p.years = rng.int(1, 4);
}

/** Everyone ages a year: ratings grow or fade by age (and potential), some veterans retire. */
export function progressPlayers(f, teams) {
  const rng = rngOf(f);
  const report = [];
  const retired = [];
  teams.forEach((t, ti) => {
    for (const p of [...t.roster]) {
      ensureContract(p, rng);
      const before = overall(p);
      p.age = (p.age || 25) + 1;
      const age = p.age;
      // Skill growth by age; young players with high potential grow most.
      const skill = age <= 23 ? rng.gauss(2.5 + p.pot * 3, 1.5) : age <= 26 ? rng.gauss(1 + p.pot * 1.5, 1.3) : age <= 29 ? rng.gauss(0, 1)
        : age <= 32 ? -rng.gauss(1.5, 1) : -rng.gauss(3, 1.4);
      const phys = age <= 25 ? rng.gauss(0.5, 0.8) : age <= 28 ? rng.gauss(-0.3, 0.6) : age <= 31 ? -rng.gauss(1.5, 0.8) : -rng.gauss(3, 1.2);
      const keys = new Set([...Object.keys(OVERALL_WEIGHTS[p.pos] || {}), 'awareness']);
      for (const k of keys) if (!PHYS.includes(k)) p.ratings[k] = clampR(p.ratings[k] + skill + rng.gauss(0, 0.8));
      for (const k of PHYS) p.ratings[k] = clampR(p.ratings[k] + phys + rng.gauss(0, 0.6));
      if (p.pos !== 'K' && p.pos !== 'P' && age >= 30) p.ratings.awareness = clampR(p.ratings.awareness + 1); // veterans still learn
      p.ovr = overall(p);
      p.years--;
      // Retirement: likely past 33, sooner for fading veterans.
      const retire = age >= 32 && rng.chance(Math.min(0.9, 0.12 + (age - 32) * 0.18 + (p.ovr < 65 ? 0.2 : 0)));
      if (retire) { releasePlayer(t, p.id); retired.push({ ...p, team: ti }); }
      if (ti === f.userTeam) report.push({ id: p.id, name: `${p.first} ${p.last}`, pos: p.pos, age, before, after: retire ? null : p.ovr, retired: retire });
    }
  });
  f.offseason.report = report.sort((a, b) => (b.after ?? 0) - (b.before) - ((a.after ?? 0) - a.before));
  f.offseason.retired = retired.length;
  f.offseason.step = 'progression';
}

/** Players whose contracts ran out on a team. */
export function expiring(team) { return team.roster.filter((p) => p.years <= 0); }

/** Contract offer by age: younger players sign longer deals. */
export function contractYears(p) { return p.age <= 25 ? 4 : p.age <= 28 ? 3 : p.age <= 31 ? 2 : 1; }

/** What a player asks to re-sign or sign as a free agent ($M / season). */
export function askingSalary(p) { return marketValue(p); }

/** Payroll next season if these expiring players are re-signed at their asking price (the rest leave). */
export function projectedPayroll(team, keepIds) {
  let pay = payroll(team);
  for (const p of expiring(team)) pay += (keepIds.has(p.id) ? askingSalary(p) : 0) - (p.salary || 0);
  return pay;
}

export function resign(team, id) {
  const p = team.roster.find((q) => q.id === id);
  if (p) { p.years = contractYears(p); p.salary = askingSalary(p); }
}

/** Close re-signing: CPU teams keep good players; everyone left without a contract becomes a free agent. */
export function finishResigning(f, teams) {
  const rng = rngOf(f);
  const pool = f.offseason.pool || [];
  teams.forEach((t, ti) => {
    // CPU teams keep their best expiring players while the money fits.
    let pay = payroll(t) - expiring(t).reduce((s, p) => s + (p.salary || 0), 0);
    for (const p of expiring(t).sort((a, b) => b.ovr - a.ovr)) {
      const ask = askingSalary(p);
      const keep = ti !== f.userTeam && p.ovr >= 66 && p.age < 33 && pay + ask <= capOf(f) * 0.97 && rng.chance(0.75);
      if (keep) { p.years = contractYears(p); p.salary = ask; pay += ask; }
      else { releasePlayer(t, p.id); delete p.pinned; pool.push(p); }
    }
  });
  // A few unsigned veterans fill out the market.
  for (const pos of Object.keys(ROSTER_COUNTS)) {
    for (let i = 0; i < Math.max(1, Math.round(ROSTER_COUNTS[pos] / 2)); i++) {
      const p = generatePlayer(pos, rng, rng.gauss(-6, 4));
      p.age = rng.int(26, 33); p.pot = 0.2; p.years = 0; p.salary = MIN_SALARY;
      pool.push(p);
    }
  }
  f.offseason.pool = pool.sort((a, b) => b.ovr - a.ovr);
  f.offseason.step = 'freeagency';
}

/** Sign a free agent to a team at his asking price; null if he isn't there or the team can't afford him. */
export function signFreeAgent(f, team, id) {
  const pool = f.offseason.pool;
  const i = pool.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const ask = askingSalary(pool[i]);
  if (!fits(team, ask, 0, capOf(f))) return null;
  const [p] = pool.splice(i, 1);
  p.years = Math.min(3, contractYears(p));
  p.salary = ask;
  addPlayer(team, p);
  return p;
}

/** How short a team is at each position (target = the standard roster counts). */
export function needs(team) {
  const have = {};
  for (const p of team.roster) have[p.pos] = (have[p.pos] || 0) + 1;
  return Object.fromEntries(Object.entries(ROSTER_COUNTS).map(([pos, n]) => [pos, n - (have[pos] || 0)]));
}

/** CPU teams sign the best free agents at the positions they're short. */
export function cpuFreeAgency(f, teams) {
  teams.forEach((t, ti) => {
    if (ti === f.userTeam) return;
    for (const [pos, short] of Object.entries(needs(t))) {
      for (let k = 0; k < short; k++) {
        const p = f.offseason.pool.find((q) => q.pos === pos && fits(t, askingSalary(q), 0, capOf(f) * 0.98));
        if (p) signFreeAgent(f, t, p.id);
      }
    }
  });
}

/** Draft order: worst regular-season record first, champion last; 7 rounds. */
export function makeDraft(f, teams) {
  const rng = rngOf(f);
  const champ = f.history[f.history.length - 1]?.champion;
  const order = rank(standings(teams, f.schedule)).reverse().map((r) => r.team);
  const ordered = [...order.filter((t) => t !== champ), ...(champ !== undefined ? [champ] : [])];
  const picks = [];
  for (let round = 0; round < 7; round++) ordered.forEach((team, i) => picks.push({ round: round + 1, pick: i + 1, team, player: null }));
  // Rookie class: a few blue-chippers, lots of depth; young with growth ahead of them.
  const positions = Object.entries(ROSTER_COUNTS).flatMap(([pos, n]) => Array(n).fill(pos));
  const cls = [];
  for (let i = 0; i < picks.length + 32; i++) {
    const pos = rng.pick(positions);
    const tier = i < 12 ? rng.gauss(2, 3) : i < 64 ? rng.gauss(-4, 3) : rng.gauss(-10, 4);
    const p = generatePlayer(pos, rng, tier);
    p.age = rng.int(21, 23);
    p.pot = Math.max(0, Math.min(1, rng.gauss(0.65, 0.2)));
    p.years = 4;
    p.rookie = true;
    cls.push(p);
  }
  f.offseason.draft = { picks, at: 0, cls: cls.sort((a, b) => b.ovr - a.ovr) };
  f.offseason.step = 'draft';
}

/** Value of a prospect to a team: overall plus a bump at positions it needs. */
function draftValue(team, p) {
  const n = needs(team)[p.pos] || 0;
  return p.ovr + p.pot * 6 + Math.max(-4, Math.min(8, n * 4));
}

/** Make the current pick (the human passes an id; CPU picks best value). Returns the pick or null. */
export function makePick(f, teams, id = null) {
  const d = f.offseason.draft;
  const pick = d.picks[d.at];
  if (!pick) return null;
  const team = teams[pick.team];
  let p = id !== null ? d.cls.find((q) => q.id === id) : null;
  if (!p) p = [...d.cls].sort((a, b) => draftValue(team, b) - draftValue(team, a))[0];
  d.cls.splice(d.cls.indexOf(p), 1);
  p.salary = rookieSalary(d.at + 1);
  addPlayer(team, p);
  pick.player = { id: p.id, name: `${p.first} ${p.last}`, pos: p.pos, ovr: p.ovr };
  d.at++;
  return pick;
}

/** CPU picks until it's the human's turn (or the draft ends). */
export function simToUserPick(f, teams) {
  const d = f.offseason.draft;
  while (d.at < d.picks.length && d.picks[d.at].team !== f.userTeam) makePick(f, teams);
  return d.at >= d.picks.length;
}

/** Undrafted rookies join the free-agent pool; on to cut-downs. */
export function finishDraft(f, teams) {
  while (f.offseason.draft.at < f.offseason.draft.picks.length) makePick(f, teams);
  for (const p of f.offseason.draft.cls.slice(0, 30)) { p.salary = MIN_SALARY; p.years = 2; f.offseason.pool.push(p); }
  f.offseason.step = 'cutdown';
}

/** Trim to 53 keeping position minimums, then (with a cap) release the worst value for the money until under it. */
export function cutDown(team, limit = ROSTER_LIMIT, cap = Infinity) {
  const cut = [];
  while (team.roster.length > limit) {
    const have = {};
    for (const p of team.roster) have[p.pos] = (have[p.pos] || 0) + 1;
    const min = (pos) => Math.max(1, ROSTER_COUNTS[pos] - 1);
    const candidates = team.roster.filter((p) => have[p.pos] > min(p.pos)).sort((a, b) => a.ovr - b.ovr);
    const p = candidates[0] || [...team.roster].sort((a, b) => a.ovr - b.ovr)[0];
    releasePlayer(team, p.id);
    cut.push(p);
  }
  while (payroll(team) > cap) {
    const have = {};
    for (const p of team.roster) have[p.pos] = (have[p.pos] || 0) + 1;
    const pricey = team.roster.filter((p) => p.salary > MIN_SALARY * 2 && have[p.pos] > 1).sort((a, b) => tradeValue(a) / a.salary - tradeValue(b) / b.salary);
    if (!pricey.length) break;
    releasePlayer(team, pricey[0].id);
    cut.push(pricey[0]);
  }
  return cut;
}

export function cpuCutDowns(f, teams) {
  teams.forEach((t, ti) => {
    if (ti === f.userTeam) return;
    cutDown(t, ROSTER_LIMIT, capOf(f));
    fillRoster(f, t, 50);
  });
}

/** Sign affordable free agents (neediest positions first) until the roster has `size` players. */
export function fillRoster(f, team, size) {
  const pool = f.offseason?.pool || [];
  while (team.roster.length < size) {
    const need = needs(team);
    const p = pool.filter((q) => fits(team, askingSalary(q), 0, capOf(f))).sort((a, b) => (need[b.pos] || 0) - (need[a.pos] || 0) || b.ovr - a.ovr)[0];
    if (!p || !signFreeAgent(f, team, p.id)) break;
  }
}
