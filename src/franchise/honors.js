// All-Pro teams and Pro Bowl rosters at the end of the regular season, and the franchise tag (pure logic).
// Selection blends the season's production with the player's rating (linemen and kickers have few stats).
// Honors stick to the player (`p.honors`) and raise his asking price for a few years (contracts.js marketValue).
import { addNews } from './extras.js';

// Spots per team: All-Pro (one league-wide) and Pro Bowl (one per conference, two deep where the NFL is).
const ALL_PRO = { QB: 1, HB: 1, WR: 3, TE: 1, T: 2, G: 2, C: 1, DE: 2, DT: 2, OLB: 2, MLB: 1, CB: 2, FS: 1, SS: 1, K: 1, P: 1 };
const PRO_BOWL = { QB: 3, HB: 3, WR: 4, TE: 2, T: 3, G: 3, C: 2, DE: 3, DT: 3, OLB: 3, MLB: 2, CB: 4, FS: 2, SS: 2, K: 1, P: 1 };

function production(s) {
  if (!s) return 0;
  return (s.passYds || 0) * 0.02 + (s.passTD || 0) * 2.5 - (s.int || 0) * 2 + (s.rushYds || 0) * 0.06 + (s.rushTD || 0) * 3.5 + (s.recYds || 0) * 0.06 + (s.recTD || 0) * 3.5
    + (s.tackles || 0) * 0.35 + (s.sacks || 0) * 4 + (s.defInt || 0) * 5 + (s.ff || 0) * 3 + (s.fgMade || 0) * 1.2;
}

function rated(teams, f, filter) {
  const out = [];
  teams.forEach((t, ti) => {
    if (filter && !filter(t, ti)) return;
    for (const p of t.roster) {
      const s = f.stats?.[p.id] || f.stats?.[String(p.id)];
      const gp = s?.gp || 0;
      if (gp < 6 && !['T', 'G', 'C', 'K', 'P'].includes(p.pos)) continue;
      out.push({ p, ti, sc: p.ovr * 1.2 + production(s) * (['T', 'G', 'C'].includes(p.pos) ? 0 : 0.5) + Math.min(gp, 17) * 0.6 });
    }
  });
  return out.sort((a, b) => b.sc - a.sc);
}

function pickTeam(pool, slots, taken = new Set()) {
  const team = [];
  for (const [pos, n] of Object.entries(slots)) {
    const at = pool.filter((x) => x.p.pos === pos && !taken.has(x.p.id)).slice(0, n);
    for (const x of at) { team.push(x); taken.add(x.p.id); }
  }
  return team;
}

/** Pick the All-Pro first and second teams and both conferences' Pro Bowl rosters; record them. */
export function selectHonors(f, teams) {
  const year = f.year;
  const pool = rated(teams, f);
  const first = pickTeam(pool, ALL_PRO);
  const second = pickTeam(pool, ALL_PRO, new Set(first.map((x) => x.p.id)));
  const confs = [...new Set(teams.map((t) => t.conference))];
  const pro = confs.map((c) => ({ conf: c, players: pickTeam(rated(teams, f, (t) => t.conference === c), PRO_BOWL) }));
  const tag = (x, h) => { (x.p.honors ||= []).push({ year, h }); };
  first.forEach((x) => tag(x, 'All-Pro'));
  second.forEach((x) => tag(x, 'All-Pro 2nd team'));
  for (const c of pro) c.players.forEach((x) => tag(x, 'Pro Bowl'));
  const line = (x) => ({ rid: x.p.id, name: `${x.p.first} ${x.p.last}`, pos: x.p.pos, team: teams[x.ti].abbr, ti: x.ti, ovr: x.p.ovr });
  (f.honors ||= {})[year] = { allPro: first.map(line), allPro2: second.map(line), proBowl: pro.map((c) => ({ conf: c.conf, players: c.players.map(line) })) };
  const mine = [...first, ...second].filter((x) => x.ti === f.userTeam);
  addNews(f, `All-Pro teams announced${mine.length ? `: ${mine.map((x) => `${x.p.pos} ${x.p.last}`).join(', ')} from your team` : ''}`, 'award');
  return f.honors[year];
}

/** Asking-price bump from recent honors (players with Pro Bowls and All-Pro nods want more). */
export function honorsPremium(p, year = null) {
  const recent = (p.honors || []).filter((x) => year === null || x.year >= year - 2);
  let k = 1;
  for (const x of recent) k += x.h === 'All-Pro' ? 0.12 : x.h === 'All-Pro 2nd team' ? 0.07 : 0.04;
  return Math.min(1.35, k);
}

// ---------------------------------------------------------------------------------------------------------------
// The franchise tag: one a year, on a player whose contract is up. A one-year deal at the average of the top five
// salaries at his position (or 120% of his current salary, if more).

export function tagSalary(teams, p) {
  const top = teams.flatMap((t) => t.roster).filter((q) => q.pos === p.pos).map((q) => q.salary || 0).sort((a, b) => b - a).slice(0, 5);
  const avg = top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
  return Math.round(Math.max(avg, (p.salary || 0) * 1.2) * 20) / 20;
}

/** Tag a player (offseason re-signing step): he stays on a 1-year deal at the tag price. */
export function applyTag(f, teams, team, p) {
  if (f.tagUsed === f.year) return { ok: false, reason: 'You already used the franchise tag this year.' };
  if (!(p.years <= 0)) return { ok: false, reason: 'Only players whose contracts are expiring can be tagged.' };
  p.salary = tagSalary(teams, p);
  p.years = 1;
  p.tagged = f.year;
  f.tagUsed = f.year;
  p.morale = Math.max(0, (p.morale ?? 70) - 8); // nobody loves the tag
  return { ok: true, salary: p.salary };
}
