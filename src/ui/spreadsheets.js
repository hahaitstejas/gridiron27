import { el } from './nav.js';
import { parseCSV, importRosterRows, importTeamsRows, importDepthRows, exportRosterCSV, exportTeamsCSV, exportDepthCSV } from '../data/csv.js';
import { loadLocalLeague } from '../data/localLeague.js';
import { downloadFile, pickFile } from '../data/storage.js';
import { attachLogos } from './league.js';

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
    item('Export all three', 'Download teams.csv, roster.csv and depth.csv', exportAll),
    item('Export teams.csv', 'Names, colors, conferences, logos, your team', () => downloadFile('teams.csv', exportTeamsCSV(teams, prefs.home), 'text/csv')),
    item('Export roster.csv', 'Every player with all ratings', () => downloadFile('roster.csv', exportRosterCSV(teams), 'text/csv')),
    item('Export depth.csv', 'Depth charts by jersey number', () => downloadFile('depth.csv', exportDepthCSV(teams), 'text/csv')),
    item('Import a spreadsheet…', 'teams.csv, roster.csv or depth.csv (import teams → roster → depth)', async () => {
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
    el('div.setup-help', { html: 'Edit the files in Numbers, Excel or Google Sheets and save as CSV. &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { onBack: ctx.onBack });
}

function summarizeProblems(problems) {
  if (!problems?.length) return ['No problems.'];
  return [`${problems.length} problem${problems.length > 1 ? 's' : ''}:`, ...problems.slice(0, 8), ...(problems.length > 8 ? [`…and ${problems.length - 8} more`] : [])];
}

async function importCSV(ctx, name, text) {
  const { teams, prefs } = ctx;
  let rows;
  try { rows = parseCSV(text); } catch (e) { return [`${name}: couldn't read it (${e.message})`]; }
  const kind = csvKind(rows);
  if (!kind) return [`${name}: not a teams, roster or depth spreadsheet (check the header row).`];
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
