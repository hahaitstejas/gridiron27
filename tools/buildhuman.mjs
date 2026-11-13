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
  // MakeHuman's ".L" side sits at +x in our frame, where OUR right (R) bones are (render/body.js bindOrigin: L = -x). `s` stays
  // MakeHuman's (the re-pose transforms are keyed by it); the bones we fold into take the side by position (`o`). Folding by
  // name drove each visible limb with the opposite side's bones (the mesh looked right, but rigid cleats and the carried ball,
  // which ride on the real bones, sat on the other leg / arm).
  const o = s === 'L' ? 'R' : s === 'R' ? 'L' : null;
  const n = b.replace(/\.[LR]$/, '');
  if (/^upperarm0[12]$/.test(n)) return { t: 'upper', s, ours: { [`sh${o}`]: 1 } };
  if (/^(lowerarm0[12]|wrist|metacarpal\d|finger\d-\d)$/.test(n)) return { t: 'fore', s, ours: { [`el${o}`]: 1 } };
  if (/^upperleg0[12]$/.test(n)) return { t: 'thigh', s, ours: { [`hip${o}`]: 1 } };
  if (/^lowerleg0[12]$/.test(n)) return { t: 'shin', s, ours: { [`knee${o}`]: 1 } };
  if (/^(foot|toe\d-\d)$/.test(n)) return { t: 'shin', s, ours: { [`foot${o}`]: 1 } };
  if (n === 'shoulder01') return { t: null, s, ours: { chest: 0.55, [`sh${o}`]: 0.45 } };
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
// Relaxed curl of the fingers (the base mesh has them straight): each phalanx bends about its joint, toward the palm
// (the base pose has the palms down, so the tips go to -y), applied child first so the chain folds like a real finger.
const CURL = { 1: [0.1, 0.25, 0.15], 2: [0.3, 0.6, 0.35], 3: [0.32, 0.65, 0.38], 4: [0.35, 0.7, 0.4], 5: [0.4, 0.75, 0.42] }; // radians per joint, finger 1 = thumb
function curlFingers(P) {
  const chains = {};
  for (const s of ['L', 'R']) for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) {
    const name = `finger${f}-${j}.${s}`;
    chains[name] = [];
    for (let k = j; k >= 1; k--) { // this joint first, then its parents'
      const b = `finger${f}-${k}.${s}`;
      const h = head(P, b), t = joint(P, skel.bones[b].tail);
      const d = norm(sub(t, h));
      let axis = norm(cross(d, [0, 1, 0]));
      const a = CURL[f][k - 1];
      // Flip the axis if this angle would lift the tip instead of dropping it.
      const q = sub(t, h), rq = add(mul(q, Math.cos(a)), add(mul(cross(axis, q), Math.sin(a)), mul(axis, dot(axis, q) * (1 - Math.cos(a)))));
      if (rq[1] > q[1]) axis = mul(axis, -1);
      chains[name].push({ h, axis, a });
    }
  }
  const rotAbout = (p, c) => {
    const v = sub(p, c.h), cs = Math.cos(c.a), sn = Math.sin(c.a);
    return add(c.h, add(mul(v, cs), add(mul(cross(c.axis, v), sn), mul(c.axis, dot(c.axis, v) * (1 - cs)))));
  };
  return P.map((v, i) => {
    let tot = 0, acc = [0, 0, 0];
    for (const [b, w] of vw[i]) {
      const ch = chains[b];
      if (!ch) continue;
      let p = v;
      for (const c of ch) p = rotAbout(p, c);
      acc = add(acc, mul(p, w)); tot += w;
    }
    if (!tot) return v;
    const rest = vw[i].reduce((m, [, w]) => m + w, 0) - tot; // weight on non-finger bones stays put
    return mul(add(acc, mul(v, rest)), 1 / (tot + rest));
  });
}
const Ta = poseOf(ATH), Th = poseOf(HEAVY);
let A = repose(curlFingers(ATH), Ta), Hv = repose(curlFingers(HEAVY), Th);

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
  const dx = Math.sign(p[0]) * k * 0.055 * out;
  // Slope: the trapezius rises toward the neck and the cap sits just above the shoulder line.
  const dyy = k * 0.03 * Math.min(1, ax + 0.2) + 0.012 * k * Math.max(0, 1 - Math.abs(ax - 0.45) * 3);
  // The plates push outward from the torso's axis (not by the sign of z: that flips between neighbors at the sides and tears the surface).
  const onTorso = up < 0.5; // the plates are on the chest and back, not on the arm
  let px = 0, pz = 0;
  if (onTorso) {
    const r = Math.hypot(p[0], p[2]) || 1e-6, ux = p[0] / r, uz = p[2] / r;
    const amt = kp * 0.035 * (0.45 + 0.55 * Math.abs(uz)) + k * 0.012; // front / back plates stand off more than the sides
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


// ---------- cleats: the base mesh foot is bare (toes); smooth it into a shoe and give it a sole ----------
{
  const nb = A.map(() => new Set());
  for (const [a, b, c] of faces) { nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b); }
  const foot = ids.filter((i) => region[i] === REGION.shoe);
  const inFoot = new Set(foot);
  let P = A.map((p) => [...p]);
  for (let it = 0; it < 40; it++) for (const lam of [0.5, -0.53]) {
    const Q = P.map((p) => [...p]);
    for (const i of foot) {
      const n = [...nb[i]].filter((j) => inFoot.has(j) || A[j][1] > A[i][1]);
      if (!n.length) continue;
      const m = [0, 0, 0];
      for (const j of n) { m[0] += P[j][0]; m[1] += P[j][1]; m[2] += P[j][2]; }
      for (let k = 0; k < 3; k++) Q[i][k] = P[i][k] + lam * (m[k] / n.length - P[i][k]);
    }
    P = Q;
  }
  for (const i of foot) {
    const top = smooth01((A[i][1] - (ankleY - 0.02)) / 0.05); // blend back to the ankle so the sock join stays put
    const d = mul(sub(P[i], A[i]), 1 - top);
    if (A[i][1] < 0.03) d[1] = Math.min(d[1], 0); // keep the sole on the ground
    // A molded sole sticks out a little all round.
    const sole = A[i][1] < 0.035 ? 0.006 : 0;
    const r = Math.hypot(A[i][0] - Math.sign(A[i][0]) * Bk.hipX, A[i][2] - 0.05) || 1;
    d[0] += sole * (A[i][0] - Math.sign(A[i][0]) * Bk.hipX) / r; d[2] += sole * (A[i][2] - 0.05) / r;
    pad[i] = add(pad[i], mul(d, 1 / 1.3));
  }
}

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
        d = radial(p, cx, 0, 0.016 * bump(0.02 + t * 0.95) * (0.7 + 0.5 * t), 1.5); // quads (front) more than the sides: athletic, not bulky
      } else if (y > ankleY + 0.05) {
        const t = (y - ankleY) / (kneeY - ankleY);
        const r = radial(p, cx, 0, 0.012 * bump(0.25 + t * 0.7), 1.0);
        const back = p[2] < 0 ? 1.6 : 0.7;               // the calf bulges behind
        d = [r[0] * back, 0, r[2] * back];
      }
    } else if (legW > 0.3 && y >= hipH - 0.05 && y < hipH + 0.12 && region[i] === REGION.pants) {
      // Hip pads: a bulge over the hip bone on each side, under the pants.
      const hb = bump((y - (hipH - 0.05)) / 0.17) * smooth01((Math.abs(p[0]) - 0.1) / 0.08);
      d = [side * 0.012 * hb, 0, 0];
    } else if (!armW && !foreW && !legW) {
      // Trunk: sloped traps, a V-taper (lats wide, waist narrow), broad upper back.
      const ux = p[0] === 0 ? 0 : Math.sign(p[0]);
      const lat = bump((y - (waistY + 0.1)) / 0.5);      // lats: waist..chest
      const waist = bump((y - (waistY - 0.1)) / 0.28);   // the waist itself
      d = [ux * (0.024 * lat - 0.02 * waist) * Math.min(1, Math.abs(p[0]) / 0.12), 0, 0];
      // The jersey tucks into a narrow waist under broad pads (the TV V-taper): from the chest down, take the sides in and
      // flatten the belly and the lower back, most at the belt.
      const tap = smooth01((shY - 0.16 - y) / (shY - 0.16 - waistY)) * (1 - smooth01((waistY - 0.07 - y) / 0.06));
      if (tap > 0) {
        d[0] -= ux * 0.03 * tap * Math.min(1, Math.abs(p[0]) / 0.1);
        d[2] -= (p[2] > 0.02 ? 0.022 : p[2] < -0.04 ? -0.006 : 0) * tap * (1 - Math.min(1, Math.abs(p[0]) / 0.16));
      }
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
  const seatBack = (() => {
    const m = new Map();
    for (const i of ids) if (region[i] === 2 && A[i][2] < 0 && Math.abs(A[i][0]) < 0.14) { const k = Math.round(A[i][1] / 0.02); m.set(k, Math.min(m.get(k) ?? 0, A[i][2])); }
    return (y) => m.get(Math.round(y / 0.02)) ?? 0;
  })();
  const THICK = { 0: 0.02, 1: 0.016, 2: 0.006, 3: 0.006, 4: 0.004, 8: 0.012 }; // pants and socks cling (tight football pants)
  for (const i of ids) {
    const t = THICK[region[i]];
    if (!t) continue;
    const n = norm(nrm[i]);
    // The jersey drapes: thicker over the belly and back than the sides.
    // Fitted below the chest (it tucks into the pants), fuller over the pads.
    const k = region[i] === 0 ? t * (0.8 + 0.4 * Math.abs(n[2])) * (0.55 + 0.45 * smooth01((A[i][1] - waistY) / (shY - 0.12 - waistY))) : t;
    pad[i] = add(pad[i], mul(n, k));
    // Padded pants are smooth over the seat: fill the cleft between the glutes (it rendered as a dark crease).
    if (region[i] === 2 && A[i][2] < 0) {
      const y = A[i][1], ax = Math.abs(A[i][0]);
      const band = Math.max(0, 1 - Math.abs(y - (hipH - 0.08)) / 0.17);
      const mid = Math.max(0, 1 - ax / 0.09);
      if (band > 0 && mid > 0) {
        const zb = seatBack(y); // the cheeks' depth at this height: the cleft fills out to (just short of) it
        const fill = Math.max(0, A[i][2] - (zb + 0.012));
        pad[i] = add(pad[i], [0, 0, -fill * smooth01(band) * smooth01(mid) / 1.3]);
      }
    }
    // Thigh and knee pads under the pants: the thigh pad is a plate (flat face, short rounded edges, ~9 in tall) on the
    // front of the thigh; the knee pad a rounded cap over the kneecap.
    if (region[i] === 2 && n[2] > 0.2) {
      const y = A[i][1];
      const thigh = smooth01((0.125 - Math.abs(y - (kneeY + 0.25))) / 0.03) * smooth01((n[2] - 0.3) / 0.25);
      const kt = Math.abs(y - (kneeY + 0.015)) / 0.065, knee = kt < 1 ? Math.cos(kt * Math.PI / 2) ** 2 * smooth01((n[2] - 0.35) / 0.3) : 0;
      pad[i] = add(pad[i], mul(n, thigh * 0.017 + knee * 0.02));
    }
  }
}

// ---------- padded pants: a smooth seat (the bare glutes and the folds under them showed through tight pants) ----------
{
  const nb = A.map(() => new Set());
  for (const [a, b, c] of faces) { nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b); }
  const w = A.map((p, i) => (region[i] === 2 && p[2] < 0.03
    ? smooth01((p[1] - (hipH - 0.36)) / 0.08) * (1 - smooth01((p[1] - (hipH + 0.02)) / 0.06)) * smooth01((0.03 - p[2]) / 0.05) : 0));
  const idsS = ids.filter((i) => w[i] > 0);
  let P = A.map((p, i) => add(p, pad[i]));
  const pass = (lam) => {
    const Q = P.map((p) => [...p]);
    for (const i of idsS) {
      const n = [...nb[i]];
      const m = [0, 0, 0];
      for (const j of n) { m[0] += P[j][0]; m[1] += P[j][1]; m[2] += P[j][2]; }
      for (let k = 0; k < 3; k++) Q[i][k] = P[i][k] + lam * w[i] * (m[k] / n.length - P[i][k]);
    }
    P = Q;
  };
  for (let it = 0; it < 40; it++) { pass(0.5); pass(-0.53); }
  let mx = 0;
  for (const i of idsS) { const d = sub(P[i], add(A[i], pad[i])); mx = Math.max(mx, len(d)); pad[i] = add(pad[i], d); }
  console.log('seat smoothing:', idsS.length, 'vertices, max move', mx.toFixed(4));
}

// ---------- the jersey front stretches across the chest plate: one smooth convex curve per height, no pec lumps ----------
// Runs on the final padded shape (pads x 1.3, the runtime default): in each 2 cm slab of jersey from the lower ribs to the
// collarbone, the front's depth at each |x| is pulled onto a superellipse through the slab's centre-front depth and width.
{
  const PK = 1.3, lo = shY - 0.36, hi = shY + 0.01;
  const F = (i) => add(A[i], mul(pad[i], PK));
  const jersey = ids.filter((i) => region[i] === 0 && wOf(i, 'shL') + wOf(i, 'shR') < 0.5);
  const slabs = new Map();
  for (const i of jersey) { const y = A[i][1]; if (y < lo || y > hi) continue; const k = Math.round(y / 0.02); (slabs.get(k) || slabs.set(k, []).get(k)).push(i); }
  let moved = 0;
  for (const list of slabs.values()) {
    const front = list.filter((i) => F(i)[2] > 0.0);
    if (front.length < 8) continue;
    const xs = front.map((i) => Math.abs(F(i)[0])).sort((a, b) => a - b), a = xs[Math.floor(xs.length * 0.95)];
    const mids = front.filter((i) => Math.abs(F(i)[0]) < 0.05);
    if (!mids.length || a < 0.1) continue;
    const zf = Math.max(...mids.map((i) => F(i)[2]));
    const y = list.length ? A[list[0]][1] : 0;
    const w = smooth01((y - lo) / 0.06) * smooth01((hi - y) / 0.05); // ease in / out at the slab range's ends
    for (const i of front) {
      const f = F(i), t = Math.min(1, Math.abs(f[0]) / a);
      const zt = zf * Math.pow(Math.max(0, 1 - Math.pow(t, 3)), 1 / 3);
      const keep = smooth01((t - 0.8) / 0.2); // leave the sides (they meet the arms) alone
      const dz = (zt - f[2]) * w * (1 - keep);
      const cl = Math.max(-0.02, dz); // fill hollows fully; trim bulges by at most 2 cm
      pad[i] = add(pad[i], [0, 0, cl / PK]);
      moved = Math.max(moved, Math.abs(cl));
    }
  }
  console.log('chest plate fair: max move', moved.toFixed(4));
}

// The shoe region is the rigid cleat's footprint (render/players.js parts.shoe rides on the foot bone): give it to the foot bone
// alone, so the body's foot moves exactly with the cleat (a shin / foot blend slid out beside it in a hard ankle bend).
for (const i of ids) if (region[i] === REGION.shoe) {
  const b = A[i][0] < 0 ? BONE.footL : BONE.footR;
  skinIdx[i] = [b, 0, 0, 0]; skinW[i] = [1, 0, 0, 0];
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
  const patch = (kind, side, yc, hw, hh, nx, ny, xc = 0) => {
    const base = decal.pos.length / 3;
    const cz = czAt(yc);
    const pool = jersey.filter((i) => Math.sign(A[i][2] - cz) === side && Math.abs(A[i][1] - yc) < hh + 0.08 && Math.abs(A[i][0] - xc) < hw + 0.1);
    const inPool = new Set(pool);
    const tris = faces.filter((f) => f.some((v) => inPool.has(v)) && f.every((v) => region[v] === REGION.jersey));
    for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) {
      const x = xc - hw + (2 * hw * gx) / (nx - 1), y = yc - hh + (2 * hh * gy) / (ny - 1);
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
      // Kinds 3+ are the patches (chest, sleeves, under the V-neck): uv = (viewer's left .. right, bottom .. top) straight into the patch atlas.
      if (kind >= 3) decal.uv.push(gx / (nx - 1), gy / (ny - 1));
      else decal.uv.push(side > 0 ? 1 - gx / (nx - 1) : gx / (nx - 1), side > 0 || kind >= 1 ? 1 - gy / (ny - 1) : gy / (ny - 1));
      decal.kind.push(kind);
    }
    for (let gy = 0; gy < ny - 1; gy++) for (let gx = 0; gx < nx - 1; gx++) {
      const a = base + gy * nx + gx, b = a + 1, c = a + nx, d = c + 1;
      // Wound to face outward (front: +z, back: -z), so only the visible side draws.
      if (side > 0) decal.idx.push(a, b, c, b, d, c); else decal.idx.push(a, c, b, b, c, d);
    }
  };
  // A patch on the outside of the upper arm (wearer's left sleeve = +x, right = -x): the grid runs over (z, y) and is dropped along x.
  const sleevePatch = (kind, sgn, yc, hz, hh, nz, ny) => {
    const base = decal.pos.length / 3;
    const sl = ids.filter((i) => region[i] === REGION.sleeve && Math.sign(A[i][0]) === sgn && Math.abs(A[i][1] - yc) < hh + 0.1);
    const inPool = new Set(sl);
    const tris = faces.filter((f) => f.some((v) => inPool.has(v)) && f.every((v) => region[v] === REGION.sleeve));
    let zc = 0; for (const i of sl) zc += Pp[i][2]; zc = sl.length ? zc / sl.length : 0;
    for (let gy = 0; gy < ny; gy++) for (let gz = 0; gz < nz; gz++) {
      const z = zc - hz + (2 * hz * gz) / (nz - 1), y = yc - hh + (2 * hh * gy) / (ny - 1);
      let hit = null;
      for (const [ia, ib, ic] of tris) {
        const P0 = Pp[ia], P1 = Pp[ib], P2 = Pp[ic];
        // barycentric in the (z, y) plane
        const d = (P1[1] - P2[1]) * (P0[2] - P2[2]) + (P2[2] - P1[2]) * (P0[1] - P2[1]);
        if (Math.abs(d) < 1e-12) continue;
        const w0 = ((P1[1] - P2[1]) * (z - P2[2]) + (P2[2] - P1[2]) * (y - P2[1])) / d;
        const w1 = ((P2[1] - P0[1]) * (z - P2[2]) + (P0[2] - P2[2]) * (y - P2[1])) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const xx = w0 * P0[0] + w1 * P1[0] + w2 * P2[0];
        if (!hit || xx * sgn > hit.x * sgn) hit = { x: xx, v: [ia, ib, ic], w: [w0, w1, w2] };
      }
      if (!hit) { const n = sl.map((i) => [i, Math.hypot(Pp[i][2] - z, Pp[i][1] - y)]).sort((q, r) => q[1] - r[1])[0][0]; hit = { x: Pp[n][0], v: [n, n, n], w: [1, 0, 0] }; }
      const lerp3 = (arr) => [0, 1, 2].map((k) => hit.w[0] * arr(hit.v[0])[k] + hit.w[1] * arr(hit.v[1])[k] + hit.w[2] * arr(hit.v[2])[k]);
      const bs = lerp3((i) => A[i]), pd = lerp3((i) => pad[i]), bk = lerp3((i) => mass[i]);
      decal.pos.push(bs[0] + sgn * 0.01, bs[1], bs[2]);
      decal.pad.push(...pd); decal.bulk.push(...bk);
      const bones = {};
      hit.v.forEach((i, k) => { for (let q = 0; q < 4; q++) if (skinW[i][q] > 0) bones[skinIdx[i][q]] = (bones[skinIdx[i][q]] || 0) + skinW[i][q] * hit.w[k]; });
      const top = Object.entries(bones).sort((q, r) => r[1] - q[1]).slice(0, 4), tw = top.reduce((t, e) => t + e[1], 0);
      for (let q = 0; q < 4; q++) { decal.si.push(top[q] ? +top[q][0] : 0); decal.sw.push(top[q] ? top[q][1] / tw : 0); }
      // Seen from the wearer's left (+x) the viewer's right is -z; from his right (-x) it is +z.
      decal.uv.push(sgn > 0 ? 1 - gz / (nz - 1) : gz / (nz - 1), gy / (ny - 1));
      decal.kind.push(kind);
    }
    for (let gy = 0; gy < ny - 1; gy++) for (let gz = 0; gz < nz - 1; gz++) {
      const a = base + gy * nz + gz, b = a + 1, c = a + nz, d = c + 1;
      // (a, b, c) faces -x: flip for the +x sleeve so the print faces outward.
      if (sgn > 0) decal.idx.push(a, c, b, b, c, d); else decal.idx.push(a, b, c, b, d, c);
    }
  };
  const shAbs = hipH + Bk.shY;
  patch(0, 1, shAbs - 0.19, 0.15, 0.115, 22, 18); // front number, across the chest (lowered: the league shield sits under the V-neck)
  patch(1, -1, shAbs - 0.19, 0.165, 0.15, 26, 22); // back number
  patch(2, -1, shAbs + 0.02, 0.17, 0.05, 30, 8); // name plate across the shoulders
  // Patches (kinds 3..7 = left chest, right chest, left sleeve, right sleeve, collar). Left / right are the wearer's: his left is +x.
  patch(3, 1, shAbs - 0.075, 0.04, 0.045, 12, 12, 0.135); // left chest
  patch(4, 1, shAbs - 0.075, 0.04, 0.045, 12, 12, -0.135); // right chest
  sleevePatch(5, 1, shAbs - 0.085, 0.045, 0.045, 12, 12); // left sleeve
  sleevePatch(6, -1, shAbs - 0.085, 0.045, 0.045, 12, 12); // right sleeve
  { // under the V-neck: its tip sits at 83% of the way from the waist to the collar (see body.js's neckline)
    const tip = waistY + 0.83 * (collarY - waistY);
    patch(7, 1, tip - 0.047, 0.043, 0.04, 12, 12);
  }
}

// ---------- decimate ----------
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true; // simplifyWithAttributes (vertex lock)
const remap = new Map(ids.map((v, k) => [v, k]));
const pos = new Float32Array(ids.length * 3);
ids.forEach((v, k) => pos.set(A[v], k * 3));
let index = new Uint32Array(faces.flat().map((v) => remap.get(v)));
// Region borders and the left / right seam stay put (locked) so uniform edges and the numbers stay clean.
// The hands (gloves region: fingers and thumbs) are locked so the simplifier doesn't melt them; the rest takes the whole cut.
const lock = new Uint8Array(ids.length);
let handVerts = 0;
ids.forEach((v, k) => { if (region[v] === REGION.gloves) { lock[k] = 1; handVerts++; } });
let handTris = 0;
for (let t = 0; t < index.length; t += 3) if (lock[index[t]] && lock[index[t + 1]] && lock[index[t + 2]]) handTris++;
// Stage A: only the hands are free; they go to HAND_RATIO (the fingers survive, the palm and back lose their flat triangles).
const HAND_RATIO = 0.6;
const lockOther = lock.map((v) => 1 - v);
const handTarget = Math.floor(handTris * HAND_RATIO);
const [stageA] = MeshoptSimplifier.simplifyWithAttributes(index, pos, 3, new Float32Array(0), 1, [], lockOther, (index.length / 3 - handTris + handTarget) * 3, 0.01, []);
let handTris2 = 0;
for (let t = 0; t < stageA.length; t += 3) if (lock[stageA[t]] && lock[stageA[t + 1]] && lock[stageA[t + 2]]) handTris2++;
// Stage B: the hands are locked as they are; the rest takes the usual cut.
const keepTris = Math.floor((stageA.length / 3 - handTris2) * TARGET_RATIO) + handTris2;
console.log(`hands: ${handVerts} vertices, ${handTris} → ${handTris2} triangles kept`);
const [simp, err] = MeshoptSimplifier.simplifyWithAttributes(stageA, pos, 3, new Float32Array(0), 1, [], lock, keepTris * 3, 0.01, ['LockBorder']);
const keep = [...new Set(simp)].sort((a, b) => a - b);
const k2 = new Map(keep.map((v, k) => [v, k]));
const outIdx = Array.from(simp, (v) => k2.get(v));
const src = keep.map((k) => ids[k]);
// A second, much lighter index buffer over the same vertices for the sideline players (render/players.js `bodyLod`): the
// fingers and region borders are free to go (LockBorder still keeps the uniform edges clean).
const lodPos = new Float32Array(keep.length * 3);
keep.forEach((k, n) => lodPos.set(pos.subarray(k * 3, k * 3 + 3), n * 3));
const [lodSimp, lodErr] = MeshoptSimplifier.simplify(new Uint32Array(outIdx), lodPos, 3, Math.floor(outIdx.length * 0.3 / 3) * 3, 0.08, ['LockBorder']);
// The jersey shell (render/players.js `parts.shell`): a second draw of the torso and upper-arm triangles, pushed out by the
// cloth thickness in the vertex shader and cut to the real jersey zones per pixel, so the cloth is a layer over the body
// (the arm shows inside the sleeve, the hem and the neck have a visible edge).
const shellIdx = [];
for (let t = 0; t < outIdx.length; t += 3) {
  let ok = true;
  for (let q = 0; q < 3 && ok; q++) {
    const v = src[outIdx[t + q]], y = A[v][1];
    if (part[v] === 0) ok = y > Bk.waistY - 0.12 && y < Bk.collarY + 0.02;
    else if (part[v] === 1) ok = y > Bk.sleeveY - 0.1;
    else ok = false;
  }
  if (ok) shellIdx.push(outIdx[t], outIdx[t + 1], outIdx[t + 2]);
}
console.log(`shell: ${shellIdx.length / 3} triangles`);
console.log(`lod: ${lodSimp.length / 3} triangles (error ${lodErr.toFixed(4)})`);
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
  lodIndex: u16(Array.from(lodSimp)),
  shellIndex: u16(shellIdx),
  decals: { count: decal.pos.length / 3, position: f32(decal.pos), bulk: f32(decal.bulk), pad: f32(decal.pad), skinIndex: u8(decal.si),
    skinWeight: f32(decal.sw), uv: f32(decal.uv), kind: u8(decal.kind), index: u16(decal.idx) },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
