import { clamp } from '../core/math.js';
import { flightTime, predictPos, pressureOn, startThrow, maxThrowDist } from '../sim/passing.js';
import { ROUTES } from '../data/routes.js';

/** Rate how open a receiver will be when a throw arrives. Higher is better (yards of separation-ish). */
export function evaluateTarget(sim, qb, r, kind = 'bullet') {
  const thp = sim.R(qb, 'throwPower');
  let pred = { x: r.x, z: r.z };
  let T = 0.5;
  for (let i = 0; i < 3; i++) {
    T = flightTime(Math.hypot(pred.x - qb.x, pred.z - qb.z), kind, thp);
    pred = predictPos(sim, r, T);
  }
  const dist = Math.hypot(pred.x - qb.x, pred.z - qb.z);
  if (dist > maxThrowDist(thp) * 0.95) return { score: -9, pred, T, dist };
  let sep = 99;
  let lane = 0;
  const lx = pred.x - qb.x, lz = pred.z - qb.z;
  const ll = Math.hypot(lx, lz) || 1;
  for (const d of sim.players) {
    if (d.team === qb.team || d.state === 'down') continue;
    const dpx = d.x + d.vx * T * 0.5, dpz = d.z + d.vz * T * 0.5;
    const reach = d.maxSpeed * Math.max(0, T - 0.25) * 0.55;
    const s = Math.hypot(dpx - pred.x, dpz - pred.z) - reach * 0.35;
    if (s < sep) sep = s;
    // Defenders sitting in the throwing lane.
    const proj = ((d.x - qb.x) * lx + (d.z - qb.z) * lz) / ll;
    if (proj > 2 && proj < ll - 1.5) {
      const off = Math.abs((d.x - qb.x) * lz - (d.z - qb.z) * lx) / ll;
      const h = kind === 'lob' ? 0.4 : 1;
      if (off < 1.3) lane += (1.3 - off) * h * (d.engagement ? 0.3 : 1);
    }
  }
  const gain = (pred.x - sim.losX) * sim.dir;
  let score = sep - lane * 1.6 + clamp(gain, -5, 30) * 0.04;
  if (sim.firstDownX !== null && (pred.x - sim.firstDownX) * sim.dir >= 0) score += 0.4;
  if (Math.abs(pred.z) > 25.5) score -= 2;
  return { score, pred, T, dist, gain };
}

const QUICK = new Set(['slant', 'quick_out', 'hitch', 'flat', 'swing', 'screen', 'arrow', 'drag', 'stick', 'sit', 'shallow', 'angle', 'whip']);
const DEEP = new Set(['go', 'fade', 'post', 'corner', 'seam', 'wheel', 'skinny_post', 'out_up', 'deep_out', 'comeback']);

function routeDeveloped(sim, r) {
  const t = r.task;
  if (!t || (t.type !== 'route' && t.type !== 'catch')) return false;
  if (t.settled) return true;
  const minT = QUICK.has(t.name) ? 0.65 : DEEP.has(t.name) ? 1.9 : 1.35;
  return sim.t > minT && t.idx >= 1;
}

export function qbDecide(sim, qb, dt) {
  if (sim.passThrown || sim.pendingThrow || sim.qbCrossed) return;
  if ((qb._decT = (qb._decT || 0) - dt) > 0) return;
  qb._decT = 0.1;
  const t = sim.t;
  const awr = sim.R(qb, 'awareness');
  const pressure = pressureOn(sim, qb, true);
  const task = qb.task;
  if (t < 0.55 && pressure < 0.7) return;

  const order = (sim.offPlay.read || []).map((s) => sim.bySlot(sim.offIdx, s)).filter(Boolean);
  for (const p of sim.players) if (p.team === sim.offIdx && p.task?.type === 'route' && !order.includes(p)) order.push(p);
  const readTime = 0.5 - awr * 0.0025;
  const seen = Math.max(1, Math.floor((t - 0.6) / readTime) + 1);
  let threshold = 3.0 - clamp((t - 0.9) / 2.6, 0, 1) * 1.8;
  if (pressure > 0.55) threshold = Math.min(threshold, 1.3);
  const noise = (100 - awr) * 0.02;

  let pick = null, best = null;
  for (let i = 0; i < order.length; i++) {
    const r = order[i];
    if (!routeDeveloped(sim, r) || r.state !== 'active') continue;
    const deep = r.task && DEEP.has(r.task.name) && r.task.name !== 'comeback';
    const kind = deep ? 'lob' : 'bullet';
    const ev = evaluateTarget(sim, qb, r, kind);
    const s = ev.score + sim.rng.gauss(0, noise);
    if (!pick && i < seen && s > threshold) pick = { r, kind, s };
    if (!best || s > best.s) best = { r, kind, s };
  }
  if (pick) {
    startThrow(sim, qb, pick.r, pick.kind);
    return;
  }
  // Under heavy pressure or holding too long: best available, scramble or throw it away.
  if ((pressure > 0.7 && t > 1.2) || t > 4.2) {
    if (best && best.s > 0.6) { startThrow(sim, qb, best.r, best.kind); return; }
    const mobile = sim.R(qb, 'speed') > 76;
    if (mobile && task.phase !== 'scramble' && pressure > 0.5) {
      task.phase = 'scramble';
      task.side = sim.rng.chance(0.5) ? 1 : -1;
      return;
    }
    if (t > 5.2 || pressure > 0.92) startThrow(sim, qb, null, 'throwaway');
  }
}
