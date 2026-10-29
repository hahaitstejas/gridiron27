// League save format (pure logic): the whole league — teams, colors, logos, rosters, depth charts —
// as plain JSON, plus which team the player uses. Browser storage lives in storage.js.
import { setNextPlayerId } from './generator.js';
import { overall } from './positions.js';
import { buildDepthChart } from './depthChart.js';

export const SAVE_VERSION = 1;

/** Plain-JSON snapshot of the league. Logo images travel as data URLs (logo.dataUrl). */
export function serializeLeague(teams, { name = 'My League', playAs = null } = {}) {
  return {
    version: SAVE_VERSION,
    name,
    savedAt: new Date().toISOString(),
    playAs,
    teams: teams.map((t) => {
      const { _img, ...logo } = t.logo || {};
      return {
        id: t.id, city: t.city, name: t.name, abbr: t.abbr, conference: t.conference, division: t.division,
        colors: { ...t.colors }, uniform: t.uniform ? { ...t.uniform } : undefined, logo,
        roster: t.roster.map((p) => { const { _tmp, ...q } = p; return { ...q, ratings: { ...p.ratings } }; }),
        depth: Object.fromEntries(Object.entries(t.depth || {}).map(([k, v]) => [k, [...v]])),
      };
    }),
  };
}

/**
 * Rebuild teams from a snapshot. Bad or missing pieces are repaired (missing depth slots are rebuilt,
 * unknown ids dropped, overall recomputed) so an edited or older file still loads.
 */
export function deserializeLeague(data) {
  if (!data || !Array.isArray(data.teams) || !data.teams.length) throw new Error('Not a Gridiron 27 league file');
  let maxId = 0;
  const teams = data.teams.map((t, i) => {
    const roster = (t.roster || []).map((p) => {
      const q = { ...p, ratings: { ...p.ratings } };
      q.ovr = overall(q);
      maxId = Math.max(maxId, q.id || 0);
      return q;
    });
    const ids = new Set(roster.map((p) => p.id));
    const auto = buildDepthChart(roster);
    const depth = {};
    for (const slot of Object.keys(auto)) {
      const saved = (t.depth?.[slot] || []).filter((id) => ids.has(id));
      depth[slot] = saved.length ? saved : auto[slot];
    }
    return { ...t, id: t.id ?? i, colors: { ...t.colors }, logo: { ...t.logo }, roster, depth };
  });
  setNextPlayerId(maxId + 1);
  return { teams, playAs: data.playAs ?? null, name: data.name || 'My League' };
}

/** Next free jersey number on a team (keeps `prefer` if it's free). */
export function freeNumber(team, prefer) {
  const used = new Set(team.roster.map((p) => p.number));
  if (prefer !== undefined && prefer >= 0 && prefer <= 99 && !used.has(prefer)) return prefer;
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return 0;
}
