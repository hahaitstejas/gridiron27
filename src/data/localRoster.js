import { parseCSV, importRosterRows } from './csv.js';

/**
 * Optional local override: if public/local/roster.csv exists (git-ignored, so personal rosters
 * never leave your machine), import it at startup. Returns the import summary or null.
 */
export async function loadLocalRoster(teams, url = '/local/roster.csv') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    // The dev server answers unknown paths with index.html, so check it's really our CSV.
    if (!/^\s*team\s*,/i.test(text)) return null;
    const summary = importRosterRows(teams, parseCSV(text));
    console.info(`[Gridiron 27] Local roster: imported ${summary.imported} players for ${summary.teams.join(', ')}`, summary.skipped);
    return summary;
  } catch {
    return null;
  }
}
