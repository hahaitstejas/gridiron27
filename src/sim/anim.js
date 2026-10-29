import { wrapAngle } from '../core/math.js';
// Chooses a high-level animation state for each player. The renderer turns these into poses.
const HOLD = new Set(['throw', 'catch', 'tackle', 'getup', 'juke', 'spin', 'stiffarm', 'truck', 'hurdle', 'dive', 'slide', 'tackle_dive', 'hitstick', 'strip', 'stumble', 'swat', 'celebrate']);
const HOLD_TIME = { throw: 0.45, catch: 0.35, getup: 0.6, stumble: 0.5, swat: 0.5, tackle: 0.6, celebrate: 99 };

export function updateAnimations(sim, dt) {
  for (const p of sim.players) {
    const speed = Math.hypot(p.vx, p.vz);
    p.cycle += dt * (2.2 + speed * 1.05);
    // Face movement direction unless a task set an explicit facing target.
    if (p.state === 'active' && !p.engagement && sim.state !== 'presnap') {
      let target;
      if (p.face) target = Math.atan2(p.face.z - p.z, p.face.x - p.x);
      else if (speed > 0.6) target = Math.atan2(p.vz, p.vx);
      if (target !== undefined && !(p.move && (p.move.type === 'spin'))) {
        const d = wrapAngle(target - p.facing);
        const rate = 9 * dt;
        p.facing += Math.abs(d) < rate ? d : Math.sign(d) * rate;
      }
      if (p.move && p.move.type === 'spin') p.facing = p.move.startFacing + (p.move.t / p.move.dur) * Math.PI * 2;
    }
    if (p.state === 'down') { if (p.anim !== 'tackle' || p.animT > 0.6) p.anim = 'down'; continue; }
    if (p.state === 'tackled') { p.anim = 'falling'; continue; }
    if (sim.state === 'presnap') continue;
    if (p.engagement) { p.anim = 'block'; continue; }
    if (p.move) { p.anim = p.move.type; continue; }
    if (HOLD.has(p.anim) && p.animT < (HOLD_TIME[p.anim] ?? 0.4)) continue;
    if (p.anim === 'stance_qb' || p.anim === 'stance2' || p.anim === 'stance3') {
      if (sim.state === 'live' && sim.t > 0.05) { p.anim = 'run'; p.animT = 0; }
      else continue;
    }
    if (p.wantsBall && sim.ball.state === 'air' && sim.ball.T - sim.ball.t < 0.6) { setAnim(p, 'reach'); continue; }
    if (p.task?.type === 'pass_block' && speed < 2.5) { setAnim(p, 'passset'); continue; }
    if (sim.state === 'dead' && sim.result?.touchdown === p.team && p.id === sim.result.carrierId) { setAnim(p, 'celebrate'); continue; }
    // Backpedal when moving opposite to facing.
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const along = speed > 0.5 ? (p.vx * fx + p.vz * fz) / speed : 1;
    if (speed < 0.4) setAnim(p, 'idle');
    else if (along < -0.3) setAnim(p, 'backpedal');
    else if (Math.abs(along) <= 0.3) setAnim(p, 'shuffle');
    else setAnim(p, 'run');
  }
}

function setAnim(p, a) {
  if (p.anim !== a) { p.anim = a; p.animT = 0; }
}
