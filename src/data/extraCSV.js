// More league spreadsheets (Update 1.0), same idea as teams/roster/depth.csv: exported from League → Spreadsheets,
// read back from an import or from git-ignored public/local/ at startup.
//   retired_numbers.csv  team,number,player                                  numbers nobody on that team can wear
//   coaches.csv          team,role,first,last,age,run_pct,go_for_it,long_fg,blitz,aggression
//                        role = HC | OC | DC. run_pct = how often the offense runs (0-100, 45 = league average);
//                        go_for_it / long_fg / blitz / aggression are 0-100 tendencies (50 = league average)
//   uniforms.csv         team,kind,jersey,pants,number,number_outline,helmet   kind = home | away | alt (hex colors)
//                        optional: sleeves, shoulders, helmet_stripe, facemask, socks, gloves, cleats (colors) and the design
//                        columns number_font, name_font, patch_font, captain_patch, left_chest, right_chest, left_sleeve, right_sleeve, collar
//                        (allowed values: src/data/design.js, also written into the [README] section of a league book)
//   stadiums.csv         team,name,city,capacity,roof,surface,kind,year         team blank + kind = championship |
//                        international for neutral sites (year = which season's championship game is played there)
//                        optional: turf, endzone, mid_logo, seats and the end zone design columns endzone_color, endzone_color2,
//                        endzone_text_color, endzone_outline_color, endzone_font, endzone_text_left, endzone_text_right,
//                        endzone_logo_left, endzone_logo_right, yard_font
//   schedule.csv         week,away,home,day,date,time                           a franchise season's schedule
import { toCSV } from './csv.js';
import { FIRST_NAMES, LAST_NAMES } from './names.js';
import { uniformFor, UNIFORM_KINDS } from './uniforms.js';
import { FONTS, fontOf, PATCH_SLOTS, parsePatch, patchCell, ENDZONE_STYLES, ENDZONE_LOGOS, TURF_STYLES } from './design.js';

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

/** A row with its column names folded to lower case with underscores, so "Number Font" / "number_font" both work. */
const lowerRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/[\s-]+/g, '_'), v]));
const fontList = () => FONTS.map((f) => f.id).join(', ');

export function importUniforms(teams, rows) {
  const idx = byAbbr(teams), skipped = [];
  let bad = 0;
  rows.forEach((raw, i) => {
    const r = lowerRow(raw);
    const ti = idx.get((r.team || '').toUpperCase()), kind = (r.kind || '').toLowerCase().trim().replace(/\s+/g, '_').replace('alternate', 'alt').replace('rivalry', 'alt').replace(/^colou?r_?rush$/, 'color_rush');
    if (ti === undefined || !UNIFORM_KINDS.includes(kind)) { bad++; skipped.push(`row ${i + 2}: team "${raw.team}" / kind "${raw.kind}" (${UNIFORM_KINDS.join(', ')})`); return; }
    const u = {};
    for (const [col, key] of [['jersey', 'jersey'], ['pants', 'pants'], ['number', 'number'], ['number_outline', 'outline'], ['helmet', 'helmet'], ...EXTRA_COLS]) { const v = hex(r[col]); if (v) u[key] = v; }
    if (/^none$/i.test(r.helmet_stripe || '')) u.stripe = 'none';
    // Design columns: fonts (ids from design.js) and the four patch slots.
    for (const [col, key] of FONT_COLS) {
      if (!r[col]) continue;
      const f = fontOf(r[col]);
      if (f) u[key] = f.id; else skipped.push(`row ${i + 2}: unknown ${col} "${r[col]}" (allowed: ${fontList()})`);
    }
    if (r.captain_patch) {
      const p = parsePatch(r.captain_patch);
      if (p?.error) skipped.push(`row ${i + 2}: captain_patch: ${p.error}`);
      else if (p) u.captainPatch = p;
    }
    for (const slot of PATCH_SLOTS) {
      if (!r[slot]) continue;
      const p = parsePatch(r[slot]);
      if (p?.error) skipped.push(`row ${i + 2}: ${slot}: ${p.error}`);
      else if (p) (u.patches ||= {})[slot] = p;
    }
    ((teams[ti].uniforms ||= {})[kind] = u);
  });
  return { count: rows.length - bad, skipped };
}
const FONT_COLS = [['number_font', 'numberFont'], ['name_font', 'nameFont'], ['patch_font', 'patchFont']];
// Optional uniform-creator columns (written only when some team uses them, so plain sheets keep their columns).
const EXTRA_COLS = [['sleeves', 'sleeves'], ['shoulders', 'shoulders'], ['helmet_stripe', 'stripe'], ['facemask', 'facemask'], ['socks', 'socks'], ['gloves', 'gloves'], ['cleats', 'cleats']];
const DESIGN_COLS = [...FONT_COLS.map(([c]) => c), 'captain_patch', ...PATCH_SLOTS];
/** opts.designColumns: always write the font / patch columns (the league book does, so a guide-reading AI sees them). */
export function exportUniforms(teams, { designColumns = false } = {}) {
  const out = [];
  let extras = false, design = designColumns;
  for (const t of teams) for (const kind of UNIFORM_KINDS) {
    const u = uniformFor(t, kind);
    const row = { team: t.abbr, kind, jersey: u.jersey, pants: u.pants, number: u.number, number_outline: u.outline, helmet: u.helmet };
    for (const [col, key] of EXTRA_COLS) if (u[key]) { row[col] = u[key]; extras = true; }
    for (const [col, key] of FONT_COLS) if (u[key]) { row[col] = u[key]; design = true; }
    if (u.captainPatch) { row.captain_patch = patchCell(u.captainPatch); design = true; }
    for (const slot of PATCH_SLOTS) if (u.patches?.[slot]) { row[slot] = patchCell(u.patches[slot]); design = true; }
    out.push(row);
  }
  return toCSV(out, ['team', 'kind', 'jersey', 'pants', 'number', 'number_outline', 'helmet', ...(extras || designColumns ? EXTRA_COLS.map(([c]) => c) : []), ...(design ? DESIGN_COLS : [])]);
}

/** Stadiums: per team, plus neutral sites (league.sites: championship venues by year, international venues). */
/** End zone design columns: spreadsheet name → saved key. */
const EZ_TEXT = [['endzone_text_left', 'ezLeft'], ['endzone_text_right', 'ezRight']];
const EZ_COLORS = [['endzone_color', 'ezColor'], ['endzone_color2', 'ezColor2'], ['endzone_text_color', 'ezText'], ['endzone_outline_color', 'ezOutline']];
export function importStadiums(teams, rows, league = {}) {
  const idx = byAbbr(teams), skipped = [];
  let bad = 0;
  league.sites ||= { championship: {}, international: [] };
  rows.forEach((raw, i) => {
    const r = lowerRow(raw);
    const st = { name: r.name, city: r.city || '', capacity: num(r.capacity), roof: (r.roof || 'open').toLowerCase(), surface: r.surface || '' };
    // Stadium creator columns (optional): turf color, end zone style, midfield logo, seat color.
    if (r.turf) { const t = r.turf.toLowerCase(); if (TURF_STYLES.includes(t)) st.turf = t; else skipped.push(`row ${i + 2}: unknown turf "${r.turf}" (${TURF_STYLES.join(', ')})`); }
    if (r.endzone) { const e = r.endzone.toLowerCase().replace(/[\s-]+/g, '_'); if (ENDZONE_STYLES[e]) st.endzone = e; else skipped.push(`row ${i + 2}: unknown endzone style "${r.endzone}" (${Object.keys(ENDZONE_STYLES).join(', ')})`); }
    if (r.mid_logo) st.midLogo = !/^(n|no|off|0|false)$/i.test(r.mid_logo);
    if (hex(r.seats)) st.seats = hex(r.seats);
    // End zone design: colors, lettering font and words, the logos beside the words, the yard-number font.
    for (const [col, key] of EZ_COLORS) { const v = hex(r[col]); if (v) st[key] = v; else if (r[col]) skipped.push(`row ${i + 2}: ${col} must be a hex color, got "${r[col]}"`); }
    for (const [col, key] of EZ_TEXT) if (r[col]) st[key] = r[col] === '_' ? '' : r[col];
    for (const [col, key] of [['endzone_font', 'ezFont'], ['yard_font', 'yardFont']]) {
      if (!r[col]) continue;
      const f = fontOf(r[col]);
      if (f) st[key] = f.id; else skipped.push(`row ${i + 2}: unknown ${col} "${r[col]}" (allowed: ${fontList()})`);
    }
    for (const [col, key] of [['endzone_logo_left', 'ezLogoLeft'], ['endzone_logo_right', 'ezLogoRight']]) {
      if (!r[col]) continue;
      const v = r[col].toLowerCase();
      if (ENDZONE_LOGOS.includes(v)) st[key] = v; else skipped.push(`row ${i + 2}: ${col} must be ${ENDZONE_LOGOS.join(', ')}, got "${r[col]}"`);
    }
    if (!st.name) { bad++; skipped.push(`row ${i + 2}: no stadium name`); return; }
    const kind = (r.kind || '').toLowerCase();
    if (r.team && kind !== 'championship' && kind !== 'international') {
      const ti = idx.get(r.team.toUpperCase());
      if (ti === undefined) { bad++; skipped.push(`row ${i + 2}: unknown team "${r.team}"`); return; }
      teams[ti].stadium = st;
    } else if (kind === 'international') league.sites.international.push({ city: st.city, stadium: st.name });
    else league.sites.championship[r.year || 'any'] = { ...st, stadium: st.name };
  });
  return { count: rows.length - bad, skipped, sites: league.sites };
}
const EZ_COLS = ['endzone_color', 'endzone_color2', 'endzone_text_color', 'endzone_outline_color', 'endzone_font', 'endzone_text_left', 'endzone_text_right', 'endzone_logo_left', 'endzone_logo_right', 'yard_font'];
export function exportStadiums(teams, sites = null, { designColumns = false } = {}) {
  const out = teams.map((t) => {
    const sd = t.stadium || {};
    return { team: t.abbr, name: sd.name || `${t.city} Stadium`, city: sd.city || t.city, capacity: sd.capacity ?? '', roof: sd.roof || 'open', surface: sd.surface || '', kind: 'home', year: '',
      turf: sd.turf || '', endzone: sd.endzone || '', mid_logo: sd.midLogo === false ? 'off' : sd.midLogo ? 'on' : '', seats: sd.seats || '',
      endzone_color: sd.ezColor || '', endzone_color2: sd.ezColor2 || '', endzone_text_color: sd.ezText || '', endzone_outline_color: sd.ezOutline || '', endzone_font: sd.ezFont || '',
      endzone_text_left: sd.ezLeft === '' ? '_' : sd.ezLeft || '', endzone_text_right: sd.ezRight === '' ? '_' : sd.ezRight || '', endzone_logo_left: sd.ezLogoLeft || '', endzone_logo_right: sd.ezLogoRight || '', yard_font: sd.yardFont || '' };
  });
  const extra = designColumns || out.some((o) => o.turf || o.endzone || o.mid_logo || o.seats);
  const ezUsed = designColumns || out.some((o) => EZ_COLS.some((c) => o[c]));
  for (const [year, s] of Object.entries(sites?.championship || {})) out.push({ team: '', name: s.name || s.stadium, city: s.city, capacity: s.capacity ?? '', roof: s.roof || '', surface: '', kind: 'championship', year: year === 'any' ? '' : year });
  for (const s of sites?.international || []) out.push({ team: '', name: s.stadium, city: s.city, capacity: '', roof: '', surface: '', kind: 'international', year: '' });
  return toCSV(out, ['team', 'name', 'city', 'capacity', 'roof', 'surface', 'kind', 'year', ...(extra ? ['turf', 'endzone', 'mid_logo', 'seats'] : []), ...(ezUsed ? EZ_COLS : [])]);
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
