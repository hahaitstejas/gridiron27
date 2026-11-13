import * as THREE from 'three';
import foldUrl from '../assets/jersey_fold.png'; // soft cloth folds baked from the CC BY reference shirt (tools/bakefolds.mjs), see CREDITS.md
import fabricUrl from '../assets/fabric_normal.jpg'; // ambientCG Fabric030 normal map (CC0), see CREDITS.md

// One smooth, skinned football-player body (torso over shoulder pads, pelvis, arms with gloves, legs with socks),
// drawn for every player with a single InstancedMesh. Each instance is skinned on the GPU from a float texture of
// bone matrices (one row per instance), so elbows, knees, the waist and the shoulders bend as one surface instead of
// separate capsules meeting at the joints. Uniform colors, the jersey number and the name on the back come from the
// same texture (no per-part draw calls).
//
// Bind pose = PlayerRenderer's pose with every angle 0, height scale 1 and width 1 (standing straight, arms hanging).
// Bones (texture columns b*4 .. b*4+3):
export const BONE = { hips: 0, chest: 1, head: 2, shL: 3, shR: 4, elL: 5, elR: 6, hipL: 7, hipR: 8, kneeL: 9, kneeR: 10, footL: 11, footR: 12 };
export const BONES = 13;
export const COL_PARAMS = 52; // (width, limb thickness, chest depth, shoulder-pad width)
export const COL_COLORS = 53; // 9 region colors
export const COL_NUMBER = 62; // (atlas cell x, cell y, name row, show number)
export const COL_NUMCOL = 63; // number color
export const COL_FLAGS = 64; // (officials' stripes, lineman bulk 0..1, shoulder pads 0..1, face photo)
export const TEX_W = 72;
// Uniform regions (vertex attribute) → color texel.
export const REGION = { jersey: 0, sleeve: 1, pants: 2, stripe: 3, socks: 4, skin: 5, forearm: 6, gloves: 7, shoe: 8 };

// Bind-pose joint positions (yards) for width w: kept in sync with PlayerRenderer.drawPlayer's frames.
// Procedural defaults; applySkeleton() replaces them with the MakeHuman body's (src/assets/human.json) at boot.
export const BIND = { spineY: 0, hipH: 1.0, hipX: 0.125, thigh: 0.48, shin: 0.47, torso: 0.66, shX: 0.27, shY: 0.66 * 0.84, shZ: 0, upper: 0.34, fore: 0.32, headY: 0.86, headZ: 0.02, helmY: 0, helmZ: 0 };
/** Use a body's skeleton (yards). Everything that poses or skins players reads BIND, so this is the one switch. */
export function applySkeleton(sk) { Object.assign(BIND, sk); }
/** Bind-space origin of bone b for width w (the bind pose has no rotations, so bind = a translation). */
export function bindOrigin(b, w, out) {
  const B = BIND, shY = B.hipH + B.shY;
  switch (b) {
    case BONE.hips: case BONE.chest: return out.set(0, B.hipH, 0);
    case BONE.head: return out.set(0, B.hipH + B.headY, B.headZ);
    case BONE.shL: case BONE.shR: return out.set((b === BONE.shL ? -1 : 1) * B.shX * w, shY, B.shZ);
    case BONE.elL: case BONE.elR: return out.set((b === BONE.elL ? -1 : 1) * B.shX * w, shY - B.upper, B.shZ);
    case BONE.hipL: case BONE.hipR: return out.set((b === BONE.hipL ? -1 : 1) * B.hipX * w, B.hipH, 0);
    case BONE.kneeL: case BONE.kneeR: return out.set((b === BONE.kneeL ? -1 : 1) * B.hipX * w, B.hipH - B.thigh, 0);
    default: return out.set((b === BONE.footL ? -1 : 1) * B.hipX * w, B.hipH - B.thigh - B.shin - 0.01, 0.06);
  }
}

// ---------- geometry ----------
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Vertex kinds (how a player's build reshapes the bind mesh in the shader): 0 chest (x by width, z by chest depth),
// 1 limb (axis x by width, radius by limb thickness), 3 pelvis (x and z by width).
const KIND_CHEST = 0, KIND_LIMB = 1, KIND_PELVIS = 3;

/**
 * A tube of horizontal elliptical rings along bind-space y. rings: [{ y, rx, rz, cz? }] from top to bottom (or bottom
 * to top); f(y, angle) → { a, b, w, region } picks the two bones and weight (w on a) and the uniform region.
 * n = segments around; exp = superellipse exponent (2 = ellipse, higher = boxier, for the chest).
 */
function tube(out, cx, rings, n, f, kind, { exp = 2, capTop = true, capBottom = true, bodyUv = null, flatSide = 0 } = {}) {
  const base = out.pos.length / 3;
  const pw = 2 / exp;
  // A ring marked split is emitted twice (same place, the region above / below it), so uniform seams are clean lines.
  const desc = rings.length > 1 && rings[rings.length - 1].y < rings[0].y;
  rings = rings.flatMap((R) => (R.split ? (desc ? [{ ...R, ry: 1 }, { ...R, ry: -1 }] : [{ ...R, ry: -1 }, { ...R, ry: 1 }]) : [R]));
  for (let r = 0; r < rings.length; r++) {
    const R = rings[r];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2; // 0 = front (+z), increasing toward +x
      const s = Math.sin(a), c = Math.cos(a);
      const sx = Math.sign(s) * Math.pow(Math.abs(s), pw), sz = Math.sign(c) * Math.pow(Math.abs(c), pw);
      // flatSide: flatten the inner face of a limb a little (thighs against each other read less like pipes).
      const inner = flatSide ? Math.max(0, -s * Math.sign(cx || 1)) : 0;
      const x = cx + sx * R.rx * (1 - inner * flatSide), z = (R.cz || 0) + sz * R.rz, y = R.y;
      out.pos.push(x, y, z);
      out.axis.push(cx, y, R.cz || 0);
      const wt = f(y, a, s);
      const region = R.ry ? f(y + R.ry * 0.002, a, s).region : wt.region;
      out.skin.push(wt.a, wt.b, wt.w, region);
      out.kind.push(kind);
      out.uv.push(k / n * (R.rx + R.rz) * 9, y * 9);
      out.body.push(bodyUv ? bodyUv(y, a)[0] : -1, bodyUv ? bodyUv(y, a)[1] : -1);
    }
  }
  const row = n + 1;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < n; k++) {
      const i0 = base + r * row + k, i1 = i0 + 1, j0 = i0 + row, j1 = j0 + 1;
      // Rings run top to bottom or bottom to top: wind so the faces point outward either way.
      if (rings[r + 1].y < rings[r].y) out.idx.push(i0, j0, i1, i1, j0, j1);
      else out.idx.push(i0, i1, j0, i1, j1, j0);
    }
  }
  const cap = (r, top) => {
    const R = rings[r];
    const ci = out.pos.length / 3;
    const dir = rings.length > 1 ? Math.sign(R.y - rings[r === 0 ? 1 : r - 1].y) : 1;
    const y = R.y + dir * Math.min(R.rx, R.rz) * 0.6;
    out.pos.push(cx, y, R.cz || 0); out.axis.push(cx, y, R.cz || 0);
    const wt = f(y, 0, 0);
    out.skin.push(wt.a, wt.b, wt.w, wt.region); out.kind.push(kind); out.uv.push(0, y * 9); out.body.push(-1, -1);
    for (let k = 0; k < n; k++) {
      const i0 = base + r * row + k, i1 = i0 + 1;
      if ((dir > 0) === top) out.idx.push(ci, i1, i0); else out.idx.push(ci, i0, i1);
      if (dir < 0 && top) { out.idx.pop(); out.idx.pop(); out.idx.pop(); out.idx.push(ci, i0, i1); }
    }
  };
  const first = 0, last = rings.length - 1;
  // The first ring is the top for tubes listed top-down.
  if (capTop) cap(rings[first].y > rings[last].y ? first : last, true);
  if (capBottom) cap(rings[first].y > rings[last].y ? last : first, false);
}

/** The whole body in bind space (BufferGeometry with position, normal, uv, aSkin, aAxis, aKind, aBody). */
export function buildBodyGeometry() {
  const out = { pos: [], axis: [], skin: [], kind: [], uv: [], body: [], idx: [] };
  const B = BIND;
  const shY = B.hipH + B.torso * 0.84, elY = shY - B.upper, kneeY = B.hipH - B.thigh;
  const top = B.hipH + B.torso; // collar

  // Torso: pelvis (pants) up to the collar, the jersey pulled over wide shoulder pads.
  const torsoRings = [
    { y: 0.84, rx: 0.162, rz: 0.119 }, { y: 0.9, rx: 0.205, rz: 0.140, cz: -0.005 }, { y: 0.97, rx: 0.221, rz: 0.151, cz: -0.01 },
    { y: 1.04, rx: 0.221, rz: 0.146 }, { y: 1.05, rx: 0.219, rz: 0.145, split: true }, { y: 1.1, rx: 0.211, rz: 0.140, cz: 0.005 }, { y: 1.18, rx: 0.216, rz: 0.146, cz: 0.01 },
    { y: 1.27, rx: 0.232, rz: 0.157, cz: 0.012 }, { y: 1.36, rx: 0.254, rz: 0.167, cz: 0.012 }, { y: 1.44, rx: 0.292, rz: 0.178, cz: 0.01 },
    { y: 1.5, rx: 0.346, rz: 0.192 }, { y: 1.56, rx: 0.373, rz: 0.200 }, { y: 1.61, rx: 0.362, rz: 0.192 },
    { y: 1.645, rx: 0.292, rz: 0.162 }, { y: top - 0.005, rx: 0.162, rz: 0.119 },
  ];
  const torsoW = (y, a, s) => {
    const region = y < 1.05 ? REGION.pants : REGION.jersey;
    // Hips bone below the belt, chest bone from the ribs up: the spine bends through the waist.
    const w = 1 - smooth(1.04, 1.32, y);
    return { a: BONE.hips, b: BONE.chest, w, region };
  };
  const numberUv = (y, a) => [a + Math.PI / 2, (y - 1.06) / (1.64 - 1.06)]; // same convention as the MakeHuman body
  tube(out, 0, torsoRings, 40, torsoW, KIND_CHEST, { exp: 2.5, capBottom: true, capTop: true, bodyUv: numberUv });
  // Neck: chest to head.
  tube(out, 0, [{ y: top - 0.06, rx: 0.088, rz: 0.088, cz: 0.0 }, { y: top + 0.04, rx: 0.08, rz: 0.08, cz: 0.012 }, { y: top + 0.13, rx: 0.075, rz: 0.075, cz: 0.02 }], 12,
    (y) => ({ a: BONE.chest, b: BONE.head, w: 1 - smooth(top + 0.0, top + 0.12, y), region: REGION.skin }), KIND_LIMB, { capBottom: false });

  for (const side of [-1, 1]) {
    const L = side < 0;
    const sh = L ? BONE.shL : BONE.shR, el = L ? BONE.elL : BONE.elR;
    const hp = L ? BONE.hipL : BONE.hipR, kn = L ? BONE.kneeL : BONE.kneeR;
    // Arm: deltoid (under the pad), biceps, elbow, forearm, wrist, glove.
    const ax = side * B.shX;
    const armRings = [
      { y: shY + 0.06, rx: 0.090, rz: 0.096 }, { y: shY, rx: 0.113, rz: 0.115 }, { y: shY - 0.08, rx: 0.106, rz: 0.110 },
      { y: shY - 0.13, rx: 0.102, rz: 0.106, cz: 0.002, split: true }, { y: shY - 0.17, rx: 0.099, rz: 0.102, cz: 0.004 }, { y: shY - 0.26, rx: 0.084, rz: 0.087 }, { y: elY, rx: 0.077, rz: 0.079 },
      { y: elY - 0.06, rx: 0.082, rz: 0.084, cz: 0.004 }, { y: elY - 0.14, rx: 0.074, rz: 0.077 }, { y: elY - 0.25, rx: 0.059, rz: 0.061 },
      { y: elY - 0.3, rx: 0.055, rz: 0.059 }, { y: elY - 0.31, rx: 0.053, rz: 0.059, split: true }, { y: elY - 0.34, rx: 0.04, rz: 0.062, cz: 0.006 }, { y: elY - 0.39, rx: 0.036, rz: 0.058, cz: 0.01 },
      { y: elY - 0.43, rx: 0.03, rz: 0.044, cz: 0.012 },
    ];
    tube(out, ax, armRings, 16, (y) => {
      const region = y > shY - 0.13 ? REGION.sleeve : y > elY - 0.31 ? REGION.forearm : REGION.gloves;
      if (y > shY - 0.02) return { a: sh, b: BONE.chest, w: 1 - 0.55 * smooth(shY - 0.02, shY + 0.06, y), region };
      return { a: sh, b: el, w: 1 - smooth(elY + 0.05, elY - 0.05, y), region };
    }, KIND_LIMB);
    // Leg: glute / thigh, knee, calf, ankle (the cleat is a rigid part on the foot bone).
    const lx = side * B.hipX;
    const legRings = [
      { y: B.hipH + 0.04, rx: 0.132, rz: 0.144, cz: -0.01 }, { y: B.hipH - 0.04, rx: 0.144, rz: 0.150, cz: -0.005 }, { y: B.hipH - 0.14, rx: 0.138, rz: 0.142 },
      { y: B.hipH - 0.26, rx: 0.124, rz: 0.127, cz: 0.006 }, { y: B.hipH - 0.38, rx: 0.106, rz: 0.108, cz: 0.008 }, { y: kneeY + 0.02, rx: 0.091, rz: 0.096, cz: 0.01 },
      { y: kneeY - 0.05, rx: 0.086, rz: 0.090, cz: 0.004 }, { y: kneeY - 0.07, rx: 0.087, rz: 0.092, split: true }, { y: kneeY - 0.13, rx: 0.090, rz: 0.096, cz: -0.012 }, { y: kneeY - 0.22, rx: 0.082, rz: 0.084, cz: -0.01 },
      { y: kneeY - 0.32, rx: 0.062, rz: 0.065 }, { y: kneeY - 0.41, rx: 0.054, rz: 0.056 }, { y: kneeY - 0.47, rx: 0.055, rz: 0.060, cz: 0.01 },
    ];
    tube(out, lx, legRings, 24, (y, a, s) => {
      const region = y > kneeY - 0.07 ? REGION.pants : REGION.socks;
      if (y > B.hipH - 0.08) return { a: hp, b: BONE.hips, w: 1 - 0.5 * smooth(B.hipH - 0.08, B.hipH + 0.04, y), region };
      return { a: hp, b: kn, w: 1 - smooth(kneeY + 0.06, kneeY - 0.06, y), region };
    }, KIND_LIMB, { flatSide: 0.15, bodyUv: (y, a) => [Math.cos(a - side * Math.PI / 2), side < 0 ? -2 : -3] }); // 0 = the outside of the leg
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  // Same attribute layout as the MakeHuman body: 4 bone indices / weights, region, zero shape deltas.
  const n = out.pos.length / 3, idx = new Float32Array(n * 4), wt = new Float32Array(n * 4), reg = new Float32Array(n);
  for (let k = 0; k < n; k++) { idx[k * 4] = out.skin[k * 4]; idx[k * 4 + 1] = out.skin[k * 4 + 1]; wt[k * 4] = out.skin[k * 4 + 2]; wt[k * 4 + 1] = 1 - out.skin[k * 4 + 2]; reg[k] = out.skin[k * 4 + 3]; }
  g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('aWt', new THREE.BufferAttribute(wt, 4));
  g.setAttribute('aRegion', new THREE.BufferAttribute(reg, 1));
  g.setAttribute('aBulkD', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aPadD', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(out.axis, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(out.kind, 1));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(out.body, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(out.pos.length / 3).fill(-1), 1));
  g.setIndex(out.idx);
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

// ---------- shaders ----------
const VERT_HEAD = /* glsl */`
uniform sampler2D boneTex;
attribute vec4 aIdx;
attribute vec4 aWt;
attribute float aRegion;
attribute vec3 aBulkD;
attribute vec3 aPadD;
attribute vec3 aAxis;
attribute float aKind;
attribute vec2 aBody;
attribute float aPart;
flat varying float vInst;
flat varying float vRegion;
varying vec2 vBody;
flat varying float vPart;
varying float vBindY;
varying vec3 vBindN;
uniform float uShell; // > 0: this mesh is the jersey shell (or a print on it): pushed out by the cloth thickness x uShell
uniform vec4 uRegY;
uniform int uRowOff; // the first bone-texture row this mesh draws (the sideline LOD mesh starts after the main players)
mat4 boneMat(int b) {
  int c = b * 4;
  return mat4(texelFetch(boneTex, ivec2(c, gl_InstanceID + uRowOff), 0), texelFetch(boneTex, ivec2(c + 1, gl_InstanceID + uRowOff), 0),
              texelFetch(boneTex, ivec2(c + 2, gl_InstanceID + uRowOff), 0), texelFetch(boneTex, ivec2(c + 3, gl_InstanceID + uRowOff), 0));
}
vec3 buildPos(vec3 p, vec3 nrm) {
  vec4 prm = texelFetch(boneTex, ivec2(${COL_PARAMS}, gl_InstanceID + uRowOff), 0); // width, limb, chest depth
  if (aKind < 0.5) { float pad = mix(1.0, prm.w, smoothstep(1.38, 1.56, p.y)); return vec3(p.x * prm.x * pad, p.y, p.z * prm.z); }
  if (aKind < 1.5) { vec3 ax = vec3(aAxis.x * prm.x, aAxis.y, aAxis.z); return ax + (p - aAxis) * vec3(prm.y, 1.0, prm.y); }
  if (aKind > 4.5) {
    // The MakeHuman body: build (tools/buildhuman.mjs mass: neck, chest, belly, arms, thighs; 1 = a ~320 lb lineman) and
    // pads as shape deltas, then the hips, seat and thighs taken in toward each leg's center so the shoulder pads read
    // wider than the hips the way a player in uniform does on TV.
    vec4 fl = texelFetch(boneTex, ivec2(${COL_FLAGS}, gl_InstanceID + uRowOff), 0);
    float lower = smoothstep(1.34, 1.12, p.y); // from the lower ribs down: the jersey tapers into the belt, hips and seat trimmed
    vec3 q = p + aBulkD * fl.y + aPadD * fl.z;
    // Officials / coaches (no pads) wear a ball cap: the top of the skull is tucked in a little so it never pokes through it.
    if (fl.z < 0.01 && aPart > 2.5) {
      float capK = smoothstep(1.93, 1.98, p.y) * 0.13;
      vec3 hc = vec3(0.0, 1.95, 0.035);
      q = hc + (q - hc) * (1.0 - capK);
    }
    float t = lower * smoothstep(0.32, 0.6, p.y);
    float cx = 0.105 * clamp(q.x / 0.05, -1.0, 1.0);
    q.x = cx + (q.x - cx) * (1.0 - 0.45 * t);
    // The belly comes in over a longer ramp than the sides / seat: a short ramp left the chest overhanging it (it read as
    // two pec lumps from the front three-quarter view).
    float tf = smoothstep(1.5, 1.1, p.y) * smoothstep(0.32, 0.6, p.y);
    q.z = q.z < -0.03 ? -0.03 + (q.z + 0.03) * (1.0 - 0.45 * t) : q.z * (1.0 - 0.11 * tf);
    if (uShell < 0.0 && aRegion < 1.5 && aPart < 1.5) q -= normalize(nrm) * 0.013; // under the shell: tucked inside it
    if (uShell > 0.0) {
      // Cloth is a layer, not skin: a centimetre or so over the pads and body, looser toward the hem and at the sleeve ends.
      float cl = 0.0;
      // The jersey is tucked in: a little fuller over the chest, snug at the belt (looseness at the hem flared it into a skirt).
      if (aPart < 0.5) cl = 0.007 + 0.005 * smoothstep(uRegY.x + 0.12, uRegY.x + 0.35, p.y);
      else if (aPart < 1.5) cl = 0.010 + 0.009 * smoothstep(uRegY.y + 0.18, uRegY.y - 0.02, p.y);
      q += normalize(nrm) * cl * uShell;
    }
    return q;
  }
  return vec3(p.x * prm.x, p.y, p.z * prm.x);
}
mat4 skinMat() { return boneMat(int(aIdx.x)) * aWt.x + boneMat(int(aIdx.y)) * aWt.y + boneMat(int(aIdx.z)) * aWt.z + boneMat(int(aIdx.w)) * aWt.w; }
`;

function patchVertex(sh, normals = true, rowOff = null, shell = null) {
  sh.uniforms.boneTex = BODY_UNIFORMS.boneTex;
  sh.uniforms.uShell = shell || { value: 0 };
  sh.uniforms.uRegY = BODY_UNIFORMS.regionY;
  sh.uniforms.uRowOff = rowOff || { value: 0 };
  let v = VERT_HEAD + 'mat4 gSk;\n' + sh.vertexShader;
  if (normals) v = v.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\ngSk = skinMat();\nobjectNormal = normalize(mat3(gSk) * objectNormal);');
  v = v.replace('#include <begin_vertex>', `#include <begin_vertex>\n${normals ? '' : 'gSk = skinMat();'}\ntransformed = (gSk * vec4(buildPos(position, normal), 1.0)).xyz;\nvInst = float(gl_InstanceID + uRowOff); vRegion = aRegion; vBody = aBody; vPart = aPart; vBindY = position.y;${normals ? ' vBindN = normal;' : ''}`);
  sh.vertexShader = v;
}

export const BODY_UNIFORMS = { numTex2: { value: null }, patchTex: { value: null }, foldTex: { value: null }, boneTex: { value: null }, numTex: { value: null }, nameTex: { value: null }, nameRows: { value: 56 }, faceTex: { value: null }, sweat: { value: 0 },
  regionY: { value: new THREE.Vector4(1.156, 1.531, 1.113, 0.488) }, shoeY: { value: 0.109 }, collarY: { value: 1.79 }, decals: { value: 0 } };

/** The body's material: per-instance region colors, numbers / name printed on the jersey, fabric sheen. */
/** opts.shell: draw as the jersey shell (cloth thickness, cut to the jersey zones); opts.under: the plain body hides its jersey zones behind a dark undershirt layer. */
export function bodyMaterial(envMap, fabric, rowOff = { value: 0 }, opts = {}) {
  // The plain body under the jersey shell gets uShell = -1: its jersey / sleeve zones sit a little inside (buildPos), so the
  // shell never has the body poking through it (it showed as dark sawtooth patches on the shoulders and back).
  const uShell = { value: opts.under ? -1 : opts.shell || 0 }, uUnder = { value: opts.under ? 1 : 0 };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, envMap, envMapIntensity: 0.22,
    sheen: 0.55, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.45, 0.45, 0.45), normalMap: fabric, normalScale: new THREE.Vector2(0.6, 0.6) });
  m.onBeforeCompile = (sh) => {
    patchVertex(sh, true, rowOff, uShell);
    sh.uniforms.uUnder = uUnder;
    sh.uniforms.foldTex = BODY_UNIFORMS.foldTex; sh.uniforms.numTex = BODY_UNIFORMS.numTex; sh.uniforms.nameTex = BODY_UNIFORMS.nameTex; sh.uniforms.nameRows = BODY_UNIFORMS.nameRows; sh.uniforms.faceTex = BODY_UNIFORMS.faceTex; sh.uniforms.uSweat = BODY_UNIFORMS.sweat;
    sh.uniforms.uRegY = BODY_UNIFORMS.regionY; sh.uniforms.uShoeY = BODY_UNIFORMS.shoeY; sh.uniforms.uCollarY = BODY_UNIFORMS.collarY; sh.uniforms.uDecals = BODY_UNIFORMS.decals;
    sh.fragmentShader = `uniform sampler2D boneTex; uniform sampler2D numTex; uniform sampler2D nameTex; uniform float nameRows; uniform sampler2D faceTex; uniform sampler2D foldTex; uniform float uSweat;
uniform vec4 uRegY; uniform float uShoeY; uniform float uCollarY; uniform float uDecals; uniform float uShell; uniform float uUnder;
flat varying float vInst; flat varying float vRegion; varying vec2 vBody; flat varying float vPart; varying float vBindY; varying vec3 vBindN;
vec4 tex(int c) { return texelFetch(boneTex, ivec2(c, int(vInst + 0.5)), 0); }
float vh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(vh(i), vh(i + vec2(1.0, 0.0)), f.x), mix(vh(i + vec2(0.0, 1.0)), vh(i + vec2(1.0, 1.0)), f.x), f.y) * 2.0 - 1.0; }
float gFold = 0.0; // cloth fold height (-1..1): shades the creases and bends the normal
` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      int region = int(floor(vRegion + 0.5));
      // MakeHuman body: each part's uniform edges come from the bind-pose height per pixel (clean lines, not triangle zigzags).
      // uRegY = (waist, sleeve end, wrist, sock top), uShoeY = top of the cleat.
      bool band = false;
      if (vPart > -0.5) {
        int part = int(floor(vPart + 0.5));
        float y = vBindY;
        if (part == 0) region = y > uCollarY ? 5 : y > uRegY.x ? (region == 1 ? 1 : 0) : 2;
        else if (part == 1) region = y > uRegY.y ? 1 : (y > uRegY.z ? 6 : 7);
        else if (part == 2) { region = y > uRegY.w ? 2 : (y > uShoeY ? 4 : 8); float d = uRegY.w - y; band = region == 4 && ((d > 0.05 && d < 0.066) || (d > 0.08 && d < 0.096)); }
        else region = y > uCollarY - 0.03 ? 5 : 0; // the head part's lowest ring is the collar
      }
      // Layers: the shell is only the jersey and sleeves (cut per pixel at the real hem, cuff and neck); the plain body hides
      // those zones behind a dark undershirt, so the arm shows inside the sleeve and a gap at the hem reads as depth.
      bool underLayer = false;
      if (uShell > 0.5) { if (region != 0 && region != 1) discard; }
      else if (uUnder > 0.5 && (region == 0 || region == 1)) { underLayer = true; region = 6; }
      vec3 col = tex(${COL_COLORS} + region).rgb;
      if (underLayer) col *= 0.5;
      // Sleeve and sock stripes in the trim color (the pants stripe's), when it differs from the base.
      if (band) { vec3 tc = tex(${COL_COLORS} + 3).rgb; if (distance(tc, col) > 0.08) col = tc; }
      if (vPart > -0.5) {
        vec3 jer = tex(${COL_COLORS}).rgb, tr = tex(${COL_COLORS} + 3).rgb;
        vec3 trimC = distance(tr, jer) > 0.12 ? tr : (dot(jer, vec3(0.33)) > 0.5 ? vec3(0.08) : vec3(0.92));
        float y = vBindY;
        // Sleeve stripes: two bands just above the sleeve's end, on the arm tube and the shoulder cap alike.
        if (region == 1 && vPart > 0.5 && vPart < 1.5) { float d = y - uRegY.y; if ((d > 0.018 && d < 0.032) || (d > 0.044 && d < 0.058)) col = trimC; }
        // Jersey neckline: a V in front with a trim edge and the undershirt inside, a trim collar band all round.
        // Cloth: a few soft vertical drape folds hanging from the pads, horizontal tuck wrinkles above the belt, and the
        // pants bunching at the knees: shading only (no geometry), strongest where real fabric gathers.
        if (region == 0) {
          float a = vBody.x;
          float h = (y - uRegY.x) / max(0.01, uRegY.y - uRegY.x);
          float drape = sin(a * 9.0 + sin(a * 2.0) * 1.5) * 0.5 + 0.5;
          float tuck = (sin(y * 260.0 + sin(a * 5.0) * 2.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 0.22, h));
          if (abs(dFdx(vBody.x)) + abs(dFdy(vBody.x)) < 0.6) col *= 1.0 - 0.07 * drape * smoothstep(0.1, 0.5, 1.0 - h) - 0.12 * tuck; // not across the wrap seam
        }
        if (region == 2 && vPart > 1.5 && vPart < 2.5) {
          float k = max(0.0, 1.0 - abs(y - uRegY.w - 0.07) / 0.06);
          col *= 1.0 - 0.1 * k * (sin(y * 300.0) * 0.5 + 0.5);
        }
        if (region == 0 && vBody.y > 0.5 && abs(dFdx(vBody.x)) + abs(dFdy(vBody.x)) < 0.6) { // (not across the wrap seam)
          float a = vBody.x - 1.5708; float fa = a > 3.14159 ? a - 6.28318 : a;
          float depth = 1.0 - vBody.y;
          float vee = 0.17 * max(0.0, 1.0 - abs(fa) / 0.4);
          if (depth < vee - 0.03) col = jer * 0.3;
          else if (depth < vee || depth < 0.022) col = trimC;
        }
        // Wrist tape: nearly everyone (not officials / coaches) wears a white band above the glove or bare hand, QBs included.
        if (region == 6 && tex(${COL_FLAGS}).x < 0.5) { float d = y - uRegY.z; if (d > 0.004 && d < 0.05) col = vec3(0.92); }
        // Jersey mesh: a fine punched-hole pattern on the lower torso and sides (fades out where the holes are under a pixel).
        if (region == 0 && vBody.y > 0.0 && vBody.y < 0.5) {
          vec2 mp = vec2(vBody.x * 26.0, vBody.y * 70.0);
          float w = fwidth(mp.x) + fwidth(mp.y);
          vec2 cell = fract(mp) - 0.5;
          float hole = smoothstep(0.34, 0.2, length(cell)) * (1.0 - smoothstep(0.3, 0.8, w)) * smoothstep(0.5, 0.25, vBody.y);
          col *= 1.0 - 0.1 * hole;
        }
      }
      vec4 flg = tex(${COL_FLAGS});
      if (flg.x > 0.5 && (region == 0 || region == 1)) { float a = vBody.x; col *= fract(a * 1.909) < 0.5 ? 1.0 : 0.05; }
      if (region == 0 && vBody.y > -0.5 && uDecals < 0.5) {
        vec4 nb = tex(${COL_NUMBER});
        vec3 ncol = tex(${COL_NUMCOL}).rgb;
        float a = vBody.x - 1.5708; // stored with the seam under the left arm: 0 = front, PI = back
        // A triangle that straddles the seam under the left arm interpolates the angle all the way round: skip it.
        float seamJump = abs(dFdx(vBody.x)) + abs(dFdy(vBody.x));
        if (nb.w > 0.5 && seamJump < 0.6) {
          // Front number (chest) and back number (bigger), name above it across the shoulders.
          vec2 st = vec2(-1.0);
          float fa = a > 3.14159 ? a - 6.28318 : a;
          if (abs(fa) < 0.78 && vBody.y > 0.3 && vBody.y < 0.8) st = vec2(fa / 1.56 + 0.5, (vBody.y - 0.3) / 0.5);
          float ba = a - 3.14159;
          if (abs(ba) < 0.95 && vBody.y > 0.1 && vBody.y < 0.74) st = vec2(ba / 1.9 + 0.5, (vBody.y - 0.1) / 0.64);
          if (st.x >= 0.0) {
            // Crop the atlas cell to the digits (they sit mid-cell with wide margins) so the number fills its patch.
            vec2 sc = vec2(0.07 + st.x * 0.86, 0.2 + (1.0 - st.y) * 0.64);
            vec2 uvN = vec2((sc.x + nb.x) / 10.0, 1.0 - (sc.y + nb.y) / 10.0);
            vec4 t = texture2D(numTex, uvN);
            if (t.a > 0.4) col = mix(ncol * 0.12, ncol, t.r);
          }
          if (abs(ba) < 0.85 && vBody.y > 0.76 && vBody.y < 0.92 && nb.z >= 0.0) {
            vec2 s2 = vec2(ba / 1.7 + 0.5, (vBody.y - 0.76) / 0.16);
            vec4 t = texture2D(nameTex, vec2(s2.x, 1.0 - (nb.z + 1.0 - s2.y) / nameRows));
            if (t.a > 0.45) col = ncol;
          }
        }
      }
      // Pants stripe down the outside of each leg (vBody.y = -2 left leg, -3 right leg; x = angle around it).
      // Thigh pads under the pants: a raised rectangle on the front of each thigh with three soft grooves, and a knee pad.
      if (region == 2 && vPart > 1.5 && vPart < 2.5) {
        vec3 tn = normalize(vBindN);
        float front = smoothstep(0.35, 0.7, tn.z);
        float yy = vBindY - uRegY.w;
        float pad = front * smoothstep(0.1, 0.16, yy) * (1.0 - smoothstep(0.34, 0.4, yy));
        float groove = pad * smoothstep(0.78, 1.0, abs(sin(yy * 52.0)));
        col *= 1.0 - 0.05 * pad - 0.11 * groove;
        float knee = front * (1.0 - smoothstep(0.0, 0.07, abs(yy - 0.07)));
        col *= 1.0 - 0.07 * knee;
      }
      // The bind-pose normal pointing straight out to the side (smooth per pixel, so the edges are clean lines, not blotches
      // from the per-vertex angle), a thin trim line on either side when the stripe matches the jersey trim.
      if (region == 2 && vBody.y < -1.5) {
        vec3 bn = normalize(vBindN);
        float o = bn.x * (vBody.y < -2.5 ? 1.0 : -1.0) / max(0.2, length(bn.xz));
        if (o > 0.955 && vBody.x > 0.55) col = tex(${COL_COLORS} + 3).rgb; // vBody.x = cosine around the leg, 1 = outside (keeps the crotch seam clean)
      }
      // Face photo (8 x 8 atlas, cell = instance) on the front of the MakeHuman head (vBody.y > 5 marks it), faded into the skin.
      if (region == 5 && vBody.y > 5.0 && flg.w > 0.5) {
        vec2 st = vec2(vBody.x, vBody.y - 10.0);
        float k = smoothstep(0.5, 0.3, length(st - 0.5));
        float inst = vInst + 0.5;
        vec2 cell = vec2(mod(floor(inst), 8.0), floor(floor(inst) / 8.0));
        vec2 q = clamp(st, 0.0, 1.0) * 0.84 + 0.08;
        col = mix(col, texture2D(faceTex, vec2((cell.x + q.x) / 8.0, 1.0 - (cell.y + 1.0 - q.y) / 8.0)).rgb, k);
      }
      // Cloth folds: drape hanging from the pads, tuck wrinkles at the hem, underarm stress lines; pants bunch at the hip and knee.
      gFold = 0.0;
      if (vPart > -0.5) {
        float fy = vBindY;
        float nz = vn(vec2(fy * 6.0, vInst * 0.37));
        if (region == 0 && vBody.y > 0.0) {
          // The jersey angle per pixel from the bind normal (front = PI/2, the wrap under the left arm, like vBody.x):
          // interpolating vBody.x across a triangle that straddles the wrap gave checkered speckle on the left shoulder.
          vec3 nbj = normalize(vBindN);
          float ja = 3.14159265 - atan(nbj.z, nbj.x);
          float fa = ja - 1.5708, fv = vBody.y;
          float drape = sin(fa * 7.0 + nz * 3.0 + sin(fy * 9.0) * 0.8);
          float tuck = sin(fy * 120.0 + fa * 3.0 + nz * 4.0);
          float fside = smoothstep(0.55, 0.9, abs(sin(fa)));
          float under = sin(fy * 55.0 - fa * 8.0) * smoothstep(0.5, 0.85, fv) * fside;
          // A triangle that straddles the wrap seam under the left arm interpolates the angle all the way round: no folds there
          // (they turned into speckle at the armpit).
          {
            // Only folds that stay continuous across the arm / torso triangles: the procedural drape and underarm lines jumped
            // there (streaks on the shoulders). The tuck at the hem and the baked reference folds below the armpits remain.
            gFold = 0.45 * tuck * smoothstep(uRegY.x + 0.22, uRegY.x + 0.02, vBindY) + 0.0 * (drape + under); // only near the belt
            // Fade out toward the shoulder / armpit junction: arm triangles use the sleeve's folds, and a jump between the two
            // along their shared edges showed as jagged streaks on the shoulders.
            gFold *= 1.0 - smoothstep(0.55, 0.95, fside) * smoothstep(0.55, 0.85, fv);
            // Real folds from the reference shirt (unrolled around the torso): below the armpits only.
            gFold += 0.0 * (textureGrad(foldTex, vec2(ja / 6.28318, 1.0 - fv), vec2(0.0), vec2(0.0)).r - 0.5) * smoothstep(0.7, 0.5, fv) * smoothstep(0.0, 0.04, fv);
          }
        } else if (region == 1) {
          float ang = atan(vBindN.z, vBindN.x);
          gFold = 0.0; // sleeves: no procedural folds (they seamed against the torso's at the shoulder)
        } else if (region == 2 && vPart > 1.5 && vPart < 2.5) {
          float ang = atan(vBindN.z, vBindN.x);
          float hip = smoothstep(uRegY.w + 0.45, uRegY.w + 0.7, fy);
          float knee = smoothstep(0.1, 0.0, abs(fy - uRegY.w - 0.07));
          gFold = 0.35 * hip * sin(fy * 45.0 + ang * 6.0 + nz * 3.0) + 0.3 * knee * sin(fy * 95.0 + ang * 2.0 + nz * 5.0);
          // The pads under the pants (tools/buildhuman.mjs): a crease along the thigh plate's top and bottom edges and round
          // the knee cap, on the front of the leg (knee = uRegY.w + 0.07).
          float front = smoothstep(0.25, 0.6, normalize(vBindN).z);
          float edge = smoothstep(0.035, 0.0, abs(abs(fy - uRegY.w - 0.32) - 0.125)) + 0.6 * smoothstep(0.03, 0.0, abs(abs(fy - uRegY.w - 0.085) - 0.06));
          gFold -= 0.55 * edge * front;
        }
      }
      col *= 1.0 + 0.12 * gFold; // creases read darker, ridges lighter
      // Cleats: a dark molded sole and a welt line, a darker heel counter and toe so the foot reads as a shoe.
      if (region == 8) {
        float sy = vBindY;
        vec3 sn = normalize(vBindN);
        if (sy < 0.034) col = mix(col, vec3(0.05), 0.85);
        else if (sy < 0.042) col *= 0.55;
        col *= 1.0 - 0.25 * smoothstep(0.4, 0.9, -sn.z) - 0.15 * smoothstep(0.5, 0.95, sn.z) * step(sy, 0.06);
      }
      // No photo: a painted face (eyes, brows, nose, mouth, and stubble or a beard on some players), so the helmet opening isn't a blank mask.
      if (region == 5 && vBody.y > 5.0 && flg.w < 0.5) {
        vec2 st = vec2(vBody.x, vBody.y - 10.0);
        float hh = fract(sin(vInst * 12.9898) * 43758.5453), h2 = fract(sin(vInst * 78.233) * 12345.6789);
        float fm = smoothstep(0.62, 0.38, abs(st.x - 0.5)) * smoothstep(0.0, 0.12, st.y) * smoothstep(1.0, 0.8, st.y);
        vec3 skinC = col;
        vec3 dark = skinC * 0.55;
        // Beard / stubble on the jaw and upper lip for about a third of the players, a lighter shadow for most of the rest.
        float jaw = smoothstep(0.34, 0.14, st.y) * smoothstep(0.62, 0.4, abs(st.x - 0.5)) + 0.7 * smoothstep(0.015, 0.0, abs(st.y - 0.285)) * smoothstep(0.2, 0.1, abs(st.x - 0.5));
        float beard = hh < 0.33 ? 0.85 : hh < 0.7 ? 0.22 : 0.0;
        col = mix(col, skinC * 0.28, clamp(jaw, 0.0, 1.0) * beard * fm);
        // Eyes: white, a dark-brown / hazel iris, pupil, upper lid shadow.
        vec3 iris = h2 < 0.6 ? vec3(0.16, 0.1, 0.06) : h2 < 0.85 ? vec3(0.25, 0.17, 0.08) : vec3(0.22, 0.3, 0.38);
        for (int e = 0; e < 2; e++) {
          vec2 ec = vec2(e == 0 ? 0.31 : 0.69, 0.585);
          vec2 d = (st - ec) / vec2(0.115, 0.05);
          float eye = smoothstep(1.0, 0.8, length(d));
          float ir = smoothstep(0.62, 0.5, length((st - ec - vec2(0.0, 0.0)) / vec2(0.056, 0.05)));
          float pu = smoothstep(0.26, 0.18, length((st - ec) / vec2(0.056, 0.05)));
          col = mix(col, vec3(0.9, 0.88, 0.85), eye);
          col = mix(col, iris, ir * eye);
          col = mix(col, vec3(0.02), pu * eye);
          col = mix(col, dark * 0.7, smoothstep(0.07, 0.0, abs(st.y - (ec.y + 0.042))) * smoothstep(1.15, 0.7, abs(d.x)) * 0.8); // lid line
          // Brow: a thick dark arc above the eye.
          vec2 bd = (st - ec - vec2(0.0, 0.115 - (e == 0 ? -0.012 : 0.012) * 0.0)) / vec2(0.14, 0.022);
          col = mix(col, skinC * 0.22, smoothstep(1.0, 0.6, length(bd)) * 0.85 * fm);
        }
        // Nose: soft shadow on either side of the bridge and the nostrils.
        col *= 1.0 - 0.18 * smoothstep(0.08, 0.0, abs(abs(st.x - 0.5) - 0.07)) * smoothstep(0.25, 0.4, st.y) * smoothstep(0.62, 0.5, st.y) * fm;
        col = mix(col, dark * 0.6, smoothstep(0.05, 0.0, length((st - vec2(0.5, 0.375)) / vec2(0.1, 0.04))) * 0.7 * fm);
        // Mouth: a darker lip band with the line between the lips.
        float lip = smoothstep(1.0, 0.7, length((st - vec2(0.5, 0.215)) / vec2(0.15, 0.038)));
        col = mix(col, mix(skinC, vec3(0.45, 0.2, 0.2), 0.55) * 0.9, lip * 0.75 * fm);
        col = mix(col, vec3(0.1, 0.03, 0.03), smoothstep(0.012, 0.0, abs(st.y - 0.215)) * smoothstep(0.14, 0.09, abs(st.x - 0.5)) * 0.85 * fm);
      }
      // Skin life: mottled tone, and on a painted face a flush on the cheeks, shadow under the eyes and a warmer nose tip.
      if (region == 5) {
        float mot = vn(vec2(vBindY * 38.0, atan(vBindN.x, vBindN.z) * 5.0 + vInst * 1.7)) * 0.6 + vn(vec2(vBindY * 120.0 + 9.0, atan(vBindN.x, vBindN.z) * 14.0)) * 0.4;
        col *= 1.0 + 0.05 * mot;
        if (vBody.y > 5.0 && flg.w < 0.5) {
          vec2 fs = vec2(vBody.x, vBody.y - 10.0);
          float fmask = smoothstep(0.62, 0.38, abs(fs.x - 0.5)) * smoothstep(0.0, 0.12, fs.y) * smoothstep(1.0, 0.8, fs.y);
          float cheek = smoothstep(0.17, 0.0, length((fs - vec2(0.25, 0.43)) * vec2(1.0, 1.25))) + smoothstep(0.17, 0.0, length((fs - vec2(0.75, 0.43)) * vec2(1.0, 1.25)));
          col = mix(col, col * vec3(1.14, 0.8, 0.76), clamp(cheek, 0.0, 1.0) * 0.4 * fmask);
          float under = smoothstep(0.045, 0.0, abs(fs.y - 0.52)) * (smoothstep(0.15, 0.07, abs(fs.x - 0.31)) + smoothstep(0.15, 0.07, abs(fs.x - 0.69)));
          col *= 1.0 - 0.14 * under * fmask;
          col = mix(col, col * vec3(1.1, 0.85, 0.82), smoothstep(0.05, 0.0, length((fs - vec2(0.5, 0.4)) * vec2(1.0, 1.4))) * 0.3 * fmask);
        }
      }
      if (uShell > 0.5 && !gl_FrontFacing) col *= 0.45; // the inside of the cloth
      diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = region == 5 ? 0.5 - uSweat * 0.22 : region == 7 ? 0.55 : region == 8 ? 0.35 : region == 2 || region == 3 ? 0.62 : 0.78 - uSweat * 0.08;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Cheap occlusion: surfaces facing the turf (under the arms, the undersides of the pads, inside the legs) and the
      // lower legs get less of the sky; whites are cloth, not paint (a touch under pure white so folds and shading read).
      if (region == 5) normal = nonPerturbedNormal; // no cloth weave on skin
      // A triangle across the fabric uv's wrap (down the middle of the back) samples the knit map across the whole texture:
      // no weave there (speckle otherwise). Its uv derivative is huge and the same over the whole triangle.
      if (fwidth(vNormalMapUv.x) > 1.5) normal = nonPerturbedNormal;
      if (gFold != 0.0) {
        vec3 fsx = dFdx(-vViewPosition), fsy = dFdy(-vViewPosition);
        vec3 fr1 = cross(fsy, normal), fr2 = cross(normal, fsx);
        float fdet = dot(fsx, fr1);
        // Clamped: gFold jumps where triangles of different parts meet (arm / torso), and the derivative of that jump in a
        // 2x2 pixel block was a black / white speckle along the seam. Real folds change far less than this per pixel.
        vec2 fdh = clamp(vec2(dFdx(gFold), dFdy(gFold)), -0.12, 0.12) * 0.007;
        normal = normalize(abs(fdet) * normal - sign(fdet) * (fdh.x * fr1 + fdh.y * fr2));
      }
      vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      float ao = mix(region == 2 ? 0.74 : 0.6, 1.0, smoothstep(-0.8, 0.35, wN.y)); // padded pants: softer under the seat
      if (vPart > -0.5) ao *= mix(0.8, 1.0, smoothstep(0.25, 1.15, vBindY));
      if (region == 5) { // skin: a little warmth where the surface turns away from the light (cheap subsurface scatter)
        float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 0.82, 0.7), rim * 0.55);
      }
      float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb *= ao * mix(1.0, 0.85, smoothstep(0.7, 0.95, lum));`);
  };
  return m;
}

/** Shadow-pass material with the same skinning (otherwise shadows would be the bind pose). */
export function bodyDepthMaterial(rowOff = { value: 0 }, shell = 0) {
  const uShell = { value: shell };
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    patchVertex(sh, false, rowOff, uShell);
    sh.fragmentShader = 'flat varying float vInst; flat varying float vRegion; varying vec2 vBody; flat varying float vPart; varying float vBindY;\n' + sh.fragmentShader;
  };
  return m;
}

{ // the baked folds (a 1024 x 512 height map: 0.5 = flat); wraps around the torso, clamps top / bottom
  const t = new THREE.TextureLoader().load(foldUrl);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  BODY_UNIFORMS.foldTex.value = t;
}

/** Jersey / pants fabric: a real fine knit (ambientCG Fabric030, CC0) as a tiling normal map; a procedural knit stands in until it loads. */
export function fabricNormal() {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.6, 0.6); // one tile ≈ 0.18 yd (the geometry's uv is ~9 per yd)
  t.anisotropy = 8;
  new THREE.TextureLoader().load(fabricUrl, (img) => {
    t.image = img.image; t.needsUpdate = true;
  });
  return t;
}

/** The MakeHuman body (tools/buildhuman.mjs → src/assets/human.json) as a BufferGeometry in our bind pose. */
export function buildHumanGeometry(h) {
  const dec = (b64, T) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
  const g = new THREE.BufferGeometry();
  const n = h.count;
  g.setAttribute('position', new THREE.BufferAttribute(dec(h.position, Float32Array), 3));
  g.setAttribute('aBulkD', new THREE.BufferAttribute(dec(h.bulk, Float32Array), 3));
  g.setAttribute('aPadD', new THREE.BufferAttribute(dec(h.pad, Float32Array), 3));
  g.setAttribute('aIdx', new THREE.BufferAttribute(Float32Array.from(dec(h.skinIndex, Uint8Array)), 4));
  g.setAttribute('aWt', new THREE.BufferAttribute(dec(h.skinWeight, Float32Array), 4));
  g.setAttribute('aRegion', new THREE.BufferAttribute(Float32Array.from(dec(h.region, Uint8Array)), 1));
  g.setAttribute('aBody', new THREE.BufferAttribute(dec(h.body, Float32Array), 2));
  g.setAttribute('aPart', new THREE.BufferAttribute(h.part ? Float32Array.from(dec(h.part, Uint8Array)) : new Float32Array(n).fill(-1), 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(5), 1));
  g.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  // Fabric UVs for the knit normal map: a simple cylindrical wrap (only the tiling matters).
  const p = g.attributes.position.array, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = Math.atan2(p[i * 3], p[i * 3 + 2]) * 1.6; uv[i * 2 + 1] = p[i * 3 + 1] * 9; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(dec(h.index, Uint16Array), 1));
  // Normals from the dressed shape (pads x 1.3, the default), not the bare MakeHuman body: those carried its pecs and abs
  // into the lighting through a smooth jersey (two round lumps on the chest from the front three-quarter view).
  {
    const pos = g.attributes.position.array, pad = g.attributes.aPadD.array, dressed = new Float32Array(pos.length);
    for (let k = 0; k < pos.length; k++) dressed[k] = pos[k] + pad[k] * 1.3;
    const t = new THREE.BufferGeometry();
    t.setAttribute('position', new THREE.BufferAttribute(dressed, 3));
    t.setIndex(g.index);
    t.computeVertexNormals();
    g.setAttribute('normal', t.attributes.normal);
  }
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

/** The jersey shell: the same vertices and attributes as the body with only the torso / upper-arm triangles (`shellIndex`). */
export function buildHumanShellGeometry(full, h) {
  const dec = (b64, T) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(full.attributes)) g.setAttribute(name, attr);
  g.setIndex(new THREE.BufferAttribute(dec(h.shellIndex, Uint16Array), 1));
  g.boundingSphere = full.boundingSphere;
  return g;
}

/** The sideline LOD: the same vertices and attributes as the full body with the much lighter index buffer (`lodIndex`). */
export function buildHumanLodGeometry(full, h) {
  const dec = (b64, T) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(full.attributes)) g.setAttribute(name, attr);
  g.setIndex(new THREE.BufferAttribute(dec(h.lodIndex, Uint16Array), 1));
  g.boundingSphere = full.boundingSphere;
  return g;
}

/** The printed numbers / name plate (tools/buildhuman.mjs decals): thin skinned patches on the chest and back. */
export function buildDecalGeometry(h) {
  const d = h.decals;
  const dec = (b64, T) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
  const g = new THREE.BufferGeometry(), n = d.count;
  g.setAttribute('position', new THREE.BufferAttribute(dec(d.position, Float32Array), 3));
  g.setAttribute('aBulkD', new THREE.BufferAttribute(dec(d.bulk, Float32Array), 3));
  g.setAttribute('aPadD', new THREE.BufferAttribute(dec(d.pad, Float32Array), 3));
  g.setAttribute('aIdx', new THREE.BufferAttribute(Float32Array.from(dec(d.skinIndex, Uint8Array)), 4));
  g.setAttribute('aWt', new THREE.BufferAttribute(dec(d.skinWeight, Float32Array), 4));
  g.setAttribute('aRegion', new THREE.BufferAttribute(Float32Array.from(dec(d.kind, Uint8Array)), 1)); // 0 front number, 1 back number, 2 name
  g.setAttribute('aBody', new THREE.BufferAttribute(dec(d.uv, Float32Array), 2));
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(5), 1));
  g.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  // aPart: the prints ride on the jersey shell's layer (0 torso, 1 sleeve: kinds 5 / 6), so they get the same cloth offset.
  g.setAttribute('aPart', new THREE.BufferAttribute(Float32Array.from(dec(d.kind, Uint8Array), (k) => (k === 5 || k === 6 ? 1 : 0)), 1));
  g.setIndex(new THREE.BufferAttribute(dec(d.index, Uint16Array), 1));
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}

/**
 * Lettering material: the instance's number (filled in its number color, outlined in the trim color like a twill
 * number) or its name, with soft anti-aliased edges; everything else on the patch is transparent.
 */
export function decalMaterial(envMap, shellK = 0) {
  const uShell = { value: shellK };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, envMap, envMapIntensity: 0.3, transparent: true,
    depthWrite: false, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 });
  m.onBeforeCompile = (sh) => {
    patchVertex(sh, true, null, uShell);
    sh.uniforms.numTex = BODY_UNIFORMS.numTex; sh.uniforms.numTex2 = BODY_UNIFORMS.numTex2; sh.uniforms.patchTex = BODY_UNIFORMS.patchTex; sh.uniforms.nameTex = BODY_UNIFORMS.nameTex; sh.uniforms.nameRows = BODY_UNIFORMS.nameRows;
    sh.fragmentShader = `uniform sampler2D boneTex; uniform sampler2D numTex; uniform sampler2D numTex2; uniform sampler2D patchTex; uniform sampler2D nameTex; uniform float nameRows;
flat varying float vInst; flat varying float vRegion; varying vec2 vBody; flat varying float vPart; varying float vBindY; varying vec3 vBindN;
vec4 tex(int c) { return texelFetch(boneTex, ivec2(c, int(vInst + 0.5)), 0); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec4 nb = tex(${COL_NUMBER});
      vec3 ncol = tex(${COL_NUMCOL}).rgb, jersey = tex(${COL_COLORS}).rgb, trim = tex(${COL_COLORS} + 3).rgb;
      // The outline: the trim color when it stands out from both the jersey and the number, else a dark edge.
      vec3 edge = (distance(trim, jersey) > 0.15 && distance(trim, ncol) > 0.15) ? trim : ncol * 0.15;
      int kind = int(floor(vRegion + 0.5));
      vec2 st = 1.0 - vBody; // the patch's grid runs the other way round from the atlas cell
      float alpha = 0.0; vec3 col = ncol;
      // Which of the two teams in the game this player is (1 or 2 in the number color's w; 0 = an official: no patches, team 1's numbers).
      float wv = tex(${COL_NUMCOL}).w;                       // 0 official, 1 / 2 = team 0 / 1, +2 for a team captain
      float team = wv > 0.5 ? mod(wv - 1.0, 2.0) + 1.0 : 0.0; // 0 official, 1 or 2
      bool captain = wv > 2.5;
      if (kind >= 3) {
        // Patches (3 left chest, 4 right chest, 5 left sleeve, 6 right sleeve, 7 under the V-neck; cell 5 = the captain's badge, which
        // takes the right chest's place on a captain): a 6 x 2 atlas, one row per team.
        if (team > 0.5) {
          float row = team > 1.5 ? 1.0 : 0.0;
          float cell = (kind == 4 && captain) ? 5.0 : float(kind - 3);
          vec4 t = texture2D(patchTex, vec2((cell + clamp(vBody.x, 0.0, 1.0)) / 6.0, 1.0 - (row + 1.0 - clamp(vBody.y, 0.0, 1.0)) / 2.0));
          alpha = t.a; col = t.rgb;
        }
      } else if (nb.w > 0.5) {
        if (kind < 2) {
          vec2 sc = vec2(0.12 + st.x * 0.76, 0.2 + (1.0 - st.y) * 0.64);
          vec2 nuv = vec2((sc.x + nb.x) / 10.0, 1.0 - (sc.y + nb.y) / 10.0);
          vec4 t = mix(texture(numTex, nuv, -1.0), texture(numTex2, nuv, -1.0), step(1.5, team)); // each team has its own number font
          alpha = smoothstep(0.25, 0.6, t.a);
          // Only inside the digits' box: keeps mip bleed from the neighbouring cells off the shirt.
          alpha *= step(0.0, st.x) * step(st.x, 1.0) * step(0.02, st.y) * step(st.y, 0.98);
          col = mix(edge, ncol, smoothstep(0.35, 0.75, t.r));
        } else if (nb.z >= 0.0) {
          vec4 t = texture2D(nameTex, vec2(st.x, 1.0 - (nb.z + 1.0 - st.y) / nameRows));
          alpha = smoothstep(0.3, 0.65, t.a);
        }
      }
      if (alpha < 0.02) discard;
      diffuseColor = vec4(col, alpha);`);
  };
  return m;
}
