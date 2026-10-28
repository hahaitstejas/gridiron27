import { HALF_WIDTH } from '../core/constants.js';
import { moveDir, seek } from '../sim/movement.js';
import { startMove } from '../sim/tackling.js';

const ANGLES = [];
for (let a = -85; a <= 85; a += 10) ANGLES.push((a * Math.PI) / 180);

/** AI for whoever carries the ball: find running lanes and use moves on nearby tacklers. */
export function carrierAI(sim, p, dt) {
  if (sim.isHumanControlled(p) && p.userActive) return;
  if (p.state !== 'active') return;
  if (p.recoverAt && sim.t > p.recoverAt && !p.move) { p.speedCap = 1; p.recoverAt = 0; }
  const t = p.task;
  // Initial aiming point (run hole) for handoffs.
  if (t.aim && sim.t < t.aimUntil) {
    const d = seek(p, t.aim.x, t.aim.z, 1, 0.1);
    if (d < 0.8) t.aimUntil = 0;
    aiMoves(sim, p);
    return;
  }
  const td = sim.teamDir(p.team);
  const base = td > 0 ? 0 : Math.PI;
  const opp = sim.players.filter((d) => d.team !== p.team && d.state !== 'down' && d.state !== 'tackled');
  let bestA = base, bestS = -1e9;
  for (const a0 of ANGLES) {
    const a = base + a0;
    const dx = Math.cos(a), dz = Math.sin(a);
    let s = Math.cos(a0) * 1.4;
    for (const r of [1.5, 3.5, 6.5]) {
      const px = p.x + dx * r, pz = p.z + dz * r;
      let md = 99;
      for (const d of opp) {
        const ox = d.x + d.vx * 0.25, oz = d.z + d.vz * 0.25;
        let dd = Math.hypot(ox - px, oz - pz);
        if (d.engagement) dd += 1.5;
        if (dd < md) md = dd;
      }
      s -= Math.max(0, 3.2 - md) * (r < 2 ? 0.9 : r < 4 ? 0.6 : 0.3);
      if (Math.abs(pz) > HALF_WIDTH - 1) s -= 1.5 + (Math.abs(pz) - HALF_WIDTH + 1);
    }
    if (t.lastA !== undefined) s -= Math.abs(a - t.lastA) * 0.25;
    if (s > bestS) { bestS = s; bestA = a; }
  }
  t.lastA = bestA;
  moveDir(p, Math.cos(bestA), Math.sin(bestA), 1);
  aiMoves(sim, p);
}

function aiMoves(sim, p) {
  if (p.move || (p.moveCd || 0) > sim.t) return;
  const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
  for (const d of sim.players) {
    if (d.team === p.team || d.state !== 'active' || d.engagement) continue;
    const dx = d.x - p.x, dz = d.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.3 || dist < 0.8) continue;
    const front = (dx * fx + dz * fz) / dist;
    if (front < 0.35) continue;
    if (p.lastMoveVs === d.id) continue;
    p.lastMoveVs = d.id;
    const isQB = p.slot === 'QB' && p.team === sim.offIdx;
    if (isQB && sim.rng.chance(0.6)) { startMove(sim, p, 'slide'); return; }
    if (!sim.rng.chance(0.3)) return;
    const agi = sim.R(p, 'agility'), str = sim.R(p, 'strength'), btk = sim.R(p, 'breakTackle');
    const choice = sim.rng.weighted(
      [['juke', agi], ['spin', agi * 0.6], ['stiffarm', str * 0.8], ['truck', (str + btk) / 2 * (0.4 + p.bulk)]],
      (c) => c[1] - 40,
    )[0];
    const side = Math.sign(-fz * dx + fx * dz) || 1; // which side the defender is on
    startMove(sim, p, choice, -side);
    return;
  }
}
