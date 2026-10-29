// Roster edits that keep depth charts consistent (pure logic, used by the roster editor).
import { DEPTH_SLOTS, buildDepthChart } from './depthChart.js';
import { overall } from './positions.js';
import { freeNumber } from './league.js';

/** Slots whose first-choice position is `pos` (where a player of that position belongs). */
const homeSlots = (pos) => Object.keys(DEPTH_SLOTS).filter((s) => DEPTH_SLOTS[s][0] === pos);

/** Refill any depth slot that ended up empty. */
function repairDepth(team) {
  const auto = buildDepthChart(team.roster);
  for (const slot of Object.keys(auto)) if (!team.depth[slot]?.length) team.depth[slot] = auto[slot];
}

function dropFromDepth(team, id, keep = () => false) {
  for (const slot of Object.keys(team.depth)) if (!keep(slot)) team.depth[slot] = team.depth[slot].filter((x) => x !== id);
}

/** Add a player to a team (end of the depth chart at his position), fixing a clashing number. */
export function addPlayer(team, p) {
  p.number = freeNumber(team, p.number);
  p.ovr = overall(p);
  team.roster.push(p);
  for (const slot of homeSlots(p.pos)) (team.depth[slot] ||= []).push(p.id);
  repairDepth(team);
  return p;
}

/** Remove a player from the team and every depth slot. */
export function releasePlayer(team, id) {
  const i = team.roster.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [p] = team.roster.splice(i, 1);
  dropFromDepth(team, id);
  repairDepth(team);
  return p;
}

export function tradePlayer(from, to, id) {
  const p = releasePlayer(from, id);
  if (p) { delete p.pinned; addPlayer(to, p); }
  return p;
}

/** New position: leave slots he can't play, join the ones for the new position. */
export function changePosition(team, p, pos) {
  if (p.pos === pos) return;
  p.pos = pos;
  p.ovr = overall(p);
  dropFromDepth(team, p.id, (slot) => DEPTH_SLOTS[slot].includes(pos));
  for (const slot of homeSlots(pos)) if (!team.depth[slot]?.includes(p.id)) (team.depth[slot] ||= []).push(p.id);
  repairDepth(team);
}
