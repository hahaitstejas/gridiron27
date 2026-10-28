import { RNG } from '../core/rng.js';
import { FIRST_NAMES, LAST_NAMES, COLLEGES } from './names.js';
import { POSITION_TEMPLATES, RATING_KEYS, ROSTER_COUNTS, JERSEY_RANGES, BODY, overall } from './positions.js';
import { buildDepthChart } from './depthChart.js';

let nextPlayerId = 1;
export function setNextPlayerId(n) { nextPlayerId = Math.max(nextPlayerId, n); }

const clampR = (v) => Math.max(25, Math.min(99, Math.round(v)));

/**
 * Generate one player. `quality` shifts all position-relevant ratings (0 = average starter,
 * +8 = star, -10 = backup).
 */
export function generatePlayer(pos, rng, quality = 0, opts = {}) {
  const tpl = POSITION_TEMPLATES[pos];
  const ratings = {};
  for (const k of RATING_KEYS) {
    const base = tpl[k];
    if (base === undefined) {
      ratings[k] = clampR(rng.gauss(32, 8));
    } else {
      ratings[k] = clampR(base + quality + rng.gauss(0, 5.5));
    }
  }
  const [h, w] = BODY[pos];
  const p = {
    id: opts.id ?? nextPlayerId++,
    first: rng.pick(FIRST_NAMES),
    last: rng.pick(LAST_NAMES),
    pos,
    number: 0,
    age: opts.age ?? rng.int(21, 33),
    height: h + rng.int(-2, 2),
    weight: w + rng.int(-15, 15),
    college: rng.pick(COLLEGES),
    ratings,
    skin: rng.int(0, 5),
  };
  p.ovr = overall(p);
  return p;
}

function assignNumbers(players, rng) {
  const used = new Set();
  for (const p of players) {
    const ranges = JERSEY_RANGES[p.pos];
    let n = 0;
    for (let tries = 0; tries < 60 && !n; tries++) {
      const r = ranges[tries < 40 ? 0 : rng.int(0, ranges.length - 1)];
      const c = rng.int(r[0], r[1]);
      if (!used.has(c)) n = c;
    }
    if (!n) for (let c = 1; c <= 99 && !n; c++) if (!used.has(c)) n = c;
    used.add(n);
    p.number = n;
  }
}

/** Generate a full 53-man roster. teamStrength roughly -6..+6 shifts the whole team. */
export function generateRoster(rng, teamStrength = 0) {
  const players = [];
  for (const [pos, count] of Object.entries(ROSTER_COUNTS)) {
    for (let i = 0; i < count; i++) {
      // Starters better than backups; first at each position is the best.
      const starterSlots = { WR: 3, CB: 3, T: 2, G: 2, DE: 2, DT: 2, OLB: 2, HB: 1, TE: 1 }[pos] ?? 1;
      const q = i < starterSlots ? rng.gauss(2, 4) : rng.gauss(-9, 4);
      players.push(generatePlayer(pos, rng, q + teamStrength));
    }
  }
  assignNumbers(players, rng);
  return players;
}

export function generateLeagueRosters(teams, seed = 2027) {
  const rng = new RNG(seed);
  for (const t of teams) {
    t.roster = generateRoster(rng, rng.gauss(0, 3));
    t.depth = buildDepthChart(t.roster);
  }
  return teams;
}
