import * as THREE from 'three';

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
export const BIND = { hipH: 1.0, hipX: 0.125, thigh: 0.48, shin: 0.47, torso: 0.66, shX: 0.27, shY: 0.66 * 0.84, shZ: 0, upper: 0.34, fore: 0.32, headY: 0.86, headZ: 0.02, helmY: 0, helmZ: 0 };
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
  const numberUv = (y, a) => [a, (y - 1.06) / (1.64 - 1.06)];
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
    }, KIND_LIMB, { flatSide: 0.15, bodyUv: (y, a) => [a, side < 0 ? -2 : -3] });
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
flat varying float vInst;
flat varying float vRegion;
varying vec2 vBody;
mat4 boneMat(int b) {
  int c = b * 4;
  return mat4(texelFetch(boneTex, ivec2(c, gl_InstanceID), 0), texelFetch(boneTex, ivec2(c + 1, gl_InstanceID), 0),
              texelFetch(boneTex, ivec2(c + 2, gl_InstanceID), 0), texelFetch(boneTex, ivec2(c + 3, gl_InstanceID), 0));
}
vec3 buildPos(vec3 p) {
  vec4 prm = texelFetch(boneTex, ivec2(${COL_PARAMS}, gl_InstanceID), 0); // width, limb, chest depth
  if (aKind < 0.5) { float pad = mix(1.0, prm.w, smoothstep(1.38, 1.56, p.y)); return vec3(p.x * prm.x * pad, p.y, p.z * prm.z); }
  if (aKind < 1.5) { vec3 ax = vec3(aAxis.x * prm.x, aAxis.y, aAxis.z); return ax + (p - aAxis) * vec3(prm.y, 1.0, prm.y); }
  if (aKind > 4.5) { vec4 fl = texelFetch(boneTex, ivec2(${COL_FLAGS}, gl_InstanceID), 0); return p + aBulkD * fl.y + aPadD * fl.z; } // the MakeHuman body: lineman build and pads as shape deltas
  return vec3(p.x * prm.x, p.y, p.z * prm.x);
}
mat4 skinMat() { return boneMat(int(aIdx.x)) * aWt.x + boneMat(int(aIdx.y)) * aWt.y + boneMat(int(aIdx.z)) * aWt.z + boneMat(int(aIdx.w)) * aWt.w; }
`;

function patchVertex(sh, normals = true) {
  sh.uniforms.boneTex = BODY_UNIFORMS.boneTex;
  let v = VERT_HEAD + 'mat4 gSk;\n' + sh.vertexShader;
  if (normals) v = v.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\ngSk = skinMat();\nobjectNormal = normalize(mat3(gSk) * objectNormal);');
  v = v.replace('#include <begin_vertex>', `#include <begin_vertex>\n${normals ? '' : 'gSk = skinMat();'}\ntransformed = (gSk * vec4(buildPos(position), 1.0)).xyz;\nvInst = float(gl_InstanceID); vRegion = aRegion; vBody = aBody;`);
  sh.vertexShader = v;
}

export const BODY_UNIFORMS = { boneTex: { value: null }, numTex: { value: null }, nameTex: { value: null }, nameRows: { value: 56 }, faceTex: { value: null }, sweat: { value: 0 } };

/** The body's material: per-instance region colors, numbers / name printed on the jersey, fabric sheen. */
export function bodyMaterial(envMap, fabric) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, envMap, envMapIntensity: 0.35,
    sheen: 0.55, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.45, 0.45, 0.45), normalMap: fabric, normalScale: new THREE.Vector2(0.35, 0.35) });
  m.onBeforeCompile = (sh) => {
    patchVertex(sh);
    sh.uniforms.numTex = BODY_UNIFORMS.numTex; sh.uniforms.nameTex = BODY_UNIFORMS.nameTex; sh.uniforms.nameRows = BODY_UNIFORMS.nameRows; sh.uniforms.faceTex = BODY_UNIFORMS.faceTex; sh.uniforms.uSweat = BODY_UNIFORMS.sweat;
    sh.fragmentShader = `uniform sampler2D boneTex; uniform sampler2D numTex; uniform sampler2D nameTex; uniform float nameRows; uniform sampler2D faceTex; uniform float uSweat;
flat varying float vInst; flat varying float vRegion; varying vec2 vBody;
vec4 tex(int c) { return texelFetch(boneTex, ivec2(c, int(vInst + 0.5)), 0); }
` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      int region = int(floor(vRegion + 0.5));
      vec3 col = tex(${COL_COLORS} + region).rgb;
      vec4 flg = tex(${COL_FLAGS});
      if (flg.x > 0.5 && (region == 0 || region == 1)) { float a = vBody.x; col *= fract(a * 1.909) < 0.5 ? 1.0 : 0.05; }
      if (region == 0 && vBody.y > -0.5) {
        vec4 nb = tex(${COL_NUMBER});
        vec3 ncol = tex(${COL_NUMCOL}).rgb;
        float a = vBody.x; // 0 = front, PI = back
        if (nb.w > 0.5) {
          // Front number (chest) and back number (bigger), name above it across the shoulders.
          vec2 st = vec2(-1.0);
          float fa = a > 3.14159 ? a - 6.28318 : a;
          if (abs(fa) < 0.62 && vBody.y > 0.32 && vBody.y < 0.8) st = vec2(fa / 1.24 + 0.5, (vBody.y - 0.32) / 0.48);
          float ba = a - 3.14159;
          if (abs(ba) < 0.78 && vBody.y > 0.14 && vBody.y < 0.74) st = vec2(ba / 1.56 + 0.5, (vBody.y - 0.14) / 0.6);
          if (st.x >= 0.0) {
            vec2 uvN = vec2((st.x + nb.x) / 10.0, 1.0 - ((1.0 - st.y) + nb.y) / 10.0);
            vec4 t = texture2D(numTex, uvN);
            if (t.a > 0.4) col = mix(ncol * 0.12, ncol, t.r);
          }
          if (abs(ba) < 0.62 && vBody.y > 0.76 && vBody.y < 0.9 && nb.z >= 0.0) {
            vec2 s2 = vec2(ba / 1.24 + 0.5, (vBody.y - 0.76) / 0.14);
            vec4 t = texture2D(nameTex, vec2(s2.x, 1.0 - (nb.z + 1.0 - s2.y) / nameRows));
            if (t.a > 0.45) col = ncol;
          }
        }
      }
      // Pants stripe down the outside of each leg (vBody.y = -2 left leg, -3 right leg; x = angle around it).
      if (region == 2 && vBody.y < -1.5) { float sd = vBody.y < -2.5 ? 1.0 : -1.0; if (sin(vBody.x) * sd > 0.972) col = tex(${COL_COLORS} + 3).rgb; }
      // Face photo (8 x 8 atlas, cell = instance) on the front of the MakeHuman head (vBody.y > 5 marks it), faded into the skin.
      if (region == 5 && vBody.y > 5.0 && flg.w > 0.5) {
        vec2 st = vec2(vBody.x, vBody.y - 10.0);
        float k = smoothstep(0.5, 0.3, length(st - 0.5));
        float inst = vInst + 0.5;
        vec2 cell = vec2(mod(floor(inst), 8.0), floor(floor(inst) / 8.0));
        vec2 q = clamp(st, 0.0, 1.0) * 0.84 + 0.08;
        col = mix(col, texture2D(faceTex, vec2((cell.x + q.x) / 8.0, 1.0 - (cell.y + 1.0 - q.y) / 8.0)).rgb, k);
      }
      diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = region == 5 ? 0.5 - uSweat * 0.22 : region == 7 ? 0.55 : region == 8 ? 0.35 : region == 2 || region == 3 ? 0.62 : 0.78 - uSweat * 0.08;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>`);
  };
  return m;
}

/** Shadow-pass material with the same skinning (otherwise shadows would be the bind pose). */
export function bodyDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    patchVertex(sh, false);
    sh.fragmentShader = 'flat varying float vInst; flat varying float vRegion; varying vec2 vBody;\n' + sh.fragmentShader;
  };
  return m;
}

/** A fine knit pattern for jersey / pants fabric (tiling normal map). */
export function fabricNormal() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Mesh holes: a grid of shallow dimples.
    const u = (x % 8) / 8 - 0.5, v = (y % 8) / 8 - 0.5;
    const r = Math.hypot(u, v);
    const d = r < 0.3 ? (0.3 - r) : 0;
    const nx = u * d * 5, ny = v * d * 5;
    const i = (y * N + x) * 4;
    img.data[i] = 128 + nx * 127; img.data[i + 1] = 128 + ny * 127; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
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
  g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(n).fill(5), 1));
  g.setAttribute('aAxis', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  // Fabric UVs for the knit normal map: a simple cylindrical wrap (only the tiling matters).
  const p = g.attributes.position.array, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = Math.atan2(p[i * 3], p[i * 3 + 2]) * 1.6; uv[i * 2 + 1] = p[i * 3 + 1] * 9; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(dec(h.index, Uint16Array), 1));
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}
