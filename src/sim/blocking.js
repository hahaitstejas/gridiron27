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
    // Kick protection: everyone holds a gap, so they pick up rushers a little wider.
    let best = null, bd = sim.kick && !sim.kick.launched ? 1.45 : ENGAGE_DIST;
    for (const d of sim.players) {
      if (!canBeBlocked(sim, d)) continue;
      const dist = Math.hypot(d.x - b.x, d.z - b.z);
      if (dist < bd && (tgtId === undefined || tgtId === d.id || dist < 0.9)) { bd = dist; best = d; }
    }
    if (best) {
      const mode = (sim.offPlay.type === 'pass' || (sim.kick && !sim.kick.launched)) && !sim.ballLiveRun ? 'pass' : 'run';
      engage(sim, b, best, mode);
    }
  }
  // Double teams: a free pass blocker adjacent to an engaged rusher helps (not on kicks: everyone has a gap).
  for (const b of sim.kick ? [] : sim.players) {
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
  // A user who keeps working (stick held) gets a little extra leverage.
  const diff = dPow - bPow + rng.gauss(0, 4) + (d.userActive && sim.isHumanControlled(d) ? 3 : 0);
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
  // Field goal / punt protection is a wall of big bodies for ~1.3 s: rushers rarely get clean through.
  if (sim.kick && b.team === sim.offIdx && b.task?.type === 'pass_block' && !sim.kick.launched) rate *= 0.22;
  if (b.task?.type === 'escort') rate *= sim.kick ? 10 : 3; // open-field blocks don't hold long
  if (b.task?.type === 'kr_block') rate *= sim.ball.state === 'kick' ? (sim.kick?.type === 'punt' ? 2 : 3) : 8; // coverage fights through return blocks (vises hold gunners a bit longer)
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

/**
 * User pass-rush moves while engaged (A / RS up: bull rush, X / RS left: swim, Y / RS right: spin, RS down: rip).
 * Each is a rating contest against the blocker: power moves use strength, finesse moves use pass rush and
 * agility. A good edge beats an average tackle more often than not; double teams are hard to beat.
 */
export const RUSH_MOVES = {
  bull: { atk: (s, d) => s.R(d, 'strength') * 0.6 + s.R(d, 'passRush') * 0.4, def: (s, b) => s.R(b, 'strength') * 0.55 + s.R(b, 'passBlock') * 0.45 },
  swim: { atk: (s, d) => s.R(d, 'passRush') * 0.65 + s.R(d, 'agility') * 0.35, def: (s, b) => s.R(b, 'passBlock') * 0.7 + s.R(b, 'agility') * 0.3 },
  spin: { atk: (s, d) => s.R(d, 'passRush') * 0.55 + s.R(d, 'agility') * 0.25 + s.R(d, 'acceleration') * 0.2, def: (s, b) => s.R(b, 'passBlock') * 0.75 + s.R(b, 'awareness') * 0.25 },
  rip: { atk: (s, d) => s.R(d, 'passRush') * 0.5 + s.R(d, 'strength') * 0.5, def: (s, b) => s.R(b, 'passBlock') * 0.6 + s.R(b, 'strength') * 0.4 },
};

export function passRushMove(sim, d, type) {
  const e = d.engagement;
  if (!e || e.d !== d || (d.rushMoveCd || 0) > sim.t) return;
  const mv = RUSH_MOVES[type] || RUSH_MOVES.swim;
  const edge = mv.atk(sim, d) - mv.def(sim, e.b);
  // Quick get-off (a move early in the rep) helps; each extra blocker hurts.
  const p = Math.max(0.12, Math.min(0.85, 0.2 + edge * 0.013 + (e.t < 1 ? 0.06 : 0) - e.helpers.length * 0.18));
  sim.emit('rushMove', { player: d.id, kind: type });
  const qb = sim.bySlot(sim.offIdx, 'QB');
  if (sim.rng.next() < p) {
    d.rushMoveCd = sim.t + 0.9;
    if (type === 'bull') {
      // Walk the blocker back into the pocket; often that's enough to shed him too.
      e.bal += 18;
      if (sim.rng.next() < 0.3) shed(sim, e, qb ? qb.x : d.x, qb ? qb.z : d.z);
    } else {
      shed(sim, e, qb ? qb.x : d.x, qb ? qb.z : d.z);
      if (type === 'spin') { d.speedCap = 1; d.recoverAt = 0; }
    }
    sim.emit('rushWin', { player: d.id, kind: type });
  } else {
    // A missed move costs ground (a failed spin most of all).
    d.rushMoveCd = sim.t + 1.8;
    e.bal -= type === 'spin' ? 10 : 6;
  }
}
