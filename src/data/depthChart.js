import { overall } from './positions.js';

// Depth chart slots and which roster positions can fill them (in preference order).
export const DEPTH_SLOTS = {
  QB: ['QB'], HB: ['HB', 'FB'], FB: ['FB', 'HB', 'TE'], WR: ['WR', 'TE', 'HB'], TE: ['TE', 'FB', 'T'],
  LT: ['T', 'G'], LG: ['G', 'C', 'T'], C: ['C', 'G'], RG: ['G', 'C', 'T'], RT: ['T', 'G'],
  LE: ['DE', 'OLB', 'DT'], RE: ['DE', 'OLB', 'DT'], DT: ['DT', 'DE'], LOLB: ['OLB', 'MLB', 'DE'], MLB: ['MLB', 'OLB'],
  ROLB: ['OLB', 'MLB', 'DE'], CB: ['CB', 'FS', 'SS'], FS: ['FS', 'SS', 'CB'], SS: ['SS', 'FS', 'CB'], K: ['K', 'P'], P: ['P', 'K'],
  KR: ['WR', 'HB', 'CB'], PR: ['WR', 'CB', 'HB'],
};
const SLOT_DEPTH = { WR: 5, CB: 5, DT: 3 };

/** Builds {slot: [playerId,...]} ordered best first. OL/edge pairs split so L and R starters differ. */
export function buildDepthChart(roster) {
  const depth = {};
  const byPos = (positions) => {
    const list = [];
    positions.forEach((pos, pri) => {
      // Pinned (imported) players start ahead of everyone at their own position, in file order.
      for (const p of roster) if (p.pos === pos) list.push({ p, score: overall({ ...p, pos: positions[0] }) - pri * 6 + (p.pinned && pri === 0 ? 1000 - p.pinned : 0) });
    });
    list.sort((a, b) => b.score - a.score);
    return list.map((x) => x.p.id);
  };
  for (const slot of Object.keys(DEPTH_SLOTS)) depth[slot] = byPos(DEPTH_SLOTS[slot]).slice(0, SLOT_DEPTH[slot] ?? 4);
  // Pairs: make the 2nd best tackle/guard/end/olb the "right" starter.
  const pair = (l, r, pos) => {
    const list = byPos(DEPTH_SLOTS[l]).filter((id) => roster.find((p) => p.id === id).pos === pos);
    if (list.length >= 2) {
      depth[l] = [list[0], ...depth[l].filter((x) => x !== list[0] && x !== list[1])];
      depth[r] = [list[1], ...depth[r].filter((x) => x !== list[0] && x !== list[1])];
    }
  };
  pair('LT', 'RT', 'T');
  pair('LG', 'RG', 'G');
  pair('LE', 'RE', 'DE');
  pair('LOLB', 'ROLB', 'OLB');
  // KR/PR: fastest players
  const fast = [...roster].filter((p) => ['WR', 'HB', 'CB'].includes(p.pos)).sort((a, b) => b.ratings.speed - a.ratings.speed);
  depth.KR = fast.slice(0, 3).map((p) => p.id);
  depth.PR = fast.slice(0, 3).map((p) => p.id);
  return depth;
}

/** Roster players who can play `slot`, best first by their overall at that spot, excluding ones listed. */
export function eligibleForSlot(team, slot) {
  const positions = DEPTH_SLOTS[slot] || [slot];
  const listed = new Set(team.depth[slot] || []);
  return team.roster
    .filter((p) => positions.includes(p.pos) && !listed.has(p.id))
    .sort((a, b) => slotRating(b, slot) - slotRating(a, slot));
}

/** A player's overall rating if he plays `slot`. */
export function slotRating(p, slot) {
  return overall({ ...p, pos: (DEPTH_SLOTS[slot] || [p.pos])[0] });
}

/** Move a player to position `to` in a slot's order (adding him if he isn't listed). */
export function placeInDepth(team, slot, id, to) {
  const list = (team.depth[slot] || []).filter((x) => x !== id);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, id);
  team.depth[slot] = list;
  return list;
}

/** Take a player off a slot (a slot always keeps at least one player). */
export function removeFromDepth(team, slot, id) {
  const list = team.depth[slot] || [];
  if (list.length > 1) team.depth[slot] = list.filter((x) => x !== id);
  return team.depth[slot];
}
