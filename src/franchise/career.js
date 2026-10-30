// Career mode (pure logic): one created player, played as himself inside a franchise.
// The franchise state carries f.career = { rid, xp, points, spent, games: [] }; the player is a normal
// roster player flagged `career: true` (never retired, cut or traded by the CPU). Games he plays lock the
// controls to him (session settings.lockPlayer); XP from each game's stat line buys rating points.
import { generatePlayer } from '../data/generator.js';
import { overall, OVERALL_WEIGHTS } from '../data/positions.js';
import { addPlayer } from '../data/rosterOps.js';
import { DEPTH_SLOTS, placeInDepth } from '../data/depthChart.js';

export const CAREER_POSITIONS = ['QB', 'HB', 'WR', 'TE', 'DE', 'OLB', 'MLB', 'CB', 'SS'];
export const XP_PER_POINT = 100;

/** Ratings a career player can train: his position's key ratings first, then the physical basics. */
export function careerKeys(pos) {
  const keys = Object.keys(OVERALL_WEIGHTS[pos] || {}).sort((a, b) => OVERALL_WEIGHTS[pos][b] - OVERALL_WEIGHTS[pos][a]);
  for (const k of ['speed', 'acceleration', 'agility', 'strength', 'awareness']) if (!keys.includes(k)) keys.push(k);
  if (['HB', 'WR', 'TE'].includes(pos)) for (const k of ['carrying', 'breakTackle']) if (!keys.includes(k)) keys.push(k);
  if (['OLB', 'MLB', 'CB', 'SS', 'DE'].includes(pos)) for (const k of ['tackling', 'hitPower', 'catching']) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** Points to raise a rating by one: cheap early, expensive near the top. */
export function upgradeCost(v) {
  return v < 70 ? 1 : v < 80 ? 2 : v < 88 ? 3 : v < 94 ? 4 : 6;
}

/**
 * Create the player and put him on the team as the starter at his position (a rookie with starter
 * ratings well below a veteran starter's, so the first seasons are about earning points).
 */
export function createCareerPlayer(team, { first, last, pos, number }, rng) {
  const p = generatePlayer(pos, rng, -11, { age: 21 });
  p.first = first || p.first;
  p.last = last || p.last;
  p.number = number || 0;
  p.career = true;
  p.potential = 90;
  addPlayer(team, p);
  for (const slot of Object.keys(DEPTH_SLOTS)) if (DEPTH_SLOTS[slot][0] === pos) placeInDepth(team, slot, p.id, 0);
  p.ovr = overall(p);
  return p;
}

export function startCareer(f, p) {
  f.career = { rid: p.id, xp: 0, points: 3, spent: 0, games: [], seasons: [] };
  p.rookieYear = f.year;
  return f.career;
}

export function careerPlayer(f, teams) {
  if (!f?.career) return null;
  for (const t of teams) { const p = t.roster.find((q) => q.id === f.career.rid); if (p) return p; }
  return null;
}

/** XP for one game's stat line: production, efficiency and the big plays, by position group. */
export function gameXP(line = {}, pos) {
  let xp = 25; // showing up
  xp += (line.passYds || 0) * 0.25 + (line.passTD || 0) * 30 - (line.int || 0) * 25 + (line.passCmp || 0) * 2;
  xp += (line.rushYds || 0) * 0.6 + (line.rushTD || 0) * 30;
  xp += (line.recYds || 0) * 0.6 + (line.rec || 0) * 6 + (line.recTD || 0) * 30;
  xp += (line.tackles || 0) * 9 + (line.sacks || 0) * 35 + (line.defInt || 0) * 45 + (line.ff || 0) * 30;
  // Linemen and blockers rarely fill a box score: a flat bonus for the snaps.
  if (pos === 'DE' && !(line.tackles || line.sacks)) xp += 15;
  return Math.max(10, Math.round(xp));
}

/** Award a game's XP (played or simmed) and log it. Returns the XP. */
export function awardCareerGame(f, teams, g, lines) {
  const c = f.career, p = careerPlayer(f, teams);
  if (!c || !p) return 0;
  const line = lines?.[c.rid] || lines?.[String(c.rid)];
  if (!line) return 0;
  const xp = gameXP(line, p.pos);
  c.xp += xp;
  while (c.xp >= XP_PER_POINT) { c.xp -= XP_PER_POINT; c.points++; }
  c.games.unshift({ year: f.year, week: f.phase === 'regular' ? f.week + 1 : null, opp: g.home === f.userTeam ? g.away : g.home, line: { ...line }, xp });
  if (c.games.length > 40) c.games.length = 40;
  return xp;
}

/** Spend points on one rating. Returns false when he can't afford it or it's maxed. */
export function trainRating(f, p, key) {
  const v = p.ratings[key] ?? 40;
  const cost = upgradeCost(v);
  if (v >= 99 || f.career.points < cost) return false;
  f.career.points -= cost;
  f.career.spent += cost;
  p.ratings[key] = v + 1;
  p.ovr = overall(p);
  return true;
}

/** One-line summary of a stat line for the career log. */
export function lineText(line = {}) {
  const parts = [];
  if (line.passAtt) parts.push(`${line.passCmp}/${line.passAtt}, ${Math.round(line.passYds)} yds, ${line.passTD} TD, ${line.int} INT`);
  if (line.rushAtt) parts.push(`${line.rushAtt} car, ${Math.round(line.rushYds)} yds${line.rushTD ? `, ${line.rushTD} TD` : ''}`);
  if (line.rec) parts.push(`${line.rec} rec, ${Math.round(line.recYds)} yds${line.recTD ? `, ${line.recTD} TD` : ''}`);
  if (line.tackles || line.sacks || line.defInt) parts.push(`${line.tackles || 0} tkl${line.sacks ? `, ${line.sacks} sk` : ''}${line.defInt ? `, ${line.defInt} INT` : ''}`);
  return parts.join(' · ') || 'No stats';
}
