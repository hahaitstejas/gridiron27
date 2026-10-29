import { clamp } from '../core/math.js';
import { seek, stop, moveDir } from '../sim/movement.js';
import { carrierAI } from './carrier.js';
import { qbDecide } from './qb.js';

const OFF_TASKS = new Set(['pitch_trail', 'pa_fake', 'qb_pass', 'qb_handoff', 'qb_fake', 'pass_block', 'run_block', 'stalk', 'route', 'catch', 'run_path', 'carrier', 'escort', 'scramble']);

export function runOffenseAI(sim, dt) {
  if ((sim._protT = (sim._protT || 0) - dt) <= 0) {
    sim._protT = 0.1;
    assignProtection(sim);
  }
  for (const p of sim.players) {
    if (!p.task || !OFF_TASKS.has(p.task.type)) continue;
    if (p.state !== 'active' || p.engagement) continue;
    p.face = null;
    switch (p.task.type) {
      case 'qb_pass': qbPass(sim, p, dt); break;
      case 'qb_handoff': qbHandoff(sim, p, dt); break;
      case 'qb_fake': seek(p, p.task.to.x, p.task.to.z, 0.6); break;
      case 'pass_block': passBlock(sim, p); break;
      case 'pa_fake':
        if (seek(p, p.task.to.x, p.task.to.z, 0.7, 0.4) < 0.6 || sim.t > 1.3) p.task = { type: 'pass_block' };
        break;
      case 'run_block': runBlock(sim, p); break;
      case 'stalk': stalk(sim, p); break;
      case 'route': route(sim, p); break;
      case 'catch': catchBall(sim, p); break;
      case 'run_path': runPath(sim, p); break;
      case 'carrier': carrierAI(sim, p, dt); break;
      case 'escort': escort(sim, p); break;
      case 'pitch_trail': pitchTrail(sim, p); break;
    }
  }
}

// ---------- QB ----------
function qbPass(sim, p, dt) {
  const t = p.task;
  const down = sim.dir; // downfield direction along x
  if (!t.start) {
    const play = sim.offPlay;
    t.start = { x: p.x, z: p.z };
    // Bootleg: roll out to one side (offense frame) instead of setting up in the pocket.
    const roll = play.boot ? sim.toWorld(-(t.drop + 1), play.boot * 7) : null;
    t.dropTo = roll ? { x: roll.x, z: roll.z } : { x: p.x - down * t.drop, z: p.z };
    // Play action: show the ball to the back first.
    if (play.pa) { const f = sim.toWorld(-2.6, play.boot ? -play.boot * 1.2 : 0.8); t.fake = { x: f.x, z: f.z, until: 0.65 }; }
  }
  p.face = { x: p.x + down * 20, z: p.z * 0.5 };
  if (sim.ball.state === 'snap') { stop(p); return; }
  if (t.phase === 'drop' && t.fake && sim.t < t.fake.until) {
    seek(p, t.fake.x, t.fake.z, 0.55, 0.3);
    p.face = { x: t.fake.x, z: t.fake.z };
  } else if (t.phase === 'drop') {
    const d = seek(p, t.dropTo.x, t.dropTo.z, sim.offPlay.boot ? 0.85 : 0.7, 0.8);
    if (d < 0.35) { t.phase = 'set'; t.setT = sim.t; }
  } else if (t.phase === 'set') {
    if (sim.offPlay.boot) stop(p); else pocketMove(sim, p, t);
  } else if (t.phase === 'scramble') {
    const side = t.side;
    moveDir(p, down * 0.6, side, 1);
  }
  if (sim.passThrown) { t.phase = 'done'; stop(p); }
  if (!sim.isHumanControlled(p) && sim.ball.state === 'held' && sim.ball.carrier === p.id) qbDecide(sim, p, dt);
}

function pocketMove(sim, p, t) {
  // Slide away from the nearest free rusher but stay in the pocket.
  let tx = 0, tz = 0, threat = 0;
  for (const d of sim.players) {
    if (d.team === p.team || d.engagement || d.state !== 'active') continue;
    const dx = p.x - d.x, dz = p.z - d.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 4.5) { const w = (4.5 - dist) / 4.5; tx += (dx / dist) * w; tz += (dz / dist) * w; threat = Math.max(threat, w); }
  }
  if (threat > 0.05) {
    const base = t.dropTo;
    let nx = clamp(p.x + tx * 2, base.x - 2, base.x + 2);
    let nz = clamp(p.z + tz * 2, base.z - 4, base.z + 4);
    seek(p, nx, nz, 0.6, 0.6);
  } else {
    stop(p);
  }
}

function qbHandoff(sim, p) {
  const play = sim.offPlay;
  const rb = sim.bySlot(sim.offIdx, play.run.carrier);
  if (sim.ball.state === 'snap') { stop(p); return; }
  // Toss: pitch the ball to the back as he flows to the edge.
  if (play.run.style === 'pitch') {
    stop(p);
    if (rb) p.face = { x: rb.x, z: rb.z };
    if (sim.ball.carrier === p.id && sim.ball.state === 'held' && rb && sim.t > 0.3) {
      const b = sim.ball;
      b.state = 'snap'; b.t = 0; b.T = 0.38; b.from = { x: p.x, y: 1.2, z: p.z }; b.carrier = rb.id; b.pitch = true;
      p.anim = 'throw'; p.animT = 0.15;
      p.task = { type: 'qb_fake', to: { x: p.x - sim.dir * 1.5, z: p.z } };
      sim.emit('pitch', { from: p.id, to: rb.id });
    }
    return;
  }
  const mesh = play.run.mesh ? sim.toWorld(play.run.mesh[0] + 0.6, play.run.mesh[1] - (play.run.side || 1) * 0.9) : { x: p.x - sim.dir, z: p.z };
  // Read option: at the mesh the QB reads the backside end: if he crashes on the back, the QB keeps.
  if (play.run.style === 'read' && rb && p.task.read === undefined && sim.t > 0.62 && sim.ball.carrier === p.id && sim.ball.state === 'held' && Math.hypot(rb.x - p.x, rb.z - p.z) < 1.6) {
    p.task.read = p.task.forceKeep || readKeep(sim, rb);
    if (p.task.read) {
      sim.emit('keep', { qb: p.id });
      sim.setRunner(p, 'keep');
      p.task.aim = sim.toWorld(1, -(play.run.side || 1) * 5.5);
      p.task.aimUntil = sim.t + 1.1;
      return;
    }
  }
  seek(p, mesh.x, mesh.z, play.run.style === 'draw' ? 0.55 : 0.75, 0.6);
  if (rb) p.face = play.run.style === 'draw' && sim.t < 0.8 ? { x: p.x + sim.dir * 10, z: p.z } : { x: rb.x, z: rb.z };
  const minT = play.run.style === 'draw' ? 1.0 : play.run.style === 'jet' ? 0.05 : play.run.style === 'read' ? 0.62 : 0.35;
  if (sim.ball.carrier === p.id && sim.ball.state === 'held' && rb && rb.state === 'active' && sim.t > minT && Math.hypot(rb.x - p.x, rb.z - p.z) < 1.3) {
    sim.handedOff = true;
    sim.emit('handoff', { from: p.id, to: rb.id });
    const aim = sim.toWorld(play.run.aim[0], play.run.aim[1]);
    sim.setRunner(rb, 'handoff');
    rb.task.aim = aim;
    rb.task.aimUntil = sim.t + 0.9;
    p.task = { type: 'qb_fake', to: sim.toWorld(sim.toLocal(p.x, p.z).down - 2, -(play.run.side || 1) * 4) };
  }
  // Safety net: if the RB never arrives, the QB keeps it.
  if (sim.t > 2.6 && sim.ball.carrier === p.id && sim.ball.state === 'held') sim.setRunner(p, 'keep');
}

function runPath(sim, p) {
  const play = sim.offPlay;
  const mesh = sim.toWorld(play.run.mesh?.[0] ?? -4, play.run.mesh?.[1] ?? 0);
  const aim = sim.toWorld(play.run.aim[0], play.run.aim[1]);
  if (p.task.phase === 'mesh') {
    // Delay slightly so the QB reaches the mesh point (much longer on draws: sell the pass first).
    if (sim.t < (play.run.style === 'draw' ? 0.6 : play.run.style === 'jet' ? 0 : 0.15)) { stop(p); return; }
    const d = seek(p, mesh.x, mesh.z, 0.7, 0.3);
    if (d < 0.6) p.task.phase = 'hole';
  } else {
    seek(p, aim.x, aim.z, 0.55, 0.1);
  }
}

/** The read on a zone read: the unblocked backside end crashing down on the back means keep. */
function readKeep(sim, rb) {
  const side = sim.offPlay.run.side || 1;
  let end = null, best = 99;
  for (const d of sim.players) {
    if (d.team === sim.offIdx || d.engagement || d.state !== 'active') continue;
    const l = sim.toLocal(d.x, d.z);
    const back = -side * l.lat; // how far toward the backside
    if (back > 2 && back < 9 && l.down < 4 && back < best) { best = back; end = d; }
  }
  if (!end) return false;
  const toRb = Math.hypot(rb.x - end.x, rb.z - end.z);
  const closing = (end.vx * (rb.x - end.x) + end.vz * (rb.z - end.z)) / (toRb || 1);
  return toRb < 3.2 || closing > 3;
}

/** Speed option pitch man: stay a few yards outside and behind the QB. */
function pitchTrail(sim, p) {
  const qb = sim.carrier();
  if (!qb || !qb.task?.option) {
    const l = sim.toLocal(p.x, p.z);
    const w = sim.toWorld(l.down, l.lat + (sim.offPlay.run.side || 1) * 2);
    seek(p, w.x, w.z, 0.6);
    return;
  }
  const l = sim.toLocal(qb.x, qb.z);
  const w = sim.toWorld(l.down - 1.6, l.lat + (sim.offPlay.run.side || 1) * 4);
  seek(p, w.x, w.z, 1, 0.3);
}

// ---------- Protection ----------
function assignProtection(sim) {
  if (sim.offPlay.type !== 'pass' || sim.ballLiveRun) return;
  const qb = sim.bySlot(sim.offIdx, 'QB');
  if (!qb) return;
  const blockers = sim.players.filter((p) => p.team === sim.possTeam && p.task?.type === 'pass_block' && p.state !== 'down');
  // Threats: designed rushers, plus anyone (blitzers, the human's defender) coming at the QB from the box.
  const threats = sim.players.filter((d) => {
    if (d.team === sim.possTeam || d.state === 'down') return false;
    if (d.task?.type === 'rush') return true;
    const dist = Math.hypot(d.x - qb.x, d.z - qb.z);
    if (sim.toLocal(d.x, d.z).down > 6 || dist > 11) return false;
    const closing = ((qb.x - d.x) * d.vx + (qb.z - d.z) * d.vz) / (dist || 1);
    if (sim.isHumanControlled(d) && closing > 2) return true; // the user's blitzer
    return sim.toLocal(d.x, d.z).down < 2.5 && dist < 9;
  });
  const taken = new Map();
  // Keep blockers already engaged on their man.
  for (const b of blockers) if (b.engagement && b.engagement.b === b) { b.task.target = b.engagement.d.id; taken.set(b.engagement.d.id, b); }
  const free = blockers.filter((b) => !(b.engagement && b.engagement.b === b));
  // Greedy: closest blocker-threat pairs first, OL before backs.
  const pairs = [];
  for (const b of free) for (const d of threats) {
    if (taken.has(d.id)) continue;
    let cost = Math.hypot(b.x - d.x, b.z - d.z);
    if (!['LT', 'LG', 'C', 'RG', 'RT'].includes(b.slot)) cost += 1.5;
    // Blockers prefer the man on their side of the center.
    cost += Math.abs(sim.toLocal(b.x, b.z).lat - sim.toLocal(d.x, d.z).lat) * 0.6;
    pairs.push({ b, d, cost });
  }
  pairs.sort((a, c) => a.cost - c.cost);
  const used = new Set();
  for (const b of free) b.task.target = undefined;
  for (const pr of pairs) {
    if (used.has(pr.b) || taken.has(pr.d.id)) continue;
    used.add(pr.b);
    taken.set(pr.d.id, pr.b);
    pr.b.task.target = pr.d.id;
  }
}

function passBlock(sim, p) {
  const qb = sim.bySlot(sim.offIdx, 'QB');
  const tgt = p.task.target !== undefined ? sim.players[p.task.target] : null;
  if (!p.task.home) {
    const l = sim.toLocal(p.x, p.z);
    p.task.home = sim.toWorld(Math.min(l.down - 1.2, -1.5), l.lat * 1.1);
  }
  if (tgt && qb && !tgt.engagement) {
    let ux = qb.x - tgt.x, uz = qb.z - tgt.z;
    const ul = Math.hypot(ux, uz) || 1;
    const px = tgt.x + (ux / ul) * 0.9, pz = tgt.z + (uz / ul) * 0.9;
    // Never chase past the line of scrimmage.
    const lx = sim.losX - sim.dir * 0.3;
    const cx = sim.dir > 0 ? Math.min(px, lx) : Math.max(px, lx);
    seek(p, cx, pz, 0.85, 0.5);
    p.face = { x: tgt.x, z: tgt.z };
  } else {
    seek(p, p.task.home.x, p.task.home.z, 0.5, 0.8);
    p.face = { x: p.x + sim.dir * 10, z: p.z };
  }
}

// ---------- Run blocking ----------
function runBlock(sim, p) {
  const t = p.task;
  const play = sim.offPlay;
  const side = play.run?.side || 1;
  if (!t.drive) {
    const w = sim.toWorld(1, side * 0.45);
    const dx = w.x - sim.losX, dz = w.z - sim.ballZ;
    const l = Math.hypot(dx, dz);
    t.drive = { x: dx / l, z: dz / l };
  }
  if (t.pull && !t.pulled) {
    const l0 = sim.toLocal(p.x, p.z);
    const hole = sim.toWorld(-1.2, play.run.aim[1]);
    if (!t.pullPt) t.pullPt = hole;
    const d = seek(p, t.pullPt.x, t.pullPt.z, 0.9, 0.3);
    if (d < 1 || sim.t > 1.4 || l0.down > 0) t.pulled = true;
    return;
  }
  const cur = t.target !== undefined ? sim.players[t.target] : null;
  if (!validTarget(sim, cur) || (cur.engagement && cur.engagement.b !== p)) t.target = pickRunTarget(sim, p, side);
  const d = t.target !== undefined ? sim.players[t.target] : null;
  if (d) {
    // Approach from the ball's side so we seal the defender away from the hole.
    seek(p, d.x - t.drive.x * 0.5, d.z - t.drive.z * 0.5, 0.9, 0.3);
    p.face = { x: d.x, z: d.z };
  } else {
    const w = sim.toWorld(3, sim.toLocal(p.x, p.z).lat + side);
    seek(p, w.x, w.z, 0.6, 1);
  }
}

function validTarget(sim, d) {
  return d && d.team !== sim.possTeam && d.state !== 'down';
}

function pickRunTarget(sim, p, side) {
  const me = sim.toLocal(p.x, p.z);
  const claimed = new Set();
  for (const q of sim.players) if (q !== p && q.team === sim.possTeam && q.task?.target !== undefined) claimed.add(q.task.target);
  let best, bs = 1e9;
  for (const d of sim.players) {
    if (d.team === sim.possTeam || d.state === 'down' || claimed.has(d.id) || d.engagement) continue;
    const l = sim.toLocal(d.x, d.z);
    if (l.down < -1 || l.down > 10) continue;
    const second = l.down > 2.5; // linebackers / box safeties
    const latOff = (l.lat - me.lat) * side; // positive = playside of me
    if (latOff < (second ? -4 : -1.6) || latOff > (second ? 6 : 3.2)) continue;
    let s = Math.hypot(l.lat - me.lat - side * 0.6, (l.down - me.down) * 0.7);
    if (second) s += 1.5;
    if (s < bs) { bs = s; best = d.id; }
  }
  return best;
}

function stalk(sim, p) {
  // Receivers block the nearest defensive back in front of them.
  let best = null, bd = 14;
  for (const d of sim.players) {
    if (d.team === sim.possTeam || d.state === 'down') continue;
    if (!['LCB', 'RCB', 'NB', 'FS', 'SS', 'DB'].includes(d.slot)) continue;
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist < bd) { bd = dist; best = d; }
  }
  if (best) {
    p.task.target = best.id;
    const c = sim.carrier();
    const ref = c || { x: sim.losX, z: sim.ballZ };
    let ux = ref.x - best.x, uz = ref.z - best.z;
    const ul = Math.hypot(ux, uz) || 1;
    seek(p, best.x + (ux / ul) * 0.9, best.z + (uz / ul) * 0.9, bd > 3 ? 0.8 : 0.6, 0.6);
    p.face = { x: best.x, z: best.z };
  } else stop(p);
}

// ---------- Routes ----------
function route(sim, p) {
  const t = p.task;
  if (t.settled) {
    // Sit in the void and face the QB, sliding away from the closest defender.
    const qb = sim.bySlot(sim.offIdx, 'QB');
    if (qb) p.face = { x: qb.x, z: qb.z };
    const sp = t.pts[t.pts.length - 1];
    let az = 0;
    for (const d of sim.players) {
      if (d.team === p.team || d.state === 'down') continue;
      const dz = p.z - d.z, dd = Math.hypot(p.x - d.x, dz);
      if (dd < 3 && dd > 1e-3) az += (dz / dd) * (3 - dd);
    }
    seek(p, sp.x, clamp(sp.z + az * 0.8, sp.z - 2, sp.z + 2), 0.4, 1);
    return;
  }
  const target = t.pts[t.idx];
  if (!target) { stop(p); return; }
  const dx = target.x - p.x, dz = target.z - p.z;
  const d = Math.hypot(dx, dz);
  // Slow into sharp breaks; better route runners keep more speed.
  let frac = 1;
  const next = t.pts[t.idx + 1];
  if (next && d < 1.8) {
    const ax = dx / (d || 1), az = dz / (d || 1);
    const bx = next.x - target.x, bz = next.z - target.z;
    const bl = Math.hypot(bx, bz) || 1;
    const cos = ax * (bx / bl) + az * (bz / bl);
    if (cos < 0.6) frac = 0.5 + sim.R(p, 'routeRunning') * 0.004 + (cos + 1) * 0.08;
  }
  if (!next && t.end === 'settle') frac = Math.min(frac, 0.7);
  seek(p, target.x, target.z, frac, next || t.end === 'continue' ? 0.01 : 1.2);
  if (d < 0.6) {
    t.idx++;
    if (t.idx >= t.pts.length) {
      if (t.end === 'settle') { t.settled = true; }
      else stop(p);
    }
  }
}

function catchBall(sim, p) {
  const b = sim.ball;
  if (b.state !== 'air' || !b.target) { p.task.type = 'route'; return; }
  // Time the run to meet the ball: arrive as it does, settle under it if early.
  const dx = b.target.x - p.x, dz = b.target.z - p.z;
  const d = Math.hypot(dx, dz);
  const left = Math.max(0.05, b.T - b.t);
  const v = d < 0.3 ? 0 : Math.min(p.maxSpeed * p.speedCap, (d / left) * 1.15 + 0.5);
  p.desired.x = d > 1e-3 ? (dx / d) * v : 0;
  p.desired.z = d > 1e-3 ? (dz / d) * v : 0;
  p.face = { x: b.x, z: b.z };
}

// ---------- After the catch / handoff ----------
function escort(sim, p) {
  const c = sim.carrier();
  if (!c) { stop(p); return; }
  if (p.slot === 'QB' && p.team === sim.offIdx && sim.possTeam === sim.offIdx) {
    seek(p, p.x, p.z, 0.3);
    return;
  }
  const claimed = new Set();
  for (const q of sim.players) if (q !== p && q.team === p.team && q.task?.type === 'escort' && q.task.target !== undefined) claimed.add(q.task.target);
  let best = null, bs = 1e9;
  for (const d of sim.players) {
    if (d.team === p.team || d.state === 'down' || d.engagement) continue;
    const dc = Math.hypot(d.x - c.x, d.z - c.z);
    const dp = Math.hypot(d.x - p.x, d.z - p.z);
    if (dc > 14 || dp > dc + 2) continue;
    const s = dp + dc * 0.5 + (claimed.has(d.id) ? 6 : 0);
    if (s < bs) { bs = s; best = d; }
  }
  if (best) {
    p.task.target = best.id;
    let ux = c.x - best.x, uz = c.z - best.z;
    const ul = Math.hypot(ux, uz) || 1;
    seek(p, best.x + (ux / ul) * 0.8, best.z + (uz / ul) * 0.8, 0.95, 0.3);
  } else {
    p.task.target = undefined;
    const td = sim.teamDir(c.team);
    seek(p, c.x + td * 4, c.z + (p.z > c.z ? 3 : -3), 0.8, 2);
  }
}
