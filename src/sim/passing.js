import { GRAVITY, HALF_WIDTH } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { reactionDelay } from './play.js';
import { attemptTackle } from './tackling.js';
import { addFoul, foulRate } from './fouls.js';

const RELEASE_HEIGHT = 2.0;
const CATCH_HEIGHT = 1.35;
const WINDUP = 0.2;

export function flightTime(dist, kind, thp) {
  if (kind === 'bullet') return dist / (15 + thp * 0.12) + 0.05;
  if (kind === 'throwaway') return dist / 26 + 0.1;
  return dist / (13.5 + thp * 0.09) + 0.12; // lob / touch: some air under it, but not a floater
}

export function maxThrowDist(thp) { return 38 + thp * 0.33; }

/** Predict where a receiver will be in T seconds by walking his remaining route. */
export function predictPos(sim, r, T) {
  const t = r.task;
  const sp = Math.max(Math.hypot(r.vx, r.vz), r.maxSpeed * 0.85);
  if (t && t.type === 'route' && !t.settled) {
    let x = r.x, z = r.z, remain = sp * T;
    for (let i = t.idx; i < t.pts.length && remain > 0; i++) {
      const p = t.pts[i];
      const d = Math.hypot(p.x - x, p.z - z);
      if (d >= remain) { x += ((p.x - x) / d) * remain; z += ((p.z - z) / d) * remain; remain = 0; break; }
      x = p.x; z = p.z; remain -= d;
    }
    return { x, z };
  }
  if (t && t.type === 'route' && t.settled) return { x: r.x + r.vx * T * 0.3, z: r.z + r.vz * T * 0.3 };
  return { x: r.x + r.vx * T, z: r.z + r.vz * T };
}

/** Begin a throw. kind: 'bullet' | 'lob' | 'throwaway'. lead: {x,z} world-space stick lead (yards). */
export function startThrow(sim, qb, receiver, kind, lead = null) {
  if (sim.passThrown || sim.pendingThrow || sim.ball.state !== 'held' || sim.ball.carrier !== qb.id) return false;
  if (sim.qbCrossed) return false;
  sim.pendingThrow = { qb: qb.id, rec: receiver ? receiver.id : -1, kind, lead, at: sim.t + WINDUP };
  qb.anim = 'throw';
  qb.animT = 0;
  if (receiver) qb.face = { x: receiver.x, z: receiver.z };
  return true;
}

export function updatePendingThrow(sim) {
  const pt = sim.pendingThrow;
  if (!pt) return;
  const qb = sim.players[pt.qb];
  if (sim.ball.carrier !== qb.id || sim.ball.state !== 'held' || qb.state === 'tackled' || qb.state === 'down') {
    sim.pendingThrow = null; // sacked during the windup
    return;
  }
  if (sim.t < pt.at) return;
  sim.pendingThrow = null;
  release(sim, qb, pt.rec >= 0 ? sim.players[pt.rec] : null, pt.kind, pt.lead);
}

function release(sim, qb, rec, kind, lead) {
  const rng = sim.rng;
  const thp = sim.R(qb, 'throwPower');
  const tha = sim.R(qb, 'throwAccuracy');
  let tx, tz, T;
  if (kind === 'throwaway' || !rec) {
    // Throw it out of bounds toward the nearest sideline, downfield.
    const side = Math.sign(qb.z) || 1;
    tx = qb.x + sim.dir * 5;
    tz = side * (HALF_WIDTH + 2);
    kind = 'throwaway';
    T = flightTime(Math.hypot(tx - qb.x, tz - qb.z), kind, thp);
  } else {
    // Iterate time-of-flight against the receiver's predicted position.
    let p = { x: rec.x, z: rec.z };
    T = 0.5;
    for (let i = 0; i < 4; i++) {
      T = flightTime(Math.hypot(p.x - qb.x, p.z - qb.z), kind, thp);
      p = predictPos(sim, rec, T);
    }
    tx = p.x; tz = p.z;
    if (lead) { tx += lead.x; tz += lead.z; }
    // Accuracy: worse under pressure, on the move, and with distance.
    const dist = Math.hypot(tx - qb.x, tz - qb.z);
    const pressure = pressureOn(sim, qb);
    const moving = Math.min(1, Math.hypot(qb.vx, qb.vz) / 5);
    let sd = (0.06 + (100 - tha) * 0.014) * (0.45 + dist / 30 + Math.max(0, dist - 18) / 22) * (1 + pressure * 0.9 + moving * 0.6);
    if (kind === 'bullet') sd *= 1.1;
    if (sim.difficulty) sd *= qb.team !== sim.humanTeam ? sim.difficulty.cpuAccuracy ?? 1 : sim.difficulty.humanAccuracy ?? 1;
    sd *= 1 - 0.45 * sim.sl(qb.team, 'qbAccuracy');
    tx += rng.gauss(0, sd);
    tz += rng.gauss(0, sd);
    // Arm strength limit.
    const maxD = maxThrowDist(thp);
    const d2 = Math.hypot(tx - qb.x, tz - qb.z);
    if (d2 > maxD) {
      tx = qb.x + ((tx - qb.x) / d2) * maxD;
      tz = qb.z + ((tz - qb.z) / d2) * maxD;
    }
    T = flightTime(Math.hypot(tx - qb.x, tz - qb.z), kind, thp);
  }
  const b = sim.ball;
  b.state = 'air';
  b.kind = kind;
  b.x = qb.x; b.z = qb.z; b.y = RELEASE_HEIGHT;
  b.t = 0;
  b.T = T;
  b.vx = (tx - qb.x) / T;
  b.vz = (tz - qb.z) / T;
  b.vy = (CATCH_HEIGHT - RELEASE_HEIGHT + 0.5 * GRAVITY * T * T) / T;
  b.target = { x: tx, z: tz };
  b.intended = rec ? rec.id : -1;
  b.thrower = qb.id;
  b.carrier = -1;
  b.resolved = false;
  b.tried = new Set();
  b.swatT = new Map();
  b.tipped = false;
  sim.passThrown = true;
  sim.stats.passer = qb.id;
  // Intentional grounding: throwing it away from inside the tackle box.
  if (kind === 'throwaway') {
    const l = sim.toLocal(qb.x, qb.z);
    if (Math.abs(l.lat) < 4.5 && l.down < 0) addFoul(sim, 'grounding', qb.team, qb, { spotX: qb.x });
  }
  sim.releaseT = sim.t;
  sim.stats.target = b.intended >= 0 ? b.intended : null;
  qb.face = null;
  sim.emit('throw', { qb: qb.id, rec: b.intended, kind, T });

  // Receiver works back to the ball; defenders react after their read delay.
  if (rec) {
    rec.task = { ...rec.task, prevType: rec.task?.type, type: 'catch' };
    rec.wantsBall = true;
  }
  for (const d of sim.players) {
    if (d.team === sim.possTeam) continue;
    d.ballReactAt = sim.t + reactionDelay(sim, d);
  }
}

/** Pressure 0..1 from free defenders near the QB. With perceived=true, blind-side rushers only
 * count once they are very close (better awareness widens the QB's feel for the rush). */
export function pressureOn(sim, qb, perceived = false) {
  let p = 0;
  const fx = Math.cos(qb.facing), fz = Math.sin(qb.facing);
  const feel = 0.8 + sim.R(qb, 'awareness') * 0.012;
  for (const d of sim.players) {
    if (d.team === qb.team || d.engagement || d.state !== 'active') continue;
    const dx = d.x - qb.x, dz = d.z - qb.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= 4) continue;
    if (perceived && (dx * fx + dz * fz) / (dist || 1) < -0.1 && dist > feel) continue;
    p = Math.max(p, 1 - dist / 4);
  }
  return p;
}

export function updateBallFlight(sim, dt) {
  const b = sim.ball;
  b.t += dt;
  b.vy -= GRAVITY * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  b.spin += dt * 20;

  if (b.kind === 'throwaway') {
    if (b.y <= 0.15 || Math.abs(b.z) > HALF_WIDTH + 0.5) incomplete(sim, 'throwaway');
    return;
  }
  // Primary resolution when the ball reaches catch height at the target.
  if (!b.resolved && b.t >= b.T - dt * 0.5) {
    b.resolved = true;
    resolveCatch(sim, 1.25);
    return;
  }
  // Late catches (overthrows, tipped balls) while the ball is still catchable.
  if (b.resolved && b.state === 'air' && b.y > 0.25 && b.y < 2.8) {
    resolveCatch(sim, 0.75, true);
    if (b.state !== 'air') return;
  }
  if (b.y <= 0.12) incomplete(sim, 'ground');
}

function swatBonus(sim, d) {
  const t = sim.ball.swatT?.get(d.id);
  return t !== undefined && sim.t - t < 0.7;
}

function resolveCatch(sim, reach, late = false) {
  const b = sim.ball;
  const rng = sim.rng;
  const cands = [];
  for (const p of sim.players) {
    if (p.state === 'down' || p.state === 'tackled' || p.engagement) continue;
    if (late && b.tried.has(p.id)) continue;
    const d = Math.hypot(p.x - b.x, p.z - b.z);
    // Receivers can extend for the ball (intended receiver most of all); defenders reach less unless swatting.
    const isRec = p.team === sim.possTeam;
    const r = reach + (isRec ? (p.id === b.intended ? 0.45 : 0.2) : 0) + (!isRec && swatBonus(sim, p) ? 0.6 : 0) + (p.move?.type === 'dive' ? 0.6 : 0);
    if (d <= r) cands.push({ p, d });
  }
  if (!cands.length) return;
  cands.sort((a, c) => a.d - c.d);
  for (const c of cands) b.tried.add(c.p.id);
  const offC = cands.filter((c) => c.p.team === sim.possTeam && c.p.slot !== 'QB' && !['LT', 'LG', 'C', 'RG', 'RT'].includes(c.p.slot));
  const defC = cands.filter((c) => c.p.team !== sim.possTeam);
  const recDist = offC.length ? offC[0].d : 9;

  for (const dc of defC) {
    const d = dc.p;
    const reacted = d.task?.type === 'ball' || dc.d < 0.6;
    const userSwat = swatBonus(sim, d);
    let pPlay = 0.12 + sim.R(d, 'coverage') * 0.0035 + (recDist - dc.d) * 0.28 + (reacted ? 0.08 : -0.15) + (userSwat ? 0.25 : 0);
    if (b.kind === 'lob') {
      // Touch passes drop in over underneath defenders; a defender over the top can still play it.
      const qb = sim.players[b.thrower];
      const under = qb && Math.hypot(d.x - qb.x, d.z - qb.z) < Math.hypot(b.target.x - qb.x, b.target.z - qb.z) - 1;
      pPlay += under ? -0.1 : 0.03;
    }
    if (late) pPlay -= 0.1;
    pPlay = clamp(pPlay, 0.03, 0.95);
    if (rng.next() < pPlay) {
      // Base hands, then much better odds when the defender beat the receiver to the ball, when the
      // ball is thrown into a crowd, or when the receiver is out of the play entirely.
      const ir = sim.players[b.intended];
      const irDist = ir ? Math.hypot(ir.x - b.x, ir.z - b.z) : 9;
      const away = Math.min(recDist, irDist);
      const crowd = defC.filter((c) => c.d < 1.6).length;
      let pInt = (0.03 + sim.R(d, 'catching') * 0.0026) * (dc.d < 0.7 ? 1 : 0.5);
      pInt += clamp(away - dc.d - 0.2, 0, 1.5) * 0.12 + Math.max(0, crowd - 1) * 0.14;
      const clean = dc.d < 0.9 && away > 2 ? clamp(0.5 + (away - 2) / 1.5, 0, 1) : 0;
      pInt += (0.5 + sim.R(d, 'catching') * 0.004 - pInt) * clean;
      pInt = Math.min(0.9, pInt * (1 + 0.7 * sim.sl(d.team, 'interceptions')));
      if (b.tipped) pInt *= 0.4;
      if (recDist < 0.8) pInt *= 0.6;
      if (rng.next() < pInt && Math.abs(b.z) < HALF_WIDTH - 0.2) {
        interception(sim, d);
      } else {
        deflect(sim, d);
      }
      return;
    }
  }
  // Pass interference: a defender who didn't play the ball and is on top of the receiver.
  const ir = sim.players[b.intended];
  if (ir && !late) {
    for (const d of sim.players) {
      if (d.team === sim.possTeam || d.state !== 'active') continue;
      const dd = Math.hypot(d.x - ir.x, d.z - ir.z);
      const playingBall = d.task?.type === 'ball' && Math.hypot(d.x - b.x, d.z - b.z) < 1.2;
      if (dd < 0.75 && !playingBall && rng.next() < 0.22 * foulRate(sim)) {
        addFoul(sim, 'dpi', d.team, d, { spotX: b.x });
        break;
      }
    }
  }
  if (!offC.length) return;
  const rc = offC[0];
  const r = rc.p;
  let contest = 0;
  for (const d of sim.players) {
    if (d.team === sim.possTeam || d.state === 'down') continue;
    const dd = Math.hypot(d.x - r.x, d.z - r.z);
    if (dd < 2) contest += (2 - dd) * 0.13 * (sim.R(d, 'coverage') / 80);
  }
  let pCatch = 0.6 + sim.R(r, 'catching') * 0.0036 - contest - clamp((rc.d - 0.8) * 0.15, 0, 0.15);
  if (b.kind === 'bullet' && b.T < 0.45) pCatch -= 0.05;
  if (late) pCatch -= 0.15;
  if (b.tipped) pCatch -= 0.2;
  pCatch -= Math.max(0, b.T - 1.3) * 0.12; // long balls: more time for the defense to get a hand in
  pCatch += 0.12 * sim.sl(r.team, 'catching');
  pCatch = clamp(pCatch, 0.1, 0.97);
  if (Math.abs(r.z) > HALF_WIDTH - 0.15) {
    // Caught out of bounds.
    sim.emit('oobCatch', { player: r.id });
    incomplete(sim, 'oob');
    return;
  }
  if (rng.next() < pCatch) {
    sim.stats.receiver = r.id;
    sim.stats.catchX = r.x;
    r.anim = 'catch'; r.animT = 0;
    sim.emit('catch', { player: r.id, contested: contest > 0.15 });
    // Securing the catch costs a step, more so in traffic: gives defenders a chance to close.
    r.speedCap = contest > 0.15 ? 0.55 : 0.75;
    r.recoverAt = sim.t + 0.35;
    sim.setRunner(r, 'catch');
    // A defender closing on the catch gets a shot at him as the ball arrives.
    let hitter = null, hd = 2.2;
    for (const d of sim.players) {
      if (d.team === r.team || d.state !== 'active' || d.engagement) continue;
      const dx = r.x - d.x, dz = r.z - d.z, dd = Math.hypot(dx, dz);
      const closing = (d.vx * dx + d.vz * dz) / (dd || 1) > 2;
      if (dd < hd && (closing || dd < 1.2)) { hd = dd; hitter = d; }
    }
    if (hitter) attemptTackle(sim, hitter, r, false);
  } else {
    sim.emit('drop', { player: r.id });
    deflect(sim, r, 0.6);
  }
}

function interception(sim, d) {
  const b = sim.ball;
  sim.stats.intBy = d.id;
  d.anim = 'catch'; d.animT = 0;
  const td = sim.teamDir(d.team);
  d.caughtInEZ = d.x * td <= -50;
  sim.emit('interception', { player: d.id });
  b.state = 'held';
  sim.setRunner(d, 'interception');
}

function deflect(sim, p, mag = 1) {
  const b = sim.ball;
  const rng = sim.rng;
  b.vx = b.vx * 0.15 + rng.gauss(0, 2.5) * mag;
  b.vz = b.vz * 0.15 + rng.gauss(0, 2.5) * mag;
  b.vy = Math.abs(b.vy) * 0.15 + rng.range(0.8, 2.6) * mag;
  b.tipped = true;
  b.resolved = true;
  sim.emit('deflection', { player: p.id });
}

export function incomplete(sim, why) {
  const b = sim.ball;
  b.state = 'loose';
  b.vx *= 0.3; b.vz *= 0.3; b.vy = Math.max(0.5, Math.abs(b.vy) * 0.3);
  if (b.y < 0.12) b.y = 0.12;
  sim.emit('incomplete', { why });
  sim.whistle('incomplete');
}
