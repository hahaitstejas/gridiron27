// Between-play presentation (render-only; the sim and replays never see it):
//  - after the whistle players get up and jog to their huddles (offense behind the new spot, defense across),
//  - when the next play is set they break the huddle and run to the line (the session waits LINEUP_T before
//    a human can snap),
//  - a seven-man officiating crew works every play: positions by the ball, signals (touchdown, incomplete,
//    first down, penalties) and the referee faces the camera to announce fouls.
import { LINEUP_T } from '../game/session.js';
import { HALF_WIDTH } from '../core/constants.js';

const JOG = 4.2; // yd/s
const HUDDLE_DELAY = 0.8; // seconds after the whistle before players head to the huddle

// Officials: [name, downfield, lateral] from the ball in the offense frame (lateral 'S' = on the sideline).
const CREW = [
  ['R', -12, 4], // referee (white cap) behind the backfield, to the QB's arm side
  ['U', -7, -3], // umpire in the offensive backfield
  ['DJ', 0, 'S-'], // down judge on one sideline at the line
  ['LJ', 0, 'S+'], // line judge on the other
  ['SJ', 18, 'S+'], // side judge
  ['FJ', 18, 'S-'], // field judge
  ['BJ', 24, 0], // back judge deep in the middle
];

const SIGNAL = {
  holding_off: 'sig_holding', holding_def: 'sig_holding', dpi: 'sig_pi', offsides: 'sig_offside', offsides_live: 'sig_offside',
  false_start: 'sig_false_start', delay_of_game: 'sig_false_start', roughing: 'sig_personal', facemask_def: 'sig_personal',
  facemask_off: 'sig_personal', grounding: 'sig_pi',
};

function proxyOf(p) {
  return { id: p.id, team: p.team, number: p.number, skin: p.skin, height: p.height, bulk: p.bulk, slot: p.slot, pos: p.pos,
    state: 'active', move: null, x: p.x, z: p.z, px: p.x, pz: p.z, facing: p.facing, pfacing: p.facing, vx: 0, vz: 0, anim: 'idle', animT: 0, cycle: 0 };
}

export class Presentation {
  constructor() {
    this.spots = new Map(); // `${team}:${k}` -> { x, z, f } last shown position (huddle -> line-up hand-off)
    this.disp = []; // per player index proxy
    this.refs = CREW.map(([name], i) => ({ id: 100 + i, name, team: -1, number: 0, skin: i, height: i === 0 ? 2.02 : 1.98, bulk: 0.15,
      state: 'active', move: null, x: 0, z: 0, px: 0, pz: 0, facing: 0, pfacing: 0, vx: 0, vz: 0, anim: 'idle', animT: 0, cycle: 0, sig: null, sigT: 0 }));
    this.refsPlaced = false;
    this.mode = null;
    this.modeT = 0;
    this.lastSim = null;
    this.announce = null; // { sig, until }
  }

  /** Session events: officials react (TD, incomplete, flags, first downs). */
  onEvent(e, session) {
    const sim = session?.sim;
    if (!sim) return;
    const nearest = (x, z, skip = -1) => {
      let best = null, bd = 1e9;
      this.refs.forEach((r, i) => { if (i === skip) return; const d = Math.hypot(r.x - x, r.z - z); if (d < bd) { bd = d; best = r; } });
      return best;
    };
    const ball = sim.ball;
    if (e.type === 'touchdown') {
      // The two officials nearest the goal line signal it.
      const a = nearest(ball.x, ball.z);
      const b = nearest(ball.x, ball.z, this.refs.indexOf(a));
      for (const r of [a, b]) this.signal(r, 'sig_td', 3);
    } else if (e.type === 'incomplete' && e.why !== 'spike') this.signal(nearest(ball.x, ball.z), 'sig_incomplete', 1.8);
    else if (e.type === 'flag' && e.live) {
      // A flag flies on the field: the nearest official throws it.
      const pl = sim.players.find((p) => p.team === e.team) || null;
      this.signal(pl ? nearest(pl.x, pl.z) : this.refs[1], 'sig_flag', 0.6);
    } else if (e.type === 'flag' && e.outcome) {
      // After the play the referee announces it, facing the camera, with the signal for the foul.
      this.announce = { sig: SIGNAL[e.foul?.type] || 'sig_holding', t: 0 };
    } else if (e.type === 'result' && e.result && !e.result.touchdown && !e.result.turnover && e.result.offTeam === session.match.possession && session.match.down === 1 && session.match.phase === 'scrimmage' && !sim.isKick && (e.result.yards || 0) > 0) {
      this.signal(nearest(ball.x, ball.z), 'sig_first', 1.6);
    }
  }

  signal(r, sig, secs) { if (r) { r.sig = sig; r.sigT = secs; r.animT = 0; } }

  /**
   * Per frame: returns { display, refs } — display[i] overrides sim player i (or null when the sim's own
   * positions should be drawn), refs are the officials.
   */
  frame(session, sim, dt) {
    const m = session.match;
    if (sim !== this.lastSim) { this.lastSim = sim; this.mode = null; }
    const scrim = m.phase === 'scrimmage' || m.phase === 'try';
    const dir = m.dirOf(m.possession);
    const losX = m.xOf(m.possession, m.yardLine);
    const ballZ = m.phase === 'scrimmage' ? m.ballZ : 0;
    let display = null;
    const st = session.state;

    // ---- players ----
    const huddling = !sim.isKick && scrim && !session.fast && (st === 'post' || st === 'playcall' || (st === 'penalty')) && sim.state !== 'presnap';
    const lining = !sim.isKick && scrim && !session.fast && st === 'presnap' && sim.state === 'presnap' && session.presnapT < LINEUP_T && this.spots.size;
    const mode = huddling ? 'huddle' : lining ? 'lineup' : null;
    if (mode !== this.mode) { this.mode = mode; this.modeT = 0; if (mode === 'huddle') this.startHuddle(sim); }
    this.modeT += dt;
    if (mode === 'huddle') display = this.huddle(sim, m, dir, losX, ballZ, dt);
    else if (mode === 'lineup') display = this.lineup(sim, session.presnapT, dt);
    else if (!mode && sim.state === 'presnap') this.spots.clear();

    // ---- officials ----
    this.officials(sim, session, dir, losX, ballZ, dt);
    return { display, refs: this.refs, ballAt: mode === 'huddle' && this.modeT > HUDDLE_DELAY + 0.5 ? { x: losX, z: ballZ } : null };
  }

  startHuddle(sim) {
    sim.players.forEach((p, i) => {
      const d = (this.disp[i] = proxyOf(p));
      if (p.state === 'down' || p.state === 'tackled') { d.anim = 'down'; d.down = true; }
    });
  }

  /** Where player k of a team stands in its huddle (a ring facing the middle). */
  huddleSpot(off, k, dir, losX, ballZ) {
    const cx = losX - dir * (off ? 8 : -7), cz = ballZ;
    const a = (k / 11) * Math.PI * 2 + (off ? 0 : 0.3);
    const r = 1.75;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, cx, cz };
  }

  huddle(sim, m, dir, losX, ballZ, dt) {
    const count = [0, 0];
    sim.players.forEach((p, i) => {
      const d = this.disp[i];
      d.px = d.x; d.pz = d.z; d.pfacing = d.facing;
      const k = count[p.team]++;
      const off = p.team === m.possession;
      const s = this.huddleSpot(off, k, dir, losX, ballZ);
      d.animT += dt;
      if (this.modeT < HUDDLE_DELAY) {
        // A beat after the whistle: whoever is down stays down for a moment, the rest stand.
        if (!d.down) { d.anim = 'idle'; d.vx = d.vz = 0; }
      } else if (d.down && d.anim === 'down') { d.anim = 'getup'; d.animT = 0; }
      else if (d.anim === 'getup' && d.animT < 0.6) { /* getting up */ }
      else {
        const dx = s.x - d.x, dz = s.z - d.z, dist = Math.hypot(dx, dz);
        if (dist > 0.25) {
          const v = Math.min(JOG * (dist > 12 ? 1.3 : 1), dist / dt);
          d.vx = (dx / dist) * v; d.vz = (dz / dist) * v;
          d.x += d.vx * dt; d.z += d.vz * dt;
          d.facing = turn(d.facing, Math.atan2(dz, dx), dt * 8);
          if (d.anim !== 'run') { d.anim = 'run'; d.animT = 0; }
          d.cycle += dt * (2.2 + v * 1.05);
        } else {
          d.vx = d.vz = 0;
          d.facing = turn(d.facing, Math.atan2(s.cz - d.z, s.cx - d.x), dt * 6);
          if (d.anim !== 'huddle') { d.anim = 'huddle'; d.animT = 0; }
        }
      }
      this.spots.set(`${p.team}:${k}`, { x: d.x, z: d.z, f: d.facing });
    });
    return this.disp;
  }

  /** Break the huddle: everyone runs from where he was shown to his spot in the formation. */
  lineup(sim, t, dt) {
    const count = [0, 0];
    const k0 = Math.min(1, t / LINEUP_T);
    sim.players.forEach((p, i) => {
      const k = count[p.team]++;
      const from = this.spots.get(`${p.team}:${k}`);
      const d = (this.disp[i] ||= proxyOf(p));
      Object.assign(d, { id: p.id, team: p.team, number: p.number, skin: p.skin, height: p.height, bulk: p.bulk, slot: p.slot, pos: p.pos });
      d.px = d.x; d.pz = d.z; d.pfacing = d.facing;
      if (!from) { d.x = p.x; d.z = p.z; d.facing = p.facing; d.anim = p.anim; return; }
      if (k0 < 0.12) {
        // Clap and break.
        d.x = from.x; d.z = from.z; d.facing = from.f; d.vx = d.vz = 0;
        if (d.anim !== 'clap') { d.anim = 'clap'; d.animT = 0; }
        d.animT += dt;
        return;
      }
      const e = Math.min(1, (k0 - 0.12) / 0.8);
      const ease = e * e * (3 - 2 * e);
      const nx = from.x + (p.x - from.x) * ease, nz = from.z + (p.z - from.z) * ease;
      d.vx = (nx - d.x) / Math.max(dt, 1e-3); d.vz = (nz - d.z) / Math.max(dt, 1e-3);
      d.x = nx; d.z = nz;
      if (e < 1) {
        const sp = Math.hypot(d.vx, d.vz);
        if (sp > 0.3) d.facing = turn(d.facing, Math.atan2(d.vz, d.vx), dt * 10);
        if (d.anim !== 'run') { d.anim = 'run'; d.animT = 0; }
        d.cycle += dt * (2.2 + sp * 1.05);
      } else {
        // Set: settle into the stance the sim has him in.
        d.facing = turn(d.facing, p.facing, dt * 10);
        d.vx = d.vz = 0;
        if (d.anim !== p.anim) { d.anim = p.anim; d.animT = 0; }
      }
      d.animT += dt;
    });
    return this.disp;
  }

  officials(sim, session, dir, losX, ballZ, dt) {
    const b = sim.ball;
    const live = sim.state === 'live';
    // Ball position the crew keys on (the dead-ball spot after the whistle).
    const bx = live || sim.state === 'dead' ? b.x : losX, bz = live || sim.state === 'dead' ? b.z : ballZ;
    const lz = (side) => (side === 'S+' ? 1 : -1) * dir * (HALF_WIDTH + 1.2);
    const place = (spec, down) => {
      const [, d0, lat] = spec;
      const x = (sim.state === 'presnap' || !live ? losX : losX) + dir * (down ?? d0);
      const z = typeof lat === 'string' ? lz(lat) : ballZ + dir * lat;
      return { x, z };
    };
    if (!this.refsPlaced || sim.state === 'presnap' && !this.placedFor) {
      this.refs.forEach((r, i) => { const p = place(CREW[i]); r.x = r.px = p.x; r.z = r.pz = p.z; });
      this.refsPlaced = true;
    }
    this.placedFor = sim.state !== 'presnap' ? null : this.placedFor;
    if (this.announce) this.announce.t += dt;
    this.refs.forEach((r, i) => {
      r.px = r.x; r.pz = r.z; r.pfacing = r.facing;
      r.animT += dt;
      if (r.sigT > 0) r.sigT -= dt;
      const spec = CREW[i];
      let tx, tz, face = null;
      if (live) {
        // Work the play: sideline officials stay level with the ball, deep ones stay deeper than it,
        // everyone keeps a few yards from the ball carrier.
        const ballDown = (bx - losX) * dir;
        const base = place(spec);
        if (typeof spec[2] === 'string') { tx = bx - dir * 1; tz = base.z; }
        else if (spec[1] > 0) { tx = losX + dir * Math.max(spec[1], ballDown + 10); tz = bz * 0.5 + base.z * 0.5; }
        else { tx = base.x; tz = base.z; }
        const away = Math.hypot(r.x - bx, r.z - bz);
        if (away < 5) { tx = r.x + (r.x - bx) / (away || 1) * 2; tz = r.z + (r.z - bz) / (away || 1) * 2; }
        face = { x: bx, z: bz };
      } else if (this.announce && i === 0 && this.announce.t < 4) {
        // Referee announces the penalty from the middle of the field, facing the offense's backfield (camera).
        tx = losX - dir * 6; tz = ballZ;
        face = { x: losX - dir * 30, z: ballZ };
        if (Math.hypot(tx - r.x, tz - r.z) < 1.2) { r.sig = this.announce.sig; r.sigT = 0.2; }
      } else {
        // Between plays: walk back to the next play's spots (the nearest one spots the ball).
        const p = place(spec);
        tx = p.x; tz = p.z;
        face = { x: losX, z: ballZ };
      }
      if (!live && this.announce && this.announce.t >= 4) this.announce = null;
      const dx = tx - r.x, dz = tz - r.z, dist = Math.hypot(dx, dz);
      const signaling = r.sigT > 0 && r.sig !== 'sig_flag';
      if (dist > 0.3 && !signaling) {
        const v = Math.min(live ? 7.5 : 4.5, dist * 2.5, dist / dt);
        r.vx = (dx / dist) * v; r.vz = (dz / dist) * v;
        r.x += r.vx * dt; r.z += r.vz * dt;
        const moveF = Math.atan2(r.vz, r.vx);
        const want = face ? Math.atan2(face.z - r.z, face.x - r.x) : moveF;
        // Backpedal when the target is behind the way he wants to face.
        r.facing = turn(r.facing, Math.cos(moveF - want) < -0.2 ? want : moveF, dt * 7);
        r.cycle += dt * (2.2 + v * 1.05);
      } else {
        r.vx = r.vz = 0;
        if (face) r.facing = turn(r.facing, Math.atan2(face.z - r.z, face.x - r.x), dt * 5);
      }
      const sp = Math.hypot(r.vx, r.vz);
      const anim = r.sigT > 0 ? r.sig : sp > 0.5 ? (Math.cos(Math.atan2(r.vz, r.vx) - r.facing) < -0.2 ? 'backpedal' : 'run') : 'idle';
      if (anim !== r.anim) { r.anim = anim; r.animT = 0; }
    });
  }
}

function turn(a, b, max) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + Math.max(-max, Math.min(max, d));
}
