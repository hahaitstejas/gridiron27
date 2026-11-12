// Builds src/assets/cleat.json: one cleat from the Sketchfab "American Football Player" (CC BY 4.0, Stuffed Dog Digital)
// glTF, in our foot-bone space (yards; toe +z, sole at y = -SOLE, origin at the ankle bone). SHAPE only: no textures.
// Usage: node tools/buildcleat.mjs <dir with scene.gltf + scene.bin>
import fs from 'fs';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const dir = process.argv[2];
const g = JSON.parse(fs.readFileSync(dir + '/scene.gltf', 'utf8'));
const bin = fs.readFileSync(dir + '/' + g.buffers[0].uri);
function acc(i) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView];
  const n = { VEC3: 3, SCALAR: 1 }[a.type], T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT));
}
const prim = g.meshes[0].primitives[0];
const P0 = acc(prim.attributes.POSITION), I0 = acc(prim.indices);
// Keep the foot at x > -2 (the other one is its mirror); weld vertices by position.
const map = new Map(), pos = [], idx = [];
const vid = (k) => {
  const x = P0[k * 3], y = P0[k * 3 + 1], z = P0[k * 3 + 2];
  const key = Math.round(x * 50) + ',' + Math.round(y * 50) + ',' + Math.round(z * 50);
  let v = map.get(key);
  if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(x, y, z); }
  return v;
};
for (let t = 0; t < I0.length; t += 3) {
  const a = I0[t], b = I0[t + 1], c = I0[t + 2];
  if (P0[a * 3] < -2 || P0[b * 3] < -2 || P0[c * 3] < -2) continue;
  const A = vid(a), B = vid(b), C = vid(c);
  if (A !== B && B !== C && A !== C) idx.push(A, B, C);
}
// Fit: length LEN along z, sole at y = -SOLE, heel at z = HEEL, centered on x = 0 (right foot is +x).
const LEN = 0.318, SOLE = 0.079, HEEL = -0.125, TARGET = +process.argv[3] || 2200;
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[i + a]); mx[a] = Math.max(mx[a], pos[i + a]); }
const s = LEN / (mx[2] - mn[2]), cx = (mn[0] + mx[0]) / 2;
const fit = new Float32Array(pos.length);
for (let i = 0; i < pos.length; i += 3) { fit[i] = (pos[i] - cx) * s; fit[i + 1] = (pos[i + 1] - mn[1]) * s - SOLE; fit[i + 2] = (pos[i + 2] - mn[2]) * s + HEEL; }
const index = new Uint32Array(idx);
const [simp, err] = MeshoptSimplifier.simplify(index, fit, 3, TARGET * 3, 0.03, []);
// Compact.
const rem = new Map(), P = [], I = [];
for (const v of simp) { let n = rem.get(v); if (n === undefined) { n = P.length / 3; rem.set(v, n); P.push(fit[v * 3], fit[v * 3 + 1], fit[v * 3 + 2]); } I.push(n); }
// Smooth normals.
const N = new Float32Array(P.length);
for (let t = 0; t < I.length; t += 3) {
  const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
  const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  for (const v of [a, b, c]) for (let k = 0; k < 3; k++) N[v + k] += n[k];
}
for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
let bmn = [1e9, 1e9, 1e9], bmx = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { bmn[a] = Math.min(bmn[a], P[i + a]); bmx[a] = Math.max(bmx[a], P[i + a]); }
console.log('verts', P.length / 3, 'tris', I.length / 3, 'err', err.toFixed(4), 'min', bmn.map((x) => +x.toFixed(3)), 'max', bmx.map((x) => +x.toFixed(3)));
const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
fs.writeFileSync('src/assets/cleat.json', JSON.stringify({
  source: 'Shape of one cleat from "American Football Player" by Stuffed Dog Digital (CC BY 4.0, sketchfab.com); geometry only, no textures',
  count: P.length / 3, position: b64(new Float32Array(P)), normal: b64(N), index: b64(new Uint16Array(I)),
}));
