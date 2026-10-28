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

const ROSTER_HEADER = ['team', 'first', 'last', 'pos', 'number', 'age', 'height', 'weight', 'college', ...RATINGS.map((r) => r[1])];
const POS_ALIAS = { RB: 'HB', LB: 'OLB', ILB: 'MLB', NB: 'CB', S: 'FS', OT: 'T', OG: 'G', EDGE: 'DE', NT: 'DT', PK: 'K' };

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
    p.ovr = overall(p);
    p.pinned = (team._pinCount[pos] = (team._pinCount[pos] || 0) + 1);
    // Replace a generated player at this position (best first, so imports become the starters).
    const gen = team.roster.filter((q) => q.pos === pos && !q.pinned).sort((a, b) => b.ovr - a.ovr);
    const out = gen[0];
    if (out) team.roster.splice(team.roster.indexOf(out), 1);
    const wanted = parseInt(row.number, 10);
    const used = new Set(team.roster.map((q) => q.number));
    p.number = Number.isFinite(wanted) && wanted >= 0 && wanted <= 99 ? wanted : (out && !used.has(out.number) ? out.number : firstFree(used));
    // A requested number wins: bump any generated player wearing it.
    const clash = team.roster.find((q) => q.number === p.number);
    if (clash) clash.number = firstFree(new Set([...used, p.number]));
    team.roster.push(p);
    summary.imported++;
  });
  for (const t of touched) { t.depth = buildDepthChart(t.roster); delete t._pinCount; }
  summary.teams = [...touched].map((t) => t.abbr);
  return summary;
}

function firstFree(used) { for (let n = 1; n <= 99; n++) if (!used.has(n)) return n; return 0; }

export function exportRosterCSV(teams) {
  const rows = [];
  for (const t of teams) for (const p of t.roster) {
    const o = { team: t.abbr, first: p.first, last: p.last, pos: p.pos, number: p.number, age: p.age, height: p.height, weight: p.weight, college: p.college };
    for (const [key, code] of RATINGS) o[code] = p.ratings[key];
    rows.push(o);
  }
  return toCSV(rows, ROSTER_HEADER);
}
