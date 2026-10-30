import { GOAL_X, END_X, HALF_WIDTH, GRAVITY } from '../core/constants.js';

const WIND_PUSH = 0.12; // wind acceleration on a kicked ball, per yd/s of wind
import { clamp } from '../core/math.js';
import { seek, stop } from './movement.js';

// Special teams: kick meter, kick physics, field goals, kickoffs/punts and their returns.
// The kicking team is the PlaySim "offense" (sim.offIdx, attacking sim.dir).

export const GOALPOST_HALF_WIDTH = 3.08; // 18'6" between uprights
export const CROSSBAR = 3.33; // 10 ft

// ---------- Kick meter (classic three-press) ----------
// Press 1 starts the power bar rising, press 2 sets power, then the needle falls back; press 3
// near the accuracy line sets accuracy. Error is how far from the line the third press was.
export const METER = { riseTime: 1.0, fallSpeed: 1.5, accLine: 0.08, floor: -0.22 };

export function newMeter() {
  return { phase: 'idle', t: 0, value: 0, power: 0, accuracy: 0, needle: 0 };
}

export function meterPress(m) {
  if (m.phase === 'idle') { m.phase = 'power'; m.t = 0; m.value = 0; }
  else if (m.phase === 'power') { m.power = m.value; m.phase = 'accuracy'; m.t = 0; m.needle = m.value; }
  else if (m.phase === 'accuracy') { m.accuracy = m.needle - METER.accLine; m.phase = 'done'; }
}

export function updateMeter(m, dt) {
  if (m.phase === 'power') {
    m.t += dt;
    m.value = Math.min(1, m.t / METER.riseTime);
    if (m.value >= 1) { m.power = 1; m.phase = 'accuracy'; m.t = 0; m.needle = 1; }
  } else if (m.phase === 'accuracy') {
    m.t += dt;
    m.needle = m.power - m.t * METER.fallSpeed;
    if (m.needle <= METER.floor) { m.accuracy = METER.floor - METER.accLine; m.phase = 'done'; }
  }
}

// ---------- Kick physics ----------
const KICKS = {
  deep: { angle: 44, range: (kpw) => 44 + kpw * 0.3 },
  squib: { angle: 14, range: (kpw) => (30 + kpw * 0.15) },
  onside: { angle: 30, range: () => 13 },
  punt: { angle: 61, range: (kpw) => 40 + kpw * 0.25 },
  fg: { angle: 33, range: (kpw) => 44 + kpw * 0.24 },
};

export function kickRange(type, kpw, power = 1) {
  return KICKS[type].range(kpw) * power;
}

/**
 * Blocked kicks: a rusher right in front of the kicker as the ball comes off his foot may get a hand on it.
 * Long field goals fly lower and are easier to block; punts are harder (the punter is deeper). Real rates
 * are ~1-2% of field goals (more from 50+) and well under 1% of punts.
 */
/**
 * Field goal / punt protection: a free rusher wading through the wall of linemen barely moves (the human's
 * rusher too), so getting a hand on the kick takes a well-timed rush through a gap. Applied as a speed cap.
 */
export function protectionWall(sim) {
  const k = sim.kick;
  if (!k || (k.type !== 'fg' && k.type !== 'punt')) return;
  for (const p of sim.players) {
    if (p.team === sim.offIdx || p.engagement || p.state !== 'active') continue;
    let wall = 1;
    if (!k.launched) {
      for (const o of sim.players) {
        if (o.team !== sim.offIdx || o.task?.type !== 'pass_block') continue;
        const dd = Math.hypot(o.x - p.x, o.z - p.z);
        if (dd < WALL_R) wall = Math.min(wall, WALL_MIN + (dd / WALL_R) * (1 - WALL_MIN));
      }
    }
    p.speedCap = wall;
  }
}
const WALL_R = 1.5, WALL_MIN = 0.5;

function blockCheck(sim, kicker, type, range) {
  const kl = sim.toLocal(kicker.x, kicker.z);
  const low = type === 'fg' ? 0.6 + Math.max(0, range - 38) / 30 : 0.45;
  for (const d of sim.players) {
    if (d.team === kicker.team || d.state !== 'active' || d.engagement) continue;
    const dist = Math.hypot(d.x - kicker.x, d.z - kicker.z);
    if (dist > 2.6 || sim.toLocal(d.x, d.z).down < kl.down + 0.4) continue;
    const reach = Math.pow((2.6 - dist) / 2.6, 1.5) * 0.45 * low * (sim.isHumanControlled(d) ? 1.15 : 1);
    if (sim.rng.next() < reach) {
      const b = sim.ball;
      // The ball pops up and dies short of the line.
      b.vx = b.vx * 0.12 + sim.rng.gauss(0, 1.5); b.vz = b.vz * 0.12 + sim.rng.gauss(0, 2); b.vy = sim.rng.range(2, 5);
      b.target = { x: b.x + b.vx * 0.8, z: b.z + b.vz * 0.8 };
      b.T = 0.8;
      sim.kick.blocked = true;
      sim.emit('kickBlocked', { player: d.id, kind: type });
      return true;
    }
  }
  return false;
}

/** Field-goal distance in yards from a line of scrimmage (yard line = yards from own goal). */
export const fgDistance = (yardLine) => 100 - yardLine + 17;

/**
 * Launch the ball. params: { type: deep|squib|onside|punt|fg, power 0..1, accuracy (meter error),
 * aim -1..1 (left/right) }.
 */
export function launchKick(sim, kicker, params) {
  const b = sim.ball;
  const kac = sim.R(kicker, 'kickAccuracy');
  const kpw = sim.R(kicker, 'kickPower');
  const type = params.type;
  const spec = KICKS[type];
  // A mis-timed meter press is a shank, not a dribbler that dies at the tee.
  const power = clamp(params.power, type === 'fg' ? 0.05 : type === 'squib' ? 0.6 : 0.45, 1);
  const kickKey = type === 'fg' ? 'fg' : type === 'punt' ? 'punt' : 'kickoff';
  const R = (type === 'onside' ? spec.range(kpw) : spec.range(kpw) * power) * (1 + 0.15 * sim.sl(kicker.team, kickKey + 'Power'));
  const theta = (spec.angle * Math.PI) / 180;
  const v = Math.sqrt((R * GRAVITY) / Math.sin(2 * theta));
  // Aim: a point downfield; field goals aim at the posts.
  let ax, az;
  const sx = b.x, sz = b.z;
  if (type === 'fg') {
    ax = GOAL_X * sim.dir + 10 * sim.dir; // goalposts sit on the end line
    az = clamp(params.aim || 0, -1, 1) * 6;
  } else {
    ax = sx + sim.dir * R;
    az = sz + clamp(params.aim || 0, -1, 1) * (type === 'punt' ? 14 : type === 'onside' ? 8 : 18);
  }
  let yaw = Math.atan2(az - sz, ax - sx);
  // Accuracy: meter error (hook/slice) scaled by the kicker's accuracy, plus a little natural noise.
  // Real kickers miss: ~3 deg spread for an 85-accuracy CPU kicker. A human's meter press replaces
  // most of that randomness with skill.
  const human = sim.humanTeam === sim.offIdx;
  const noise = (human ? 0.5 + (100 - kac) * 0.04 : 1.0 + (100 - kac) * 0.1) * (type === 'fg' ? 0.7 + 0.5 * power : 1) * (1 - 0.5 * sim.sl(kicker.team, kickKey + 'Accuracy'));
  const errDeg = (params.accuracy || 0) * 26 * (1.3 - kac / 100) + sim.rng.gauss(0, noise);
  yaw += (errDeg * Math.PI) / 180 * (sim.dir > 0 ? 1 : -1);
  const vh = v * Math.cos(theta);
  b.state = 'kick';
  b.kind = type;
  b.x = sx; b.z = sz; b.y = type === 'fg' || type === 'punt' ? 0.5 : 0.2;
  b.vx = Math.cos(yaw) * vh;
  b.vz = Math.sin(yaw) * vh;
  b.vy = v * Math.sin(theta);
  b.t = 0;
  b.carrier = -1;
  b.bounces = 0;
  b.kicker = kicker.id;
  b.kickedFrom = { x: sx, z: sz };
  // Predicted landing point (ignoring bounces) for returners and coverage.
  const T = (2 * b.vy) / GRAVITY;
  b.T = T;
  b.target = { x: sx + b.vx * T + 0.5 * sim.wind.x * WIND_PUSH * T * T, z: sz + b.vz * T + 0.5 * sim.wind.z * WIND_PUSH * T * T };
  sim.kick.launched = true;
  sim.kick.style = type; // deep / squib / onside / punt / fg (kick.type stays kickoff/punt/fg)
  sim.possTeam = sim.defIdx; // ball belongs to nobody in the air; the receiving team blocks
  sim.emit('kick', { kind: type, power, kicker: kicker.id });
  if (type === 'fg' || type === 'punt') blockCheck(sim, kicker, type, R);
  for (const p of sim.players) {
    if (p.team === sim.offIdx && p.task && ['pass_block', 'hold_kick', 'cover_wait'].includes(p.task.type)) p.task = { type: 'cover', safety: !!p.task.safety };
    if (p.engagement) sim.breakEngagement(p.engagement);
  }
  // A human on the kicking team takes over a coverage man in the middle of the field.
  if (sim.humanTeam === sim.offIdx && type !== 'fg') {
    let best = null, bd = 1e9;
    for (const p of sim.players) {
      if (p.team !== sim.offIdx || p.task?.type !== 'cover') continue;
      const d = Math.abs(p.z - b.target.z) + (p.slot === 'C' ? 50 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) sim.controlledId = best.id;
  }
}

// ---------- Setup at the snap ----------
export function setupSpecialSnap(sim) {
  const type = sim.offPlay.type;
  const k = (sim.kick = { type, launched: false, snapDone: type === 'kickoff', kickerId: -1, resolved: false });
  const kickerSlot = type === 'punt' ? 'P' : 'K';
  const kicker = sim.bySlot(sim.offIdx, kickerSlot);
  k.kickerId = kicker ? kicker.id : -1;
  for (const p of sim.players) {
    p.state = 'active';
    if (p.team === sim.offIdx) {
      if (p.id === k.kickerId) p.task = { type: 'kicker' };
      else if (p.slot === 'H') p.task = { type: 'hold_kick' };
      else if (type === 'kickoff') p.task = { type: 'cover_wait', safety: p.slot === 'L5' || p.slot === 'R5' };
      else if (p.slot === 'GL' || p.slot === 'GR') p.task = { type: 'cover' };
      else p.task = { type: 'pass_block', releaseAt: type === 'punt' && p.slot !== 'C' ? 1.0 : 99 };
    } else {
      if (p.slot === 'KR' || p.slot === 'PR') p.task = { type: 'returner' };
      else if (type === 'punt' && /^V/.test(p.slot)) {
        const g = sim.bySlot(sim.offIdx, p.slot[1] === 'L' ? 'GL' : 'GR');
        p.task = { type: 'kr_block', target: g ? g.id : undefined, drive: { x: -sim.dir, z: 0 } };
      } else if (type === 'kickoff') p.task = { type: 'kr_block', drive: { x: -sim.dir, z: 0 } };
      else p.task = { type: 'st_rush' };
    }
  }
  // Long snap to the punter / holder.
  if (type === 'punt' || type === 'fg') {
    const to = type === 'punt' ? kicker : sim.bySlot(sim.offIdx, 'H');
    const c = sim.bySlot(sim.offIdx, 'C');
    if (to && c) {
      sim.ball.state = 'snap';
      sim.ball.t = 0;
      sim.ball.T = type === 'punt' ? 0.75 : 0.42;
      sim.ball.from = { x: c.x, y: 0.4, z: c.z };
      sim.ball.carrier = to.id;
    }
  } else {
    sim.ball.state = 'tee';
  }
  sim.emit('snap');
}

/** CPU kick decisions (power/accuracy/aim) for the kicking team. */
export function cpuKickParams(sim, kicker) {
  const type = sim.offPlay.type;
  const kac = sim.R(kicker, 'kickAccuracy');
  const rng = sim.rng;
  const accErr = 0; // CPU spread comes from launchKick's rating-based noise
  if (type === 'fg') {
    const dist = Math.abs(GOAL_X * sim.dir + 10 * sim.dir - sim.ball.x);
    const need = (dist + 6) / kickRange('fg', sim.R(kicker, 'kickPower'));
    return { type: 'fg', power: clamp(need * 1.08 + 0.05, 0.6, 1), accuracy: accErr, aim: 0 };
  }
  if (type === 'punt') {
    const toGoal = (GOAL_X - sim.ball.x * sim.dir);
    const full = kickRange('punt', sim.R(kicker, 'kickPower'));
    // Pin it deep: from midfield-ish, aim to land around the 10 instead of into the end zone.
    const power = toGoal - 10 < full ? clamp((toGoal - 10) / full, 0.45, 1) : clamp(0.92 + rng.gauss(0, 0.05), 0.7, 1);
    return { type: 'punt', power, accuracy: accErr, aim: rng.gauss(0, 0.25) };
  }
  const style = sim.offPlay.kick || 'deep';
  return { type: style, power: clamp(0.93 + rng.gauss(0, 0.05), 0.7, 1), accuracy: accErr, aim: rng.gauss(0, 0.3) };
}

// ---------- Per-tick special teams logic ----------
export function updateSpecial(sim, dt, input) {
  const k = sim.kick;
  if (!k) return;
  const b = sim.ball;
  const kicker = sim.players[k.kickerId];
  const humanKicks = sim.humanTeam === sim.offIdx;
  protectionWall(sim);
  // Human meter.
  if (humanKicks && sim.meter && !k.launched) {
    if (input?.pressed.A && sim.meter.phase !== 'done' && sim.meter.phase !== 'idle') meterPress(sim.meter);
    updateMeter(sim.meter, dt);
    if (input) sim.kickAim = clamp(sim.kickAim + input.lx * dt * 1.2 * (sim.camDir > 0 ? 1 : -1), -1, 1);
  }
  const ready = !humanKicks || (sim.meter && sim.meter.phase === 'done');
  const params = () => humanKicks
    ? { type: sim.offPlay.type === 'kickoff' ? sim.offPlay.kick || 'deep' : sim.offPlay.type, power: sim.meter.power, accuracy: sim.meter.accuracy, aim: sim.kickAim }
    : cpuKickParams(sim, kicker);

  if (!k.launched && kicker && kicker.state === 'active') {
    if (k.type === 'kickoff') {
      // Approach and kick off the tee.
      // Approach right away; kick once at the ball and the meter is set.
      if (sim.t > 0.3) {
        const d = seek(kicker, b.x - sim.dir * 0.4, b.z, 0.75, ready ? 0.05 : 1.2);
        kicker.face = { x: b.x + sim.dir * 10, z: b.z };
        if (ready && d < 0.5) { kicker.anim = 'kick'; kicker.animT = 0; launchKick(sim, kicker, params()); }
      } else stop(kicker);
    } else if (k.type === 'punt') {
      if (b.state === 'held' && b.carrier === kicker.id) {
        k.heldT = (k.heldT || 0) + dt;
        stop(kicker);
        kicker.face = { x: kicker.x + sim.dir * 10, z: kicker.z };
        if (ready && k.heldT > (humanKicks ? 0.35 : 0.85)) { kicker.anim = 'kick'; kicker.animT = 0; launchKick(sim, kicker, params()); }
      } else stop(kicker);
    } else if (k.type === 'fg') {
      const holder = sim.bySlot(sim.offIdx, 'H');
      const held = b.state === 'held' && holder && b.carrier === holder.id;
      if (held) {
        k.heldT = (k.heldT || 0) + dt;
        b.y = 0.35;
        if (k.heldT > 0.2) {
          const d = seek(kicker, holder.x + sim.dir * 0.2, holder.z - 0.5, 0.55, ready ? 0.05 : 1.0);
          kicker.face = { x: kicker.x + sim.dir * 10, z: kicker.z };
          if (ready && d < 0.7) {
            kicker.anim = 'kick'; kicker.animT = 0;
            b.x = holder.x + sim.dir * 0.5; b.z = holder.z;
            launchKick(sim, kicker, params());
          }
        } else stop(kicker);
      } else stop(kicker);
    }
  }

  // Ball in flight after the kick.
  if (b.state === 'kick') updateKickFlight(sim, dt);
  runSpecialAI(sim, dt);
}

function updateKickFlight(sim, dt) {
  const b = sim.ball;
  const k = sim.kick;
  b.t += dt;
  const px = b.x;
  b.vy -= GRAVITY * dt;
  // Wind pushes the ball while it's up.
  b.vx += sim.wind.x * WIND_PUSH * dt; b.vz += sim.wind.z * WIND_PUSH * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  b.spin += dt * 12;

  if (k.type === 'fg') {
    const plane = (GOAL_X + 10) * sim.dir;
    if (!k.resolved && (px - plane) * (b.x - plane) <= 0) {
      k.resolved = true;
      const good = Math.abs(b.z) < GOALPOST_HALF_WIDTH && b.y > CROSSBAR;
      k.fgGood = good;
      sim.emit(good ? 'fieldGoal' : 'fgMiss', { wide: Math.abs(b.z) >= GOALPOST_HALF_WIDTH, short: b.y <= CROSSBAR });
      sim.whistle('fg');
    } else if (!k.resolved && b.y <= 0.15) {
      k.resolved = true;
      k.fgGood = false;
      sim.emit('fgMiss', { short: true });
      sim.whistle('fg');
    }
    return;
  }

  // Catchable kicks: in the air on the way down, or loose on the ground after a bounce.
  const onGround = b.bounces > 0 && b.y <= 0.35;
  if ((b.vy < 0 && b.y < 2.6 && b.y > 0.3) || onGround) {
    // The kicking team can only recover a kickoff once it has gone 10 yards.
    const traveled = (b.x - b.kickedFrom.x) * sim.dir;
    for (const p of sim.players) {
      if (p.state !== 'active' || p.engagement) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      const isRet = p.task?.type === 'returner';
      if (d > (isRet || onGround ? 1.2 : 0.7)) continue;
      // Only the receiving team fields kicks in the air (kicking team must let it land, except onside).
      if (p.team === sim.offIdx && !(k.type === 'kickoff' && b.bounces > 0 && traveled >= 10)) continue;
      if (p.team === sim.defIdx && !isRet && b.bounces === 0) continue;
      if ((p.team === sim.offIdx || (k.style === 'onside' && !isRet)) && !securesLooseKick(sim, p)) continue;
      catchKick(sim, p);
      return;
    }
  }
  // Out of bounds or through the end zone.
  if (Math.abs(b.z) > HALF_WIDTH) { kickDead(sim, 'kickOOB'); return; }
  if (b.x * sim.dir > END_X) { kickDead(sim, 'touchback'); return; }

  if (b.y <= 0.12 && b.vy < 0) {
    b.y = 0.12;
    b.bounces++;
    if (b.bounces === 1) sim.emit('kickLanded', {});
    // Pointy ball: unpredictable bounces that lose speed.
    const sp = Math.hypot(b.vx, b.vz);
    const yaw = Math.atan2(b.vz, b.vx) + sim.rng.gauss(0, 0.5);
    const keep = k.style === 'onside' ? 0.75 : 0.55;
    b.vx = Math.cos(yaw) * sp * keep;
    b.vz = Math.sin(yaw) * sp * keep;
    b.vy = Math.abs(b.vy) * (0.3 + sim.rng.next() * 0.25);
    if (sp * keep < 1.2 && b.vy < 1) { b.vx = b.vz = b.vy = 0; }
  }
  // Ball stopped rolling: punts are downed where they stop (in the end zone = touchback).
  const rolling = Math.hypot(b.vx, b.vz);
  if (b.bounces > 0 && (rolling < 1.2 || b.t > 7.5)) {
    if (k.type === 'punt') {
      // Kicking team downs it once it settles (or it dies on its own).
      const toucher = sim.players.find((p) => p.team === sim.offIdx && Math.hypot(p.x - b.x, p.z - b.z) < 1.2);
      if (toucher || b.t > 7.5) kickDead(sim, b.x * sim.dir > GOAL_X ? 'touchback' : 'downed');
    } else if (b.x * sim.dir > GOAL_X) kickDead(sim, 'touchback');
    else {
      // A loose kickoff nobody falls on is the receiving team's ball where it stops.
      k.restT = (k.restT || 0) + dt;
      if (k.restT > 2.5) kickDead(sim, 'downed');
    }
  }
}

/**
 * Someone gets a hand on a loose kickoff. Onside kicks hop and spin, so even the receiving team's
 * hands team doesn't always secure it; the kicking team has it much harder, especially in a scrum.
 * A failed try knocks the ball loose.
 */
function securesLooseKick(sim, p) {
  if ((p.recoverTry || 0) > sim.t) return false;
  p.recoverTry = sim.t + 0.5;
  const b = sim.ball;
  const hands = sim.R(p, 'catching') * 0.002;
  let chance;
  if (p.team === sim.defIdx) chance = 0.5 + hands;
  else {
    const crowd = sim.players.filter((q) => q.team === sim.defIdx && q.state === 'active' && Math.hypot(q.x - b.x, q.z - b.z) < 2.2).length;
    chance = (0.6 + hands) * (crowd ? 1 / crowd : 1);
  }
  if (sim.rng.next() < chance) return true;
  // Batted around: squirts off in a random direction.
  const a = sim.rng.next() * Math.PI * 2, sp = 2 + sim.rng.next() * 3;
  b.vx = Math.cos(a) * sp; b.vz = Math.sin(a) * sp; b.vy = 1.2;
  b.y = Math.max(b.y, 0.2);
  return false;
}

function catchKick(sim, p) {
  const b = sim.ball;
  const k = sim.kick;
  b.state = 'held';
  p.anim = 'catch'; p.animT = 0;
  const recvDir = sim.teamDir(sim.defIdx);
  k.caughtAt = { x: b.x, z: b.z };
  sim.stats.returner = p.team === sim.defIdx ? p.id : null;
  sim.emit('kickCaught', { player: p.id });
  if (p.team === sim.offIdx) {
    // Kicking team recovered (onside kick).
    sim.emit('onsideRecovered', { player: p.id });
    sim.possTeam = sim.offIdx;
    sim.setRunner(p, 'onside');
    return;
  }
  // Fair catch (punts): called while the ball was in the air.
  if (k.type === 'punt' && p.fairCatch) {
    b.carrier = p.id;
    sim.possTeam = sim.defIdx;
    kickDead(sim, 'fairCatch');
    return;
  }
  // Kneel in the end zone for a touchback.
  const deep = -b.x * recvDir - GOAL_X; // yards deep in own end zone (positive = in end zone)
  if (deep > 0 && (p.kneel || (!sim.isHumanControlled(p) && deep > 2.5 && k.type === 'kickoff'))) {
    b.carrier = p.id;
    sim.possTeam = sim.defIdx;
    kickDead(sim, 'touchback');
    return;
  }
  p.caughtInEZ = deep > 0;
  sim.setRunner(p, 'return');
  // Securing a kick costs a beat before the return gets going.
  p.speedCap = 0.55; p.recoverAt = sim.t + 0.45; p.vx *= 0.4; p.vz *= 0.4;
}

/** Kick play ends without a live return. */
function kickDead(sim, why) {
  const k = sim.kick;
  k.endReason = why;
  sim.possTeam = sim.defIdx;
  sim.emit(why, {});
  sim.whistle(why);
}

function runSpecialAI(sim, dt) {
  const b = sim.ball;
  const k = sim.kick;
  for (const p of sim.players) {
    // Punt protection blocks briefly, then releases into coverage.
    if (p.task?.type === 'pass_block' && p.task.releaseAt !== undefined && sim.t > p.task.releaseAt && !k.launched) {
      if (p.engagement) sim.breakEngagement(p.engagement);
      p.task = { type: 'cover' };
    }
    if (p.state !== 'active' || p.engagement) continue;
    const t = p.task?.type;
    if (sim.isHumanControlled(p) && p.userActive && t !== 'kicker') continue;
    switch (t) {
      case 'cover_wait': {
        // Kickoff coverage: creep to the ball line as the kicker approaches, then go on the kick.
        const w = sim.toWorld(-0.6, sim.toLocal(p.x, p.z).lat);
        seek(p, w.x, w.z, 0.3, 0.5);
        break;
      }
      case 'cover': {
        const ret = sim.players.find((q) => q.team === sim.defIdx && q.task?.type === 'returner');
        const tgt = b.state === 'kick' && !b.bounces ? b.target : b;
        // Stay in lanes until close, then converge on the returner/ball.
        const lat0 = sim.toLocal(p.alignX, p.alignZ).lat;
        const d = Math.hypot(tgt.x - p.x, tgt.z - p.z);
        const laneZ = tgt.z + sim.dir * lat0 * clamp((d - 8) / 40, 0, 0.6);
        if (b.state === 'kick' && (k.style === 'onside' || b.bounces > 0)) {
          // Onside or loose kick: race to where it comes down, then attack the ball itself.
          if (!b.bounces && b.target) seek(p, b.target.x, b.target.z, 1, 0.05);
          else seek(p, b.x + b.vx * 0.25, b.z + b.vz * 0.25, 1, 0.05);
        } else if (ret && d < 14) seek(p, ret.x, ret.z, 1, 0.1);
        else seek(p, tgt.x - sim.dir * (d > 15 ? 4 : 0), laneZ, 1, 0.5);
        break;
      }
      case 'hold_kick':
        stop(p);
        p.face = { x: p.x + sim.dir * 10, z: p.z };
        break;
      case 'returner': {
        if (b.state === 'kick' && b.bounces > 0 && k.type === 'kickoff') {
          // Short or bouncing kickoff: go get it.
          seek(p, b.x, b.z, 1, 0.1);
        } else if (b.state === 'kick' && b.target) {
          // Field the kick; let punts landing inside the 10 bounce into the end zone.
          const recvDir = sim.teamDir(sim.defIdx);
          const landYL = GOAL_X + b.target.x * recvDir; // yards from own goal line
          const avoid = k.type === 'punt' && landYL < 9 && !sim.isHumanControlled(p);
          if (avoid) seek(p, b.target.x + recvDir * 6, b.target.z, 0.8, 1);
          else seek(p, b.target.x, b.target.z, 1, 0.4);
          p.face = { x: b.x, z: b.z };
          // CPU fair catch when the coverage will be on him as the ball arrives.
          if (k.type === 'punt' && !p.fairCatch && !sim.isHumanControlled(p) && b.T - b.t < 1.2) {
            const left = Math.max(0, b.T - b.t);
            const close = sim.players.some((q) => q.team === sim.offIdx && Math.hypot(q.x - b.target.x, q.z - b.target.z) < 3 + q.maxSpeed * left * 0.45);
            if (close) { p.fairCatch = true; sim.emit('fairCatchSignal', { player: p.id }); }
          }
        } else if (b.state === 'kick') stop(p);
        else if (b.state === 'tee' || b.state === 'snap' || (b.state === 'held' && !sim.ballLiveRun)) stop(p);
        break;
      }
      case 'kr_block': {
        // Set up a wall in front of the landing spot, then block whoever comes through.
        if (b.state === 'kick' && b.bounces > 0 && Math.hypot(b.x - p.x, b.z - p.z) < 10) { seek(p, b.x, b.z, 1, 0.1); break; } // loose ball: fall on it
        if (b.state === 'kick' && k.style === 'onside' && b.t > 0.35 && b.target && Math.hypot(b.target.x - p.x, b.target.z - p.z) < 25) {
          // Onside: the front line attacks the ball instead of setting up blocks.
          seek(p, b.bounces ? b.x : b.target.x, b.bounces ? b.z : b.target.z, 1, 0.1);
          break;
        }
        const tgt = b.state === 'kick' && b.target ? b.target : null;
        if (!tgt) {
          if (k.type === 'punt' && p.task.target !== undefined) {
            const g = sim.players[p.task.target];
            seek(p, g.x + sim.dir * 1, g.z, 0.9, 0.2);
          } else stop(p);
          break;
        }
        const lat0 = sim.toLocal(p.alignX, p.alignZ).lat;
        const wallX = tgt.x - sim.dir * 12;
        const wallZ = clamp(tgt.z + sim.dir * lat0 * 0.35, -HALF_WIDTH + 2, HALF_WIDTH - 2);
        let threat = null, td = 9;
        for (const q of sim.players) {
          if (q.team !== sim.offIdx || q.engagement || q.state !== 'active') continue;
          const dd = Math.hypot(q.x - p.x, q.z - p.z);
          if (dd < td) { td = dd; threat = q; }
        }
        if (threat && (threat.x - wallX) * sim.dir > -3) { p.task.target = threat.id; seek(p, threat.x, threat.z, 0.9, 0.2); }
        else seek(p, wallX, wallZ, 0.95, 1);
        break;
      }
      case 'st_rush': {
        const kicker = sim.players[k.kickerId];
        if (!k.launched && kicker) seek(p, kicker.x, kicker.z, 1, 0.1);
        else if (b.state === 'kick' && b.target) {
          // Turn and set up blocks for the return.
          seek(p, b.target.x - sim.dir * 15, clamp(p.z, -20, 20), 0.8, 1);
        } else stop(p);
        break;
      }
      case 'kicker':
        if (k.launched) {
          // After the kick the kicker is the safety valve: stay back, then pursue.
          const tgt = b.state === 'kick' && b.target ? b.target : b;
          seek(p, tgt.x - sim.dir * 25, tgt.z * 0.5, 0.6, 2);
        }
        break;
    }
  }
}
