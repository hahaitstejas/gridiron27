// More league spreadsheets (Update 1.0), same idea as teams/roster/depth.csv: exported from League → Spreadsheets,
// read back from an import or from git-ignored public/local/ at startup.
//   retired_numbers.csv  team,number,player                                  numbers nobody on that team can wear
//   coaches.csv          team,role,first,last,age,run_pct,go_for_it,long_fg,blitz,aggression
//                        role = HC | OC | DC. run_pct = how often the offense runs (0-100, 45 = league average);
//                        go_for_it / long_fg / blitz / aggression are 0-100 tendencies (50 = league average)
//   uniforms.csv         team,kind,jersey,pants,number,number_outline,helmet   kind = home | away | alt (hex colors)
//   stadiums.csv         team,name,city,capacity,roof,surface,kind,year         team blank + kind = championship |
//                        international for neutral sites (year = which season's championship game is played there)
//   schedule.csv         week,away,home,day,date,time                           a franchise season's schedule
import { toCSV } from './csv.js';
import { FIRST_NAMES, LAST_NAMES } from './names.js';
import { uniformFor, UNIFORM_KINDS } from './uniforms.js';

const byAbbr = (teams) => new Map(teams.map((t, i) => [t.abbr.toUpperCase(), i]));
const HEX = /^#?[0-9a-f]{6}$/i;
const hex = (v) => (v && HEX.test(v.trim()) ? (v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`) : null);
const num = (v, d = null) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

/** Which of these a parsed file is (by its columns), or null. */
export function extraKind(rows) {
  const c = new Set(Object.keys(rows[0] || {}).map((k) => k.toLowerCase()));
  if (c.has('role') && c.has('team')) return 'coaches';
  if (c.has('kind') && c.has('jersey')) return 'uniforms';
  if (c.has('week') && c.has('home') && c.has('away')) return 'schedule';
  if (c.has('number') && c.has('team') && !c.has('pos') && !c.has('first')) return 'retired';
  if (c.has('name') && (c.has('capacity') || c.has('roof') || c.has('city')) && !c.has('id')) return 'stadiums';
  return null;
}

export function importRetired(teams, rows) {
  const idx = byAbbr(teams), skipped = [];
  const touched = new Set();
  rows.forEach((r, i) => {
    const ti = idx.get((r.team || '').toUpperCase()), n = parseInt(r.number, 10);
    if (ti === undefined || !(n >= 0 && n <= 99)) { skipped.push(`row ${i + 2}: team "${r.team}" / number "${r.number}"`); return; }
    if (!touched.has(ti)) { teams[ti].retired = []; touched.add(ti); }
    teams[ti].retired.push({ number: n, player: r.player || r.name || '' });
  });
  return { count: rows.length - skipped.length, skipped };
}
export const exportRetired = (teams) => toCSV(teams.flatMap((t) => (t.retired || []).map((r) => ({ team: t.abbr, number: r.number, player: r.player || '' }))), ['team', 'number', 'player']);

const ROLES = { HC: 'hc', OC: 'oc', DC: 'dc', 'HEAD COACH': 'hc', 'OFFENSIVE COORDINATOR': 'oc', 'DEFENSIVE COORDINATOR': 'dc' };
export function importCoaches(teams, rows) {
  const idx = byAbbr(teams), skipped = [];
  rows.forEach((r, i) => {
    const ti = idx.get((r.team || '').toUpperCase()), role = ROLES[(r.role || '').toUpperCase()];
    if (ti === undefined || !role) { skipped.push(`row ${i + 2}: team "${r.team}" / role "${r.role}" (HC, OC or DC)`); return; }
    const c = { name: `${r.first || ''} ${r.last || ''}`.trim() || r.name || 'Coach', age: num(r.age), runPct: num(r.run_pct), goForIt: num(r.go_for_it, 50),
      longFG: num(r.long_fg, 50), blitz: num(r.blitz, 50), aggression: num(r.aggression, 50) };
    (teams[ti].coaches ||= {})[role] = c;
    applyCoachTendencies(teams[ti]);
  });
  return { count: rows.length - skipped.length, skipped };
}

/** Team tendencies the CPU play caller reads (playcaller.js): run rate, 4th-down aggressiveness, FG range, blitz. */
export function applyCoachTendencies(t) {
  const hc = t.coaches?.hc || {}, oc = t.coaches?.oc || {}, dc = t.coaches?.dc || {};
  t.coach = {
    aggr: ((hc.goForIt ?? 50) - 50) / 50, // -1..1 for fourthDecision
    runPct: oc.runPct ?? hc.runPct ?? null,
    longFG: ((hc.longFG ?? 50) - 50) / 50,
    blitz: ((dc.blitz ?? 50) - 50) / 50,
    name: hc.name || null,
  };
}
export function exportCoaches(teams) {
  const out = [];
  for (const t of teams) for (const [role, key] of [['HC', 'hc'], ['OC', 'oc'], ['DC', 'dc']]) {
    const c = t.coaches?.[key];
    const [first, ...rest] = (c?.name || '').split(' ');
    out.push({ team: t.abbr, role, first: first || '', last: rest.join(' '), age: c?.age ?? '', run_pct: c?.runPct ?? '', go_for_it: c?.goForIt ?? 50, long_fg: c?.longFG ?? 50, blitz: c?.blitz ?? 50, aggression: c?.aggression ?? 50 });
  }
  return toCSV(out, ['team', 'role', 'first', 'last', 'age', 'run_pct', 'go_for_it', 'long_fg', 'blitz', 'aggression']);
}

export function importUniforms(teams, rows) {
  const idx = byAbbr(teams), skipped = [];
  rows.forEach((r, i) => {
    const ti = idx.get((r.team || '').toUpperCase()), kind = (r.kind || '').toLowerCase().trim().replace(/\s+/g, '_').replace('alternate', 'alt').replace('rivalry', 'alt').replace(/^colou?r_?rush$/, 'color_rush');
    if (ti === undefined || !UNIFORM_KINDS.includes(kind)) { skipped.push(`row ${i + 2}: team "${r.team}" / kind "${r.kind}" (${UNIFORM_KINDS.join(', ')})`); return; }
    const u = {};
    for (const [col, key] of [['jersey', 'jersey'], ['pants', 'pants'], ['number', 'number'], ['number_outline', 'outline'], ['helmet', 'helmet'], ...EXTRA_COLS]) { const v = hex(r[col]); if (v) u[key] = v; }
    if (/^none$/i.test(r.helmet_stripe || '')) u.stripe = 'none';
    ((teams[ti].uniforms ||= {})[kind] = u);
  });
  return { count: rows.length - skipped.length, skipped };
}
// Optional uniform-creator columns (written only when some team uses them, so plain sheets keep their columns).
const EXTRA_COLS = [['sleeves', 'sleeves'], ['shoulders', 'shoulders'], ['helmet_stripe', 'stripe'], ['facemask', 'facemask'], ['socks', 'socks'], ['gloves', 'gloves'], ['cleats', 'cleats']];
export function exportUniforms(teams) {
  const out = [];
  let extras = false;
  for (const t of teams) for (const kind of UNIFORM_KINDS) {
    const u = uniformFor(t, kind);
    const row = { team: t.abbr, kind, jersey: u.jersey, pants: u.pants, number: u.number, number_outline: u.outline, helmet: u.helmet };
    for (const [col, key] of EXTRA_COLS) if (u[key]) { row[col] = u[key]; extras = true; }
    out.push(row);
  }
  return toCSV(out, ['team', 'kind', 'jersey', 'pants', 'number', 'number_outline', 'helmet', ...(extras ? EXTRA_COLS.map(([c]) => c) : [])]);
}

/** Stadiums: per team, plus neutral sites (league.sites: championship venues by year, international venues). */
export function importStadiums(teams, rows, league = {}) {
  const idx = byAbbr(teams), skipped = [];
  league.sites ||= { championship: {}, international: [] };
  rows.forEach((r, i) => {
    const st = { name: r.name, city: r.city || '', capacity: num(r.capacity), roof: (r.roof || 'open').toLowerCase(), surface: r.surface || '' };
    if (!st.name) { skipped.push(`row ${i + 2}: no stadium name`); return; }
    const kind = (r.kind || '').toLowerCase();
    if (r.team && kind !== 'championship' && kind !== 'international') {
      const ti = idx.get(r.team.toUpperCase());
      if (ti === undefined) { skipped.push(`row ${i + 2}: unknown team "${r.team}"`); return; }
      teams[ti].stadium = st;
    } else if (kind === 'international') league.sites.international.push({ city: st.city, stadium: st.name });
    else league.sites.championship[r.year || 'any'] = { ...st, stadium: st.name };
  });
  return { count: rows.length - skipped.length, skipped, sites: league.sites };
}
export function exportStadiums(teams, sites = null) {
  const out = teams.map((t) => ({ team: t.abbr, name: t.stadium?.name || `${t.city} Stadium`, city: t.stadium?.city || t.city, capacity: t.stadium?.capacity ?? '', roof: t.stadium?.roof || 'open', surface: t.stadium?.surface || '', kind: 'home', year: '' }));
  for (const [year, s] of Object.entries(sites?.championship || {})) out.push({ team: '', name: s.name || s.stadium, city: s.city, capacity: s.capacity ?? '', roof: s.roof || '', surface: '', kind: 'championship', year: year === 'any' ? '' : year });
  for (const s of sites?.international || []) out.push({ team: '', name: s.stadium, city: s.city, capacity: '', roof: '', surface: '', kind: 'international', year: '' });
  return toCSV(out, ['team', 'name', 'city', 'capacity', 'roof', 'surface', 'kind', 'year']);
}

/** "20:20" → "8:20 PM" (a 12-hour time like "1:00 PM" is kept as it is). */
function clockTime(v) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(v || '');
  if (!m) return v.trim();
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** A franchise schedule from a CSV: weeks of { home, away, day?, date?, time? }; null with problems if unusable. */
export function scheduleFromRows(teams, rows) {
  const idx = byAbbr(teams), skipped = [];
  const weeks = [];
  rows.forEach((r, i) => {
    const w = parseInt(r.week, 10), h = idx.get((r.home || '').toUpperCase()), a = idx.get((r.away || '').toUpperCase());
    if (!(w >= 1 && w <= 22) || h === undefined || a === undefined || h === a) { skipped.push(`row ${i + 2}: week "${r.week}", ${r.away} @ ${r.home}`); return; }
    (weeks[w - 1] ||= []).push({ home: h, away: a, score: null, ...(r.day ? { day: r.day } : {}), ...(r.date ? { date: r.date } : {}), ...(r.time ? { time: clockTime(r.time) } : {}) });
  });
  for (let k = 0; k < weeks.length; k++) weeks[k] ||= [];
  // Nobody plays twice in a week.
  weeks.forEach((wk, k) => { const seen = new Set(); for (const g of wk) { if (seen.has(g.home) || seen.has(g.away)) skipped.push(`week ${k + 1}: a team plays twice`); seen.add(g.home); seen.add(g.away); } });
  return { weeks: weeks.length ? weeks : null, skipped };
}
export function exportSchedule(teams, schedule) {
  return toCSV(schedule.flatMap((wk, k) => wk.map((g) => ({ week: k + 1, away: teams[g.away].abbr, home: teams[g.home].abbr, day: g.day || '', date: g.date || '', time: g.time || '' }))), ['week', 'away', 'home', 'day', 'date', 'time']);
}

/** Fictional coaching staffs for teams that don't have one (names from the generator's name lists). */
export function ensureCoaches(teams, seed = 7) {
  let k = seed;
  const rnd = () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
  for (const t of teams) {
    t.coaches ||= {};
    for (const role of ['hc', 'oc', 'dc']) {
      if (t.coaches[role]) continue;
      const n = `${FIRST_NAMES[Math.floor(rnd() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rnd() * LAST_NAMES.length)]}`;
      t.coaches[role] = { name: n, age: 38 + Math.floor(rnd() * 28), runPct: role === 'oc' ? 38 + Math.round(rnd() * 16) : null,
        goForIt: 30 + Math.round(rnd() * 45), longFG: 35 + Math.round(rnd() * 30), blitz: 30 + Math.round(rnd() * 40), aggression: 35 + Math.round(rnd() * 30) };
    }
    applyCoachTendencies(t);
  }
}
