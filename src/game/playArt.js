// Pre-snap play art on the field (hold RT at the line in a one-player game): the human side's routes, run path
// and blocks on offense; zones, man matchups, rushers and blitzers on defense. Pure: returns world-space shapes
// for the renderer (render/playArt.js), read from the play the sim will actually run (audibles and hot routes
// included, receivers where they stand now).
import { ROUTES } from '../data/routes.js';
import { ZONES } from '../ai/zones.js';
import { matchMan } from '../ai/defense.js';

// Receiver colors follow their button icons.
export const ART_COLORS = { A: '#3ddc5a', B: '#ff4a4a', X: '#3d8bff', Y: '#ffd23d', RB: '#e6e6e6', run: '#ff6a3d', block: '#c9d2e0',
  deepZone: '#3d8bff', zone: '#ffd23d', man: '#c08cff', rush: '#ff9b6b', blitz: '#ff3b3b', spy: '#ff9df5' };
const OL = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
const TAIL = 7; // yards a "keep running" route is drawn past its last break

/**
 * Shapes for `team`'s side of the sim's play: { lines: [{ pts: [{x, z}], color, dashed, head, width }],
 * zones: [{ x, z, rx, rz, color }] }.
 */
export function playArt(sim, team) {
  const out = { lines: [], zones: [] };
  if (team === sim.offIdx) offenseArt(sim, out); else defenseArt(sim, out);
  return out;
}

function offenseArt(sim, out) {
  const play = sim.offPlay;
  const routes = play.routes || {};
  const btnOf = {};
  for (const [btn, id] of Object.entries(sim.icons || {})) btnOf[id] = btn;
  const fwd = (p, d, lat = 0) => sim.toWorld(sim.toLocal(p.x, p.z).down + d, sim.toLocal(p.x, p.z).lat + lat);
  for (const p of sim.offense()) {
    const a = routes[p.slot];
    const run = play.type === 'run' && play.run;
    if (run && run.carrier === p.slot) {
      const pts = [{ x: p.x, z: p.z }];
      if (run.mesh) pts.push(sim.toWorld(run.mesh[0], run.mesh[1]));
      const aim = sim.toWorld(run.aim[0], run.aim[1]);
      pts.push(aim, sim.toWorld(run.aim[0] + 6, run.aim[1] + Math.sign(run.aim[1] || 1) * 1.5));
      out.lines.push({ pts, color: ART_COLORS.run, head: true, width: 0.42, dashed: run.style === 'pitch' });
    } else if (p.slot === 'QB') {
      if (play.pa) out.lines.push({ pts: [{ x: p.x, z: p.z }, sim.toWorld(-3, 0.8)], color: ART_COLORS.block, dashed: true, width: 0.2 });
      if (play.boot) out.lines.push({ pts: [{ x: p.x, z: p.z }, sim.toWorld(-6, play.boot * 7)], color: '#ffffff', head: true, dashed: true, width: 0.22 });
    } else if (a && ROUTES[a.replace(/_(l|r)$/, '')]) {
      const r = sim.makeRoute(p, a);
      const pts = [{ x: p.x, z: p.z }, ...r.pts];
      if (ROUTES[r.name].end === 'continue' && pts.length > 2) trimTail(pts);
      out.lines.push({ pts, color: ART_COLORS[btnOf[p.id]] || '#ffffff', head: true, width: 0.32 });
    } else if (a === 'stalk' || OL.has(p.slot) || !a || a === 'block') {
      // Blocking: a short stem and a bar ("T"). Run blocks go forward, pass sets step back.
      const d = play.type === 'run' ? 1.4 : -1.1;
      const end = fwd(p, d);
      out.lines.push({ pts: [{ x: p.x, z: p.z }, end], color: ART_COLORS.block, width: 0.16 });
      out.lines.push({ pts: [fwd(p, d, -0.55), fwd(p, d, 0.55)], color: ART_COLORS.block, width: 0.16 });
    }
  }
}

/** Shorten a route's long "keep running" extension to a readable tail. */
function trimTail(pts) {
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
  if (l > TAIL) pts[pts.length - 1] = { x: a.x + (dx / l) * TAIL, z: a.z + (dz / l) * TAIL };
}

function defenseArt(sim, out) {
  const assign = sim.defPlay.assign || {};
  const man = matchMan(sim);
  const qb = sim.bySlot(sim.offIdx, 'QB');
  const qbAt = qb ? { x: qb.x - sim.dir * 2, z: qb.z } : sim.toWorld(-6, 0);
  for (const d of sim.defense()) {
    const a = assign[d.slot] || '';
    const from = { x: d.x, z: d.z };
    if (a.startsWith('zone:')) {
      const z = ZONES[a.slice(5)];
      if (!z) continue;
      const c = sim.toWorld(z.down, z.lat);
      const color = z.deep ? ART_COLORS.deepZone : ART_COLORS.zone;
      out.zones.push({ x: c.x, z: c.z, rx: z.r * 0.55, rz: z.r * 0.75, color });
      out.lines.push({ pts: [from, c], color, dashed: true, width: 0.18 });
    } else if (a.startsWith('man:')) {
      const r = man.get(d.id);
      if (r) out.lines.push({ pts: [from, { x: r.x, z: r.z }], color: ART_COLORS.man, head: true, width: 0.24 });
    } else if (a === 'rush' || a === 'blitz') {
      const dx = qbAt.x - d.x, dz = qbAt.z - d.z, l = Math.hypot(dx, dz) || 1;
      const reach = Math.min(l - 0.5, a === 'blitz' ? l : 4.5);
      out.lines.push({ pts: [from, { x: d.x + (dx / l) * reach, z: d.z + (dz / l) * reach }], color: a === 'blitz' ? ART_COLORS.blitz : ART_COLORS.rush, head: true, width: a === 'blitz' ? 0.34 : 0.26 });
    } else if (a === 'spy') {
      out.lines.push({ pts: [from, sim.toWorld(3, sim.toLocal(qbAt.x, qbAt.z).lat)], color: ART_COLORS.spy, dashed: true, head: true, width: 0.22 });
    }
  }
}
