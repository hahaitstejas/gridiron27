// Trick plays and laterals (pure sim logic). A play's `trick` field drives the scripted part:
//   flea    { back }            QB hands to the back, who runs at the line and pitches it back; the QB throws deep
//   double  { passer, qbRoute } QB laterals to a receiver behind the line who throws (qbRoute: the QB goes out too)
//   ladder  { from, to }        hook and ladder: after the catch `from` laterals to `to` trailing him
//   reverse { to }              run: the back takes the handoff and gives it to a receiver coming the other way
// Laterals in general: any carrier can pitch the ball to a teammate level with or behind him (human: LB); on the last
// play of a half the CPU does it when he's about to go down ("last gasp").
import { seek } from './movement.js';

const BACKWARD_OK = 0.4; // yards: a "lateral" thrown forward more than this would be an illegal forward pass

/** Can `from` lateral to `to` right now (backward or level)? */
export function canLateral(sim, from, to) {
  if (!to || to === from || to.team !== from.team || to.state !== 'active') return false;
  const td = sim.teamDir(from.team);
  return (to.x - from.x) * td <= BACKWARD_OK && Math.hypot(to.x - from.x, to.z - from.z) < 14;
}

/** Pitch the ball from the carrier to a teammate. `then` = what the receiver does with it ('run' | 'qb' | 'passer'). */
export function lateral(sim, from, to, then = 'run') {
  const b = sim.ball;
  if (b.state !== 'held' || b.carrier !== from.id || !canLateral(sim, from, to)) return false;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  b.state = 'snap'; b.t = 0; b.T = 0.22 + dist * 0.032; b.from = { x: from.x, y: 1.2, z: from.z }; b.carrier = to.id;
  b.trick = then;
  // Long or hurried pitches get away now and then.
  b.trickDrop = sim.rng.chance(dist > 7 ? 0.09 : dist > 4 ? 0.04 : 0.015) && then === 'run';
  from.anim = 'throw'; from.animT = 0.15;
  if (from.task?.type === 'carrier') from.task = { type: 'escort' };
  sim.stats.laterals = (sim.stats.laterals || 0) + 1;
  sim.emit('lateral', { from: from.id, to: to.id });
  return true;
}

/** The ball reached the target of a lateral (called from PlaySim.updateBall). */
export function lateralArrived(sim, p) {
  const b = sim.ball;
  const then = b.trick; b.trick = null;
  if (b.trickDrop) { b.trickDrop = false; sim.fumble(p, null); return; }
  b.state = 'held';
  if (then === 'qb') { sim.emit('snapCaught'); return; } // the flea flicker comes back to the QB: he's still a passer
  if (then === 'passer') {
    makePasser(sim, p);
    sim.emit('snapCaught');
    return;
  }
  sim.setRunner(p, 'lateral');
}

function makePasser(sim, p) {
  p.trickPasser = true;
  p.task = { type: 'qb_pass', drop: 0, phase: 'set', start: { x: p.x, z: p.z }, dropTo: { x: p.x - sim.dir * 1.5, z: p.z }, setT: sim.t };
  sim.trickReady = true;
  // Receiver buttons: the new passer gives his up; a quarterback running a route takes one.
  for (const [k, id] of Object.entries(sim.icons)) if (id === p.id) delete sim.icons[k];
  const qb = sim.bySlot(sim.offIdx, 'QB');
  if (qb?.task?.type === 'route') { const free = ['A', 'B', 'X', 'Y', 'RB'].find((k) => sim.icons[k] === undefined); if (free) sim.icons[free] = qb.id; }
  // A human on that side takes the new passer.
  for (const t of sim.humanTeams) if (t === p.team) sim.withHuman(t, () => { if (sim.lockId < 0) sim.controlledId = p.id; });
}

/** Best teammate to pitch to: behind or level, nobody on top of him. */
export function lateralTarget(sim, c) {
  let best = null, bs = 1e9;
  for (const q of sim.players) {
    if (q.team !== c.team || q === c || !canLateral(sim, c, q) || q.slot === 'K' || q.slot === 'P') continue;
    const d = Math.hypot(q.x - c.x, q.z - c.z);
    let near = 99;
    for (const o of sim.players) if (o.team !== c.team && o.state === 'active') near = Math.min(near, Math.hypot(o.x - q.x, o.z - q.z));
    if (d > 10 || near < 1.6) continue;
    const s = d - Math.min(near, 8) * 0.8;
    if (s < bs) { bs = s; best = q; }
  }
  return best;
}

/** Per tick, after the offense AI: run the play's scripted trick, and last-gasp laterals. */
export function updateTricks(sim, dt) {
  const tr = sim.offPlay.trick;
  const b = sim.ball;
  const st = sim.trickState || (sim.trickState = { phase: 0 });
  if (tr && !sim.passThrown && sim.possTeam === sim.offIdx) {
    const qb = sim.bySlot(sim.offIdx, 'QB');
    if (tr.type === 'flea') {
      const rb = sim.bySlot(sim.offIdx, tr.back || 'RB');
      if (st.phase === 0 && b.state === 'held' && b.carrier === qb?.id && rb && sim.t > 0.45 && Math.hypot(rb.x - qb.x, rb.z - qb.z) < 1.8) {
        // The handoff is real: the back takes it toward the line (everyone sees a run)...
        b.carrier = rb.id; st.phase = 1; st.until = sim.t + 0.75;
        rb.task = { type: 'flea_run' };
        sim.fleaShow = sim.t;
        sim.emit('handoff', { from: qb.id, to: rb.id });
      } else if (st.phase === 1 && rb) {
        const to = sim.toWorld(-1.6, rb.at?.[1] ?? 0);
        seek(rb, to.x, to.z, 0.7, 0.4);
        if (sim.t > st.until && b.state === 'held' && b.carrier === rb.id && qb?.state === 'active') {
          // ...and turns and pitches it back to the quarterback.
          st.phase = 2;
          lateral(sim, rb, qb, 'qb');
          rb.task = { type: 'pass_block' };
          sim.trickReady = true;
        }
      }
    } else if (tr.type === 'double') {
      const passer = sim.bySlot(sim.offIdx, tr.passer);
      if (st.phase === 0 && b.state === 'held' && b.carrier === qb?.id && passer && sim.t > 0.35) {
        if (canLateral(sim, qb, passer) && sim.toLocal(passer.x, passer.z).down < -0.5) {
          st.phase = 1;
          lateral(sim, qb, passer, 'passer');
          if (tr.qbRoute) { qb.task = sim.makeRoute(qb, tr.qbRoute); qb.task.late = true; } else qb.task = { type: 'pass_block' };
        } else if (sim.t > 1.6) { st.phase = 9; sim.trickReady = true; } // never came open behind the line: QB plays it out
      }
    } else if (tr.type === 'reverse') {
      const to = sim.bySlot(sim.offIdx, tr.to);
      const c = sim.carrier();
      // The receiver comes back across behind the line until the back meets him.
      if (to && st.phase === 0) {
        if (to.task?.type !== 'trick_run') to.task = { type: 'trick_run' };
        const side = -(sim.offPlay.run?.side || 1);
        const goal = sim.toWorld(-3.5, side * 6);
        seek(to, goal.x, goal.z, 0.95, 0.3);
        if (c && c.slot === (sim.offPlay.run?.carrier || 'RB') && sim.t > 0.9 && Math.hypot(to.x - c.x, to.z - c.z) < 4.5) {
          st.phase = 1;
          lateral(sim, c, to, 'run');
        } else if (sim.t > 2.4) { st.phase = 9; to.task = { type: 'escort' }; }
      }
    }
  }
  // Hook and ladder: after the catch the receiver pitches to the man trailing him.
  if (tr?.type === 'ladder' && st.phase === 0 && b.state === 'held' && sim.stats.receiver !== null && sim.stats.receiver !== undefined) {
    const from = sim.bySlot(sim.offIdx, tr.from), to = sim.bySlot(sim.offIdx, tr.to);
    const c = sim.carrier();
    if (c && from && c === from && !sim.isHumanControlled(c)) {
      st.catchT ??= sim.t;
      if (to) {
        // The trailer swings underneath, a few yards behind the catch.
        const tl = sim.toLocal(c.x, c.z);
        const goal = sim.toWorld(tl.down - 2.5, tl.lat + (tl.lat > 0 ? -3 : 3));
        if (to.state === 'active') { to.task = { type: 'trick_run' }; seek(to, goal.x, goal.z, 1, 0.3); }
        if (sim.t - st.catchT > 0.45 && lateral(sim, c, to, 'run')) st.phase = 1;
      }
      if (sim.t - st.catchT > 1.5) st.phase = 9;
    } else if (c && c !== from) st.phase = 9;
  }
  // Last gasp: on the final play the CPU carrier pitches it before he goes down.
  if (sim.cfg.lastGasp && b.state === 'held' && sim.possTeam === sim.offIdx && sim.ballLiveRun) {
    const c = sim.carrier();
    if (c && !sim.isHumanControlled(c) && c.state === 'active' && (sim.stats.laterals || 0) < 4) {
      let near = 99;
      for (const o of sim.players) if (o.team !== c.team && o.state === 'active') near = Math.min(near, Math.hypot(o.x - c.x, o.z - c.z));
      if (near < 1.5 && sim.t - (sim.lastLateralT ?? -9) > 0.6) {
        const to = lateralTarget(sim, c);
        if (to && lateral(sim, c, to, 'run')) sim.lastLateralT = sim.t;
      }
    }
  }
}
