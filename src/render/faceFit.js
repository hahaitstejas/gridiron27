// Face fitting for player photos (render only). MediaPipe's Face Landmarker (Apache-2.0, runs in the browser, no server) finds
// the face in a photo; we keep 17 key points (eyes, brows, nose tip, mouth corners, jaw, chin, forehead, face edges) and
// warp the photo piece by piece so each lands where that feature is on our 3D head (`warpFace`). Without it the photo was a
// square crop and the eyes only lined up by luck. The model / wasm load lazily on the first photo; results are cached by the
// image source (memory + localStorage `g27.faceFit`). Not in the offline single file (players.js skips the import there).
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import wasmBinaryPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';
import modelAssetPath from '../assets/face_landmarker.task?url';

// [MediaPipe face-mesh index, where it sits on our face (st: x across 0..1 in image orientation, y up from the chin)].
// The st spots are the painted face's own (body.js): eyes at 0.31 / 0.69 and 0.585 up, nose tip 0.375, mouth 0.215.
export const KEYS = [
  [10, 0.5, 0.98], // 0 forehead
  [105, 0.29, 0.7], // 1 brow (image left)
  [334, 0.71, 0.7], // 2 brow (image right)
  [33, 0.195, 0.585], // 3 eye outer corner (image left)
  [133, 0.425, 0.585], // 4 eye inner corner
  [362, 0.575, 0.585], // 5 eye inner corner (image right)
  [263, 0.805, 0.585], // 6 eye outer corner
  [234, 0.0, 0.55], // 7 face edge (image left)
  [454, 1.0, 0.55], // 8 face edge (image right)
  [1, 0.5, 0.375], // 9 nose tip
  [61, 0.35, 0.215], // 10 mouth corner (image left)
  [291, 0.65, 0.215], // 11 mouth corner (image right)
  [172, 0.1, 0.2], // 12 jaw (image left)
  [397, 0.9, 0.2], // 13 jaw (image right)
  [152, 0.5, 0.03], // 14 chin
  [54, 0.12, 0.92], // 15 forehead (image left)
  [284, 0.88, 0.92], // 16 forehead (image right)
];
// A fixed triangulation of the 17 points (same topology on every face).
export const TRIS = [
  [0, 15, 1], [0, 1, 2], [0, 2, 16], [15, 7, 3], [15, 3, 1], [1, 3, 4], [1, 4, 5], [1, 5, 2], [2, 5, 6], [2, 6, 16], [16, 6, 8],
  [7, 3, 12], [3, 4, 9], [3, 9, 10], [3, 10, 12], [4, 5, 9], [5, 6, 9], [6, 11, 9], [6, 13, 11], [6, 8, 13],
  [9, 10, 11], [10, 12, 14], [10, 14, 11], [11, 14, 13],
];

let landmarker = null, loading = null;
const cache = new Map();
const STORE = 'g27.faceFit';
let stored = null;
const readStore = () => { if (!stored) { try { stored = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { stored = {}; } } return stored; };
let writeT = 0;
// Batched: stringifying the whole store after every face was a small hitch of its own.
const writeStore = () => { clearTimeout(writeT); writeT = setTimeout(saveStore, 3000); };
const saveStore = () => { try { const keys = Object.keys(stored); if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 4000)) delete stored[k]; localStorage.setItem(STORE, JSON.stringify(stored)); } catch { try { const keys = Object.keys(stored); for (const k of keys.slice(0, keys.length - 800)) delete stored[k]; localStorage.setItem(STORE, JSON.stringify(stored)); } catch { /* full or blocked: memory cache only */ } } };

async function load() {
  if (landmarker) return landmarker;
  loading ||= FaceLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1,
  }).then((l) => (landmarker = l)).catch((e) => { console.warn('[Gridiron 27] face fitting unavailable', e); loading = null; return null; });
  return loading;
}

// The detector normally runs in a worker (faceFitWorker.js) so the game never waits on it; if the worker can't start or
// fails, fitting falls back to the main thread (the old way: a short hitch per photo).
let worker = null, workerBad = false, nextId = 1;
const pending = new Map();
const PATHS = { loader: new URL(wasmLoaderPath, location.href).href, binary: new URL(wasmBinaryPath, location.href).href, model: new URL(modelAssetPath, location.href).href };
function getWorker() {
  if (worker || workerBad || typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./faceFitWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.err) p.reject(new Error(e.data.err)); else p.resolve(e.data.pts); };
    worker.onerror = (e) => { console.warn('[Gridiron 27] face worker failed, fitting on the main thread', e.message || e); workerBad = true; worker = null; for (const p of pending.values()) p.reject(new Error('worker')); pending.clear(); };
  } catch (e) { workerBad = true; worker = null; }
  return worker;
}
async function detect(img) {
  const w = getWorker();
  if (w) {
    try {
      const bitmap = await createImageBitmap(img);
      return await new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        w.postMessage({ id, bitmap, idx: KEYS.map(([k]) => k), paths: PATHS }, [bitmap]);
      });
    } catch (e) {
      if (!workerBad) { console.warn('[Gridiron 27] face worker failed, fitting on the main thread', e); workerBad = true; worker?.terminate(); worker = null; }
    }
  }
  const l = await load();
  if (!l) return undefined;
  const lm = l.detect(img).faceLandmarks?.[0];
  return lm ? KEYS.map(([k]) => [lm[k].x, lm[k].y]) : null;
}

/** Short stable id for a photo source (sources can be long data URLs). */
function hashKey(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); }

/** Key points of the face in `img` (pixels, KEYS order) or null when no face is found. `src` = the photo source (cache key). */
export async function fitFace(img, src) {
  const key = src ? hashKey(String(src)) : null;
  if (key && cache.has(key)) return cache.get(key);
  const st = key ? readStore()[key] : undefined;
  if (st !== undefined) { const pts = st && st.map(([x, y]) => [x * img.width, y * img.height]); cache.set(key, pts); return pts; }
  let pts = null;
  try {
    pts = await detect(img);
    if (pts === undefined) return null; // no detector at all
  } catch (e) { console.warn('[Gridiron 27] face fit failed', e); return null; }
  if (key) { readStore()[key] = pts && pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]); writeStore(); }
  const px = pts && pts.map(([x, y]) => [x * img.width, y * img.height]);
  if (key) cache.set(key, px);
  return px;
}
