import { viaRelay } from './storage.js';
import { parseCSV, importRosterRows, importTeamsRows, importDepthRows } from './csv.js';
import { importRetired, importCoaches, importUniforms, importStadiums } from './extraCSV.js';
import { LEAGUE } from './leagueInfo.js';
import { isLeagueBook, importLeagueBook } from './leagueBook.js';

/** Franchise-only sections of public/local/league.csv (free agents, schedule), read when a franchise starts. */
export const localBook = { freeAgents: null, schedule: null, loaded: false };

// Browser-only: loads the optional, git-ignored league files from public/local/ at startup.
//   teams.csv  -> names, colors, logos, which team you play as
//   roster.csv -> full or partial rosters
//   depth.csv  -> depth charts by jersey number
//   logos/*    -> optional logo images referenced from teams.csv (logo_image column)
// Files are applied in that order. Run `npm run export-league` to create editable copies.

async function fetchCSV(path, firstCol) {
  // The offline single-file build opens from disk, where fetch can't read files: saves/imports cover that case.
  if (location.protocol === 'file:') return null;
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    // The dev server answers unknown paths with index.html, so make sure it's really our CSV.
    if (!new RegExp(`^\\s*${firstCol}\\s*,`, 'i').test(text)) return null;
    return parseCSV(text);
  } catch {
    return null;
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = viaRelay(src); // a web URL in logo_image goes through the game's own server (storage.js)
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function fetchText(path) {
  if (location.protocol === 'file:') return null;
  try { const res = await fetch(path, { cache: 'no-store' }); if (!res.ok) return null; const t = await res.text(); return /<html/i.test(t.slice(0, 200)) ? null : t; } catch { return null; }
}

export async function loadLocalLeague(teams) {
  const summary = { loaded: [], playAs: null, rosterTeams: [], problems: [] };
  // One file for everything (league.csv, see leagueBook.js): used instead of the separate files when it's there.
  const book = await fetchText('/local/league.csv');
  if (book && isLeagueBook(book)) {
    const r = importLeagueBook(teams, book, { league: LEAGUE });
    summary.loaded.push(`league.csv (${r.lines.join(', ')})`);
    summary.playAs = r.playAs;
    summary.problems.push(...r.problems);
    await Promise.all(r.logoImages.map(async ({ team, file }) => {
      const img = await loadImage(/^(https?:|data:)/i.test(file) ? file : `/local/logos/${file}`);
      if (img) team.logo._img = img; else summary.problems.push(`logo image not found: logos/${file}`);
    }));
    await Promise.all(r.leagueImages.map(async ({ target, file }) => {
      const img = await loadImage(/^(https?:|data:)/i.test(file) ? file : `/local/logos/${file}`);
      if (!img) { summary.problems.push(`league logo image not found: ${file}`); return; }
      if (target === 'league') LEAGUE.logo._img = img; else if (LEAGUE.confLogos?.[target]) LEAGUE.confLogos[target]._img = img;
    }));
    Object.assign(localBook, { freeAgents: r.freeAgents, schedule: r.schedule, loaded: true });
    console.info('[Gridiron 27] Local league book:', summary.loaded.join(', '), summary.problems);
    return summary;
  }
  const teamRows = await fetchCSV('/local/teams.csv', 'id');
  if (teamRows) {
    const r = importTeamsRows(teams, teamRows);
    summary.loaded.push('teams');
    summary.playAs = r.playAs;
    summary.problems.push(...r.skipped);
    await Promise.all(r.logoImages.map(async ({ team, file }) => {
      const img = await loadImage(/^(https?:|data:)/i.test(file) ? file : `/local/logos/${file}`);
      if (img) team.logo._img = img; else summary.problems.push(`logo image not found: logos/${file}`);
    }));
  }
  const rosterRows = await fetchCSV('/local/roster.csv', 'team');
  if (rosterRows) {
    const r = importRosterRows(teams, rosterRows);
    summary.loaded.push(`roster (${r.imported} players)`);
    summary.rosterTeams = r.teams;
    summary.problems.push(...r.skipped);
  }
  const depthRows = await fetchCSV('/local/depth.csv', 'team');
  if (depthRows) {
    summary.problems.push(...importDepthRows(teams, depthRows));
    summary.loaded.push('depth charts');
  }
  // The extra spreadsheets (extraCSV.js), if they're there.
  for (const [file, first, fn, label] of [['retired_numbers.csv', 'team', importRetired, 'retired numbers'], ['coaches.csv', 'team', importCoaches, 'coaches'],
    ['uniforms.csv', 'team', importUniforms, 'uniforms'], ['stadiums.csv', 'team', (t, r) => importStadiums(t, r, LEAGUE), 'stadiums']]) {
    const rows = await fetchCSV(`/local/${file}`, first);
    if (rows) { const r = fn(teams, rows); summary.loaded.push(label); summary.problems.push(...r.skipped); }
  }
  if (!summary.loaded.length) return null;
  console.info('[Gridiron 27] Local league files:', summary.loaded.join(', '), summary.problems);
  return summary;
}
