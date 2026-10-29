// Offensive line blocking, pass rush and block shedding.
import { addFoul, foulRate } from './fouls.js';
const ENGAGE_DIST = 1.05;
const CONTACT_DIST = 0.85;

const BLOCKER_TASKS = new Set(['pass_block', 'run_block', 'stalk', 'escort', 'kr_block']);

export function canBlock(sim, b) {
  return b.team === sim.possTeam && b.state === 'active' && !b.engagement && BLOCKER_TASKS.has(b.task?.type) && b.id !== sim.ball.carrier;
}

export function canBeBlocked(sim, d) {
  return d.team !== sim.possTeam && d.state === 'active' && !d.engagement && d.noEngageT <= 0;
}

export function engage(sim, b, d, mode) {
  const e = { b, d, t: 0, mode, helpers: [], bal: 0 };
  b.engagement = e;
  d.engagement = e;
  sim.engagements.push(e);
  sim.emit('engage', { b: b.id, d: d.id });
  return e;
}

export function updateBlocking(sim, dt) {
  // Form new engagements: blockers who are touching a defender they want to block.
  for (const b of sim.players) {
    if (!canBlock(sim, b)) continue;
    const tgtId = b.task.target;
    let best = null, bd = ENGAGE_DIST;
    for (const d of sim.players) {
      if (!canBeBlocked(sim, d)) continue;
      const dist = Math.hypot(d.x - b.x, d.z - b.z);
      if (dist < bd && (tgtId === undefined || tgtId === d.id || dist < 0.9)) { bd = dist; best = d; }
    }
    if (best) {
      const mode = sim.offPlay.type === 'pass' && !sim.ballLiveRun ? 'pass' : 'run';
      engage(sim, b, best, mode);
    }
  }
  // Double teams: a free pass blocker adjacent to an engaged rusher helps.
  for (const b of sim.players) {
    if (!canBlock(sim, b) || b.task.type !== 'pass_block' || b.task.target !== undefined) continue;
    for (const e of sim.engagements) {
      if (e.helpers.length || Math.hypot(e.d.x - b.x, e.d.z - b.z) > ENGAGE_DIST) continue;
      e.helpers.push(b);
      b.engagement = e;
      break;
    }
  }

  for (const e of [...sim.engagements]) updateEngagement(sim, e, dt);
}

function updateEngagement(sim, e, dt) {
  const { b, d } = e;
  if (b.state !== 'active' || (d.state !== 'active' && d.state !== 'engaged')) { sim.breakEngagement(e); return; }
  e.t += dt;
  const rng = sim.rng;
  const pass = e.mode === 'pass';
  const carrier = sim.carrier();

  // Power contest.
  const dPow = (pass ? sim.R(d, 'passRush') : sim.R(d, 'blockShed')) * 0.6 + sim.R(d, 'strength') * 0.4 + d.bulk * 6;
  let bPow = (pass ? sim.R(b, 'passBlock') : sim.R(b, 'runBlock')) * 0.6 + sim.R(b, 'strength') * 0.4 + b.bulk * 6;
  for (const h of e.helpers) bPow += ((pass ? sim.R(h, 'passBlock') : sim.R(h, 'runBlock')) * 0.6 + sim.R(h, 'strength') * 0.4) * 0.55;
  const diff = dPow - bPow + rng.gauss(0, 4);
  e.bal = e.bal * 0.95 + diff * 0.05;

  // Where the defender wants to go.
  let gx, gz;
  const qb = sim.bySlot(sim.offIdx, 'QB');
  if (carrier) { gx = carrier.x; gz = carrier.z; } else if (qb) { gx = qb.x; gz = qb.z; } else { gx = b.x; gz = b.z; }
  const mx = (b.x + d.x) / 2, mz = (b.z + d.z) / 2;
  let ux = gx - mx, uz = gz - mz;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul; uz /= ul;

  let speed;
  if (pass) {
    // Pocket slowly collapses when the rusher wins, holds when the blocker wins.
    speed = Math.max(0.08, Math.min(2.2, 0.6 + e.bal * 0.04)); // blockers anchor, never drive a rusher back
  } else {
    // Run blocking drives the defender toward the blocker's drive direction.
    const drive = b.task?.drive || { x: sim.dir, z: 0 };
    const push = Math.max(-1.6, Math.min(1.4, -e.bal * 0.06 - 0.2));
    // push > 0 means blocker winning: move along drive vector instead of toward the goal.
    if (push > 0) { ux = drive.x; uz = drive.z; speed = push; } else { speed = -push; }
  }
  const nmx = mx + ux * speed * dt, nmz = mz + uz * speed * dt;

  // Keep the pair facing each other across the contact axis; rotate the axis slightly as the defender works.
  let ax = d.x - b.x, az = d.z - b.z;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  // Defender rotates around the blocker toward his goal when winning.
  const side = Math.sign((gx - mx) * az - (gz - mz) * ax) || 1;
  const rot = Math.max(0, e.bal) * 0.004 * side * dt * 60;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const nax = ax * cr - az * sr, naz = ax * sr + az * cr;
  b.x = nmx - nax * CONTACT_DIST / 2; b.z = nmz - naz * CONTACT_DIST / 2;
  d.x = nmx + nax * CONTACT_DIST / 2; d.z = nmz + naz * CONTACT_DIST / 2;
  b.vx = (b.x - b.px) / dt; b.vz = (b.z - b.pz) / dt;
  d.vx = (d.x - d.px) / dt; d.vz = (d.z - d.pz) / dt;
  b.facing = Math.atan2(naz, nax);
  d.facing = Math.atan2(-naz, -nax);
  b.anim = 'block'; d.anim = 'block';
  for (const h of e.helpers) {
    h.x += (b.x - h.x) * 0.05; h.z += (b.z - h.z) * 0.05;
    h.facing = Math.atan2(d.z - h.z, d.x - h.x);
    h.anim = 'block';
  }

  // Holding: a beaten blocker grabs, mostly when the defender is about to make a play.
  if (e.bal > 6 && !sim.kick) {
    const target = pass ? qb : carrier;
    if (target && Math.hypot(target.x - d.x, target.z - d.z) < 4 && rng.next() < 0.05 * foulRate(sim) * dt * (e.bal / 8)) {
      addFoul(sim, 'holding_off', b.team, b, { spotX: b.x });
    }
  }
  // Shed chance.
  let rate = (pass ? 0.2 : 0.055) * Math.exp((dPow - bPow) / 13);
  if (!pass && carrier && Math.hypot(carrier.x - d.x, carrier.z - d.z) < 2) rate *= 4;
  if (pass && sim.passThrown) rate *= 0.5;
  // Sliders: blockers hold longer, rushers/defenders shed faster.
  rate *= (1 - 0.45 * sim.sl(b.team, pass ? 'passBlocking' : 'runBlocking')) * (1 + 0.45 * sim.sl(d.team, pass ? 'passRush' : 'runDefense'));
  if (b.task?.type === 'escort') rate *= sim.kick ? 10 : 3; // open-field blocks don't hold long
  if (b.task?.type === 'kr_block') rate *= 6; // gunners and coverage fight through return blocks
  if (e.t > 0.5 && rng.next() < rate * dt) shed(sim, e, gx, gz);
}

export function shed(sim, e, gx, gz) {
  const { b, d } = e;
  sim.breakEngagement(e);
  d.noEngageT = 1.0;
  b.state = 'stumble';
  b.stumbleT = 0.45;
  b.speedCap = 0.4;
  // Defender slips past toward the goal.
  const ux = gx - d.x, uz = gz - d.z;
  const ul = Math.hypot(ux, uz) || 1;
  d.vx = (ux / ul) * 2.5; d.vz = (uz / ul) * 2.5;
  sim.emit('shed', { d: d.id, b: b.id });
}

/** User pass rush move while engaged. type: 'swim' | 'spin' | 'bull'. */
export function passRushMove(sim, d, type) {
  const e = d.engagement;
  if (!e || e.d !== d || (d.rushMoveCd || 0) > sim.t) return;
  d.rushMoveCd = sim.t + 1.2;
  const pr = sim.R(d, 'passRush'), st = sim.R(d, 'strength');
  const pb = sim.R(e.b, 'passBlock'), bs = sim.R(e.b, 'strength');
  const atk = type === 'bull' ? st * 0.7 + pr * 0.3 : pr * 0.7 + sim.R(d, 'agility') * 0.3;
  const def = type === 'bull' ? bs * 0.6 + pb * 0.4 : pb * 0.8 + sim.R(e.b, 'awareness') * 0.2;
  const p = Math.max(0.1, Math.min(0.8, 0.35 + (atk - def) * 0.012 - e.helpers.length * 0.15));
  sim.emit('rushMove', { player: d.id, type });
  if (sim.rng.next() < p) {
    const qb = sim.bySlot(sim.offIdx, 'QB');
    shed(sim, e, qb ? qb.x : d.x, qb ? qb.z : d.z);
  } else {
    e.bal -= 6;
  }
}
