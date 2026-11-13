// Trades with players and draft picks, the trade block and incoming offers (pure logic).
// Picks: `f.picks[draftYear][round][originalTeam] = owner` for this year's and next year's draft (rounds 1-7).
// Draft year Y is held in the offseason after season Y - 1. A pick's value depends on the round and where the
// original team is expected to pick (its current record).
import { tradeValue, fits } from './contracts.js';
import { tradePlayer } from '../data/rosterOps.js';
import { standings, rank } from './season.js';

export const ROUNDS = 7;
const ROUND_VALUE = [10, 4.6, 2.4, 1.4, 0.9, 0.55, 0.35];

/** Make sure pick ownership exists for the next two drafts. */
export function ensurePicks(f, teams) {
  f.picks ||= {};
  for (const y of [f.year + 1, f.year + 2]) {
    f.picks[y] ||= {};
    for (let r = 1; r <= ROUNDS; r++) {
      f.picks[y][r] ||= {};
      teams.forEach((_, ti) => { if (f.picks[y][r][ti] === undefined) f.picks[y][r][ti] = ti; });
    }
  }
  for (const y of Object.keys(f.picks)) if (+y < f.year + 1 && !(f.phase === 'offseason' && +y === f.year + 1)) delete f.picks[y];
}

/** Expected slot (1..32) of a team's pick: worse record = earlier. Next year's picks are assumed mid-round. */
export function expectedSlot(f, teams, orig, year) {
  if (year > f.year + 1) return 16;
  const order = rank(standings(teams, f.schedule)).reverse().map((r) => r.team);
  return order.indexOf(orig) + 1 || 16;
}

export function pickValue(f, teams, pick) {
  const slot = expectedSlot(f, teams, pick.orig, pick.year);
  const base = ROUND_VALUE[pick.round - 1] || 0.3;
  const k = 1 + ((16.5 - slot) / 32) * (pick.round === 1 ? 1.1 : 0.5);
  return base * k * (pick.year > f.year + 1 ? 0.85 : 1);
}

/** "2028 Rd 1 (CHI)" */
export const pickLabel = (pick, teams) => `${pick.year} Rd ${pick.round}${pick.orig !== pick.owner ? ` (${teams[pick.orig].abbr})` : ''}`;

/** The picks a team owns: [{ year, round, orig, owner }]. */
export function picksOf(f, ti) {
  const out = [];
  for (const [y, rounds] of Object.entries(f.picks || {})) for (const [r, owners] of Object.entries(rounds)) for (const [orig, owner] of Object.entries(owners)) {
    if (owner === ti) out.push({ year: +y, round: +r, orig: +orig, owner });
  }
  return out.sort((a, b) => a.year - b.year || a.round - b.round);
}

const pickKey = (p) => `${p.year}:${p.round}:${p.orig}`;

/**
 * Would `cpu` (team index) accept getting `gets` from `other` for `gives`? Each side = { players: [], picks: [] }.
 * The CPU wants ~8% more value than it sends (more for a team that's contending and giving up a starter), and the
 * cap has to work for both teams.
 */
export function evaluateDeal(f, teams, cpu, gets, other, gives, cap = f.cap) {
  const val = (side) => side.players.reduce((s, p) => s + tradeValue(p), 0) + side.picks.reduce((s, p) => s + pickValue(f, teams, p), 0);
  const sal = (side) => side.players.reduce((s, p) => s + (p.salary || 0), 0);
  const vGets = val(gets), vGives = val(gives);
  const capOk = fits(teams[cpu], sal(gets), sal(gives), cap) && fits(teams[other], sal(gives), sal(gets), cap);
  const rosterOk = teams[cpu].roster.length - gives.players.length + gets.players.length <= 55;
  // A player who asked out is worth less to his own team (it's motivated to move him).
  const motivated = gives.players.some((p) => p.tradeRequest) ? 0.9 : 1;
  const want = 1.08 * motivated;
  const any = gets.players.length + gets.picks.length > 0 && gives.players.length + gives.picks.length > 0;
  return { accept: any && capOk && rosterOk && vGets >= vGives * want, capOk, vGets, vGives, ratio: vGives ? vGets / (vGives * want) : 0 };
}

/**
 * Everything a team could offer (never the career player): players and picks with their trade value, cheapest first.
 */
export function tradeAssets(f, teams, ti) {
  const out = teams[ti].roster.filter((p) => !p.career).map((p) => ({ p, v: tradeValue(p) }));
  for (const pk of picksOf(f, ti)) out.push({ pk, v: pickValue(f, teams, pk) });
  return out.sort((a, b) => a.v - b.v);
}

/**
 * The cheapest package from team `me` that team `cpu` would take for `target` (one of its players): one asset, two or
 * three, whichever overshoots the least and passes evaluateDeal (value, cap, roster size). `assets` = tradeAssets(me),
 * passed in when pricing many targets. Returns { players, picks, v } or null when nothing works.
 */
export function cheapestPackage(f, teams, cpu, target, me, assets = null) {
  assets ||= tradeAssets(f, teams, me);
  const need = tradeValue(target) * 1.08 * (target.tradeRequest ? 0.9 : 1);
  const cands = [];
  // One asset: the cheapest that covers it.
  const one = assets.find((a) => a.v >= need);
  if (one) cands.push([one]);
  // Two or three: the biggest few under the need, completed by the cheapest that covers the rest.
  const under = assets.filter((a) => a.v < need).slice(-10);
  for (const a of under) {
    const b = assets.find((x) => x !== a && a.v + x.v >= need);
    if (b) cands.push([a, b]);
    else {
      const c = [...under].reverse().find((x) => x !== a);
      const d = c && assets.find((x) => x !== a && x !== c && a.v + c.v + x.v >= need);
      if (d) cands.push([a, c, d]);
    }
  }
  cands.sort((x, y) => x.reduce((s, a) => s + a.v, 0) - y.reduce((s, a) => s + a.v, 0));
  for (const c of cands) {
    const gives = { players: c.filter((a) => a.p).map((a) => a.p), picks: c.filter((a) => a.pk).map((a) => a.pk) };
    if (evaluateDeal(f, teams, cpu, gives, me, { players: [target], picks: [] }).accept) return { ...gives, v: c.reduce((s, a) => s + a.v, 0) };
  }
  return null;
}

/** Carry out a deal: players change rosters, picks change owners. */
export function executeDeal(f, teams, a, giveA, b, giveB) {
  for (const p of giveA.players) { delete p.onBlock; delete p.tradeRequest; p.morale = Math.max(p.morale ?? 70, 65); tradePlayer(teams[a], teams[b], p.id); }
  for (const p of giveB.players) { delete p.onBlock; delete p.tradeRequest; p.morale = Math.max(p.morale ?? 70, 65); tradePlayer(teams[b], teams[a], p.id); }
  for (const pk of giveA.picks) f.picks[pk.year][pk.round][pk.orig] = b;
  for (const pk of giveB.picks) f.picks[pk.year][pk.round][pk.orig] = a;
  // A pick traded during the draft changes hands on the board too.
  const d = f.offseason?.draft;
  if (d) for (const pk of [...giveA.picks.map((x) => [x, b]), ...giveB.picks.map((x) => [x, a])]) {
    const slot = d.picks.find((q, i) => i >= d.at && q.orig === pk[0].orig && q.round === pk[0].round && pk[0].year === f.year + 1);
    if (slot) slot.team = pk[1];
  }
}

export const dealText = (teams, side) => [...side.players.map((p) => `${p.pos} ${p.first} ${p.last}`), ...side.picks.map((p) => pickLabel(p, teams))].join(', ') || 'nothing';

// ---------------------------------------------------------------------------------------------------------------
// The trade block and offers.

/** Weekly offers for the user's players on the block (and now and then an unsolicited one for a star). */
export function weeklyOffers(f, teams, rng) {
  ensurePicks(f, teams);
  const me = teams[f.userTeam];
  f.offers = (f.offers || []).filter((o) => o.week === f.week && o.year === f.year); // offers expire after a week
  const block = me.roster.filter((p) => p.onBlock || p.tradeRequest);
  const targets = [...block];
  if (rng.chance(0.15)) { const star = [...me.roster].filter((p) => p.ovr >= 82 && !p.career).sort(() => rng.next() - 0.5)[0]; if (star) targets.push(star); }
  for (const p of targets) {
    const bidders = teams.map((_, i) => i).filter((i) => i !== f.userTeam && needsPosition(teams[i], p)).sort(() => rng.next() - 0.5).slice(0, p.onBlock ? 3 : 1);
    for (const ti of bidders) {
      const offer = buildOffer(f, teams, ti, p, rng);
      if (offer) f.offers.push({ ...offer, week: f.week, year: f.year, id: `${ti}-${p.id}-${f.week}`, unsolicited: !p.onBlock && !p.tradeRequest });
    }
  }
  return f.offers;
}

function needsPosition(team, p) {
  const same = team.roster.filter((q) => q.pos === p.pos).sort((a, b) => b.ovr - a.ovr);
  const k = { WR: 3, CB: 3, T: 2, G: 2, DE: 2, DT: 2, OLB: 2 }[p.pos] || 1;
  return !same[k - 1] || p.ovr > same[k - 1].ovr + 1;
}

/** What `ti` offers for the user's player `p`: a pick and/or a player of similar value at a position it can spare. */
function buildOffer(f, teams, ti, p, rng) {
  const want = tradeValue(p) * (p.tradeRequest ? 0.85 : 1) * rng.range(0.85, 1.02);
  const picks = picksOf(f, ti).filter((pk) => pk.year <= f.year + 2);
  const t = teams[ti];
  // Try a player first (a surplus at another position), topped up with a pick; else picks alone.
  const spare = [...t.roster].filter((q) => q.pos !== p.pos && !q.career && !q.injury && tradeValue(q) <= want * 0.9).sort((a, b) => tradeValue(b) - tradeValue(a));
  const give = { players: [], picks: [] };
  let v = 0;
  if (spare.length && rng.chance(0.55)) { give.players.push(spare[0]); v += tradeValue(spare[0]); }
  const sorted = [...picks].sort((a, b) => pickValue(f, teams, b) - pickValue(f, teams, a));
  for (const pk of sorted) {
    if (v >= want * 0.95) break;
    const pv = pickValue(f, teams, pk);
    if (v + pv <= want * 1.15) { give.picks.push(pk); v += pv; }
  }
  if (v < want * 0.8) return null;
  const ev = evaluateDeal(f, teams, ti, { players: [p], picks: [] }, f.userTeam, give);
  if (!ev.capOk) return null;
  return { from: ti, player: p.id, give };
}

/** CPU-to-CPU deals can include picks too (a contender buys a veteran for a pick). */
export function cpuPickTrade(f, teams, rng) {
  ensurePicks(f, teams);
  if (!rng.chance(0.3)) return null;
  const rows = rank(standings(teams, f.schedule));
  const buyer = rows[rng.int(0, 7)].team, seller = rows[rows.length - 1 - rng.int(0, 7)].team;
  if (buyer === f.userTeam || seller === f.userTeam || buyer === seller) return null;
  const vet = teams[seller].roster.filter((p) => (p.age ?? 26) >= 28 && p.ovr >= 76 && !p.injury && needsPosition(teams[buyer], p)).sort((a, b) => b.ovr - a.ovr)[0];
  if (!vet) return null;
  const want = tradeValue(vet);
  const pk = picksOf(f, buyer).filter((x) => x.round <= 4).sort((a, b) => Math.abs(pickValue(f, teams, a) - want) - Math.abs(pickValue(f, teams, b) - want))[0];
  if (!pk || pickValue(f, teams, pk) < want * 0.9) return null;
  const give = { players: [], picks: [pk] }, get = { players: [vet], picks: [] };
  if (!evaluateDeal(f, teams, seller, give, buyer, get).capOk) return null;
  executeDeal(f, teams, buyer, give, seller, get);
  return `${teams[buyer].abbr} acquire ${vet.pos} ${vet.first} ${vet.last} from ${teams[seller].abbr} for a ${pickLabel(pk, teams)} pick`;
}

/** Draft day: teams picking later offer to trade up into the user's slot (their pick now + a later one). */
export function draftDayOffers(f, teams, rng) {
  const d = f.offseason?.draft;
  if (!d) return [];
  const cur = d.picks[d.at];
  if (!cur || cur.team !== f.userTeam) return [];
  const year = f.year + 1;
  const mine = { year, round: cur.round, orig: cur.orig ?? cur.team, owner: f.userTeam };
  const myVal = pickValue(f, teams, mine) * 1.05;
  const out = [];
  const later = d.picks.slice(d.at + 1, d.at + 20).filter((q) => q.team !== f.userTeam);
  for (const q of later.sort(() => rng.next() - 0.5).slice(0, 4)) {
    const theirs = { year, round: q.round, orig: q.orig ?? q.team, owner: q.team };
    const give = { players: [], picks: [theirs] };
    let v = pickValue(f, teams, theirs);
    for (const pk of picksOf(f, q.team).filter((x) => !(x.year === year && x.round === q.round && x.orig === theirs.orig)).sort((a, b) => a.year - b.year || b.round - a.round)) {
      if (v >= myVal) break;
      give.picks.push(pk); v += pickValue(f, teams, pk);
    }
    if (v >= myVal * 0.95) out.push({ from: q.team, give, gets: mine });
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------------------------------------------
// Compensatory picks: a team that lost more good free agents than it signed gets extra picks at the end of rounds
// 3-7 (up to 4), the round set by the best player it lost.

/** Note a free agent moving teams in the offseason (from = his old team). */
export function noteFreeAgentMove(f, from, to, p) {
  if (p.ovr < 70 || from === to) return;
  const L = (f.compLedger ||= {});
  if (from !== null && from !== undefined && from >= 0) (L[from] ||= { lost: [], gained: [] }).lost.push(p.ovr);
  if (to !== null && to !== undefined && to >= 0) (L[to] ||= { lost: [], gained: [] }).gained.push(p.ovr);
}

/** Compensatory picks for this draft: [{ team, round }]. */
export function compPicks(f) {
  const out = [];
  for (const [ti, { lost, gained }] of Object.entries(f.compLedger || {})) {
    const net = lost.length - gained.length;
    if (net <= 0) continue;
    const best = [...lost].sort((a, b) => b - a).slice(0, Math.min(4, net));
    for (const ovr of best) out.push({ team: +ti, round: ovr >= 85 ? 3 : ovr >= 80 ? 4 : ovr >= 76 ? 5 : ovr >= 73 ? 6 : 7, ovr });
  }
  f.compLedger = {};
  return out.slice(0, 32);
}

export { pickKey };
