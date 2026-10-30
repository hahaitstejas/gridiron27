import { parseCSV, importRosterRows, importTeamsRows, importDepthRows } from './csv.js';

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
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadLocalLeague(teams) {
  const summary = { loaded: [], playAs: null, rosterTeams: [], problems: [] };
  const teamRows = await fetchCSV('/local/teams.csv', 'id');
  if (teamRows) {
    const r = importTeamsRows(teams, teamRows);
    summary.loaded.push('teams');
    summary.playAs = r.playAs;
    summary.problems.push(...r.skipped);
    await Promise.all(r.logoImages.map(async ({ team, file }) => {
      const img = await loadImage(`/local/logos/${file}`);
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
  if (!summary.loaded.length) return null;
  console.info('[Gridiron 27] Local league files:', summary.loaded.join(', '), summary.problems);
  return summary;
}
