// Motion-capture clips for the renderer, from the CMU Graphics Lab Motion Capture Database (BVH conversion; free for
// research and commercial use, see src/assets/CREDITS.md):
//   node tools/mocap.mjs [cmu-mocap/data dir]  →  src/assets/clips.json
// Each BVH is run through forward kinematics and turned into OUR pose parameters (render/players.js computePose:
// lean, twist, head, arms[pitch, out, elbow, twist], legs[hip, knee, out], rootY) in the runner's own heading frame,
// so a clip plays on any player without a retargeting step at run time. Locomotion clips are cut into gait cycles at
// left-foot touchdowns, averaged over the clean cycles and resampled by phase (0 = left foot down, like render/gait.js),
// so the arm swing and torso stay locked to the planted feet whatever the speed.
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '/home/user/una-dinosauria/cmu-mocap/data';
const OUT = path.resolve('src/assets/clips.json');
const OUR_LEG = 0.518 + 0.469; // thigh + shin of the game's body (BIND), yards
const N = 32; // samples per gait cycle

// name, file, kind. Locomotion clips are blended by speed in the game (forward); backward / sideways by direction.
const CLIPS = [
  { name: 'walk', file: '007/07_01.bvh', kind: 'cycle' },
  { name: 'walk_brisk', file: '008/08_02.bvh', kind: 'cycle' },
  { name: 'jog', file: '002/02_03.bvh', kind: 'cycle' },
  { name: 'run', file: '009/09_01.bvh', kind: 'cycle' },
  { name: 'run_fast', file: '016/16_46.bvh', kind: 'cycle' },
  { name: 'run_straight', file: '102/102_05.bvh', kind: 'cycle' },
  { name: 'run_open', file: '078/078_12.bvh'.replace('078/078_', '078/78_'), kind: 'cycle' },
]

// ---------- BVH ----------
function parseBVH(text) {
  const tok = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints = [];
  const stack = [];
  let channels = 0;
  while (tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      const j = { name: tok[i++], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], ch: [], chStart: 0 };
      joints.push(j);
      stack.push(joints.length - 1);
    } else if (t === 'End') { i++; stack.push(-2); } // End Site
    else if (t === 'OFFSET') { const o = [+tok[i], +tok[i + 1], +tok[i + 2]]; i += 3; const top = stack[stack.length - 1]; if (top >= 0) joints[top].offset = o; }
    else if (t === 'CHANNELS') { const n = +tok[i++]; const j = joints[stack[stack.length - 1]]; j.chStart = channels; j.ch = tok.slice(i, i + n); i += n; channels += n; }
    else if (t === '}') stack.pop();
  }
  i++; // MOTION
  i++; const frames = +tok[i++]; // Frames: n
  i += 2; const dt = +tok[i++]; // Frame Time: x
  const data = [];
  for (let f = 0; f < frames; f++) { data.push(tok.slice(i, i + channels).map(Number)); i += channels; }
  return { joints, frames, dt, data };
}

// ---------- math (3x3 rows) ----------
const R = { x: (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]],
  y: (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]],
  z: (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]] };
const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (A, v) => [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]];
const tr = (A) => [0, 1, 2].map((i) => [A[0][i], A[1][i], A[2][i]]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const D2R = Math.PI / 180;

/** World positions of every joint for frame f. */
function fk(b, f) {
  const row = b.data[f];
  const pos = [], rot = [];
  for (let k = 0; k < b.joints.length; k++) {
    const j = b.joints[k];
    let local = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t = [0, 0, 0];
    for (let c = 0; c < j.ch.length; c++) {
      const v = row[j.chStart + c], n = j.ch[c];
      if (n === 'Xposition') t[0] = v; else if (n === 'Yposition') t[1] = v; else if (n === 'Zposition') t[2] = v;
      else local = mm(local, R[n[0].toLowerCase()](v * D2R)); // channel order = intrinsic rotation order
    }
    if (j.parent < 0) { pos.push(j.ch.includes('Xposition') ? t : j.offset); rot.push(local); }
    else {
      const pp = pos[j.parent], pr = rot[j.parent];
      const o = mv(pr, j.offset);
      pos.push([pp[0] + o[0], pp[1] + o[1], pp[2] + o[2]]);
      rot.push(mm(pr, local));
    }
  }
  // The CMU BVH frame is mirrored relative to ours (its runners move toward -forward with knees bending forward in
  // our convention): flip x so it's right-handed like the game's.
  for (const q of pos) q[0] = -q[0];
  return pos;
}

// ---------- our pose parameters from joint positions ----------
// Frames used (render/players.js drawPlayer): legs  root · Rx(-hip) · Rz(side·out), knee Rx(knee);
// chest hips · Rx(lean) · Ry(twist); arms chest · Rx(-pitch) · Rz(side·out) · Ry(side·twist), elbow Rx(-elbow);
// head chest · Rx(head) (positive = chin down). +x = the player's right, +y up, +z forward.
function poseFrom(P, J, legScale, hipStand) {
  const g = (n) => P[J[n]];
  const right = sub(g('RightUpLeg'), g('LeftUpLeg'));
  const rh = norm([right[0], 0, right[2]]);
  const up = [0, 1, 0], fwd = cross(rh, up);
  const H = [rh, up, fwd]; // rows: world → heading frame
  const loc = (v) => mv(H, v);
  const out = { lean: 0, twist: 0, head: 0, rootY: 0, arms: [{}, {}], legs: [{}, {}] };
  // Legs.
  [['Left', -1], ['Right', 1]].forEach(([s, side], k) => {
    const d = norm(loc(sub(g(`${s}Leg`), g(`${s}UpLeg`))));
    const so = Math.asin(Math.max(-1, Math.min(1, d[0])));
    const hip = Math.atan2(d[2], -d[1]);
    const F = mm(R.x(-hip), R.z(so));
    const sh = mv(tr(F), norm(loc(sub(g(`${s}Foot`), g(`${s}Leg`)))));
    out.legs[k] = { hip, knee: Math.max(0, Math.atan2(-sh[2], -sh[1])), out: so * side };
  });
  // Chest: spine lean and shoulder-line twist.
  const sp = norm(loc(sub(g('Neck'), g('Hips'))));
  out.lean = Math.atan2(sp[2], sp[1]);
  const sl = mv(R.x(-out.lean), norm(loc(sub(g('RightArm'), g('LeftArm')))));
  out.twist = Math.atan2(-sl[2], sl[0]);
  const C = mm(R.x(out.lean), R.y(out.twist));
  const inC = (v) => mv(tr(C), norm(loc(v)));
  // Arms.
  [['Left', -1], ['Right', 1]].forEach(([s, side], k) => {
    const u = inC(sub(g(`${s}ForeArm`), g(`${s}Arm`)));
    const pitch = Math.atan2(u[2], -u[1]);
    const so = Math.asin(Math.max(-1, Math.min(1, u[0])));
    const Fa = mm(C, mm(R.x(-pitch), R.z(so)));
    const f = mv(tr(Fa), norm(loc(sub(g(`${s}Hand`), g(`${s}ForeArm`)))));
    const elbow = Math.acos(Math.max(-1, Math.min(1, -f[1])));
    // Twist only means something with the elbow bent: fade it out as the arm straightens.
    const tw = Math.atan2(f[0], f[2]) * side * Math.min(1, elbow / 0.5);
    out.arms[k] = { pitch, out: so * side, elbow, twist: Math.max(-1.2, Math.min(1.2, tw)) };
  });
  // Head.
  const hd = inC(sub(g('Head'), g('Neck1')));
  out.head = Math.atan2(hd[2], hd[1]);
  out.rootY = (g('Hips')[1] - hipStand) * legScale;
  return { pose: out, H };
}

const KEYS = (p) => [p.rootY, p.lean, p.twist, p.head, ...p.arms.flatMap((a) => [a.pitch, a.out, a.elbow, a.twist]), ...p.legs.flatMap((l) => [l.hip, l.knee, l.out])];
const LAYOUT = ['rootY', 'lean', 'twist', 'head', 'aL.pitch', 'aL.out', 'aL.elbow', 'aL.twist', 'aR.pitch', 'aR.out', 'aR.elbow', 'aR.twist', 'lL.hip', 'lL.knee', 'lL.out', 'lR.hip', 'lR.knee', 'lR.out'];

function processCycle(spec) {
  const b = parseBVH(fs.readFileSync(path.join(DATA, spec.file), 'utf8'));
  const J = Object.fromEntries(b.joints.map((j, k) => [j.name, k]));
  const P = Array.from({ length: b.frames }, (_, f) => fk(b, f));
  const legLen = len(sub(P[0][J.LeftLeg], P[0][J.LeftUpLeg])) + len(sub(P[0][J.LeftFoot], P[0][J.LeftLeg]));
  const legScale = OUR_LEG / legLen;
  // Foot contacts: low and nearly still (relative to how fast the hips travel). Touchdown = a contact starting.
  const hipV = (f) => { const g = Math.max(1, Math.min(b.frames - 2, f)); return Math.hypot(P[g + 1][J.Hips][0] - P[g - 1][J.Hips][0], P[g + 1][J.Hips][2] - P[g - 1][J.Hips][2]) / (2 * b.dt); };
  const meanV = Array.from({ length: b.frames }, (_, f) => hipV(f)).reduce((s, v) => s + v, 0) / b.frames;
  const contacts = (s) => {
    const y = P.map((p) => p[J[`${s}Foot`]][1]), minY = Math.min(...y);
    const c = P.map((p, f) => {
      const g = Math.max(1, Math.min(b.frames - 2, f));
      const v = Math.hypot(P[g + 1][J[`${s}Foot`]][0] - P[g - 1][J[`${s}Foot`]][0], P[g + 1][J[`${s}Foot`]][2] - P[g - 1][J[`${s}Foot`]][2]) / (2 * b.dt);
      return y[f] < minY + legLen * 0.12 && v < meanV * 0.4;
    });
    // Debounce: a touchdown needs 3+ frames of contact after it.
    const t = [];
    for (let f = 1; f < b.frames - 3; f++) if (c[f] && !c[f - 1] && c[f + 1] && c[f + 2]) t.push(f);
    return t;
  };
  const touch = [...contacts('Left').map((f) => [f, 0]), ...contacts('Right').map((f) => [f, 1])].sort((x, y) => x[0] - y[0]);
  const hipStand = P.reduce((s, p) => s + p[J.Hips][1], 0) / b.frames;
  // Half cycles between alternating footfalls: left → right is phase 0..0.5, right → left is 0.5..1.
  const halves = [[], []];
  let dist = 0, time = 0;
  for (let k = 0; k + 1 < touch.length; k++) {
    const [a, fa] = touch[k], [z, fz] = touch[k + 1];
    if (fa === fz) continue;
    const T = (z - a) * b.dt;
    if (T < 0.12 || T > 1.3) continue;
    halves[fa].push({ a, z });
    dist += Math.hypot(P[z][J.Hips][0] - P[a][J.Hips][0], P[z][J.Hips][2] - P[a][J.Hips][2]) * legScale; time += T;
  }
  if (!halves[0].length && !halves[1].length) throw new Error(`${spec.name}: no footfalls (touchdowns ${touch.map((t) => t.join(':')).join(' ')})`);
  const H2 = N / 2;
  const sampleHalf = (list) => {
    const acc = Array.from({ length: H2 }, () => new Array(LAYOUT.length).fill(0));
    for (const c of list) for (let s = 0; s < H2; s++) {
      const f = c.a + (s / H2) * (c.z - c.a), f0 = Math.floor(f), t = f - f0;
      const v0 = KEYS(poseFrom(P[f0], J, legScale, hipStand).pose), v1 = KEYS(poseFrom(P[Math.min(b.frames - 1, f0 + 1)], J, legScale, hipStand).pose);
      for (let k = 0; k < v0.length; k++) acc[s][k] += (v0[k] + (v1[k] - v0[k]) * t) / list.length;
    }
    return acc;
  };
  // Mirror a sample: swap left / right arms and legs, turn the torso the other way.
  const mirror = (r) => [r[0], r[1], -r[2], r[3], ...r.slice(8, 12), ...r.slice(4, 8), ...r.slice(15, 18), ...r.slice(12, 15)];
  let h0 = halves[0].length ? sampleHalf(halves[0]) : null, h1 = halves[1].length ? sampleHalf(halves[1]) : null;
  if (!h0) h0 = h1.map(mirror);
  if (!h1) h1 = h0.map(mirror);
  const acc = [...h0, ...h1];
  const speed = dist / Math.max(1e-6, time);
  const T = 2 * time / (halves[0].length + halves[1].length);
  const cycles = halves[0].concat(halves[1]);
  // rootY relative to the cycle's mean (the bob), not to the standing height.
  const mY = acc.reduce((s, r) => s + r[0], 0) / N;
  for (const r of acc) r[0] -= mY;
  console.log(`${spec.name.padEnd(6)} ${spec.file}: ${cycles.length} half-cycles, ${speed.toFixed(2)} yd/s, cycle ${T.toFixed(2)} s`);
  return { name: spec.name, kind: 'cycle', speed: +speed.toFixed(3), cycle: +T.toFixed(3), samples: acc.map((r) => r.map((v) => Math.round(v * 1e4) / 1e4)) };
}

// --scan 09_01 16_35 ...: report each clip's speed (to pick clips), write nothing.
if (process.argv.includes('--scan')) {
  const ids = process.argv.slice(process.argv.indexOf('--scan') + 1);
  for (const id of ids) {
    const file = `${id.split('_')[0].padStart(3, '0')}/${id}.bvh`;
    try { processCycle({ name: id, file, kind: 'cycle' }); } catch (e) { console.log(id, 'skip:', e.message.slice(0, 60)); }
  }
  process.exit(0);
}
const out = { source: 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by Bruce Hahne', layout: LAYOUT, clips: [] };
for (const c of CLIPS) {
  try { out.clips.push(processCycle(c)); } catch (e) { console.warn('skip', c.name, e.message); }
}
out.clips.sort((a, b) => a.speed - b.speed);
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
