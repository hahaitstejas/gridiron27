import { clamp } from '../core/math.js';
import { HALF_WIDTH } from '../core/constants.js';
import { seek, stop } from '../sim/movement.js';
import { startMove } from '../sim/tackling.js';
import { ZONES } from './zones.js';

const DEF_TASKS = new Set(['rush', 'man', 'zone', 'spy', 'pursue', 'ball']);

/**
 * Match man defenders to receivers. Rules in the play (man:L1, man:RB, ...) are hints; anyone
 * whose hint doesn't resolve sensibly is matched to the nearest uncovered receiver by alignment.
 * Returns Map(defenderId -> receiver).
 */
export function matchMan(sim) {
  const assign = sim.defPlay.assign || {};
  const sets = sim.receiverSets();
  const pick = (rule) => {
    if (rule === 'RB') return sets.backs[0];
    if (rule === 'TE') return sets.TE[0];
    const k = rule[0], n = parseInt(rule.slice(1), 10);
    if (k === 'L') return sets.L[n - 1];
    if (k === 'R') return sets.R[n - 1];
    return null;
  };
  const lat = (p) => sim.toLocal(p.x, p.z).lat;
  const out = new Map();
  const covered = new Set();
  const manDefs = sim.defense().filter((d) => (assign[d.slot] || '').startsWith('man:'));
  const pending = [];
  for (const d of manDefs) {
    const r = pick(assign[d.slot].slice(4));
    const homeLat = d.at ? d.at[1] : lat(d);
    if (r && !covered.has(r.id) && Math.abs(lat(r) - homeLat) < 14) { out.set(d.id, r); covered.add(r.id); }
    else pending.push(d);
  }
  // Greedy nearest matching for the rest. DBs prefer split receivers, LBs prefer backs/TEs.
  const isDB = (d) => ['LCB', 'RCB', 'NB', 'DB', 'FS', 'SS'].includes(d.slot);
  const pairs = [];
  for (const d of pending) for (const r of sets.elig) {
    if (covered.has(r.id)) continue;
    const back = sets.backs.includes(r) || r.pos === 'TE';
    let cost = Math.abs(lat(r) - (d.at ? d.at[1] : lat(d)));
    if (isDB(d) && back) cost += 6;
    if (!isDB(d) && !back) cost += 6;
    pairs.push({ d, r, cost });
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const done = new Set();
  for (const { d, r } of pairs) {
    if (done.has(d.id) || covered.has(r.id)) continue;
    out.set(d.id, r); covered.add(r.id); done.add(d.id);
  }
  return out;
}

const CB_SLOTS = new Set(['LCB', 'RCB', 'NB', 'DB']);

/** Corner depth for the pre-snap coverage call: press (1 yd), off (8 yds) or the play's default. */
function cbDepth(sim, def) {
  const c = sim.defAdj?.cover;
  return c === 'press' ? 1.1 : c === 'off' ? Math.max(def, 8) : def;
}

/**
 * Pre-snap: man defenders walk out to line up on their receiver. With `walk` (seconds) they move
 * toward that spot at a jog instead of jumping there, and keep their man (following motion).
 */
export function alignMan(sim, walk = 0) {
  const manPlay = sim.defPlay.coverage === 'man' || Object.values(sim.defPlay.assign || {}).some((a) => a.startsWith('man:'));
  if (!manPlay) { if (!walk) alignCorners(sim); return; }
  const m = walk && sim.manMatch ? sim.manMatch : matchMan(sim);
  sim.manMatch = m;
  for (const d of sim.defense()) {
    const r = sim.players[m.get(d.id)?.id];
    if (!r) continue;
    const rl = sim.toLocal(r.x, r.z);
    const back = rl.down < -2.5;
    const isCB = CB_SLOTS.has(d.slot);
    let depth, shade;
    if (back) { depth = Math.max(4, d.at[0]); shade = 0; }
    else if (isCB) { depth = cbDepth(sim, Math.abs(rl.lat) > 10 ? 6 : 5); shade = Math.abs(rl.lat) > 10 ? 0.8 : -0.8; }
    else { depth = 4.5; shade = -0.8; }
    const latOut = rl.lat + Math.sign(rl.lat || 1) * shade;
    const w = sim.toWorld(depth, back ? rl.lat * 0.5 : latOut);
    const tz = Math.max(-25.5, Math.min(25.5, w.z));
    if (!walk) { d.x = w.x; d.z = tz; continue; }
    const dx = w.x - d.x, dz = tz - d.z, dl = Math.hypot(dx, dz);
    const step = Math.min(dl, 6.5 * walk);
    if (dl > 1e-3) { d.x += (dx / dl) * step; d.z += (dz / dl) * step; }
  }
  if (!walk) alignCorners(sim, true);
}

/** Zone corners (and man corners without a man) move to press or off depth. */
function alignCorners(sim, manOnly = false) {
  if (!sim.defAdj?.cover) return;
  for (const d of sim.defense()) {
    if (!CB_SLOTS.has(d.slot) || (manOnly && sim.manMatch?.has(d.id))) continue;
    const l = sim.toLocal(d.x, d.z);
    if (l.down < 3 && sim.defAdj.cover !== 'press') continue;
    const w = sim.toWorld(cbDepth(sim, l.down), l.lat);
    d.x = w.x; d.z = w.z;
  }
}

/**
 * Press coverage at the snap: a corner within reach of a receiver jams him. Win and the receiver's
 * release is slowed (timing routes get late); lose and the corner is a step behind.
 */
function pressJams(sim) {
  if (sim.defAdj?.cover !== 'press') return;
  for (const d of sim.defense()) {
    if (!CB_SLOTS.has(d.slot)) continue;
    let r = null, best = 2.6;
    for (const o of sim.offense()) {
      if (o.task?.type !== 'route') continue;
      const dd = Math.hypot(o.x - d.x, o.z - d.z);
      if (dd < best) { best = dd; r = o; }
    }
    if (!r) continue;
    const edge = (sim.R(d, 'strength') + sim.R(d, 'coverage') - sim.R(r, 'strength') - sim.R(r, 'routeRunning')) * 0.006;
    if (sim.rng.next() < clamp(0.5 + edge + sim.sl(d.team, 'passCoverage') * 0.1, 0.2, 0.8)) { r.speedCap = 0.4; r.recoverAt = 0.55; }
    else { d.speedCap = 0.45; d.recoverAt = 0.6; }
  }
}

/** Leverage from the coverage call: man defenders play this far inside (negative = outside) of their man. */
export function leverage(sim) {
  const s = sim.defAdj?.shade;
  return s === 'in' ? 1.4 : s === 'out' ? -0.9 : 0.5;
}

/** Resolve the defensive play's assignments against the offense's alignment at the snap. */
export function assignDefense(sim) {
  const assign = sim.defPlay.assign || {};
  const man = sim.manMatch || matchMan(sim);
  for (const d of sim.defense()) {
    const a = assign[d.slot] || 'zone:hook_middle';
    d.perceived = { x: 0, z: 0 };
    if (a === 'rush' || a === 'blitz') d.task = { type: 'rush', blitz: a === 'blitz' };
    else if (a.startsWith('man:')) {
      const r = man.get(d.id);
      if (r) d.task = { type: 'man', target: r.id, cushion: Math.max(1, Math.min(7, Math.abs(sim.toLocal(d.x, d.z).down - sim.toLocal(r.x, r.z).down))) };
      else d.task = { type: 'zone', zone: sim.toLocal(d.x, d.z).lat < 0 ? 'hook_l' : 'hook_r' };
    } else if (a.startsWith('zone:')) d.task = { type: 'zone', zone: a.slice(5) };
    else if (a === 'spy') d.task = { type: 'spy' };
    else d.task = { type: 'zone', zone: 'hook_middle' };
  }
  pressJams(sim);
}

export function runDefenseAI(sim, dt) {
  for (const p of sim.players) {
    if (!p.task || !DEF_TASKS.has(p.task.type)) continue;
    if (p.state !== 'active' || p.engagement || p.move) continue;
    p.face = null;
    // React to a thrown ball.
    if (sim.ball.state === 'air' && p.task.type !== 'ball' && p.ballReactAt !== undefined && sim.t >= p.ballReactAt && sim.ball.kind !== 'throwaway') {
      const b = sim.ball;
      const dist = Math.hypot(b.target.x - p.x, b.target.z - p.z);
      const timeLeft = Math.max(0.1, b.T - b.t);
      const canReach = dist < p.maxSpeed * (timeLeft + 0.6);
      const isMyMan = p.task.type === 'man' && p.task.target === b.intended;
      // A man defender trailing his receiver has his back to the QB: he stays in phase and only
      // finds the ball in the last moment.
      const rec = sim.players[b.intended];
      const trailing = isMyMan && rec && (rec.x - p.x) * sim.dir > 0.3;
      if (trailing && timeLeft > 0.4) { /* keep running with the receiver */ }
      else if (isMyMan || canReach) {
        // Defenders read the throw rather than knowing the exact spot: error grows with distance.
        let sd = (0.15 + dist * 0.045) * (1.6 - sim.R(p, "awareness") / 100);
        if (sim.difficulty && p.team !== sim.humanTeam) sd *= sim.difficulty.cpuRead ?? 1;
        p.task = { type: 'ball', prev: p.task, err: { x: sim.rng.gauss(0, sd), z: sim.rng.gauss(0, sd) } };
      }
      else if (dist < 22 && p.task.type !== 'rush') p.task = { type: 'ball', prev: p.task, rally: true };
    }
    // Play action: linebackers and safeties step up to the run fake; less aware players bite longer.
    if (sim.offPlay?.pa && sim.ball.state !== 'air' && (p.task.type === 'zone' || p.task.type === 'man' || p.task.type === 'spy') && !/CB|NB|DB/.test(p.slot)) {
      // Safeties are taught to read their keys first: they bite less than linebackers.
      const safety = p.slot === 'FS' || p.slot === 'SS';
      const bite = safety ? 0.15 + (1 - sim.R(p, 'awareness') / 100) * 0.5 : 0.3 + (1 - sim.R(p, 'awareness') / 100) * 1.0;
      if (sim.t < bite) {
        const l = sim.toLocal(p.x, p.z);
        const w = sim.toWorld(Math.max(1.5, l.down - 3), l.lat * 0.9);
        seek(p, w.x, w.z, 0.6, 0.3);
        continue;
      }
    }
    switch (p.task.type) {
      case 'rush': rush(sim, p); break;
      case 'man': man(sim, p, dt); break;
      case 'zone': zone(sim, p); break;
      case 'spy': spy(sim, p); break;
      case 'pursue': pursue(sim, p, dt); break;
      case 'ball': playBall(sim, p); break;
    }
  }
}

function rush(sim, p) {
  const qb = sim.bySlot(sim.offIdx, 'QB');
  const c = sim.carrier();
  if (sim.ballLiveRun && c) { p.task = { type: 'pursue', at: sim.t }; return; }
  const goal = c || qb;
  if (!goal) { stop(p); return; }
  let tx = goal.x, tz = goal.z;
  // Edge rushers keep contain early in the down.
  if ((p.slot === 'LE' || p.slot === 'RE') && sim.t < 1.6 && !p.task.blitz) {
    const side = p.slot === 'LE' ? -1 : 1;
    const w = sim.toLocal(goal.x, goal.z);
    const pt = sim.toWorld(w.down + 0.5, w.lat + side * 2.2);
    tx = pt.x; tz = pt.z;
  }
  // Slip around unengaged blockers standing between us and the goal.
  let ax = tx - p.x, az = tz - p.z;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  let sx = 0, sz = 0;
  for (const b of sim.players) {
    if (b.team !== sim.possTeam || b.engagement || b === goal || b.state !== 'active') continue;
    const dx = b.x - p.x, dz = b.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.2 || d < 1e-3) continue;
    const ahead = (dx * ax + dz * az) / d;
    if (ahead < 0.3) continue;
    const side = Math.sign(dx * az - dz * ax) || 1;
    sx += -az * -side * (2.2 - d);
    sz += ax * -side * (2.2 - d);
  }
  seek(p, p.x + ax * 3 + sx * 2, p.z + az * 3 + sz * 2, 1, 0.1);
  if (sim.ball.state === 'air' && sim.toLocal(p.x, p.z).down < 2 && !p.swatted) {
    p.swatted = true;
    p.anim = 'swat'; p.animT = 0;
  }
}

function man(sim, p, dt) {
  const r = sim.players[p.task.target];
  if (!r) { stop(p); return; }
  if (sim.ball.carrier === r.id && sim.ballLiveRun) { p.task = { type: 'pursue', at: sim.t }; return; }
  // A man target who stays in to block: become a short zone "robber".
  if ((r.task?.type === 'pass_block' || r.task?.type === 'run_block') && sim.t > 0.8) {
    p.task = { type: 'zone', zone: 'mid_robber' };
    return;
  }
  // Perceived velocity lags reality: better coverage/awareness = less lag.
  const cov = sim.R(p, 'coverage');
  let tau = 0.34 - cov * 0.0024 + (sim.R(r, 'routeRunning') - 70) * 0.0018;
  tau = clamp(tau, 0.06, 0.4);
  const k = Math.min(1, dt / tau);
  p.perceived.x += (r.vx - p.perceived.x) * k;
  p.perceived.z += (r.vz - p.perceived.z) * k;
  const cushion = Math.max(0.6, Math.min(5, p.task.cushion) - sim.t * 4);
  const rl = sim.toLocal(r.x, r.z);
  const inside = (rl.lat > 0 ? -1 : 1) * leverage(sim);
  const tgt = sim.toWorld(rl.down + cushion, rl.lat + inside);
  const lead = 0.35;
  tgt.x += p.perceived.x * lead;
  tgt.z += p.perceived.z * lead;
  const dx = tgt.x - p.x, dz = tgt.z - p.z;
  const gain = 3;
  let vx = p.perceived.x + dx * gain, vz = p.perceived.z + dz * gain;
  const vl = Math.hypot(vx, vz);
  const max = p.maxSpeed * p.speedCap;
  if (vl > max) { vx = (vx / vl) * max; vz = (vz / vl) * max; }
  p.desired.x = vx; p.desired.z = vz;
  if (sim.t < 0.7) { const qb = sim.bySlot(sim.offIdx, 'QB'); if (qb) p.face = { x: qb.x, z: qb.z }; }
}

function zone(sim, p) {
  const z = ZONES[p.task.zone] || ZONES.hook_middle;
  const c = sim.carrier();
  if (sim.ballLiveRun && c) { p.task = { type: 'pursue', at: sim.t + 0.15 }; return; }
  // Landmark in world space, kept on the field.
  const latLimit = (sgn) => sgn * (HALF_WIDTH - 2) * sim.dir - sim.ballZ * sim.dir;
  // Shade the underneath zones toward the middle or the sidelines.
  const sh = sim.defAdj?.shade;
  let lat = z.deep || !sh ? z.lat : z.lat * (sh === 'in' ? 0.8 : 1.2);
  lat = clamp(lat, Math.min(latLimit(-1), latLimit(1)), Math.max(latLimit(-1), latLimit(1)));
  const home = { down: z.down, lat };
  // Threats in my area. Deep defenders stay over the top of all vertical threats and split the
  // difference between them; underneath defenders mirror the most dangerous one.
  let threat = null, ts = -1e9;
  let deepest = -99, latSum = 0, wSum = 0;
  for (const r of sim.players) {
    if (r.team !== sim.possTeam || (r.task?.type !== 'route' && r.task?.type !== 'catch')) continue;
    const l = sim.toLocal(r.x, r.z);
    const dd = Math.hypot(l.down - home.down, l.lat - home.lat);
    // Deep zones own their lane all the way to the end line; underneath zones have a radius.
    if (z.deep ? Math.abs(l.lat - home.lat) > z.r * 1.1 || l.down < home.down - z.r : dd > z.r * 1.35) continue;
    if (z.deep) {
      if (l.down > 4) {
        const w = Math.max(0.2, l.down - 4);
        latSum += l.lat * w; wSum += w;
        deepest = Math.max(deepest, l.down);
      }
    } else {
      const s = -dd + (r.task.settled ? 1 : 0);
      if (s > ts) { ts = s; threat = { r, l }; }
    }
  }
  let tDown = home.down, tLat = home.lat;
  if (z.deep && wSum > 0) {
    tDown = Math.max(home.down * 0.7, deepest + 3.5);
    tLat = clamp(latSum / wSum, home.lat - z.r * 0.6, home.lat + z.r * 0.6);
  } else if (threat) {
    const { l, r } = threat;
    tDown = clamp(l.down - 0.8, 1, home.down + 3);
    tLat = l.lat + (r.vz * sim.dir) * 0.3;
  } else {
    // Nobody in my area: sink under the nearest vertical route (e.g. a Cover 2 corner under the go).
    let v = null, vd = z.r * 2.2;
    for (const r of sim.players) {
      if (r.team !== sim.possTeam || r.task?.type !== 'route') continue;
      const l = sim.toLocal(r.x, r.z);
      const dd = Math.abs(l.lat - home.lat);
      if (l.down > home.down + 2 && dd < vd) { vd = dd; v = l; }
    }
    if (v) { tDown = Math.min(v.down - 2.5, home.down + 9); tLat = home.lat + (v.lat - home.lat) * 0.8; }
  }
  const w = sim.toWorld(tDown, tLat);
  const qb = sim.bySlot(sim.offIdx, 'QB');
  const d = seek(p, w.x, w.z, z.deep ? 0.95 : 0.85, 1.2);
  if (qb && d < 5) p.face = { x: qb.x, z: qb.z };
}

function spy(sim, p) {
  const qb = sim.bySlot(sim.offIdx, 'QB');
  if (!qb) return stop(p);
  if (sim.ballLiveRun) { p.task = { type: 'pursue', at: sim.t }; return; }
  const l = sim.toLocal(qb.x, qb.z);
  const w = sim.toWorld(Math.max(4, l.down + 6), l.lat);
  seek(p, w.x, w.z, 0.8, 1);
  p.face = { x: qb.x, z: qb.z };
}

function pursue(sim, p, dt) {
  const c = sim.carrier();
  if (!c) { stop(p); return; }
  if (sim.t < p.task.at) {
    // Still reading: drift with current momentum.
    p.desired.x = p.vx * 0.9; p.desired.z = p.vz * 0.9;
    return;
  }
  const dist = Math.hypot(c.x - p.x, c.z - p.z);
  const awr = sim.R(p, 'awareness');
  // Solve for the intercept point |C + V t - P| = s t; better awareness takes truer angles.
  const s = p.maxSpeed;
  const rx = c.x - p.x, rz = c.z - p.z;
  const a = c.vx * c.vx + c.vz * c.vz - s * s;
  const bq = 2 * (c.vx * rx + c.vz * rz);
  const cq = rx * rx + rz * rz;
  let ti;
  if (Math.abs(a) < 1e-6) ti = bq < 0 ? -cq / bq : dist / s;
  else {
    const disc = bq * bq - 4 * a * cq;
    if (disc >= 0) {
      const r1 = (-bq - Math.sqrt(disc)) / (2 * a), r2 = (-bq + Math.sqrt(disc)) / (2 * a);
      ti = Math.min(...[r1, r2].filter((x) => x > 0), 99);
    } else ti = 99;
  }
  if (ti > 4) ti = Math.min(4, dist / s * 1.6); // can't catch him: take a deep angle ahead of him
  // Defenders already downfield of the runner overshoot the intercept (take away the alley);
  // low-awareness pursuers undershoot and end up chasing.
  const td = sim.teamDir(c.team);
  const ahead = (p.x - c.x) * td > 1;
  // ...but a defender squarely in the runner's path should meet him, not overrun him.
  const cs = Math.hypot(c.vx, c.vz) || 1;
  const headOn = ((p.x - c.x) * c.vx + (p.z - c.z) * c.vz) / (cs * (dist || 1)) > 0.8;
  const k = ahead && !headOn ? 1.15 : headOn ? 0.85 : clamp(0.55 + awr * 0.0055, 0.55, 1.05);
  let tx = c.x + c.vx * ti * k, tz = c.z + c.vz * ti * k;
  if (p.task.lane !== undefined && dist > 6) tz = tz * 0.6 + (c.z + p.task.lane) * 0.4;
  seek(p, tx, tz, 1, 0.05);
  if (sim.isHumanControlled(p)) return;
  // Occasional dive at an escaping runner, or a big hit head-on.
  if (!p.move && (p.moveCd || 0) < sim.t && dist > 1.2 && dist < 2.6) {
    const cs = Math.hypot(c.vx, c.vz);
    const away = ((c.x - p.x) * c.vx + (c.z - p.z) * c.vz) / (dist * (cs || 1));
    if (away > 0.3 && cs > p.maxSpeed * 0.8 && sim.rng.chance(dt * 4)) {
      p.facing = Math.atan2(c.z - p.z, c.x - p.x);
      startMove(sim, p, 'tackle_dive');
    } else if (away < -0.5 && sim.R(p, 'hitPower') > 80 && sim.rng.chance(dt * 1.2)) {
      p.facing = Math.atan2(c.z - p.z, c.x - p.x);
      startMove(sim, p, 'hitstick');
    }
  }
}

function playBall(sim, p) {
  const b = sim.ball;
  if (b.state !== 'air' || !b.target) {
    const prev = p.task.prev;
    p.task = sim.ballLiveRun ? { type: 'pursue', at: sim.t + 0.2 } : prev || { type: 'zone', zone: 'hook_middle' };
    return;
  }
  const qb = sim.players[b.thrower];
  let ux = qb ? qb.x - b.target.x : 0, uz = qb ? qb.z - b.target.z : 0;
  const ul = Math.hypot(ux, uz) || 1;
  if (p.task.rally) {
    // Rallying defenders far from the catch point keep leverage: deep players stay downfield of it,
    // underneath players come up in front of it.
    const deeper = (p.x - b.target.x) * sim.dir > 0;
    if (deeper) seek(p, b.target.x + sim.dir * 3, b.target.z, 1, 1.5);
    else seek(p, b.target.x + (ux / ul) * 2.5, b.target.z + (uz / ul) * 2.5, 1, 2);
  } else {
    // Drive on the catch point at full speed: shallower defenders undercut it, deeper ones come down
    // on top of it so the receiver runs into them. If already there, hit the receiver.
    const rec = sim.players[b.intended];
    const deeper = (p.x - b.target.x) * sim.dir > 0.5;
    const e = p.task.err || { x: 0, z: 0 };
    // The error shrinks as the ball gets close and the defender can track it.
    const k = Math.min(1, Math.max(0, (b.T - b.t) / 0.6));
    let tx = (deeper ? b.target.x + sim.dir * 0.7 : b.target.x + (ux / ul) * 0.4) + e.x * k;
    let tz = (deeper ? b.target.z : b.target.z + (uz / ul) * 0.4) + e.z * k;
    if (rec && Math.hypot(tx - p.x, tz - p.z) < 0.8) { tx = rec.x; tz = rec.z; }
    seek(p, tx, tz, 1, 0.05);
  }
  p.face = { x: b.x, z: b.z };
}
