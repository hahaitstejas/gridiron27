import { clamp } from '../core/math.js';
import { HALF_WIDTH } from '../core/constants.js';
import { injuryChance, rollInjury } from './injuries.js';
import { addFoul, foulRate } from './fouls.js';

// Ball-carrier moves: duration and the window during which they affect tackles.
export const MOVES = {
  juke: { dur: 0.45, window: 0.35, cd: 0.5 },
  spin: { dur: 0.55, window: 0.45, cd: 0.6 },
  stiffarm: { dur: 0.6, window: 0.55, cd: 0.4 },
  truck: { dur: 0.5, window: 0.45, cd: 0.5 },
  hurdle: { dur: 0.6, window: 0.5, cd: 0.8 },
  dive: { dur: 0.6, window: 0.6, cd: 1 },
  slide: { dur: 0.6, window: 0.6, cd: 1 },
  // Defender moves
  tackle_dive: { dur: 0.6, window: 0.4, cd: 1 },
  hitstick: { dur: 0.45, window: 0.35, cd: 1 },
  strip: { dur: 0.4, window: 0.35, cd: 0.8 },
};

export function startMove(sim, p, type, dir = 0) {
  const m = MOVES[type];
  if (!m || p.move || (p.moveCd || 0) > sim.t || p.state !== 'active' || p.engagement) return false;
  p.move = { type, t: 0, dur: m.dur, window: m.window, dir, startFacing: p.facing };
  // A sliding runner gives himself up: the ball is spotted where the slide begins.
  if (type === 'slide' && sim.ball.state === 'held' && sim.ball.carrier === p.id) p.slideSpot = sim.carrierBallPos(p);
  p.anim = type;
  p.animT = 0;
  sim.emit('move', { player: p.id, type });
  return true;
}

export function updateMoves(sim, dt) {
  for (const p of sim.players) {
    const m = p.move;
    if (!m) continue;
    m.t += dt;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    switch (m.type) {
      case 'juke': {
        // Burst sideways early in the move.
        if (m.t < 0.25) {
          const sx = -fz * m.dir, sz = fx * m.dir;
          const s = p.maxSpeed * (0.75 + sim.R(p, 'agility') * 0.002);
          p.desired.x = sx * s + fx * s * 0.45;
          p.desired.z = sz * s + fz * s * 0.45;
          p.vx += (p.desired.x - p.vx) * Math.min(1, dt * 14);
          p.vz += (p.desired.z - p.vz) * Math.min(1, dt * 14);
        }
        break;
      }
      case 'spin':
        p.speedCap = 0.85;
        break;
      case 'truck':
        p.speedCap = 0.95;
        break;
      case 'dive':
      case 'slide':
        if (m.t < 0.3) { p.desired.x = fx * p.maxSpeed; p.desired.z = fz * p.maxSpeed; }
        else if (p.state === 'active' && sim.ball.carrier === p.id && sim.ball.state === 'held') {
          // Carrier gives himself up: down by contact with the ground.
          sim.tackleCarrier(p, null, 0);
          p.fallT = 0.1;
        }
        break;
      case 'tackle_dive':
        if (m.t < 0.3) {
          p.desired.x = fx * p.maxSpeed * 1.25; p.desired.z = fz * p.maxSpeed * 1.25;
          p.vx = p.desired.x; p.vz = p.desired.z;
        } else if (p.state === 'active') {
          p.state = 'down'; p.downT = 1.2; p.anim = 'down'; p.animT = 0;
        }
        break;
      case 'hitstick':
        if (m.t < 0.3) { p.desired.x = fx * p.maxSpeed * 1.05; p.desired.z = fz * p.maxSpeed * 1.05; }
        break;
    }
    if (m.t >= m.dur) {
      p.move = null;
      p.moveCd = sim.t + (MOVES[m.type]?.cd ?? 0.5);
      if (p.state === 'active' && (m.type === 'spin' || m.type === 'truck')) p.speedCap = 1;
    }
  }
}

function moveActive(p, type) {
  return p.move && p.move.type === type && p.move.t <= p.move.window;
}

export function updateTackles(sim, dt) {
  if (sim.state !== 'live') return;
  if (sim.kick && !sim.kick.launched) return; // nobody gets to the punter/holder before the kick
  const c = sim.carrier();
  if (!c || c.state === 'tackled' || c.state === 'down') return;
  const air = moveActive(c, 'hurdle') && c.move.t > 0.1 && c.move.t < 0.45;
  for (const d of sim.players) {
    if (d.team === c.team || d.state === 'down' || d.state === 'tackled' || d.tackleCd > 0) continue;
    const dist = Math.hypot(d.x - c.x, d.z - c.z);
    // Near the sideline a pursuer on the inside shoves the runner out of bounds.
    if (!d.engagement && d.state === 'active' && dist < 1.6 && Math.abs(c.z) > HALF_WIDTH - 2.2 && Math.abs(d.z) < Math.abs(c.z)) {
      c.vz += Math.sign(c.z) * 9 * dt;
    }
    let reach = 1.05;
    if (moveActive(d, 'tackle_dive')) reach = 1.8;
    else if (moveActive(d, 'hitstick')) reach = 1.15;
    if (d.engagement) reach = 0.65;
    if (d.state === 'stumble') reach = 0.6;
    if (dist > reach) continue;
    attemptTackle(sim, d, c, air);
    if (c.state === 'tackled' || sim.state !== 'live' || sim.carrier() !== c) return;
  }
}

export function attemptTackle(sim, d, c, air) {
  const rng = sim.rng;
  d.tackleCd = 1.0;
  const tak = sim.R(d, 'tackling');
  const btk = sim.R(c, 'breakTackle');
  let p = 0.72 + (tak - btk) * 0.006;
  // Approach angle: hits from the side/behind are harder to escape.
  const fx = Math.cos(c.facing), fz = Math.sin(c.facing);
  let rx = d.x - c.x, rz = d.z - c.z;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const front = fx * rx + fz * rz; // 1 = directly in front
  if (front < -0.2) p += 0.14;
  else if (front < 0.4) p += 0.05;
  const cSpeed = Math.hypot(c.vx, c.vz);
  if (cSpeed > 7 && front > 0.3) p -= 0.05;
  if (d.engagement) p = 0.18 + (tak - btk) * 0.003;
  // QB sneak / short-yardage pile: the surge behind him is hard to stop right at the line.
  if (c.task?.sneak && Math.abs(sim.toLocal(c.x, c.z).down) < 1.8) p *= 0.45;

  let knockDown = false;
  let bigHit = false;
  const brokenBy = c.move?.type;
  if (moveActive(c, 'juke') && front > -0.1) p *= 1 - (0.22 + sim.R(c, 'agility') * 0.0025) + sim.R(d, 'awareness') * 0.001;
  else if (moveActive(c, 'spin') && front > -0.4) p *= 1 - (0.15 + sim.R(c, 'agility') * 0.0025);
  else if (moveActive(c, 'stiffarm') && front > -0.3) {
    p *= 1 - clamp(0.15 + (sim.R(c, 'strength') * 0.5 + btk * 0.5 - tak * 0.4) * 0.004, 0.1, 0.55);
    knockDown = true;
  } else if (moveActive(c, 'truck') && front > 0.2) {
    const atk = sim.R(c, 'strength') * 0.5 + btk * 0.5 + c.bulk * 15;
    const def = tak * 0.5 + sim.R(d, 'strength') * 0.5 + d.bulk * 15;
    if (atk - def + rng.gauss(0, 10) > 0) { p = 0; knockDown = true; } else { p = 0.97; bigHit = true; }
  } else if (air) {
    p = moveActive(d, 'tackle_dive') ? 0.05 : p + 0.08;
  }
  if (moveActive(d, 'tackle_dive')) p += 0.05;
  if (moveActive(d, 'hitstick')) { p += 0.06; bigHit = true; }
  if (moveActive(d, 'strip')) p -= 0.12;
  // Gang tackling.
  for (const o of sim.players) {
    if (o === d || o.team === c.team || o.state !== 'active' || o.engagement) continue;
    if (Math.hypot(o.x - c.x, o.z - c.z) < 1.4) p += 0.1;
  }
  if (sim.difficulty) p += c.team === sim.humanTeam ? (sim.difficulty.cpuTackle ?? 0) : -(sim.difficulty.humanTackle ?? 0);
  p += 0.12 * sim.sl(d.team, 'tackling');
  p = clamp(p, 0.04, 0.97);

  if (rng.next() < p) {
    const power = Math.hypot(c.vx - d.vx, c.vz - d.vz) / 10 + (bigHit ? 0.6 : 0);
    // Wrap and fall forward with momentum.
    d.anim = 'tackle'; d.animT = 0;
    d.state = 'down'; d.downT = 1.2;
    d.vx = c.vx * 0.5; d.vz = c.vz * 0.5;
    c.vx *= bigHit ? 0.2 : 0.55; c.vz *= bigHit ? 0.2 : 0.55;
    if (bigHit) sim.emit('bigHit', { player: c.id, tackler: d.id });
    // Fumble? More likely on big hits and strip attempts, less when protecting the ball.
    let pf = 0.008 + (sim.R(d, 'hitPower') - sim.R(c, 'carrying')) * 0.0005 + (bigHit ? 0.05 : 0) + (moveActive(d, 'strip') ? 0.12 : 0);
    if (front < -0.2) pf += 0.01;
    if (c.protect) pf *= 0.3;
    pf *= 1 + 0.8 * sim.sl(c.team, 'fumbles');
    if (sim.difficulty) pf *= c.team === sim.humanTeam ? (sim.difficulty.humanFumble ?? 1) : (sim.difficulty.cpuFumble ?? 1);
    const fumbled = sim.rng.next() < Math.max(0.002, pf);
    if (sim.rng.next() < 0.006 * foulRate(sim)) addFoul(sim, 'facemask_def', d.team, d, { spotX: c.x });
    sim.tackleCarrier(c, d, power);
    // Injuries (off unless the session sets an injury rate).
    const rate = sim.cfg.injuryRate || 0;
    if (rate > 0) {
      if (!c.injured && sim.rng.next() < injuryChance(c, power, bigHit, rate)) injure(sim, c);
      else if (bigHit && !d.injured && sim.rng.next() < injuryChance(d, 0.3, false, rate) * 0.3) injure(sim, d);
    }
    if (fumbled) sim.fumble(c, d);
  } else {
    // Broken tackle.
    if (knockDown || moveActive(d, 'tackle_dive') || moveActive(d, 'hitstick')) {
      d.state = 'down'; d.downT = knockDown ? 1.4 : 1.1; d.anim = 'down'; d.animT = 0;
      d.move = null;
    } else {
      d.state = 'stumble'; d.stumbleT = 0.7; d.speedCap = 0.35; d.anim = 'stumble'; d.animT = 0;
    }
    c.speedCap = Math.min(c.speedCap, 0.8);
    c.recoverAt = sim.t + 0.35;
    sim.emit('brokenTackle', { player: c.id, tackler: d.id, move: brokenBy || null });
  }
}

/** Hurt a player: he finishes this play, then the session keeps him out (see game/session.js). */
function injure(sim, p) {
  const inj = rollInjury(sim.rng);
  p.injured = inj;
  sim.injuries.push({ id: p.id, rid: p.rid, team: p.team, name: p.name, pos: p.pos, number: p.number, ...inj });
  sim.emit('injury', { player: p.id, ...inj });
}
