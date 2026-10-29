// Small 2D helpers on the ground plane. Vectors are plain {x, z} objects.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const v2 = (x = 0, z = 0) => ({ x, z });
export const len = (v) => Math.hypot(v.x, v.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a, s) => ({ x: a.x * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.z * b.z;
export function norm(v) {
  const l = Math.hypot(v.x, v.z);
  return l > 1e-6 ? { x: v.x / l, z: v.z / l } : { x: 0, z: 0 };
}
export function angleOf(v) { return Math.atan2(v.z, v.x); }
export function fromAngle(a, l = 1) { return { x: Math.cos(a) * l, z: Math.sin(a) * l }; }
export function wrapAngle(a) {
  // Modulo rather than loops: a huge or infinite angle can't hang the game (non-finite -> 0).
  if (!Number.isFinite(a)) return 0;
  const t = 2 * Math.PI;
  return ((((a + Math.PI) % t) + t) % t) - Math.PI;
}
export function approachAngle(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
// Rating (0-99) to a 0..1 factor.
export const r01 = (r) => clamp(r, 0, 100) / 100;
