// Next year's draft class exists all season (pure logic): it's generated (or imported from a CSV) when the season
// starts so you can scout it week by week, and makeDraft() uses it in the offseason. Scouting: every prospect shows an
// overall range and no potential until you spend a scouting point on him; you get a few points a week.
import { RNG } from '../core/rng.js';
import { generatePlayer } from '../data/generator.js';
import { ROSTER_COUNTS, overall } from '../data/positions.js';

export const SEASON_SCOUT_POINTS = 3; // a week during the regular season and playoffs
export const CLASS_SIZE = 260;

export function generateClass(seed, n = CLASS_SIZE) {
  const rng = new RNG(seed);
  const positions = Object.entries(ROSTER_COUNTS).flatMap(([pos, k]) => Array(k).fill(pos));
  const cls = [];
  for (let i = 0; i < n; i++) {
    const pos = rng.pick(positions);
    const tier = i < 12 ? rng.gauss(2, 3) : i < 64 ? rng.gauss(-4, 3) : rng.gauss(-10, 4);
    const p = generatePlayer(pos, rng, tier);
    p.age = rng.int(21, 23);
    p.pot = Math.max(0, Math.min(1, rng.gauss(0.65, 0.2)));
    p.years = 4;
    p.rookie = true;
    p.ovr = overall(p);
    cls.push(p);
  }
  return withScouting(cls, rng);
}

/** Hidden scouting error on each prospect (what you see is a range around ovr + err until scouted). */
export function withScouting(cls, rng) {
  for (const p of cls) if (p.scoutErr === undefined) p.scoutErr = Math.round(rng.gauss(0, 4.5));
  return cls.sort((a, b) => b.ovr - a.ovr);
}

/** Make sure there's a class for the coming draft (called when a season starts). */
export function ensureDraftClass(f) {
  if (f.draftClass?.year === f.year + 1) return f.draftClass;
  f.draftClass = { year: f.year + 1, players: generateClass(f.seed * 13 + f.year), imported: false };
  f.scoutPoints = (f.scoutPoints ?? 0) + 6;
  return f.draftClass;
}

/** Replace the class with imported players (roster-format CSV; optional POT column 0-100 or "high/avg/low"). */
export function importDraftClass(f, players, rows = []) {
  const rng = new RNG(f.seed * 5 + 1);
  players.forEach((p, i) => {
    const r = rows[i] || {};
    const pot = String(r.pot ?? r.POT ?? '').toLowerCase();
    p.pot = /high/.test(pot) ? 0.85 : /low/.test(pot) ? 0.35 : /avg|mid/.test(pot) ? 0.6 : Number.isFinite(parseFloat(pot)) ? Math.max(0, Math.min(1, parseFloat(pot) / 100)) : Math.max(0, Math.min(1, rng.gauss(0.62, 0.2)));
    p.age = p.age && p.age < 30 ? p.age : rng.int(21, 23);
    p.years = 4; p.rookie = true; p.proYears = 0;
    delete p.salary; delete p.pinned;
  });
  // Fill out a short list with generated prospects so all 7 rounds have players.
  const fill = players.length < CLASS_SIZE ? generateClass(f.seed * 17 + f.year, CLASS_SIZE - players.length).map((p) => { p.ovr = Math.min(p.ovr, 68); return p; }) : [];
  f.draftClass = { year: f.year + 1, players: withScouting([...players, ...fill], rng), imported: true };
  return f.draftClass;
}

/** Weekly scouting points (in-season). */
export function weeklyScouting(f) { f.scoutPoints = Math.min(40, (f.scoutPoints ?? 0) + SEASON_SCOUT_POINTS); }

/** Spend a point on a prospect in the class. */
export function scoutInSeason(f, id) {
  const p = f.draftClass?.players.find((q) => q.id === id);
  if (!p || p.scouted || (f.scoutPoints ?? 0) <= 0) return false;
  p.scouted = true;
  f.scoutPoints--;
  return true;
}
