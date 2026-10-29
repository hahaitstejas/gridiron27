import { startThrow } from './passing.js';
import { startMove } from './tackling.js';
import { passRushMove } from './blocking.js';

const BULLET_HOLD = 0.17; // seconds held before a press becomes a bullet pass
const RECEIVER_BUTTONS = ['A', 'B', 'X', 'Y', 'RB'];

/**
 * Apply the human controller to the player they control. AI has already set a desired
 * velocity; stick input overrides it ("assisted" control when the stick is neutral).
 * Input: { lx, ly, rx, ry, lt, rt, down:{}, pressed:{}, released:{}, held:{}, flick:{} }
 */
export function applyHuman(sim, inp, dt) {
  let p = sim.players[sim.controlledId];
  if (!p) return;
  const cam = sim.camDir;
  // Stick to world: up = away from camera (along +camDir x), right = screen right (+z * camDir).
  const sx = -inp.ly * cam, sz = inp.lx * cam;
  const mag = Math.min(1, Math.hypot(inp.lx, inp.ly));
  const sprint = inp.rt > 0.5;
  const onOffense = p.team === sim.possTeam;

  if (!onOffense) {
    if (inp.pressed.B) {
      // Switch to the defender nearest the ball (or the next nearest if that's me).
      const b = sim.ball;
      const cands = sim.players.filter((q) => q.team === p.team && q.state !== 'down')
        .map((q) => ({ q, d: Math.hypot(q.x - b.x, q.z - b.z) })).sort((a, c) => a.d - c.d);
      const next = cands[0]?.q === p ? cands[1]?.q : cands[0]?.q;
      if (next) { sim.controlledId = next.id; p = next; sim.emit('switch', { player: p.id }); }
    }
  }
  p.userActive = mag > 0.2;
  if (p.state !== 'active') return;
  // Handoffs are automatic (no QB keepers on straight runs): the QB is locked until the mesh.
  if (p.task?.type === 'qb_handoff') {
    // Read option: hold LT through the mesh to keep it yourself.
    if (inp.lt > 0.5 && sim.offPlay.run?.style === 'read') p.task.forceKeep = true;
    p.userActive = false;
    return;
  }
  // Kickers follow the meter; the left stick aims (handled in kicking.js).
  if (p.task?.type === 'kicker' || p.task?.type === 'kneel' || p.task?.type === 'spike') { p.userActive = false; return; }
  // Returner while the kick is in the air: Y = fair catch (punts), X = kneel it in the end zone.
  if (sim.kick && p.task?.type === 'returner' && sim.ball.state === 'kick') {
    if (inp.pressed.Y && sim.kick.type === 'punt' && !p.fairCatch) { p.fairCatch = true; sim.emit('fairCatchSignal', { player: p.id }); }
    if (inp.pressed.X) p.kneel = true;
  }

  // Movement.
  if (p.userActive && !p.engagement && !(p.move && ['juke', 'dive', 'slide', 'tackle_dive', 'hitstick'].includes(p.move.type) && p.move.t < 0.3)) {
    const max = p.maxSpeed * p.speedCap * (sprint ? 1 : 0.86) * Math.max(0.35, mag);
    p.desired.x = (sx / (mag || 1)) * max * (mag > 0 ? 1 : 0);
    p.desired.z = (sz / (mag || 1)) * max * (mag > 0 ? 1 : 0);
    if (p.task?.type === 'qb_pass') p.task.phase = 'user';
  } else if (!p.userActive && sim.ball.carrier === p.id && sim.ball.state === 'held' && p.task?.type === 'carrier') {
    // Neutral stick on a ball carrier: AI keeps running (assisted).
  } else if (!p.userActive && p.task?.type === 'qb_pass' && p.task.phase === 'user') {
    p.desired.x = 0; p.desired.z = 0;
  }

  const b = sim.ball;
  const hasBall = b.state === 'held' && b.carrier === p.id;
  const isPasser = hasBall && p.slot === 'QB' && p.team === sim.offIdx && !sim.passThrown && !sim.qbCrossed && sim.offPlay.type === 'pass' && sim.possTeam === sim.offIdx;

  if (isPasser && b.state === 'held') {
    handlePassing(sim, p, inp);
    return;
  }
  if (hasBall) {
    handleCarrier(sim, p, inp, cam);
    return;
  }
  if (onOffense) {
    // Ball in the air to my receiver: optional user catch control is just movement.
    return;
  }
  handleDefense(sim, p, inp);
}

function handlePassing(sim, qb, inp) {
  const st = sim._passBtn || (sim._passBtn = { btn: null, t0: 0 });
  if (inp.pressed.RS) { startThrow(sim, qb, null, 'throwaway'); return; }
  if (inp.pressed.LS && !st.btn) { pumpFake(sim, qb); return; }
  for (const btn of RECEIVER_BUTTONS) {
    if (inp.pressed[btn] && sim.icons[btn] !== undefined && !st.btn) { st.btn = btn; st.t0 = sim.t; }
  }
  if (!st.btn) return;
  const held = sim.t - st.t0;
  const released = !inp.down[st.btn];
  if (released || held >= BULLET_HOLD) {
    const rec = sim.players[sim.icons[st.btn]];
    const kind = held >= BULLET_HOLD ? 'bullet' : 'lob';
    const cam = sim.camDir;
    const lead = Math.hypot(inp.lx, inp.ly) > 0.3 ? { x: -inp.ly * cam * 3, z: inp.lx * cam * 3 } : null;
    // Placement: hold LB for a high pass (over underneath defenders), LT for a low one (away from them).
    const place = inp.down.LB ? 'high' : inp.lt > 0.5 ? 'low' : null;
    if (startThrow(sim, qb, rec, kind, lead, place)) {
      sim.controlledId = rec.id; // follow the receiver once the ball is out
      sim.emit('userThrow', { kind, btn: st.btn });
    }
    st.btn = null;
  }
}

function handleCarrier(sim, p, inp, cam) {
  p.protect = !!inp.down.RB;
  if (p.task?.option && inp.pressed.LB && sim.pitchOption()) return; // speed option pitch
  const isQB = p.slot === 'QB';
  if (inp.pressed.A) startMove(sim, p, 'stiffarm');
  else if (inp.pressed.B) startMove(sim, p, 'spin');
  else if (inp.pressed.X) startMove(sim, p, isQB ? 'slide' : 'dive');
  else if (inp.pressed.Y) startMove(sim, p, 'hurdle');
  else if (inp.flick.up) startMove(sim, p, 'truck');
  else if (inp.flick.left || inp.flick.right) {
    // Juke toward the screen side the stick was flicked. Juke side vector is (-fz, fx) * dir;
    // screen right in world space is (0, cam).
    const want = inp.flick.right ? 1 : -1;
    const fx = Math.cos(p.facing);
    const dir = Math.abs(fx) > 0.3 ? Math.sign(fx * cam) * want : want;
    startMove(sim, p, 'juke', dir || want);
  }
}

function handleDefense(sim, p, inp) {
  const b = sim.ball;
  if (p.engagement && p.engagement.d === p) {
    if (inp.flick.left || inp.flick.right) passRushMove(sim, p, inp.flick.left ? 'swim' : 'spin');
    else if (inp.flick.up) passRushMove(sim, p, 'bull');
    return;
  }
  if (inp.pressed.A && b.state === 'air') {
    b.swatT?.set(p.id, sim.t);
    p.anim = 'swat'; p.animT = 0;
  }
  const c = sim.carrier();
  const faceCarrier = () => { if (c && Math.hypot(c.x - p.x, c.z - p.z) < 5) p.facing = Math.atan2(c.z - p.z, c.x - p.x); };
  if (inp.pressed.X) { faceCarrier(); startMove(sim, p, 'tackle_dive'); }
  else if (inp.pressed.Y) startMove(sim, p, 'strip');
  else if (inp.flick.up) { faceCarrier(); startMove(sim, p, 'hitstick'); }
}

/**
 * Pump fake (LS click): the QB shows a throw toward his first open read. Defenders in coverage may bite
 * (freeze for a moment): better awareness bites less. Once per 0.8 s.
 */
function pumpFake(sim, qb) {
  if (sim.t - (sim._pumpT ?? -9) < 0.8 || sim.pendingThrow) return;
  sim._pumpT = sim.t;
  qb.anim = 'throw'; qb.animT = 0.12;
  for (const d of sim.players) {
    if (d.team === qb.team || d.state !== 'active' || !['man', 'zone'].includes(d.task?.type)) continue;
    const bite = Math.max(0.12, Math.min(0.55, 0.75 - sim.R(d, 'awareness') * 0.006));
    if (sim.rng.next() < bite) { d.speedCap = Math.min(d.speedCap, 0.3); d.recoverAt = sim.t + 0.4; }
  }
  sim.emit('pumpFake', { qb: qb.id });
}
