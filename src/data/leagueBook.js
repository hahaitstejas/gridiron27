// One spreadsheet for the whole league ("league book"): every league CSV in a single file, one section after another.
// Each section starts with a marker row whose first cell is the section name in brackets, then that section's own
// header row and rows, exactly like the separate files:
//
//   [TEAMS]
//   id,city,name,abbr,...
//   0,Boston,...
//
//   [ROSTER]
//   team,first,last,pos,...
//
// Sections: TEAMS, ROSTER, DEPTH, COACHES, UNIFORMS, STADIUMS, RETIRED_NUMBERS, FREE_AGENTS, SCHEDULE. Any can be left
// out; they're applied in that order. Spreadsheet apps pad short rows with commas ("[TEAMS],,,,"), which is fine.
// Pure logic (Node-importable): logo images and the franchise-only sections are handed back to the caller.
import { parseCSV, importRosterRows, importTeamsRows, importDepthRows, exportRosterCSV, exportTeamsCSV, exportDepthCSV, freeAgentsFromRows, toCSV } from './csv.js';
import { importRetired, importCoaches, importUniforms, importStadiums, exportRetired, exportCoaches, exportUniforms, exportStadiums, scheduleFromRows, exportSchedule } from './extraCSV.js';
import { RATINGS } from './positions.js';

export const BOOK_SECTIONS = ['TEAMS', 'ROSTER', 'DEPTH', 'COACHES', 'UNIFORMS', 'STADIUMS', 'RETIRED_NUMBERS', 'FREE_AGENTS', 'SCHEDULE'];
const MARK = /^\s*"?\[([A-Za-z_ ]+)\]"?\s*(,.*)?$/;
const norm = (s) => s.trim().toUpperCase().replace(/\s+/g, '_').replace(/^RETIRED$/, 'RETIRED_NUMBERS').replace(/^FREEAGENTS$/, 'FREE_AGENTS');

/** Is this text a league book (it has at least one known [SECTION] marker row)? */
export function isLeagueBook(text) {
  return text.split(/\r?\n/).some((l) => { const m = MARK.exec(l); return m && BOOK_SECTIONS.includes(norm(m[1])); });
}

/** Split a book into { SECTION: csvText }. Unknown sections are kept under their own names (and reported). */
export function splitLeagueBook(text) {
  const out = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = MARK.exec(line);
    if (m) { cur = norm(m[1]); out[cur] = ''; continue; }
    if (cur === null) continue;
    if (!line.replace(/[,\s"]/g, '')) continue; // blank rows (or rows of nothing but commas) between sections
    out[cur] += line + '\n';
  }
  return out;
}

/**
 * The whole league as one book. opts: { playAs, sites, schedule, freeAgents } (schedule / free agents only when a
 * franchise is running; otherwise those sections are written with just their header row, as a template).
 */
export function exportLeagueBook(teams, { playAs = null, sites = null, schedule = null, freeAgents = null } = {}) {
  // Free agents: the plain roster columns (no overall or contract: they get a deal when they sign).
  const faHead = ['team', 'first', 'last', 'pos', 'number', 'age', 'height', 'weight', 'college', ...RATINGS.map((r) => r[1]), 'face'];
  const fa = toCSV(freeAgents?.length ? parseCSV(exportRosterCSV([{ abbr: 'FA', roster: freeAgents }])) : [], faHead);
  const sec = {
    TEAMS: exportTeamsCSV(teams, playAs),
    ROSTER: exportRosterCSV(teams),
    DEPTH: exportDepthCSV(teams),
    COACHES: exportCoaches(teams),
    UNIFORMS: exportUniforms(teams),
    STADIUMS: exportStadiums(teams, sites),
    RETIRED_NUMBERS: exportRetired(teams),
    FREE_AGENTS: fa,
    SCHEDULE: schedule ? exportSchedule(teams, schedule) : toCSV([], ['week', 'away', 'home', 'day', 'date', 'time']),
  };
  return BOOK_SECTIONS.map((k) => `[${k}]\n${sec[k]}`).join('\n');
}

/**
 * Apply a book to the league. Returns { lines, problems, playAs, logoImages, freeAgents, schedule }: summary lines
 * for the screen, problems, the play-as team (TEAMS), logo files to load, and the franchise-only sections parsed
 * (free agents as players, schedule as weeks) for the caller to use when a franchise starts.
 */
export function importLeagueBook(teams, text, { league = {} } = {}) {
  const secs = splitLeagueBook(text);
  const res = { lines: [], problems: [], playAs: null, logoImages: [], freeAgents: null, schedule: null };
  const rows = (k) => (secs[k] ? parseCSV(secs[k]) : null);
  const t = rows('TEAMS');
  if (t?.length) { const r = importTeamsRows(teams, t); res.playAs = r.playAs; res.logoImages = r.logoImages; res.problems.push(...r.skipped); res.lines.push(`Teams: ${t.length}`); }
  const r = rows('ROSTER');
  if (r?.length) { const s = importRosterRows(teams, r); res.problems.push(...s.skipped); res.lines.push(`Roster: ${s.imported} players`); if (res.playAs === null && s.teams.length === 1) res.playAs = teams.find((x) => x.abbr === s.teams[0])?.id ?? null; }
  const d = rows('DEPTH');
  if (d?.length) { res.problems.push(...importDepthRows(teams, d)); res.lines.push(`Depth charts: ${d.length} rows`); }
  for (const [k, fn, label] of [['COACHES', importCoaches, 'Coaches'], ['UNIFORMS', importUniforms, 'Uniforms'], ['STADIUMS', (tm, rw) => importStadiums(tm, rw, league), 'Stadiums'], ['RETIRED_NUMBERS', importRetired, 'Retired numbers']]) {
    const x = rows(k);
    if (x?.length) { const o = fn(teams, x); res.problems.push(...o.skipped.map((p) => `${label}: ${p}`)); res.lines.push(`${label}: ${o.count}`); }
  }
  const fa = rows('FREE_AGENTS');
  if (fa?.length) { const o = freeAgentsFromRows(fa); res.freeAgents = o.players; res.problems.push(...o.skipped.map((p) => `Free agents: ${p}`)); res.lines.push(`Free agents: ${o.players.length} (used when a franchise starts)`); }
  const sc = rows('SCHEDULE');
  if (sc?.length) { const o = scheduleFromRows(teams, sc); res.schedule = o.weeks; res.problems.push(...o.skipped.map((p) => `Schedule: ${p}`)); if (o.weeks) res.lines.push(`Schedule: ${o.weeks.length} weeks (used when a franchise starts)`); }
  for (const k of Object.keys(secs)) if (!BOOK_SECTIONS.includes(k)) res.problems.push(`Unknown section [${k}] skipped`);
  return res;
}
