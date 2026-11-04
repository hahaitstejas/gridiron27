import { el } from './nav.js';
import { parseCSV, importRosterRows, importTeamsRows, importDepthRows, exportRosterCSV, exportTeamsCSV, exportDepthCSV } from '../data/csv.js';
import { loadLocalLeague } from '../data/localLeague.js';
import { downloadFile, pickFile } from '../data/storage.js';
import { attachLogos } from './league.js';
import { LEAGUE } from '../data/leagueInfo.js';
import { isLeagueBook, importLeagueBook, exportLeagueBook } from '../data/leagueBook.js';
import { extraKind, importRetired, importCoaches, importUniforms, importStadiums, exportRetired, exportCoaches, exportUniforms, exportStadiums } from '../data/extraCSV.js';

/** Which league spreadsheet a set of parsed rows is (by its columns). */
export function csvKind(rows) {
  const cols = new Set(Object.keys(rows[0] || {}));
  if (cols.has('slot') && cols.has('players')) return 'depth';
  if (cols.has('id') && cols.has('city')) return 'teams';
  if (cols.has('first') && cols.has('pos')) return 'roster';
  return null;
}

/**
 * League → Spreadsheets: export teams/roster/depth CSVs (same format as public/local/, see CLAUDE.md)
 * and import them back, with a summary of what changed. ctx = { screens, teams, prefs, onBack, onChange }.
 */
export function spreadsheetScreen(ctx, report = []) {
  const { screens, teams, prefs } = ctx;
  screens.extraButtons = null;
  const item = (label, sub, fn) => screens.menuItem(label, sub, fn);
  const exportAll = () => {
    downloadFile('teams.csv', exportTeamsCSV(teams, prefs.home), 'text/csv');
    setTimeout(() => downloadFile('roster.csv', exportRosterCSV(teams), 'text/csv'), 300);
    setTimeout(() => downloadFile('depth.csv', exportDepthCSV(teams), 'text/csv'), 600);
  };
  const items = [
    item('Export everything as one file', 'league.csv: teams, roster, depth, coaches, uniforms, stadiums, retired numbers, free agents, schedule',
      () => downloadFile('league.csv', exportLeagueBook(teams, { playAs: prefs.home, sites: LEAGUE.sites }), 'text/csv')),
    item('Export all three', 'Download teams.csv, roster.csv and depth.csv', exportAll),
    item('Export teams.csv', 'Names, colors, conferences, logos, your team', () => downloadFile('teams.csv', exportTeamsCSV(teams, prefs.home), 'text/csv')),
    item('Export roster.csv', 'Every player with all ratings', () => downloadFile('roster.csv', exportRosterCSV(teams), 'text/csv')),
    item('Export depth.csv', 'Depth charts by jersey number', () => downloadFile('depth.csv', exportDepthCSV(teams), 'text/csv')),
    item('Export retired_numbers.csv', 'team, number, player', () => downloadFile('retired_numbers.csv', exportRetired(teams), 'text/csv')),
    item('Export coaches.csv', 'Head coach and coordinators with play-calling tendencies', () => downloadFile('coaches.csv', exportCoaches(teams), 'text/csv')),
    item('Export uniforms.csv', 'Home / away / alternate: jersey, pants, number, outline, helmet', () => downloadFile('uniforms.csv', exportUniforms(teams), 'text/csv')),
    item('Export stadiums.csv', 'Team stadiums plus neutral championship / international sites', () => downloadFile('stadiums.csv', exportStadiums(teams, LEAGUE.sites), 'text/csv')),
    item('Import a spreadsheet…', 'league.csv (everything), or one of teams, roster, depth, retired numbers, coaches, uniforms, stadiums (detected by the header row)', async () => {
      const f = await pickFile('.csv,text/csv');
      if (!f) return;
      spreadsheetScreen(ctx, await importCSV(ctx, f.name, f.data));
    }),
    item('Re-apply public/local files', 'Load teams/roster/depth.csv from the public/local folder again', async () => {
      const r = await loadLocalLeague(teams);
      if (!r) { spreadsheetScreen(ctx, ['No files found in public/local/.']); return; }
      if (r.playAs !== null && r.playAs !== undefined) prefs.home = r.playAs;
      ctx.onChange();
      spreadsheetScreen(ctx, [`Loaded: ${r.loaded.join(', ')}`, ...summarizeProblems(r.problems)]);
    }),
  ];
  screens.frame('menu-screen', el('div.logo-small', { html: 'SPREADSHEETS' }),
    report.length ? el('div.ss-report', {}, report.map((l) => el('div', { text: l }))) : null,
    el('div.menu-list', {}, items),
    el('div.setup-help', { html: 'Edit in Numbers, Excel or Google Sheets and save as CSV. league.csv keeps every sheet in one file: each section starts with a [NAME] row. &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { onBack: ctx.onBack });
}

function summarizeProblems(problems) {
  if (!problems?.length) return ['No problems.'];
  return [`${problems.length} problem${problems.length > 1 ? 's' : ''}:`, ...problems.slice(0, 8), ...(problems.length > 8 ? [`…and ${problems.length - 8} more`] : [])];
}

async function importCSV(ctx, name, text) {
  const { teams, prefs } = ctx;
  if (isLeagueBook(text)) {
    const r = importLeagueBook(teams, text, { league: LEAGUE });
    if (r.playAs !== null) prefs.home = r.playAs;
    await attachLogos(teams);
    ctx.onChange();
    return [`${name}: the whole league —`, ...r.lines, ...summarizeProblems(r.problems)];
  }
  let rows;
  try { rows = parseCSV(text); } catch (e) { return [`${name}: couldn't read it (${e.message})`]; }
  const extra = extraKind(rows);
  if (extra && extra !== 'schedule') {
    const fn = { retired: importRetired, coaches: importCoaches, uniforms: importUniforms, stadiums: (t, r) => importStadiums(t, r, LEAGUE) }[extra];
    const r = fn(teams, rows);
    ctx.onChange();
    return [`${name}: ${extra} — ${r.count} rows applied.`, ...summarizeProblems(r.skipped)];
  }
  if (extra === 'schedule') return [`${name}: a schedule — import it from the franchise (Season → Schedule & Results, Y) before week 1.`];
  const kind = csvKind(rows);
  if (!kind) return [`${name}: not a league spreadsheet (check the header row).`];
  const lines = [];
  if (kind === 'teams') {
    const r = importTeamsRows(teams, rows);
    if (r.playAs !== null) prefs.home = r.playAs;
    await attachLogos(teams);
    lines.push(`${name}: updated ${rows.length} teams.`, ...summarizeProblems(r.skipped));
  } else if (kind === 'roster') {
    const r = importRosterRows(teams, rows);
    lines.push(`${name}: imported ${r.imported} players for ${r.teams.length} team${r.teams.length === 1 ? '' : 's'}.`, ...summarizeProblems(r.skipped));
  } else {
    const problems = importDepthRows(teams, rows);
    lines.push(`${name}: applied ${rows.length} depth chart rows.`, ...summarizeProblems(problems));
  }
  ctx.onChange();
  return lines;
}
