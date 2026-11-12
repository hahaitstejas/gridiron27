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
const TARGET_RATIO = 0.5;

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
  // Where the torso bends (the lower spine), above the hip joints: the chest bone pivots here.
  spineY: J(head(ATH, 'spine03'))[1] - hipH,
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
  if (up > 0.6 && p[1] < shY - 0.12) return [0, 0, 0]; // the upper arm below the pad's edge
  // Pad construction: a broad cantilever shoulder (wide, nearly flat across the top, a short drop over the deltoid), and
  // front / back plates that cover the chest and shoulder blades and end under the pecs.
  const dy = p[1] - (shY + 0.04);
  const ax = Math.abs(p[0]) / (Bk.shX + 0.08);
  const capH = dy > 0 ? 0.1 : 0.18;                      // above / below the shoulder line
  const ky = Math.max(0, 1 - Math.abs(dy) / capH);
  const plateY = Math.max(0, 1 - Math.abs(p[1] - (shY - 0.02)) / 0.3); // plates reach lower than the caps
  if (ky <= 0 && plateY <= 0) return [0, 0, 0];
  const k = ky * ky * (3 - 2 * ky), kp = plateY * plateY * plateY * (plateY * (plateY * 6 - 15) + 10);
  const out = Math.min(1, Math.pow(ax, 1.4) * 1.25);
  const dx = Math.sign(p[0]) * k * 0.075 * out;
  // Slope: the trapezius rises toward the neck and the cap sits just above the shoulder line.
  const dyy = k * 0.03 * Math.min(1, ax + 0.2) + 0.012 * k * Math.max(0, 1 - Math.abs(ax - 0.45) * 3);
  // The plates push outward from the torso's axis (not by the sign of z: that flips between neighbors at the sides and tears the surface).
  const onTorso = up < 0.5; // the plates are on the chest and back, not on the arm
  let px = 0, pz = 0;
  if (onTorso) {
    const r = Math.hypot(p[0], p[2]) || 1e-6, ux = p[0] / r, uz = p[2] / r;
    const amt = kp * 0.055 * (0.45 + 0.55 * Math.abs(uz)) + k * 0.012; // front / back plates stand off more than the sides
    px = ux * amt * 0.6; pz = uz * amt;
  }
  return [dx + px, dyy, pz];
});

// Shoulder pads ride on the torso, not the arm: vertices the pads push out move most of their upper-arm weight onto the
// chest, so raising an arm doesn't drag the pad (and the jersey over it) with it.
for (let i = 0; i < A.length; i++) {
  const pd = len(pad[i]);
  if (pd < 0.01) continue;
  const k = Math.min(0.85, pd / 0.09);
  let moved = 0;
  for (let q = 0; q < 4; q++) if (skinIdx[i][q] === BONE.shL || skinIdx[i][q] === BONE.shR) { const m = skinW[i][q] * k; skinW[i][q] -= m; moved += m; }
  if (!moved) continue;
  let ci = skinIdx[i].findIndex((b, q) => b === BONE.chest && skinW[i][q] > 0);
  if (ci < 0) { ci = skinW[i].indexOf(Math.min(...skinW[i])); skinIdx[i][ci] = BONE.chest; skinW[i][ci] = 0; }
  skinW[i][ci] += moved;
}

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
  } else if (fore > 0.5 || (arm > 0.5 && p[1] < shY - 0.2)) r = p[1] < wristY + 0.01 ? REGION.gloves : REGION.forearm;
  else if (arm > 0.5) r = REGION.sleeve;
  else if (foot > 0.4 || p[1] < ankleY + 0.02) r = REGION.shoe;
  else if (shin > 0.5 && p[1] < kneeY - 0.07) r = REGION.socks;
  else if (leg + shin > 0.5 || p[1] < waistY) {
    r = REGION.pants;
    const side = p[0] < 0 ? -1 : 1;
    b = [0, side < 0 ? -2 : -3]; // angle around the leg's own center: filled in below
    if (leg + shin < 0.3) b = [-1, -1]; // the seat of the pants: no stripe
  } else {
    r = REGION.jersey;
    // Angle around the torso with the seam under the left arm (no number there): front = PI/2, back = 3PI/2; the shader
    // takes PI/2 off, so its front is 0 and back PI with no wrap inside either number patch.
    let a = Math.atan2(p[0], p[2]) + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    b = [a, (p[1] - waistY) / (collarY - waistY)];
  }
  region.push(r); body.push(b);
}

// The pants stripe angle: around the leg's real center at each height (the mean of that leg's vertices in a 3 cm slab),
// so the stripe runs down the outside of the thigh, not wherever the hip joint's x happens to be.
{
  const slab = (i) => Math.round(A[i][1] / 0.03);
  const centers = new Map();
  for (const i of ids) if (body[i][1] === -2 || body[i][1] === -3) {
    const key = `${body[i][1]}:${slab(i)}`;
    const c = centers.get(key) || [0, 0, 0];
    c[0] += A[i][0]; c[1] += A[i][2]; c[2]++;
    centers.set(key, c);
  }
  for (const i of ids) if (body[i][1] === -2 || body[i][1] === -3) {
    const c = centers.get(`${body[i][1]}:${slab(i)}`);
    // 0 = the outside of this leg (where the stripe runs), ±PI = the inside: the wrap sits between the legs, never on the stripe.
    const side = body[i][1] === -2 ? -1 : 1;
    let a = Math.atan2((A[i][0] - c[0] / c[2]) * side, A[i][2] - c[1] / c[2]) - Math.PI / 2;
    if (a <= -Math.PI) a += Math.PI * 2;
    body[i][0] = Math.cos(a); // the cosine (1 = the outside): smooth across triangles, no wrap to interpolate through
  }
}

// ---------- smooth the torso under the jersey (the base body has sculpted pecs: a jersey over pads is smooth) ----------
// Taubin smoothing (shrink / inflate passes, so volume holds) over the jersey's torso vertices on the original mesh, from the
// belt up to the base of the neck; the result goes into the pad delta, faded out at the hem, the arms and the collar.
{
  const nb = A.map(() => new Set());
  for (const [a, b, c] of faces) { nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b); }
  const w = A.map((p, i) => {
    if (region[i] !== REGION.jersey) return 0;
    if (wOf(i, 'elL') + wOf(i, 'elR') > 0.25 || wOf(i, 'head') > 0.3) return 0; // (the chest carries some shoulder-bone weight: not a reason to skip it)
    const y = p[1];
    return smooth01((y - (waistY + 0.03)) / 0.1) * (1 - smooth01((y - (shY - 0.02)) / 0.1)) * (1 - smooth01((Math.abs(p[0]) - 0.2) / 0.06));
  });
  const idsT = ids.filter((i) => w[i] > 0);
  let P = A.map((p) => [...p]);
  const pass = (lam) => {
    const Q = P.map((p) => [...p]);
    for (const i of idsT) {
      const n = [...nb[i]];
      if (!n.length) continue;
      const m = [0, 0, 0];
      for (const j of n) { m[0] += P[j][0]; m[1] += P[j][1]; m[2] += P[j][2]; }
      for (let k = 0; k < 3; k++) Q[i][k] = P[i][k] + lam * (m[k] / n.length - P[i][k]);
    }
    P = Q;
  };
  for (let it = 0; it < 30; it++) { pass(0.5); pass(-0.53); }
  // Reshape each height slab's chest cross-section to a clean rounded box: depth from the sternum / spine line, width from the
  // slab's own extent. This removes the pec relief (a low-frequency bump smoothing alone cannot).
  {
    const SL = 0.03, slabs = new Map();
    for (const i of idsT) { const k = Math.round(P[i][1] / SL); (slabs.get(k) || slabs.set(k, []).get(k)).push(i); }
    for (const list of slabs.values()) {
      if (list.length < 12) continue;
      const zs = list.map((i) => P[i][2]), cz = zs.reduce((a, b) => a + b, 0) / zs.length;
      const xs = list.map((i) => Math.abs(P[i][0])).sort((a, b) => a - b);
      const a = xs[Math.floor(xs.length * 0.92)];
      const mid = list.filter((i) => Math.abs(P[i][0]) < 0.04);
      const fr = mid.filter((i) => P[i][2] > cz), bk = mid.filter((i) => P[i][2] <= cz);
      if (!fr.length || !bk.length || a < 0.08) continue;
      const zf = fr.reduce((t, i) => t + P[i][2], 0) / fr.length, zb = bk.reduce((t, i) => t + P[i][2], 0) / bk.length;
      const c = (zf + zb) / 2, bf = zf - c, bb = c - zb, n = 2.5;
      for (const i of list) {
        const x = Math.abs(P[i][0]), sgn = P[i][2] >= c ? 1 : -1;
        const t = Math.min(1, x / a), wx = 1 - smooth01((x / a - 0.72) / 0.28);
        const zt = c + sgn * (sgn > 0 ? bf : bb) * Math.pow(Math.max(0, 1 - Math.pow(t, n)), 1 / n);
        P[i][2] = P[i][2] + (zt - P[i][2]) * wx;
      }
    }
  }
  let maxD = 0;
  for (const i of idsT) {
    const d = sub(P[i], A[i]);
    maxD = Math.max(maxD, len(d));
    pad[i] = add(pad[i], mul(d, w[i] / 1.3));
  }
  console.log('torso smoothing:', idsT.length, 'vertices, max move', maxD.toFixed(4), 'yd');
}

// The old boxy-jersey fill (pushes the torso below the chest out to the chest's outline) is off: it made a shelf under the pads.
const FILL = false;
// ---------- the jersey hangs straight off the shoulder pads (a football jersey is boxy: no V-taper to the waist) ----------
// Below the chest, every jersey vertex is pushed out to (most of) the chest's outline in its direction, so the torso reads
// as one block from the pads to the belt, the way it does on TV.
{
  const chestY = shY - 0.14;
  const torsoV = ids.filter((i) => region[i] === 0);
  const BINS = 48, chest = new Array(BINS).fill(0);
  const czOf = (y) => { let s2 = 0, n = 0; for (const i of torsoV) if (Math.abs(A[i][1] - y) < 0.03) { s2 += A[i][2]; n++; } return n ? s2 / n : 0; };
  const cz0 = czOf(chestY);
  const bin = (x, z) => ((Math.floor(((Math.atan2(x, z) + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
  for (const i of torsoV) {
    const p = A[i];
    if (Math.abs(p[1] - chestY) > 0.035) continue;
    const r = Math.hypot(p[0], p[2] - cz0); // the body itself (not the pad plates): the jersey below the chest follows the torso, tapering to the belt
    const b = bin(p[0], p[2] - cz0);
    chest[b] = Math.max(chest[b], r);
  }
  for (let b = 0; b < BINS; b++) if (!chest[b]) chest[b] = Math.max(chest[(b + BINS - 1) % BINS], chest[(b + 1) % BINS]);
  for (const i of torsoV) {
    const p = A[i];
    if (p[1] >= chestY + 0.14 || p[1] < waistY - 0.04) continue;
    const fade = smooth01((chestY + 0.14 - p[1]) / 0.14); // 1 from the chest down, easing out above it (no step under the plates)
    const cz = czOf(p[1]);
    const dx = p[0], dz = p[2] - cz, r = Math.hypot(dx, dz) || 1e-6;
    const k = (p[1] - waistY) / (chestY - waistY); // 1 at the chest, 0 at the belt
    const want = chest[bin(dx, dz)] * (0.99 + 0.1 * Math.max(0, Math.min(1, k))) + 0.012; // a fitted jersey: just off the torso, a little fuller at the chest than the belt
    if (FILL && want > r) pad[i] = add(pad[i], [dx / r * (want - r) * fade, 0, dz / r * (want - r) * fade]);
  }
}

function smooth01(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }


// ---------- athletic base for every build: muscle where it is (biceps, deltoids, forearms, quads, calves), a V-taper ----------
// Added to the pad delta (always on, scaled with the pads), then the clothing offsets go on top.
{
  const PADK = 1.3, elbowY = shY - Bk.upper;
  const bump = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));
  const radial = (p, cx, cz, amt, front) => {
    const dx = p[0] - cx, dz = p[2] - cz, r = Math.hypot(dx, dz) || 1e-6;
    const fw = dz / r > 0 ? 1 + (front - 1) * dz / r : 1;
    return [dx / r * amt * fw, 0, dz / r * amt * fw];
  };
  for (const i of ids) {
    const p = A[i], y = p[1], side = p[0] < 0 ? -1 : 1;
    const armW = wOf(i, 'shL') + wOf(i, 'shR'), foreW = wOf(i, 'elL') + wOf(i, 'elR');
    const legW = wOf(i, 'hipL') + wOf(i, 'hipR'), shinW = wOf(i, 'kneeL') + wOf(i, 'kneeR'), footW = wOf(i, 'footL') + wOf(i, 'footR');
    let d = [0, 0, 0];
    if (region[i] === REGION.gloves || footW > 0.5) continue;
    if (foreW > 0.5) {
      // Forearm: thick near the elbow, tapering to the wrist.
      const t = Math.max(0, Math.min(1, (y - wristY) / (elbowY - wristY)));
      d = radial(p, side * Bk.shX, Bk.shZ, 0.022 * Math.pow(t, 0.8) * (1 - 0.25 * t * t), 1.1);
    } else if (armW > 0.5 && y < shY - 0.04) {
      // Upper arm: deltoid at the top, bicep in front and tricep behind through the middle.
      const t = Math.max(0, Math.min(1, (y - elbowY) / Bk.upper));
      d = radial(p, side * Bk.shX, Bk.shZ, 0.03 * bump(0.1 + t * 0.85) + 0.012 * smooth01((t - 0.6) / 0.35), 1.25);
    } else if (legW + shinW > 0.5 && y < hipH - 0.05) {
      // Thigh: quads and hamstrings, fullest a third of the way down, narrowing into the knee; calf muscle behind the shin.
      const cx = side * Bk.hipX;
      if (y > kneeY + 0.02) {
        const t = (y - kneeY) / (hipH - 0.05 - kneeY);
        d = radial(p, cx, 0, 0.034 * bump(0.02 + t * 0.95) * (0.7 + 0.5 * t), 1.35);
      } else if (y > ankleY + 0.05) {
        const t = (y - ankleY) / (kneeY - ankleY);
        const r = radial(p, cx, 0, 0.024 * bump(0.25 + t * 0.7), 1.0);
        const back = p[2] < 0 ? 1.6 : 0.7;               // the calf bulges behind
        d = [r[0] * back, 0, r[2] * back];
      }
    } else if (legW > 0.3 && y >= hipH - 0.05 && y < hipH + 0.12 && region[i] === REGION.pants) {
      // Hip pads: a bulge over the hip bone on each side, under the pants.
      const hb = bump((y - (hipH - 0.05)) / 0.17) * smooth01((Math.abs(p[0]) - 0.1) / 0.08);
      d = [side * 0.026 * hb, 0, 0];
    } else if (!armW && !foreW && !legW) {
      // Trunk: sloped traps, a V-taper (lats wide, waist narrow), broad upper back.
      const ux = p[0] === 0 ? 0 : Math.sign(p[0]);
      const lat = bump((y - (waistY + 0.1)) / 0.5);      // lats: waist..chest
      const waist = bump((y - (waistY - 0.1)) / 0.28);   // the waist itself
      d = [ux * (0.024 * lat - 0.02 * waist) * Math.min(1, Math.abs(p[0]) / 0.12), 0, 0];
      if (y > shY + 0.0 && Math.abs(p[0]) < 0.2 && Math.abs(p[0]) > 0.06) d[1] += 0.022 * smooth01((y - shY) / 0.1) * (1 - smooth01((Math.abs(p[0]) - 0.06) / 0.14)); // traps
    }
    if (d[0] || d[1] || d[2]) pad[i] = add(pad[i], mul(d, 1 / PADK));
  }
}

// ---------- clothing: the jersey hangs off the pads, sleeves and padded pants sit off the skin (part of the pads delta) ----------
{
  const nrm = A.map(() => [0, 0, 0]);
  for (const [a, b, c] of faces) {
    const n = cross(sub(A[b], A[a]), sub(A[c], A[a]));
    for (const v of [a, b, c]) nrm[v] = add(nrm[v], n);
  }
  const THICK = { 0: 0.02, 1: 0.016, 2: 0.006, 3: 0.006, 4: 0.004, 8: 0.012 }; // pants and socks cling (tight football pants)
  for (const i of ids) {
    const t = THICK[region[i]];
    if (!t) continue;
    const n = norm(nrm[i]);
    // The jersey drapes: thicker over the belly and back than the sides.
    const k = region[i] === 0 ? t * (0.8 + 0.4 * Math.abs(n[2])) : t;
    pad[i] = add(pad[i], mul(n, k));
    // Thigh and knee pads under the pants: low bumps on the front of each leg.
    if (region[i] === 2 && n[2] > 0.25) {
      const y = A[i][1];
      const thigh = Math.max(0, 1 - Math.abs(y - (kneeY + 0.24)) / 0.12), knee = Math.max(0, 1 - Math.abs(y - (kneeY + 0.02)) / 0.05);
      pad[i] = add(pad[i], mul(n, (thigh * 0.014 + knee * 0.012) * Math.min(1, (n[2] - 0.25) * 2.5)));
    }
  }
}

// ---------- body part per vertex (the shader draws the uniform's edges from the bind-pose height inside each part) ----------
const part = A.map((p, i) => {
  const arm = wOf(i, 'shL') + wOf(i, 'shR') + wOf(i, 'elL') + wOf(i, 'elR');
  const leg = wOf(i, 'hipL') + wOf(i, 'hipR') + wOf(i, 'kneeL') + wOf(i, 'kneeR') + wOf(i, 'footL') + wOf(i, 'footR');
  if (region[i] === REGION.skin) return 3;
  // Only the arm tube itself counts as arm (shoulder caps and the trapezius stay torso, so sleeve stripes can't land there).
  if (region[i] === REGION.forearm || region[i] === REGION.gloves || (region[i] === REGION.sleeve && arm > 0.8)) return 1;
  if (region[i] === REGION.socks || region[i] === REGION.shoe || (region[i] === REGION.pants && leg > 0.5)) return 2;
  return 0;
});
// ---------- build: a lineman's mass, in the places it really is (flags.y = 1 is a ~320 lb lineman) ----------
// Radial growth away from each body part's own axis. One continuous profile down the trunk (seat, belly, chest, traps, neck)
// so nothing steps at the jersey hem; thighs and calves taper away from the hip; upper arms are thick, forearms barely.
// Replaces MakeHuman's max-weight shape, whose mass is mostly belly and seat.
const profile = (tab, y) => {
  if (y <= tab[0][0]) return tab[0][1];
  for (let k = 1; k < tab.length; k++) if (y <= tab[k][0]) { const t = (y - tab[k - 1][0]) / (tab[k][0] - tab[k - 1][0]); return tab[k - 1][1] + (tab[k][1] - tab[k - 1][1]) * smooth01(t); }
  return tab[tab.length - 1][1];
};
const TRUNK = [[hipH - 0.3, 0.0], [hipH - 0.15, 0.03], [waistY, 0.05], [waistY + 0.2, 0.055], [shY - 0.3, 0.05], [shY - 0.1, 0.045], [shY + 0.05, 0.03], [collarY + 0.04, 0.034]];
const GUT = [[hipH - 0.1, 0], [waistY + 0.1, 1], [shY - 0.32, 0.8], [shY - 0.12, 0]]; // extra growth toward the front
const THIGH = [[ankleY, 0], [kneeY - 0.1, 0.012], [kneeY + 0.1, 0.024], [hipH - 0.25, 0.034], [hipH - 0.05, 0.03]];
const mass = A.map((p, i) => {
  const y = p[1], side = p[0] < 0 ? -1 : 1;
  const armW = wOf(i, 'shL') + wOf(i, 'shR'), foreW = wOf(i, 'elL') + wOf(i, 'elR');
  const footW = wOf(i, 'footL') + wOf(i, 'footR');
  const radial = (cx, amt, front = 1) => {
    const dx = p[0] - cx, dz = p[2], r = Math.hypot(dx, dz) || 1e-6;
    const fw = dz / r > 0 ? 1 + (front - 1) * dz / r : 1;
    return [dx / r * amt * fw, 0, dz / r * amt * fw];
  };
  if (footW > 0.5) return [0, 0, 0];
  if (foreW > 0.5) return radial(side * Bk.shX, 0.02 * smooth01((y - (wristY + 0.02)) / 0.12));
  if (armW > 0.5 && y < shY - 0.04) return radial(side * Bk.shX, 0.042 * smooth01((shY - 0.04 - y) / 0.06) * (1 - 0.35 * smooth01((shY - Bk.upper - y) / 0.15 + 1)));
  const trunk = radial(0, profile(TRUNK, y), 1 + 0.7 * profile(GUT, y));
  const leg = radial(side * Bk.hipX, profile(THIGH, y));
  const k = smooth01((hipH - 0.05 - y) / 0.14); // 0 in the trunk, 1 once it is clearly a leg
  return [trunk[0] + (leg[0] - trunk[0]) * k, 0, trunk[2] + (leg[2] - trunk[2]) * k];
});
Bk.waistY = waistY; Bk.collarY = collarY + 0.02; Bk.sleeveY = shY - 0.2; Bk.wristY = wristY + 0.01; Bk.sockY = kneeY - 0.07; Bk.shoeY = ankleY + 0.02;

// ---------- printed numbers and name: thin patches lying on the chest / back, with their own clean UVs ----------
// Each grid point takes the surface (and its pad / bulk deltas and skin weights) from the nearest jersey vertices, so the
// patch moves exactly like the shirt under it; only the lettering is drawn on it.
const decal = { pos: [], bulk: [], pad: [], si: [], sw: [], uv: [], kind: [], idx: [] };
{
  const jersey = ids.filter((i) => region[i] === REGION.jersey);
  const Pp = A.map((p, i) => add(p, pad[i])); // the shirt as worn (pads + clothing)
  const czAt = (y) => { let s2 = 0, n = 0; for (const i of jersey) if (Math.abs(A[i][1] - y) < 0.03) { s2 += A[i][2]; n++; } return n ? s2 / n : 0; };
  const patch = (kind, side, yc, hw, hh, nx, ny) => {
    const base = decal.pos.length / 3;
    const cz = czAt(yc);
    const pool = jersey.filter((i) => Math.sign(A[i][2] - cz) === side && Math.abs(A[i][1] - yc) < hh + 0.08 && Math.abs(A[i][0]) < hw + 0.1);
    const inPool = new Set(pool);
    const tris = faces.filter((f) => f.some((v) => inPool.has(v)) && f.every((v) => region[v] === REGION.jersey));
    for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) {
      const x = -hw + (2 * hw * gx) / (nx - 1), y = yc - hh + (2 * hh * gy) / (ny - 1);
      // Drop the point straight onto the padded shirt along z (front: from +z, back: from -z): the outermost triangle under
      // (x, y), and take its exact surface attributes by barycentric interpolation.
      let hit = null;
      for (const [ia, ib, ic] of tris) {
        const P0 = Pp[ia], P1 = Pp[ib], P2 = Pp[ic];
        const d = (P1[1] - P2[1]) * (P0[0] - P2[0]) + (P2[0] - P1[0]) * (P0[1] - P2[1]);
        if (Math.abs(d) < 1e-12) continue;
        const w0 = ((P1[1] - P2[1]) * (x - P2[0]) + (P2[0] - P1[0]) * (y - P2[1])) / d;
        const w1 = ((P2[1] - P0[1]) * (x - P2[0]) + (P0[0] - P2[0]) * (y - P2[1])) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const zz = w0 * P0[2] + w1 * P1[2] + w2 * P2[2];
        if (!hit || zz * side > hit.z * side) hit = { z: zz, v: [ia, ib, ic], w: [w0, w1, w2] };
      }
      if (!hit) { const n = pool.map((i) => [i, Math.hypot(Pp[i][0] - x, Pp[i][1] - y)]).sort((q, r) => q[1] - r[1])[0][0]; hit = { z: Pp[n][2], v: [n, n, n], w: [1, 0, 0] }; }
      const lerp3 = (arr) => [0, 1, 2].map((k) => hit.w[0] * arr(hit.v[0])[k] + hit.w[1] * arr(hit.v[1])[k] + hit.w[2] * arr(hit.v[2])[k]);
      const base = lerp3((i) => A[i]), pd = lerp3((i) => pad[i]), bk = lerp3((i) => mass[i]);
      decal.pos.push(base[0], base[1], base[2] + side * 0.012);
      decal.pad.push(...pd); decal.bulk.push(...bk);
      // Exactly the shirt's own skinning at that spot, so print and shirt bend together.
      const bones = {};
      hit.v.forEach((i, k) => { for (let q = 0; q < 4; q++) if (skinW[i][q] > 0) bones[skinIdx[i][q]] = (bones[skinIdx[i][q]] || 0) + skinW[i][q] * hit.w[k]; });
      const top = Object.entries(bones).sort((q, r) => r[1] - q[1]).slice(0, 4), tw = top.reduce((t, e) => t + e[1], 0);
      for (let q = 0; q < 4; q++) { decal.si.push(top[q] ? +top[q][0] : 0); decal.sw.push(top[q] ? top[q][1] / tw : 0); }
      // Seen from the front the player's right is on the viewer's left: the front reads with u running toward -x.
      // (The front patch is built facing the other way from the back one: both its axes run reversed.)
      decal.uv.push(side > 0 ? 1 - gx / (nx - 1) : gx / (nx - 1), side > 0 || kind >= 1 ? 1 - gy / (ny - 1) : gy / (ny - 1));
      decal.kind.push(kind);
    }
    for (let gy = 0; gy < ny - 1; gy++) for (let gx = 0; gx < nx - 1; gx++) {
      const a = base + gy * nx + gx, b = a + 1, c = a + nx, d = c + 1;
      // Wound to face outward (front: +z, back: -z), so only the visible side draws.
      if (side > 0) decal.idx.push(a, b, c, b, d, c); else decal.idx.push(a, c, b, b, c, d);
    }
  };
  const shAbs = hipH + Bk.shY;
  patch(0, 1, shAbs - 0.11, 0.15, 0.115, 22, 18); // front number, across the chest
  patch(1, -1, shAbs - 0.19, 0.165, 0.15, 26, 22); // back number
  patch(2, -1, shAbs + 0.02, 0.17, 0.05, 30, 8); // name plate across the shoulders
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
  bulk: f32(src.flatMap((i) => mass[i])),
  pad: f32(src.flatMap((i) => pad[i])),
  skinIndex: u8(src.flatMap((i) => skinIdx[i])),
  skinWeight: f32(src.flatMap((i) => skinW[i])),
  region: u8(src.map((i) => region[i])),
  part: u8(src.map((i) => part[i])),
  body: f32(src.flatMap((i) => body[i])),
  index: u16(outIdx),
  decals: { count: decal.pos.length / 3, position: f32(decal.pos), bulk: f32(decal.bulk), pad: f32(decal.pad), skinIndex: u8(decal.si),
    skinWeight: f32(decal.sw), uv: f32(decal.uv), kind: u8(decal.kind), index: u16(decal.idx) },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
