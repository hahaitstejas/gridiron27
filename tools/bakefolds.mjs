// Bakes the fine surface detail (folds, seams, hem, mesh panels) of the shirt in the CC BY Sketchfab model
// "American Football Player" (Stuffed Dog Digital) into a height texture in OUR jersey coordinates
// (x = angle around the torso with the same convention as tools/buildhuman.mjs, y = height waist..collar).
// SHAPE only (no color / textures). Usage: node tools/bakefolds.mjs <dir with scene.gltf + scene.bin>
import fs from 'fs';
import zlib from 'zlib';
const dir = process.argv[2];
const g = JSON.parse(fs.readFileSync(dir + '/scene.gltf', 'utf8'));
const bin = fs.readFileSync(dir + '/' + g.buffers[0].uri);
function acc(i) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView];
  const n = { VEC3: 3, SCALAR: 1 }[a.type], T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT));
}
const prim = g.meshes[9].primitives[0]; // the shirt
const P = acc(prim.attributes.POSITION), I = acc(prim.indices);
const HEM = 318, COLLAR = 500; // shirt hem / collar heights in the model's units (see the proportion notes in CLAUDE.md)
const CX = 0, CZ = -1;
const W = 1024, H = 512;
const R = new Float32Array(W * H).fill(Infinity);
const cyl = (i) => { const x = P[i * 3] - CX, z = P[i * 3 + 2] - CZ; let a = Math.atan2(x, z) + Math.PI / 2; if (a < 0) a += Math.PI * 2; return [a / (Math.PI * 2) * W, (P[i * 3 + 1] - HEM) / (COLLAR - HEM) * H, Math.hypot(x, z)]; };
for (let t = 0; t < I.length; t += 3) {
  const v = [cyl(I[t]), cyl(I[t + 1]), cyl(I[t + 2])];
  const xs = v.map((q) => q[0]);
  if (Math.max(...xs) - Math.min(...xs) > W / 2) continue; // straddles the wrap
  const minX = Math.max(0, Math.floor(Math.min(...xs))), maxX = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const ys = v.map((q) => q[1]);
  const minY = Math.max(0, Math.floor(Math.min(...ys))), maxY = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  const [a, b, c] = v, den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(den) < 1e-9) continue;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den, l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den, l3 = 1 - l1 - l2;
    if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
    const r = l1 * a[2] + l2 * b[2] + l3 * c[2];
    if (r < R[y * W + x]) R[y * W + x] = r; // the surface nearest the axis (the torso, not a sleeve in front of it)
  }
}
// Fill holes from the nearest valid neighbour (a few passes).
let holes = 0;
for (let pass = 0; pass < 12; pass++) {
  const N = R.slice();
  holes = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isFinite(R[y * W + x])) {
    let s = 0, n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = (x + dx + W) % W, yy = y + dy; if (yy >= 0 && yy < H && isFinite(R[yy * W + xx])) { s += R[yy * W + xx]; n++; } }
    if (n) N[y * W + x] = s / n; else holes++;
  }
  R.set(N);
}
// Detail = the radius minus a smooth version of itself (a wide box blur, several passes).
function blur(src, rx, ry) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -rx; k <= rx; k++) s += src[y * W + ((x + k + W) % W)]; tmp[y * W + x] = s / (2 * rx + 1); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let k = -ry; k <= ry; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++; } } out[y * W + x] = s / n; }
  return out;
}
const Rf = R.map((v) => (isFinite(v) ? v : 0));
let low = Rf; for (let i = 0; i < 3; i++) low = blur(low, 24, 14);
const D = Rf.map((v, i) => v - low[i]);
let mx = 0; for (const v of D) mx = Math.max(mx, Math.abs(v));
const sd = Math.sqrt(D.reduce((s, v) => s + v * v, 0) / D.length);
console.log('holes left', holes, 'max |detail|', mx.toFixed(2), 'units, rms', sd.toFixed(2));
// 8-bit: 128 = flat, +-3 rms = full range (clamped).
const px = Buffer.alloc(W * H);
for (let i = 0; i < D.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(128 + (D[i] / (3 * sd)) * 127)));
// Minimal grayscale PNG writer.
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; px.copy(raw, y * (W + 1) + 1, y * W, (y + 1) * W); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
fs.writeFileSync('src/assets/jersey_fold.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote src/assets/jersey_fold.png');
