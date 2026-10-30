// Career history and the Hall of Fame (pure logic). At the end of every season each player's numbers, awards and
// championship rings roll into `f.careers[rid]`; when a veteran retires, a great career is inducted into `f.hof`.
// The bar is relative to the league's own careers (quick-sim stat scales differ from real ones), so it stays rare.
import { STAT_FIELDS } from './season.js';
import { statLine, addNews } from './extras.js';

const MAJOR = new Set(['Most Valuable Player', 'Offensive Player of the Year', 'Defensive Player of the Year']);

/** Fold the finished season (f.stats, f.awards[year], the champion) into the career records. */
export function archiveSeason(f, champion) {
  f.careers ||= {};
  const awards = f.awards?.[f.year] || [];
  for (const [rid, s] of Object.entries(f.stats || {})) {
    const c = (f.careers[rid] ||= { name: s.name, pos: s.pos, first: f.year, seasons: 0, gp: 0, rings: 0, awards: [], ...Object.fromEntries(STAT_FIELDS.map((k) => [k, 0])) });
    c.name = s.name; c.pos = s.pos; c.team = s.team; c.last = f.year;
    c.seasons++;
    c.gp += s.gp || 0;
    for (const k of STAT_FIELDS) c[k] += s[k] || 0;
    if (champion !== null && champion !== undefined && s.teamIdx === champion) c.rings++;
  }
  for (const a of awards) {
    const c = f.careers[String(a.rid)];
    if (c) c.awards.push(`${f.year} ${a.award}`);
  }
}

/** A single number for a career: production, awards, rings and longevity. */
export function careerScore(c) {
  const prod = c.passYds / 900 + c.passTD * 0.6 - c.int * 0.3 + c.rushYds / 160 + c.recYds / 170 + (c.rushTD + c.recTD) * 0.8
    + c.tackles * 0.05 + c.sacks * 1.1 + c.defInt * 1.5 + c.ff * 1 + c.fgMade * 0.25;
  const honors = c.awards.reduce((a, x) => a + ([...MAJOR].some((m) => x.endsWith(m)) ? (x.endsWith('Most Valuable Player') ? 30 : 18) : 5), 0);
  return prod + honors + c.rings * 6 + c.seasons * 2;
}

/** Retired players (from progressPlayers): close their careers and induct the great ones. Returns the inductees. */
export function retireCareers(f, retired) {
  f.careers ||= {};
  f.hof ||= [];
  const pool = Object.values(f.careers).filter((c) => c.seasons >= 4).map(careerScore).sort((a, b) => b - a);
  const bar = pool.length >= 40 ? pool[Math.floor(pool.length * 0.03)] : Infinity; // top 3% of established careers
  const out = [];
  for (const p of retired) {
    const c = f.careers[String(p.id)];
    if (!c || c.retired) continue;
    c.retired = f.year;
    const majors = c.awards.filter((a) => [...MAJOR].some((m) => a.endsWith(m))).length;
    const mvp = c.awards.some((a) => a.endsWith('Most Valuable Player'));
    const sc = careerScore(c);
    if (c.seasons >= 5 && (mvp || majors >= 2 || sc >= bar)) {
      const entry = { rid: p.id, name: c.name, pos: c.pos, team: c.team, years: `${c.first}–${c.last}`, seasons: c.seasons, inducted: f.year,
        line: statLine(c), awards: c.awards.slice(), rings: c.rings, score: Math.round(sc) };
      f.hof.unshift(entry);
      out.push(entry);
      addNews(f, `Hall of Fame: ${c.name} (${c.pos}, ${c.years || `${c.first}–${c.last}`}) is inducted. ${entry.line}`, 'award');
    }
  }
  return out;
}

/** The best careers still active (for the "on the way" list). */
export function topActive(f, n = 8) {
  return Object.entries(f.careers || {}).filter(([, c]) => !c.retired && c.seasons >= 2)
    .map(([rid, c]) => ({ rid, ...c, score: Math.round(careerScore(c)) })).sort((a, b) => b.score - a.score).slice(0, n);
}
