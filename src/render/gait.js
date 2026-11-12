// Foot planting for the procedural poses (render-only). Each leg runs its own gait phase, driven by the distance the
// player actually covers, so stride and cadence always match his speed: while a foot is in stance it stays planted on
// the turf (world position fixed) and the body passes over it; in swing it arcs to where it will land next. Two-bone
// IK turns each foot target into the hip / knee / splay angles the pose uses. Also: lean into acceleration and turns,
// and a head that tracks the ball.

import { BIND } from './body.js';
// Leg lengths and ankle height come from the body's skeleton (BIND), read live so the MakeHuman body's apply.
const LEG = { get thigh() { return BIND.thigh; }, get shin() { return BIND.shin; }, get ankleY() { return BIND.hipH - BIND.thigh - BIND.shin - 0.01; } };
// Gaits that plant their feet. Everything else (falls, dives, jumps, celebrations) keeps its authored legs.
export const GAIT_ANIMS = new Set(['run', 'idle', 'backpedal', 'shuffle', 'passset', 'block', 'juke', 'stiffarm', 'truck', 'strip', 'catch', 'reach', 'swat', 'stumble', 'fair_catch', 'sig_flag', 'tired']);

// ---------- motion capture (CMU, tools/mocap.mjs → src/assets/clips.json) ----------
let LOCO = null; // forward locomotion clips sorted by speed: { speed, samples[N][18] }
let LAYOUT = null;
/** Install the clips (main.js at boot). */
export function setClips(data) {
  LAYOUT = data.layout;
  LOCO = data.clips.filter((c) => c.kind === 'cycle').sort((a, b) => a.speed - b.speed);
}
const MOCAP_ANIMS = new Set(['run', 'strip']);
const TMPA = new Float32Array(18), TMPB = new Float32Array(18);
/** One clip at gait phase ph (0..1, 0 = left foot down), linearly interpolated, into out. */
function sampleClip(c, ph, out) {
  const n = c.samples.length, f = ph * n, i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
  const a = c.samples[i0], b = c.samples[i1];
  for (let k = 0; k < 18; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
/** Locomotion at speed sp: the two clips around it blended; above the fastest, its swing is exaggerated (a sprint). */
function sampleLoco(sp, ph, out) {
  let hi = LOCO.findIndex((c) => c.speed >= sp);
  if (hi === 0) return sampleClip(LOCO[0], ph, out);
  if (hi < 0) {
    const top = LOCO[LOCO.length - 1];
    sampleClip(top, ph, out);
    const k = Math.min(1.5, 1 + ((sp - top.speed) / top.speed) * 0.55);
    // Exaggerate around the cycle's mean: bigger arm pump, more torso rotation, a deeper bob.
    const mean = top.mean || (top.mean = top.samples[0].map((_, j) => top.samples.reduce((s2, r) => s2 + r[j], 0) / top.samples.length));
    for (const j of [0, 2, 4, 6, 8, 10, 12, 13, 15, 16]) out[j] = mean[j] + (out[j] - mean[j]) * k;
    out[1] += (k - 1) * 0.15; // sprinters lean a little further forward
    return out;
  }
  const a = LOCO[hi - 1], b = LOCO[hi], t = (sp - a.speed) / (b.speed - a.speed);
  sampleClip(a, ph, TMPA); sampleClip(b, ph, TMPB);
  for (let k = 0; k < 18; k++) out[k] = TMPA[k] + (TMPB[k] - TMPA[k]) * t;
  return out;
}
const MC = new Float32Array(18);

/** Step length (yards) and the stance share of each leg's cycle, by speed (yd/s): walk → jog → sprint. */
const stepLen = (v) => Math.min(2.45, 0.42 + 0.19 * v);
const dutyOf = (v) => Math.min(0.62, Math.max(0.26, 0.62 - 0.036 * v));

export class Gait {
  constructor() { this.s = []; }

  reset() { this.s.length = 0; }

  state(i) {
    return (this.s[i] ||= { init: false, ph: 0, w: 0, vx: 0, vz: 0, sp: 0, f: 0, lean: 0, roll: 0, headYaw: 0,
      feet: [{ x: 0, z: 0, px: 0, pz: 0, tx: 0, tz: 0, planted: true }, { x: 0, z: 0, px: 0, pz: 0, tx: 0, tz: 0, planted: true }] });
  }

  /**
   * Adjust pose for player p (instance i) at world (x, z) facing f, scale sc, width w. dt = frame time.
   * look = world point the head turns toward (or null).
   */
  apply(p, i, pose, x, z, f, sc, w, dt, look) {
    const g = this.state(i);
    const vx = p.vx || 0, vz = p.vz || 0, sp = Math.hypot(vx, vz);
    const sin = Math.sin(f), cos = Math.cos(f);
    const hipX = BIND.hipX * w;
    if (!g.init || dt > 0.25 || Math.hypot(x - g.bx, z - g.bz) > 3) {
      // First frame (or a jump in time): feet under the hips.
      g.init = true; g.f = f; g.vx = vx; g.vz = vz; g.sp = sp;
      g.feet.forEach((ft, s) => { const side = s ? 1 : -1; ft.x = ft.px = ft.tx = x + sin * side * hipX * sc; ft.z = ft.pz = ft.tz = z - cos * side * hipX * sc; ft.planted = true; });
    }
    g.bx = x; g.bz = z;
    // ---- body dynamics: lean forward when speeding up, back when braking, into the turn when cutting ----
    if (dt > 0) {
      const acc = (sp - g.sp) / dt;
      // Turn rate from the direction of travel when moving (the facing lags a cut), else from the facing.
      const h = Math.atan2(vz, vx), h0 = Math.atan2(g.vz, g.vx);
      let dF = sp > 1.5 && g.sp > 1.5 ? h - h0 : f - g.f; while (dF > Math.PI) dF -= 2 * Math.PI; while (dF < -Math.PI) dF += 2 * Math.PI;
      const yawRate = dF / dt;
      const k = 1 - Math.exp(-dt * 9);
      g.lean += (Math.max(-0.22, Math.min(0.28, acc * 0.022)) - g.lean) * k;
      // Lean into a cut like a real runner (lateral acceleration = speed x turn rate), harder than before, and sink the hips on
      // a hard plant.
      g.roll += (Math.max(-0.55, Math.min(0.55, -yawRate * sp * 0.028)) - g.roll) * k;
      g.sp = sp; g.f = f; g.vx = vx; g.vz = vz;
    }
    const want = !pose.noGait && GAIT_ANIMS.has(p.anim) && Math.abs(pose.rootPitch) < 0.3 && p.state !== 'down' && p.state !== 'tackled' ? 1 : 0;
    g.w += (want - g.w) * Math.min(1, dt * 8);
    if (want) { pose.lean += g.lean; pose.rootRoll += g.roll * Math.min(1, sp / 4); pose.crouch -= Math.min(0.1, Math.abs(g.roll) * 0.16); }
    this.head(g, pose, x, z, f, look, dt);
    if (g.w < 0.02) return;

    // ---- gait phase: one full cycle = two steps; the distance covered drives it ----
    const L = stepLen(sp), duty = sp > 0.35 ? dutyOf(sp) : 1;
    const cycleT = sp > 0.35 ? (2 * L) / sp : 1;
    if (sp > 0.35) g.ph = (g.ph + dt / cycleT) % 1;
    // Motion capture for running: arms, torso, head and the bob come from the clip at this phase (legs: the IK below,
    // which keeps them planted). Faded in and out so changes of animation don't pop.
    const fwd = sp > 0.01 ? (vx * cos + vz * sin) / sp : 0;
    const wantMc = LOCO && MOCAP_ANIMS.has(p.anim) && sp > 1.0 && fwd > 0.5 ? 1 : 0;
    g.mw = (g.mw || 0) + (wantMc - (g.mw || 0)) * Math.min(1, dt * 7);
    if (g.mw > 0.01 && LOCO) {
      const m = sampleLoco(sp, g.ph, MC), k = g.mw * g.w;
      const mix = (a, b) => a + (b - a) * k;
      pose.rootY = mix(pose.rootY, m[0]); pose.lean = mix(pose.lean, Math.min(0.42, m[1] + g.lean * 0.6)); // the clip already leans; cap it so nobody runs like he's falling
      pose.twist = mix(pose.twist, m[2]);
      pose.head = mix(pose.head, m[3]);
      const carry = pose.carryArm; // the ball arm keeps its cradle (computePose set it; 2 = both arms protect it)
      for (let s2 = 0; s2 < 2; s2++) {
        if (carry === s2 || carry === 2) continue;
        const a = pose.arms[s2], o = 4 + s2 * 4;
        a.pitch = mix(a.pitch, m[o]); a.out = mix(a.out, m[o + 1]); a.elbow = mix(a.elbow, m[o + 2]); a.twist = mix(a.twist || 0, 0); // the clip's upper-arm roll wrings the skinned arm: keep it square
      }
      for (let s2 = 0; s2 < 2; s2++) { const l = pose.legs[s2], o = 12 + s2 * 3; l.hip = mix(l.hip, m[o]); l.knee = mix(l.knee, m[o + 1]); l.out = mix(l.out || 0, m[o + 2]); }
    }
    const crouch = pose.crouch, hipY = (BIND.hipH + crouch + pose.rootY) * sc;
    for (let s = 0; s < 2; s++) {
      const side = s ? 1 : -1, ft = g.feet[s];
      const ph = (g.ph + (s ? 0.5 : 0)) % 1;
      // Where this foot would land if it touched down now: ahead of the hip by half the stance travel, splayed a bit.
      const reach = sp > 0.35 ? sp * duty * cycleT * 0.5 : 0;
      const splay = hipX * sc * (1 + (pose.legs[s].out || 0) * 2.2);
      const landX = x + (sp > 0.01 ? (vx / sp) * reach : 0) + sin * side * splay;
      const landZ = z + (sp > 0.01 ? (vz / sp) * reach : 0) - cos * side * splay;
      let fy = LEG.ankleY * sc, flat = 1;
      if (sp <= 0.35) {
        // Standing: a foot that's far from its spot steps there (a quick shuffle), otherwise it stays put.
        if (!ft.planted || Math.hypot(ft.x - landX, ft.z - landZ) > 0.42 * sc) {
          if (ft.planted) { ft.planted = false; ft.px = ft.x; ft.pz = ft.z; ft.t = 0; }
          ft.t = Math.min(1, (ft.t || 0) + dt / 0.22);
          const e = ft.t * ft.t * (3 - 2 * ft.t);
          ft.x = ft.px + (landX - ft.px) * e; ft.z = ft.pz + (landZ - ft.pz) * e;
          fy += Math.sin(ft.t * Math.PI) * 0.06 * sc;
          if (ft.t >= 1) ft.planted = true;
        }
      } else if (ph < duty) {
        // Stance: planted. Touching down this frame → lock where it lands.
        if (!ft.planted) { ft.planted = true; ft.x = ft.tx; ft.z = ft.tz; }
        flat = 1 - Math.max(0, (ph / duty - 0.7) / 0.3) * 0.6; // the heel comes up for the push-off
      } else {
        // Swing: from where it lifted to the predicted landing (body travel during the rest of the swing + half a stance).
        if (ft.planted) { ft.planted = false; ft.px = ft.x; ft.pz = ft.z; }
        const k = (ph - duty) / (1 - duty);
        const ahead = (1 - k) * (1 - duty) * cycleT;
        ft.tx = landX + vx * ahead; ft.tz = landZ + vz * ahead;
        const e = k * k * (3 - 2 * k);
        ft.x = ft.px + (ft.tx - ft.px) * e; ft.z = ft.pz + (ft.tz - ft.pz) * e;
        fy += Math.sin(k * Math.PI) * Math.min(0.42, 0.1 + sp * 0.03) * sc * (k < 0.5 ? 1 : 0.7);
        flat = 0.25;
      }
      // ---- two-bone IK in the player's own frame (+z = facing, +x = his right) ----
      const dxw = ft.x - x, dzw = ft.z - z;
      const lx = (dxw * sin - dzw * cos) / sc - side * hipX, lz = (dxw * cos + dzw * sin) / sc;
      const ly = (fy - hipY) / sc; // negative: the foot is below the hip
      const a = LEG.thigh, b = LEG.shin;
      let d = Math.hypot(lx, ly, lz);
      const dmax = (a + b) * 0.995;
      const scaleD = d > dmax ? dmax / d : 1;
      d = Math.min(d, dmax);
      const out = Math.asin(Math.max(-0.8, Math.min(0.8, (lx * side * scaleD) / Math.max(0.05, d))));
      const sag = Math.max(0.05, Math.sqrt(Math.max(0, d * d - (lx * scaleD) ** 2)));
      const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - sag * sag) / (2 * a * b))));
      const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + sag * sag - b * b) / (2 * a * sag))));
      const phi = Math.atan2(lz * scaleD, -ly * scaleD);
      const hip = phi + alpha;
      const leg = pose.legs[s], W = g.w;
      leg.hip += (hip - leg.hip) * W;
      leg.knee += (knee - leg.knee) * W;
      leg.out = (leg.out || 0) + (out - (leg.out || 0)) * W;
      leg.flat = (leg.flat ?? 0.6) + (flat - (leg.flat ?? 0.6)) * W;
    }
  }

  /** The head turns toward `look` (the ball, mostly) within what a neck can do, smoothly. */
  head(g, pose, x, z, f, look, dt) {
    let target = 0;
    if (look) {
      let a = Math.atan2(look.z - z, look.x - x) - f - (pose.twist || 0);
      while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
      if (Math.abs(a) < 2.4) target = Math.max(-1.05, Math.min(1.05, a));
    }
    g.headYaw += (target - g.headYaw) * Math.min(1, dt * 6);
    pose.headYaw = g.headYaw;
  }
}
