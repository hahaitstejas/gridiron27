// Fast result model for franchise games nobody plays on the field: a final score from the teams'
// offense/defense ratings, then team totals split among the depth chart's players as box-score lines
// (same field names as Match stats). Pure logic, seeded.
import { RNG } from '../core/rng.js';
import { teamRatings } from '../data/positions.js';
import { rollInjury } from '../sim/injuries.js';

const healthy = (t, id) => !(t.roster.find((p) => p.id === id)?.injury?.weeks > 0);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Simulate home vs away. Returns { score: [home, away], lines: { rid: statLine } }. */
export function quickSim(home, away, seed, { neutral = false, noTies = false, injuryRate = 1 } = {}) {
  const rng = new RNG(seed);
  const rh = teamRatings(home), ra = teamRatings(away);
  const lines = {};
  const sides = [
    { team: home, opp: away, off: rh.off, def: ra.def, hfa: neutral ? 0 : 1.5 },
    { team: away, opp: home, off: ra.off, def: rh.def, hfa: 0 },
  ];
  const scores = sides.map((s) => scoreFor(rng, s.off - s.def + s.hfa));
  if (scores[0].pts === scores[1].pts && (noTies || rng.chance(0.85))) {
    // Overtime: the better team usually gets the last field goal.
    const w = rng.chance(clamp(0.5 + (rh.ovr - ra.ovr) * 0.02, 0.2, 0.8)) ? 0 : 1;
    scores[w].fgs++; scores[w].pts += 3;
  }
  sides.forEach((s, i) => teamLines(rng, s, scores[i], scores[1 - i], lines));
  // Injuries that cost games (minor knocks don't show up in a quick sim).
  const injuries = [];
  for (const t of [home, away]) {
    if (!rng.chance(0.45 * injuryRate)) continue;
    const pool = [...new Set(Object.values(t.depth).flatMap((ids) => ids.slice(0, 2)))].filter((id) => healthy(t, id));
    const inj = rollInjury(rng);
    if (pool.length && inj.weeks > 0) injuries.push({ rid: rng.pick(pool), ...inj });
  }
  return { score: [scores[0].pts, scores[1].pts], lines, injuries };
}

/** Points as touchdowns and field goals (expected ~22, better offense vs worse defense scores more). */
function scoreFor(rng, edge) {
  const pts = clamp(Math.round(rng.gauss(22 + edge * 0.6, 8.5)), 0, 63);
  const tds = clamp(Math.round((pts - rng.range(0, 6)) / 7), 0, 9);
  const fgs = clamp(Math.round((pts - tds * 7) / 3), 0, 5);
  return { tds, fgs, pts: tds * 7 + fgs * 3 };
}

function teamLines(rng, side, mine, theirs, lines) {
  const t = side.team;
  const byId = new Map(t.roster.map((p) => [p.id, p]));
  // The i-th healthy player at a depth spot (injured players don't play).
  const at = (slot, i = 0) => (t.depth[slot] || []).filter((id) => healthy(t, id))[i];
  const ovr = (id) => byId.get(id)?.ovr ?? 60;
  const line = (id) => (id === undefined ? null : (lines[id] ||= {}));
  const add = (id, f, v) => { const l = line(id); if (l) l[f] = (l[f] || 0) + v; };
  const edge = side.off - side.def;
  // Team totals.
  const qb = at('QB');
  const att = clamp(Math.round(rng.gauss(34 + (theirs.pts - mine.pts) * 0.25, 5)), 18, 55);
  const cmpRate = clamp(0.62 + (ovr(qb) - 75) * 0.003 + edge * 0.003 + rng.gauss(0, 0.05), 0.4, 0.82);
  const cmp = Math.round(att * cmpRate);
  const passYds = Math.max(40, Math.round(cmp * clamp(rng.gauss(11 + edge * 0.08, 1.6), 6, 17)));
  const ints = Math.max(0, Math.round(rng.gauss(0.8 - edge * 0.03, 0.8)));
  const rushAtt = clamp(Math.round(rng.gauss(26 + (mine.pts - theirs.pts) * 0.25, 4)), 12, 45);
  const rushYds = Math.round(rushAtt * clamp(rng.gauss(4.2 + edge * 0.04, 0.8), 1.5, 8));
  const passTD = Math.round(mine.tds * rng.range(0.45, 0.75));
  const rushTD = mine.tds - passTD;
  // Passing.
  add(qb, 'passAtt', att); add(qb, 'passCmp', cmp); add(qb, 'passYds', passYds); add(qb, 'passTD', passTD); add(qb, 'int', ints);
  // Receiving: share of catches by depth spot, yards and TDs follow catches.
  const targets = [[at('WR', 0), 0.26], [at('WR', 1), 0.2], [at('TE', 0), 0.16], [at('WR', 2), 0.13], [at('HB', 0), 0.11], [at('TE', 1), 0.05], [at('HB', 1), 0.05], [at('WR', 3), 0.04]]
    .filter(([id]) => id !== undefined);
  split(rng, targets, cmp, (id, n) => add(id, 'rec', n));
  split(rng, targets.map(([id, w]) => [id, w * (0.7 + ovr(id) / 250)]), passYds, (id, n) => add(id, 'recYds', n));
  split(rng, targets.map(([id, w]) => [id, id === at('HB', 0) ? w * 0.5 : w]), passTD, (id, n) => add(id, 'recTD', n));
  // Rushing.
  const runners = [[at('HB', 0), 0.62], [at('HB', 1), 0.22], [qb, 0.1], [at('FB', 0), 0.03], [at('WR', 0), 0.03]].filter(([id]) => id !== undefined);
  split(rng, runners, rushAtt, (id, n) => add(id, 'rushAtt', n));
  split(rng, runners, rushYds, (id, n) => add(id, 'rushYds', n));
  split(rng, runners.filter(([id]) => id !== at('WR', 0)), rushTD, (id, n) => add(id, 'rushTD', n));
  // Kicking.
  const k = at('K'), p = at('P');
  add(k, 'xpAtt', mine.tds); add(k, 'xpMade', mine.tds);
  add(k, 'fgMade', mine.fgs); add(k, 'fgAtt', mine.fgs + (rng.chance(0.35) ? 1 : 0));
  add(p, 'punts', clamp(Math.round(rng.gauss(4.5 - (mine.pts - 20) * 0.08, 1.2)), 0, 9));
  const pl = lines[p];
  if (pl?.punts) pl.puntYds = (pl.puntYds || 0) + Math.round(pl.punts * rng.gauss(45, 3));
  // Defense against the opponent's plays: tackles, sacks, interceptions, forced fumbles.
  const tackles = Math.round(rng.gauss(58, 6));
  const tacklers = [[at('MLB', 0), 0.13], [at('LOLB', 0), 0.1], [at('ROLB', 0), 0.1], [at('SS', 0), 0.1], [at('FS', 0), 0.08], [at('CB', 0), 0.07],
    [at('CB', 1), 0.07], [at('CB', 2), 0.05], [at('LE', 0), 0.06], [at('RE', 0), 0.06], [at('DT', 0), 0.05], [at('DT', 1), 0.05], [at('MLB', 1), 0.03], [at('DT', 2), 0.02]]
    .filter(([id]) => id !== undefined);
  split(rng, tacklers, tackles, (id, n) => add(id, 'tackles', n));
  const sacks = Math.max(0, Math.round(rng.gauss(2.3 + edge * 0.04, 1.2)));
  split(rng, [[at('LE'), 0.3], [at('RE'), 0.3], [at('DT'), 0.15], [at('LOLB'), 0.1], [at('ROLB'), 0.1], [at('DT', 1), 0.05]].filter(([id]) => id !== undefined), sacks, (id, n) => add(id, 'sacks', n));
  const oppInts = Math.max(0, Math.round(rng.gauss(0.8 + edge * 0.03, 0.8)));
  split(rng, [[at('CB', 0), 0.3], [at('CB', 1), 0.25], [at('FS'), 0.2], [at('SS'), 0.12], [at('CB', 2), 0.08], [at('MLB'), 0.05]].filter(([id]) => id !== undefined), oppInts, (id, n) => add(id, 'defInt', n));
  if (rng.chance(0.4)) add(rng.pick(tacklers)[0], 'ff', 1);
}

/** Split an integer total among weighted ids (multinomial-ish with noise). */
function split(rng, weighted, total, put) {
  if (!weighted.length || total <= 0) return;
  const w = weighted.map(([id, x]) => [id, Math.max(0.001, x * rng.range(0.6, 1.4))]);
  const sum = w.reduce((a, [, x]) => a + x, 0);
  let left = total;
  const parts = w.map(([id, x]) => { const n = Math.floor((total * x) / sum); left -= n; return [id, n, (total * x) / sum - n]; });
  parts.sort((a, b) => b[2] - a[2]);
  for (let i = 0; left > 0; i = (i + 1) % parts.length, left--) parts[i][1]++;
  for (const [id, n] of parts) if (n) put(id, n);
}
