// Instant replay. The recorder stores one compact frame per sim tick (positions, facing, animation,
// ball); the player rebuilds a lightweight "ghost" sim from those frames so the normal renderer can
// draw it. Pure logic (no Three.js/DOM): the app drives it and picks the camera.
import { STEP } from '../core/constants.js';

const PF = 11; // floats per player per frame: x z facing anim animT state vx vz move moveT cycle
const BF = 11; // ball: x y z vx vy vz spin state carrier possTeam -

export class ReplayRecorder {
  constructor() { this.reset(); }

  reset() {
    this.frames = [];
    this.strings = [];
    this.index = new Map();
    this.meta = null;
  }

  str(s) {
    if (s === null || s === undefined) return -1;
    let i = this.index.get(s);
    if (i === undefined) { i = this.strings.length; this.strings.push(s); this.index.set(s, i); }
    return i;
  }

  /** Call every sim tick from the snap until the play is finished. */
  capture(sim) {
    if (!this.meta) {
      this.meta = {
        players: sim.players.map((p) => ({ id: p.id, rid: p.rid, team: p.team, slot: p.slot, pos: p.pos, number: p.number, name: p.name, skin: p.skin, height: p.height, bulk: p.bulk })),
        offIdx: sim.offIdx, defIdx: sim.defIdx, dir: sim.dir, losX: sim.losX, ballZ: sim.ballZ, play: sim.offPlay?.name,
      };
    }
    const n = sim.players.length;
    const f = new Float32Array(n * PF + BF);
    for (let i = 0; i < n; i++) {
      const p = sim.players[i], o = i * PF;
      f[o] = p.x; f[o + 1] = p.z; f[o + 2] = p.facing;
      f[o + 3] = this.str(p.anim); f[o + 4] = p.animT || 0; f[o + 5] = this.str(p.state);
      f[o + 6] = p.vx; f[o + 7] = p.vz;
      f[o + 8] = this.str(p.move?.type); f[o + 9] = p.move?.t || 0; f[o + 10] = p.cycle || 0;
    }
    const b = sim.ball, o = n * PF;
    f[o] = b.x; f[o + 1] = b.y; f[o + 2] = b.z; f[o + 3] = b.vx || 0; f[o + 4] = b.vy || 0; f[o + 5] = b.vz || 0;
    f[o + 6] = b.spin || 0; f[o + 7] = this.str(b.state); f[o + 8] = b.carrier ?? -1; f[o + 9] = sim.possTeam;
    this.frames.push(f);
  }

  /** The finished recording (or null if nothing was captured). */
  take() {
    if (!this.frames.length) return null;
    const r = { meta: this.meta, frames: this.frames, strings: this.strings, duration: (this.frames.length - 1) * STEP };
    this.reset();
    return r;
  }
}

/** Plays a recording back through a ghost sim object the renderer can draw. */
export class ReplayPlayer {
  constructor(rec) {
    this.rec = rec;
    this.t = 0;
    const m = rec.meta;
    this.ghost = {
      players: m.players.map((p) => ({ ...p, x: 0, z: 0, px: 0, pz: 0, facing: 0, pfacing: 0, vx: 0, vz: 0, anim: 'stance', animT: 0, state: 'active', move: null, cycle: 0 })),
      ball: { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, spin: 0, state: 'held', carrier: -1 },
      humanTeam: null, controlledId: -1, offIdx: m.offIdx, defIdx: m.defIdx, possTeam: m.offIdx, dir: m.dir, losX: m.losX,
      ballZ: m.ballZ ?? 0, state: 'live', replay: true,
      // The same helpers PlaySim offers, for render code that needs them (e.g. celebration poses).
      toWorld(down, lat) { return { x: this.losX + this.dir * down, z: this.ballZ + this.dir * lat }; },
      toLocal(x, z) { return { down: (x - this.losX) * this.dir, lat: (z - this.ballZ) * this.dir }; },
      teamDir(team) { return team === this.offIdx ? this.dir : -this.dir; },
      carrier() { return this.ball.state === 'held' && this.ball.carrier >= 0 ? this.players[this.ball.carrier] : null; },
    };
    this.seek(0);
  }

  get duration() { return this.rec.duration; }

  /** Move to time t (seconds) and fill the ghost; returns the interpolation alpha for the renderer. */
  seek(t) {
    const { frames, strings } = this.rec;
    this.t = Math.max(0, Math.min(this.duration, t));
    const fi = this.t / STEP;
    const i = Math.min(frames.length - 1, Math.floor(fi));
    const j = Math.min(frames.length - 1, i + 1);
    const a = frames[i], b = frames[j];
    const s = (k) => (k < 0 ? null : strings[k]);
    const g = this.ghost;
    g.players.forEach((p, n) => {
      const o = n * PF;
      p.px = a[o]; p.pz = a[o + 1]; p.pfacing = a[o + 2];
      p.x = b[o]; p.z = b[o + 1]; p.facing = b[o + 2];
      p.anim = s(b[o + 3]); p.animT = b[o + 4]; p.state = s(b[o + 5]);
      p.vx = b[o + 6]; p.vz = b[o + 7];
      const mv = s(b[o + 8]);
      p.move = mv ? { type: mv, t: b[o + 9], window: 99, dur: 99 } : null;
      p.cycle = b[o + 10];
    });
    const o = g.players.length * PF;
    const B = g.ball;
    B.px = a[o]; B.py = a[o + 1]; B.pz = a[o + 2];
    B.x = b[o]; B.y = b[o + 1]; B.z = b[o + 2];
    B.vx = b[o + 3]; B.vy = b[o + 4]; B.vz = b[o + 5]; B.spin = b[o + 6];
    B.state = s(b[o + 7]); B.carrier = b[o + 8]; g.possTeam = b[o + 9];
    return fi - i;
  }

  /** The ball's (interpolated) position, for the camera. */
  focus() {
    const B = this.ghost.ball;
    if (B.state === 'held' && B.carrier >= 0) { const c = this.ghost.players[B.carrier]; return { x: c.x, y: 1, z: c.z }; }
    return { x: B.x, y: Math.max(0.5, B.y), z: B.z };
  }
}
