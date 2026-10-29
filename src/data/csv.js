import { RATINGS, POSITION_TEMPLATES, ROSTER_COUNTS, overall } from './positions.js';
import { generatePlayer } from './generator.js';
import { buildDepthChart } from './depthChart.js';
import { RNG } from '../core/rng.js';

// CSV helpers + roster import/export. Format is documented in CLAUDE.md ("Roster CSV").

/** Parse CSV text into an array of objects keyed by the header row. Handles quoted fields. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function toCSV(objs, header) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [header.join(','), ...objs.map((o) => header.map((h) => esc(o[h])).join(','))].join('\n') + '\n';
}

const ROSTER_HEADER = ['team', 'first', 'last', 'pos', 'number', 'age', 'height', 'weight', 'college', ...RATINGS.map((r) => r[1]), 'OVR'];
const POS_ALIAS = { RB: 'HB', LB: 'OLB', ILB: 'MLB', NB: 'CB', S: 'FS', OT: 'T', OG: 'G', EDGE: 'DE', NT: 'DT', PK: 'K',
  // Depth-chart slot names work as positions too.
  LT: 'T', RT: 'T', LG: 'G', RG: 'G', LE: 'DE', RE: 'DE', LOLB: 'OLB', ROLB: 'OLB', SAM: 'OLB', WILL: 'OLB', MIKE: 'MLB' };

/**
 * Apply roster rows to the league. Players listed for a team replace that team's generated players
 * at the same position (starters first) and are pinned to the top of the depth chart in file order;
 * unlisted roster spots keep their generated players. Returns a summary.
 */
export function importRosterRows(teams, rows, seed = 77) {
  const rng = new RNG(seed);
  const byAbbr = new Map(teams.map((t) => [t.abbr.toUpperCase(), t]));
  const summary = { imported: 0, skipped: [] };
  const touched = new Set();
  // A team listed with 40+ players is a full roster: replace it entirely instead of pinning starters.
  const counts = {};
  for (const r of rows) { const k = (r.team || '').toUpperCase(); counts[k] = (counts[k] || 0) + 1; }
  const full = new Set(Object.keys(counts).filter((k) => counts[k] >= 40));
  for (const k of full) { const t = byAbbr.get(k); if (t) { t.roster = []; touched.add(t); t._pinCount = {}; } }
  rows.forEach((row, i) => {
    const team = byAbbr.get((row.team || '').toUpperCase());
    let pos = (row.pos || '').toUpperCase();
    pos = POS_ALIAS[pos] || pos;
    if (!team || !ROSTER_COUNTS[pos]) { summary.skipped.push(`row ${i + 2}: unknown team "${row.team}" or position "${row.pos}"`); return; }
    if (!touched.has(team)) { touched.add(team); team._pinCount = {}; }
    const p = generatePlayer(pos, rng, 0);
    // Missing ratings use the position template exactly (no random noise).
    for (const [key, code] of RATINGS) {
      const v = parseInt(row[code], 10);
      p.ratings[key] = Number.isFinite(v) ? Math.max(0, Math.min(99, v)) : POSITION_TEMPLATES[pos][key] ?? 35;
    }
    p.first = row.first || p.first;
    p.last = row.last || p.last;
    if (row.age) p.age = +row.age;
    if (row.height) p.height = +row.height;
    if (row.weight) p.weight = +row.weight;
    if (row.college) p.college = row.college;
    // Optional OVR column: show that overall (kept as an offset from the computed one).
    const ovr = parseInt(row.OVR ?? row.ovr, 10);
    delete p.ovrAdj;
    if (Number.isFinite(ovr)) p.ovrAdj = Math.max(-30, Math.min(30, ovr - overall(p)));
    p.ovr = overall(p);
    const isFull = full.has(team.abbr.toUpperCase());
    if (!isFull) p.pinned = (team._pinCount[pos] = (team._pinCount[pos] || 0) + 1);
    // Partial file: replace a generated player at this position (best first, so imports start).
    const gen = isFull ? [] : team.roster.filter((q) => q.pos === pos && !q.pinned).sort((a, b) => b.ovr - a.ovr);
    const out = gen[0];
    if (out) team.roster.splice(team.roster.indexOf(out), 1);
    const wanted = parseInt(row.number, 10);
    const used = new Set(team.roster.map((q) => q.number));
    p.number = Number.isFinite(wanted) && wanted >= 0 && wanted <= 99 ? wanted : (out && !used.has(out.number) ? out.number : firstFree(used));
    // A requested number wins: bump any generated player wearing it.
    const clash = team.roster.find((q) => q.number === p.number);
    if (clash && !isFull) clash.number = firstFree(new Set([...used, p.number]));
    if (clash && isFull) summary.skipped.push(`row ${i + 2}: ${team.abbr} number ${p.number} is used twice`);
    team.roster.push(p);
    summary.imported++;
  });
  for (const t of touched) {
    if (t.roster.length < 22) summary.skipped.push(`${t.abbr} only has ${t.roster.length} players`);
    t.depth = buildDepthChart(t.roster);
    delete t._pinCount;
  }
  summary.teams = [...touched].map((t) => t.abbr);
  return summary;
}

function firstFree(used) { for (let n = 1; n <= 99; n++) if (!used.has(n)) return n; return 0; }

export function exportRosterCSV(teams) {
  const rows = [];
  for (const t of teams) for (const p of t.roster) {
    const o = { team: t.abbr, first: p.first, last: p.last, pos: p.pos, number: p.number, age: p.age, height: p.height, weight: p.weight, college: p.college };
    for (const [key, code] of RATINGS) o[code] = p.ratings[key];
    o.OVR = overall(p);
    rows.push(o);
  }
  return toCSV(rows, ROSTER_HEADER);
}

// ---------- Teams ----------
const TEAM_HEADER = ['id', 'city', 'name', 'abbr', 'primary', 'secondary', 'accent', 'conference', 'division', 'logo_shape', 'logo_text', 'logo_image', 'play_as'];
const CONFS = ['Liberty', 'Frontier'];
const DIVS = ['East', 'North', 'South', 'West'];
const HEX = /^#?[0-9a-f]{6}$/i;

export function exportTeamsCSV(teams, playAsId = null) {
  return toCSV(teams.map((t) => ({
    id: t.id, city: t.city, name: t.name, abbr: t.abbr,
    primary: t.colors.primary, secondary: t.colors.secondary, accent: t.colors.accent,
    conference: CONFS[t.conference], division: DIVS[t.division],
    logo_shape: t.logo.shape, logo_text: t.logo.text, logo_image: t.logo.image || '', play_as: t.id === playAsId ? 'Y' : '',
  })), TEAM_HEADER);
}

/** Update teams by id. Returns { playAs: teamId | null, logoImages: [{team, file}] }. */
export function importTeamsRows(teams, rows) {
  const out = { playAs: null, logoImages: [], skipped: [] };
  rows.forEach((r, i) => {
    const t = teams[parseInt(r.id, 10)];
    if (!t) { out.skipped.push(`teams row ${i + 2}: unknown id "${r.id}"`); return; }
    const color = (v, cur) => (HEX.test(v || '') ? (v.startsWith('#') ? v : '#' + v) : cur);
    if (r.city) t.city = r.city;
    if (r.name) t.name = r.name;
    if (r.abbr) { t.abbr = r.abbr.toUpperCase().slice(0, 4); }
    t.colors = { primary: color(r.primary, t.colors.primary), secondary: color(r.secondary, t.colors.secondary), accent: color(r.accent, t.colors.accent) };
    const ci = CONFS.findIndex((c) => c.toLowerCase() === (r.conference || '').toLowerCase());
    const di = DIVS.findIndex((d) => d.toLowerCase() === (r.division || '').toLowerCase());
    if (ci >= 0) t.conference = ci;
    if (di >= 0) t.division = di;
    t.logo = { ...t.logo, bg: t.colors.primary, fg: t.colors.secondary, border: t.colors.accent };
    if (r.logo_shape) t.logo.shape = r.logo_shape.toLowerCase();
    t.logo.text = r.logo_text !== undefined && r.logo_text !== '' ? r.logo_text : t.abbr;
    if (r.logo_image) { t.logo.image = r.logo_image; out.logoImages.push({ team: t, file: r.logo_image }); }
    if (/^(y|yes|x|1|true)$/i.test(r.play_as || '')) out.playAs = t.id;
  });
  return out;
}

// ---------- Depth charts ----------
export const DEPTH_ORDER = ['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LE', 'RE', 'DT', 'LOLB', 'MLB', 'ROLB', 'CB', 'FS', 'SS', 'K', 'P', 'KR', 'PR'];

export function exportDepthCSV(teams) {
  const rows = [];
  for (const t of teams) {
    const byId = new Map(t.roster.map((p) => [p.id, p]));
    for (const slot of DEPTH_ORDER) {
      const list = (t.depth[slot] || []).map((id) => byId.get(id)).filter(Boolean);
      rows.push({ team: t.abbr, slot, players: list.map((p) => p.number).join(' '), names: list.map((p) => `${p.first[0]}. ${p.last}`).join(' / ') });
    }
  }
  return toCSV(rows, ['team', 'slot', 'players', 'names']);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** "D. Reed", "Reed" or "Dan Reed" against a roster player. */
function nameMatches(p, name) {
  const parts = name.replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, '').trim().split(/\s+/);
  const first = parts.length > 1 ? parts[0] : '';
  const last = parts.slice(parts.length > 1 ? 1 : 0).join(' ');
  const a = norm(p.last).replace(/(jr|sr|ii|iii|iv|v)$/, ''), b = norm(last).replace(/(jr|sr|ii|iii|iv|v)$/, '');
  if (!a || !b || !(a === b || a.endsWith(b) || b.endsWith(a))) return false; // "Michael Schmitz" ~ "Schmitz"
  const f = norm(first);
  return !f || norm(p.first).startsWith(f);
}

/** Apply depth rows ("CHI, WR, 10 11 14 83"). Unknown numbers are skipped; unlisted slots stay automatic. */
export function importDepthRows(teams, rows) {
  const byAbbr = new Map(teams.map((t) => [t.abbr.toUpperCase(), t]));
  const skipped = [];
  rows.forEach((r, i) => {
    const t = byAbbr.get((r.team || '').toUpperCase());
    const slot = (r.slot || '').toUpperCase();
    if (!t || !DEPTH_ORDER.includes(slot)) { skipped.push(`depth row ${i + 2}: unknown team or slot`); return; }
    const ids = [];
    // `names` ("F. Last / F. Last") lines up with `players`; it breaks ties when two players share a
    // number and finds players listed without one ("--").
    const names = (r.names || '').split('/').map((x) => x.trim());
    (r.players || '').split(/[\s,;/]+/).filter(Boolean).forEach((n, j) => {
      const num = parseInt(n, 10);
      const byNum = Number.isFinite(num) ? t.roster.filter((q) => q.number === num) : [];
      const named = names[j] ? (byNum.length ? byNum : t.roster).filter((q) => nameMatches(q, names[j])) : [];
      const p = named.find((q) => !ids.includes(q.id)) || byNum.find((q) => !ids.includes(q.id)) || named[0] || byNum[0];
      if (p && !ids.includes(p.id)) ids.push(p.id);
      else if (!p) skipped.push(`depth row ${i + 2}: ${t.abbr} has no ${Number.isFinite(num) ? '#' + n : names[j] || n}`);
    });
    if (ids.length) t.depth[slot] = ids;
  });
  return skipped;
}
