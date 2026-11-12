// Team captains (pure data). A captain wears the "C" badge on his jersey (the uniform's `captain_patch`, default a rounded
// navy-style patch with a C). Only a few players per team are captains: by default the starting QB, the best defender and the
// best other offensive player; the roster spreadsheet's `captain` column (Y / N) overrides it.
const DEFENSE = new Set(['DE', 'DT', 'OLB', 'MLB', 'CB', 'FS', 'SS']);
const SPECIAL = new Set(['K', 'P']);
export const MAX_CAPTAINS = 6;

/** Pick the default captains of a team (clears any others). */
export function assignCaptains(team) {
  const roster = team.roster || [];
  for (const p of roster) delete p.captain;
  const best = (list) => list.slice().sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0) || (b.proYears ?? 0) - (a.proYears ?? 0))[0];
  const qb = best(roster.filter((p) => p.pos === 'QB'));
  const d = best(roster.filter((p) => DEFENSE.has(p.pos)));
  const o = best(roster.filter((p) => p !== qb && !DEFENSE.has(p.pos) && !SPECIAL.has(p.pos) && p.pos !== 'QB'));
  for (const p of [qb, d, o]) if (p) p.captain = true;
  return team;
}
export const hasCaptain = (team) => (team.roster || []).some((p) => p.captain);
export const captainsOf = (team) => (team.roster || []).filter((p) => p.captain);
