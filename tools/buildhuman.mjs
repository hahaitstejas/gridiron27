// Builds the game's player body from the public-domain (CC0) MakeHuman base mesh, its shape targets and skin weights:
//   node tools/buildhuman.mjs [makehuman/data dir]  →  src/assets/human.json
// Steps: athletic male shape (+ a heavier lineman shape as a per-vertex delta), re-posed into our bind pose (arms and legs
// hanging straight down), scaled to 2.06 yd, MakeHuman's 163 bones folded into our 13 (render/body.js BONE, up to 4 weights
// per vertex), a shoulder-pad displacement (pads under the jersey), uniform regions, jersey-number / face-photo coordinates,
// then decimated (meshoptimizer) to a size 56 instances can afford. Source: github.com/makehumancommunity/makehuman (CC0).
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const DATA = process.argv[2] || '/home/user/makehumancommunity/makehuman/makehuman/data';
const OUT = path.resolve('src/assets/human.json');
const TARGET_RATIO = 0.42;

// ---------- load ----------
const obj = fs.readFileSync(path.join(DATA, '3dobjs/base.obj'), 'utf8').split('\n');
const V = [];
const faces = [];
let group = '';
for (const l of obj) {
  if (l.startsWith('v ')) { const [, x, y, z] = l.trim().split(/\s+/); V.push([+x, +y, +z]); }
  else if (l.startsWith('g ')) group = l.slice(2).trim();
  else if (l.startsWith('f ') && group === 'body') {
    const idx = l.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
    for (let k = 1; k + 1 < idx.length; k++) faces.push([idx[0], idx[k], idx[k + 1]]);
  }
}
const target = (name) => {
  const d = new Map();
  for (const l of fs.readFileSync(path.join(DATA, 'targets/macrodetails', name), 'utf8').split('\n')) {
    if (!l || l[0] === '#') continue;
    const [i, x, y, z] = l.trim().split(/\s+/);
    d.set(+i, [+x, +y, +z]);
  }
  return d;
};
const applied = (t, k = 1) => V.map((v, i) => { const d = t.get(i); return d ? [v[0] + d[0] * k, v[1] + d[1] * k, v[2] + d[2] * k] : [...v]; });
const ATH = applied(target('universal-male-young-maxmuscle-averageweight.target'));
const HEAVY = applied(target('universal-male-young-maxmuscle-maxweight.target'));
const skel = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs/default.mhskel'), 'utf8'));
const W = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs/default_weights.mhw'), 'utf8')).weights;

// Joint positions = mean of their helper vertices.
const joint = (P, name) => {
  const ids = skel.joints[name];
  const s = [0, 0, 0];
  for (const i of ids) for (let k = 0; k < 3; k++) s[k] += P[i][k];
  return s.map((v) => v / ids.length);
};
const head = (P, bone) => joint(P, skel.bones[bone].head);

// ---------- math ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Rotation matrix (3x3, rows) taking unit a to unit b (shortest arc). */
function arc(a, b) {
  a = norm(a); b = norm(b);
  const v = cross(a, b), c = dot(a, b), s = len(v);
  if (s < 1e-8) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const k = norm(v), t = 1 - c, [x, y, z] = k;
  return [[c + x * x * t, x * y * t - z * s, x * z * t + y * s], [y * x * t + z * s, c + y * y * t, y * z * t - x * s], [z * x * t - y * s, z * y * t + x * s, c + z * z * t]];
}
const rot = (R, v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
const matmul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const DOWN = [0, -1, 0];

// ---------- re-pose into our bind pose (limbs straight down) ----------
/** Per side: transforms for the upper arm, forearm (+hand), thigh, shin (+foot) as v → pivot' + R (v - pivot). */
function poseOf(P) {
  const T = {};
  for (const s of ['L', 'R']) {
    const S = head(P, `upperarm01.${s}`), E = head(P, `lowerarm01.${s}`), Wr = head(P, `wrist.${s}`);
    const R1 = arc(sub(E, S), DOWN);
    const E2 = add(S, rot(R1, sub(E, S)));
    const R2 = matmul(arc(rot(R1, sub(Wr, E)), DOWN), R1);
    const H = head(P, `upperleg01.${s}`), K = head(P, `lowerleg01.${s}`), A = head(P, `foot.${s}`);
    const R3 = arc(sub(K, H), DOWN);
    const K2 = add(H, rot(R3, sub(K, H)));
    const R4 = matmul(arc(rot(R3, sub(A, K)), DOWN), R3);
    T[s] = {
      upper: { p: S, q: S, R: R1 }, fore: { p: E, q: E2, R: R2 }, thigh: { p: H, q: H, R: R3 }, shin: { p: K, q: K2, R: R4 },
      S, E2, W2: add(E2, mul(DOWN, len(sub(Wr, E)))), H, K2, A2: add(K2, mul(DOWN, len(sub(A, K)))),
    };
  }
  return T;
}
// Which re-pose transform (and which of our bones) each MakeHuman bone follows.
function classify(b) {
  const s = b.endsWith('.L') ? 'L' : b.endsWith('.R') ? 'R' : null;
  const n = b.replace(/\.[LR]$/, '');
  if (/^upperarm0[12]$/.test(n)) return { t: 'upper', s, ours: { [`sh${s}`]: 1 } };
  if (/^(lowerarm0[12]|wrist|metacarpal\d|finger\d-\d)$/.test(n)) return { t: 'fore', s, ours: { [`el${s}`]: 1 } };
  if (/^upperleg0[12]$/.test(n)) return { t: 'thigh', s, ours: { [`hip${s}`]: 1 } };
  if (/^lowerleg0[12]$/.test(n)) return { t: 'shin', s, ours: { [`knee${s}`]: 1 } };
  if (/^(foot|toe\d-\d)$/.test(n)) return { t: 'shin', s, ours: { [`foot${s}`]: 1 } };
  if (n === 'shoulder01') return { t: null, s, ours: { chest: 0.55, [`sh${s}`]: 0.45 } };
  if (/^(root|spine05|spine04|pelvis)$/.test(n)) return { t: null, s, ours: { hips: 1 } };
  if (n === 'spine03') return { t: null, s, ours: { hips: 0.45, chest: 0.55 } };
  if (/^(spine0[12]|breast|clavicle|levator0\d)$/.test(n)) return { t: null, s, ours: { chest: 1 } };
  if (n === 'neck01') return { t: null, s, ours: { chest: 0.6, head: 0.4 } };
  return { t: null, s, ours: { head: 1 } }; // neck02/03, head, face, jaw, eyes, tongue, special*
}
const BONE = { hips: 0, chest: 1, head: 2, shL: 3, shR: 4, elL: 5, elR: 6, hipL: 7, hipR: 8, kneeL: 9, kneeR: 10, footL: 11, footR: 12 };

// Per-vertex MakeHuman weights.
const vw = V.map(() => []);
for (const [b, list] of Object.entries(W)) for (const [i, w] of list) vw[i].push([b, w]);
const cls = Object.fromEntries(Object.keys(skel.bones).map((b) => [b, classify(b)]));

function repose(P, T) {
  return P.map((v, i) => {
    let tot = 0, acc = [0, 0, 0];
    for (const [b, w] of vw[i]) {
      const c = cls[b];
      const tr = c?.t ? T[c.s][c.t] : null;
      const p = tr ? add(tr.q, rot(tr.R, sub(v, tr.p))) : v;
      acc = add(acc, mul(p, w)); tot += w;
    }
    if (tot < 1) acc = add(acc, mul(v, 1 - tot));
    return tot > 0 ? (tot > 1 ? mul(acc, 1 / tot) : acc) : v;
  });
}
const Ta = poseOf(ATH), Th = poseOf(HEAVY);
let A = repose(ATH, Ta), Hv = repose(HEAVY, Th);

// ---------- scale / place: soles on the ground, hips at z = 0, 2.06 yd tall ----------
const used = new Set(faces.flat());
const ids = [...used];
const minY = Math.min(...ids.map((i) => A[i][1])), maxY = Math.max(...ids.map((i) => A[i][1]));
const SC = 2.06 / (maxY - minY);
const hipJ = mul(add(Ta.L.H, Ta.R.H), 0.5);
const place = (p) => [p[0] * SC, (p[1] - minY) * SC, (p[2] - hipJ[2]) * SC];
A = A.map(place); Hv = Hv.map(place);
const J = (p) => place(p);
const L = Ta.L, R = Ta.R;
const sh = [J(L.S), J(R.S)], el = [J(L.E2), J(R.E2)], wr = [J(L.W2), J(R.W2)];
const hp = [J(L.H), J(R.H)], kn = [J(L.K2), J(R.K2)], an = [J(L.A2), J(R.A2)];
const avg = (a, b) => (Math.abs(a) + Math.abs(b)) / 2;
const hipH = (hp[0][1] + hp[1][1]) / 2;
const headJ = J(head(ATH, 'head'));
const Bk = {
  hipH, hipX: avg(hp[0][0], hp[1][0]),
  thigh: (hp[0][1] - kn[0][1] + hp[1][1] - kn[1][1]) / 2,
  shin: (kn[0][1] - an[0][1] + kn[1][1] - an[1][1]) / 2,
  shX: avg(sh[0][0], sh[1][0]), shY: (sh[0][1] + sh[1][1]) / 2 - hipH, shZ: (sh[0][2] + sh[1][2]) / 2,
  upper: (sh[0][1] - el[0][1] + sh[1][1] - el[1][1]) / 2, fore: (el[0][1] - wr[0][1] + el[1][1] - wr[1][1]) / 2,
  headY: headJ[1] - hipH, headZ: headJ[2],
};
// Legs: put each knee / ankle straight under its hip (the x of each joint snaps to ±hipX).
console.log('skeleton (yd):', Object.fromEntries(Object.entries(Bk).map(([k, v]) => [k, +v.toFixed(3)])));

// ---------- our skin weights (≤ 4 per vertex) ----------
const skinIdx = [], skinW = [];
for (let i = 0; i < V.length; i++) {
  const acc = {};
  for (const [b, w] of vw[i]) for (const [o, k] of Object.entries(cls[b].ours)) acc[o] = (acc[o] || 0) + w * k;
  let e = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!e.length) e = [['hips', 1]];
  const t = e.reduce((s, x) => s + x[1], 0);
  const idx = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
  e.forEach(([o, w], k) => { idx[k] = BONE[o]; w4[k] = w / t; });
  skinIdx.push(idx); skinW.push(w4);
}
const wOf = (i, bone) => { let s = 0; for (let k = 0; k < 4; k++) if (skinIdx[i][k] === BONE[bone]) s += skinW[i][k]; return s; };

// ---------- shoulder pads under the jersey: widen and raise the shoulders / upper chest and back ----------
const shY = hipH + Bk.shY;
const pad = A.map((p, i) => {
  const armDown = wOf(i, 'elL') + wOf(i, 'elR');
  const head = wOf(i, 'head');
  if (armDown > 0.05 || head > 0.5) return [0, 0, 0];
  const up = wOf(i, 'shL') + wOf(i, 'shR');
  if (up > 0.6 && p[1] < shY - 0.1) return [0, 0, 0]; // the upper arm below the deltoid
  const ky = Math.max(0, 1 - Math.abs(p[1] - (shY + 0.03)) / 0.24);
  if (ky <= 0) return [0, 0, 0];
  const ax = Math.abs(p[0]) / (Bk.shX + 0.08);
  const k = ky * ky * (3 - 2 * ky);
  // Outward over the shoulder caps, a bit forward / back over the chest and shoulder blades, a little up on top.
  return [Math.sign(p[0]) * k * 0.13 * Math.min(1, ax * 1.15), k * 0.055 * Math.min(1, ax + 0.35), Math.sign(p[2] || 1) * k * 0.055];
});

// ---------- regions, number / photo coordinates ----------
const REGION = { jersey: 0, sleeve: 1, pants: 2, stripe: 3, socks: 4, skin: 5, forearm: 6, gloves: 7, shoe: 8 };
const ankleY = (an[0][1] + an[1][1]) / 2, kneeY = (kn[0][1] + kn[1][1]) / 2, wristY = (wr[0][1] + wr[1][1]) / 2;
const waistY = hipH + 0.08;
const collarY = hipH + Bk.headY - 0.1;
const region = [], body = [];
for (let i = 0; i < A.length; i++) {
  const p = A[i];
  const arm = wOf(i, 'shL') + wOf(i, 'shR'), fore = wOf(i, 'elL') + wOf(i, 'elR');
  const leg = wOf(i, 'hipL') + wOf(i, 'hipR'), shin = wOf(i, 'kneeL') + wOf(i, 'kneeR'), foot = wOf(i, 'footL') + wOf(i, 'footR');
  const hd = wOf(i, 'head');
  let r, b = [-1, -1];
  if (hd > 0.5 || p[1] > collarY + 0.02) {
    r = REGION.skin;
    // Face photo coordinates: the front of the head projected flat (x, y around the face center), v + 10 marks them.
    const fc = [0, hipH + Bk.headY + 0.1, Bk.headZ + 0.05];
    if (p[2] > fc[2] - 0.02) b = [(p[0] - fc[0]) / 0.16 + 0.5, (p[1] - fc[1]) / 0.2 + 0.5 + 10];
  } else if (fore > 0.5 || (arm > 0.5 && p[1] < shY - 0.13)) r = p[1] < wristY + 0.01 ? REGION.gloves : REGION.forearm;
  else if (arm > 0.5) r = REGION.sleeve;
  else if (foot > 0.4 || p[1] < ankleY + 0.02) r = REGION.shoe;
  else if (shin > 0.5 && p[1] < kneeY - 0.07) r = REGION.socks;
  else if (leg + shin > 0.5 || p[1] < waistY) {
    r = REGION.pants;
    const side = p[0] < 0 ? -1 : 1;
    b = [Math.atan2(p[0] - side * Bk.hipX, p[2]), side < 0 ? -2 : -3];
    if (leg + shin < 0.3) b = [-1, -1]; // the seat of the pants: no stripe
  } else {
    r = REGION.jersey;
    let a = Math.atan2(p[0], p[2] - 0.0);
    if (a < 0) a += Math.PI * 2;
    b = [a, (p[1] - waistY) / (collarY - waistY)];
  }
  region.push(r); body.push(b);
}

// ---------- clothing: the jersey hangs off the pads, sleeves and padded pants sit off the skin (part of the pads delta) ----------
{
  const nrm = A.map(() => [0, 0, 0]);
  for (const [a, b, c] of faces) {
    const n = cross(sub(A[b], A[a]), sub(A[c], A[a]));
    for (const v of [a, b, c]) nrm[v] = add(nrm[v], n);
  }
  const THICK = { 0: 0.026, 1: 0.018, 2: 0.02, 3: 0.02, 4: 0.006, 8: 0.012 };
  for (const i of ids) {
    const t = THICK[region[i]];
    if (!t) continue;
    const n = norm(nrm[i]);
    // The jersey drapes: thicker over the belly and back than the sides.
    const k = region[i] === 0 ? t * (0.8 + 0.4 * Math.abs(n[2])) : t;
    pad[i] = add(pad[i], mul(n, k));
  }
}

// ---------- decimate ----------
await MeshoptSimplifier.ready;
const remap = new Map(ids.map((v, k) => [v, k]));
const pos = new Float32Array(ids.length * 3);
ids.forEach((v, k) => pos.set(A[v], k * 3));
let index = new Uint32Array(faces.flat().map((v) => remap.get(v)));
// Region borders and the left / right seam stay put (locked) so uniform edges and the numbers stay clean.
const [simp, err] = MeshoptSimplifier.simplify(index, pos, 3, Math.floor(index.length * TARGET_RATIO / 3) * 3, 0.01, ['LockBorder']);
const keep = [...new Set(simp)].sort((a, b) => a - b);
const k2 = new Map(keep.map((v, k) => [v, k]));
const outIdx = Array.from(simp, (v) => k2.get(v));
const src = keep.map((k) => ids[k]);
console.log(`vertices ${ids.length} → ${src.length}, triangles ${index.length / 3} → ${outIdx.length / 3} (error ${err.toFixed(4)})`);

// ---------- write ----------
const f32 = (arr) => Buffer.from(new Float32Array(arr).buffer).toString('base64');
const u8 = (arr) => Buffer.from(new Uint8Array(arr).buffer).toString('base64');
const u16 = (arr) => Buffer.from(new Uint16Array(arr).buffer).toString('base64');
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const out = {
  source: 'MakeHuman base mesh hm08 + macro targets + default skeleton weights (CC0), github.com/makehumancommunity/makehuman',
  skeleton: Object.fromEntries(Object.entries(Bk).map(([k, v]) => [k, r4(v)])),
  count: src.length,
  position: f32(src.flatMap((i) => A[i])),
  bulk: f32(src.flatMap((i) => sub(Hv[i], A[i]))),
  pad: f32(src.flatMap((i) => pad[i])),
  skinIndex: u8(src.flatMap((i) => skinIdx[i])),
  skinWeight: f32(src.flatMap((i) => skinW[i])),
  region: u8(src.map((i) => region[i])),
  body: f32(src.flatMap((i) => body[i])),
  index: u16(outIdx),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
