// Franchise extras (pure logic): season awards, league records, the news feed and draft scouting.
import { standings } from './season.js';

// ---------- news ----------
/** Add a headline (newest first). kind: game | injury | trade | award | record | playoff | draft | signing. */
export function addNews(f, text, kind = 'game') {
  f.news ||= [];
  f.news.unshift({ year: f.year, week: f.phase === 'regular' ? f.week + 1 : null, phase: f.phase, kind, text });
  if (f.news.length > 200) f.news.length = 200;
}

const tname = (t) => `${t.city} ${t.name}`;

/** Headlines from a finished game: your games always, otherwise blowouts, shutouts and upsets. */
export function gameNews(f, teams, g) {
  const [hs, as] = g.score;
  const home = teams[g.home], away = teams[g.away];
  const win = hs >= as ? home : away, lose = hs >= as ? away : home;
  const ws = Math.max(hs, as), ls = Math.min(hs, as);
  const user = g.home === f.userTeam || g.away === f.userTeam;
  const playoff = f.phase === 'playoffs';
  if (hs === as) { if (user) addNews(f, `${tname(home)} and ${tname(away)} tie ${hs}-${as}`); return; }
  let text = null;
  if (playoff) text = `${tname(win)} beat the ${lose.name} ${ws}-${ls} and advance`;
  else if (ls === 0) text = `${tname(win)} shut out the ${lose.name} ${ws}-0`;
  else if (ws - ls >= 28) text = `${tname(win)} rout the ${lose.name} ${ws}-${ls}`;
  else if (user) text = `${tname(win)} ${ws - ls <= 3 ? 'edge' : 'beat'} the ${lose.name} ${ws}-${ls}`;
  if (text) addNews(f, text, playoff ? 'playoff' : 'game');
}

// ---------- records ----------
export const RECORD_CATS = [
  ['passYds', 'Passing yards'], ['passTD', 'Passing TDs'], ['rushYds', 'Rushing yards'], ['rushTD', 'Rushing TDs'],
  ['recYds', 'Receiving yards'], ['rec', 'Receptions'], ['recTD', 'Receiving TDs'], ['sacks', 'Sacks'], ['defInt', 'Interceptions'], ['tackles', 'Tackles'],
];

/** Single-game records from one game's lines. Returns broken record texts (also added to the news). */
export function checkGameRecords(f, lines, info) {
  f.records ||= { game: {}, season: {} };
  const out = [];
  for (const [k, label] of RECORD_CATS) {
    for (const [rid, l] of Object.entries(lines)) {
      const v = l[k] || 0;
      const cur = f.records.game[k];
      if (v > 0 && (!cur || v > cur.value)) {
        const who = info(rid);
        const isNew = !!cur && f.year > (f.recordsSince ?? f.year); // the first season just sets the marks
        f.records.game[k] = { value: v, name: who.name, team: who.team, year: f.year };
        if (isNew) out.push(`${who.name} (${who.team}) sets a single-game record: ${v} ${label.toLowerCase()}`);
      }
    }
  }
  for (const t of out) addNews(f, t, 'record');
  return out;
}

/** Season records at the end of the regular season. */
export function checkSeasonRecords(f) {
  f.records ||= { game: {}, season: {} };
  for (const [k, label] of RECORD_CATS) {
    let best = null;
    for (const s of Object.values(f.stats)) if (s[k] > 0 && (!best || s[k] > best[k])) best = s;
    const cur = f.records.season[k];
    if (best && (!cur || best[k] > cur.value)) {
      if (cur && f.year > (f.recordsSince ?? f.year)) addNews(f, `${best.name} (${best.team}) sets the season record: ${best[k]} ${label.toLowerCase()}`, 'record');
      f.records.season[k] = { value: best[k], name: best.name, team: best.team, year: f.year };
    }
  }
}

// ---------- awards ----------
const OFF = new Set(['QB', 'HB', 'FB', 'WR', 'TE']);
const DEF = new Set(['DE', 'DT', 'OLB', 'MLB', 'CB', 'FS', 'SS']);

/** Season impact score from stats (position-neutral-ish), plus team success. */
function score(s, winPct) {
  const off = s.passYds * 0.04 + s.passTD * 4 - s.int * 3 + s.rushYds * 0.1 + s.rushTD * 6 + s.recYds * 0.1 + s.recTD * 6 + s.rec * 0.3;
  const def = s.tackles * 0.8 + s.sacks * 6 + s.defInt * 8 + s.ff * 5;
  return { off, def, mvp: off * (0.6 + winPct) * (s.pos === 'QB' ? 1 : 0.85) };
}

/**
 * Season awards from the season stats: MVP, Offensive / Defensive Player of the Year, Offensive / Defensive
 * Rookie of the Year (rookies = players drafted this year). Stored in f.awards[year] and the news.
 */
export function giveAwards(f, teams) {
  const rows = standings(teams, f.schedule);
  const pct = new Map(rows.map((r) => [r.team, (r.w + r.t * 0.5) / Math.max(1, r.w + r.l + r.t)]));
  const rookies = new Set(teams.flatMap((t) => t.roster.filter((p) => p.rookieYear === f.year).map((p) => String(p.id))));
  const cands = Object.entries(f.stats).map(([rid, s]) => ({ rid, s, sc: score(s, pct.get(s.teamIdx) ?? 0.5) }));
  const best = (filter, key) => cands.filter(filter).sort((a, b) => b.sc[key] - a.sc[key])[0] || null;
  const pick = [
    ['Most Valuable Player', best((c) => OFF.has(c.s.pos), 'mvp')],
    ['Offensive Player of the Year', null],
    ['Defensive Player of the Year', best((c) => DEF.has(c.s.pos), 'def')],
    ['Offensive Rookie of the Year', best((c) => OFF.has(c.s.pos) && rookies.has(c.rid), 'off')],
    ['Defensive Rookie of the Year', best((c) => DEF.has(c.s.pos) && rookies.has(c.rid), 'def')],
  ];
  // OPOY: the best offensive season that didn't win MVP.
  pick[1][1] = cands.filter((c) => OFF.has(c.s.pos) && c.rid !== pick[0][1]?.rid).sort((a, b) => b.sc.off - a.sc.off)[0] || null;
  const list = pick.filter(([, c]) => c).map(([award, c]) => ({ award, rid: +c.rid, name: c.s.name, pos: c.s.pos, team: c.s.team, line: statLine(c.s) }));
  (f.awards ||= {})[f.year] = list;
  for (const a of list) addNews(f, `${a.award}: ${a.name}, ${a.pos}, ${a.team} (${a.line})`, 'award');
  return list;
}

/** Short stat line for a season: "4,210 pass yds, 31 TD". */
export function statLine(s) {
  const n = (v) => Math.round(v).toLocaleString('en-US');
  if (s.pos === 'QB') return `${n(s.passYds)} pass yds, ${s.passTD} TD, ${s.int} INT`;
  if (s.rushYds > s.recYds) return `${n(s.rushYds)} rush yds, ${s.rushTD + s.recTD} TD`;
  if (s.recYds > 0) return `${s.rec} catches, ${n(s.recYds)} yds, ${s.recTD} TD`;
  return `${s.tackles} tackles, ${s.sacks} sacks, ${s.defInt} INT`;
}

// ---------- scouting ----------
export const SCOUT_POINTS = 10; // prospects the user can fully scout per draft

/**
 * Give every prospect a scouting estimate: the displayed overall is off by a few points (more for later-round
 * talent) and potential is hidden until scouted. CPU teams pick on true value (their scouts are perfect).
 */
export function setupScouting(f, rng) {
  const d = f.offseason.draft;
  d.scoutLeft = SCOUT_POINTS;
  for (const p of d.cls) p.scoutErr = Math.round(rng.gauss(0, 4.5));
}

/** What the user sees for a prospect: { ovr: 'xx' | 'lo-hi', pot: 'High'|'Avg'|'Low'|'?' , scouted }. */
export function scoutView(p) {
  const potText = p.pot > 0.75 ? 'High' : p.pot > 0.5 ? 'Avg' : 'Low';
  if (p.scouted || p.scoutErr === undefined) return { ovr: String(p.ovr), pot: potText, scouted: true, sort: p.ovr };
  const mid = p.ovr + p.scoutErr;
  return { ovr: `${mid - 3}-${mid + 3}`, pot: '?', scouted: false, sort: mid };
}

/** Spend a scouting point on a prospect. */
export function scoutProspect(f, id) {
  const d = f.offseason.draft;
  const p = d.cls.find((q) => q.id === id);
  if (!p || p.scouted || d.scoutLeft <= 0) return false;
  p.scouted = true;
  d.scoutLeft--;
  return true;
}
