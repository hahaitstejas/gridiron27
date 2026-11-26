// Face Landmarker in a worker (render/faceFit.js): MediaPipe on the CPU blocks for 50-300 ms per photo, which on the main
// thread was a stutter for every photo in a league full of them. Messages: { id, bitmap, idx } → { id, pts | null, err }.
// tasks-vision loads its wasm glue with importScripts (not allowed in a module worker), so the glue is evaluated here and
// the loader path is left empty (it then uses the global ModuleFactory).
import { FaceLandmarker } from '@mediapipe/tasks-vision';

let landmarker = null;
async function load(paths) {
  if (landmarker) return landmarker;
  if (!self.ModuleFactory) {
    const code = await (await fetch(paths.loader)).text();
    (0, eval)(code + '\n;self.ModuleFactory = self.ModuleFactory || (typeof ModuleFactory !== "undefined" ? ModuleFactory : undefined);');
  }
  landmarker = await FaceLandmarker.createFromOptions({ wasmLoaderPath: '', wasmBinaryPath: paths.binary }, {
    baseOptions: { modelAssetPath: paths.model, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1,
  });
  return landmarker;
}

self.onmessage = async (e) => {
  const { id, bitmap, idx, paths } = e.data;
  try {
    const l = await load(paths);
    const lm = l.detect(bitmap).faceLandmarks?.[0];
    self.postMessage({ id, pts: lm ? idx.map((k) => [lm[k].x, lm[k].y]) : null });
  } catch (err) {
    self.postMessage({ id, pts: null, err: String(err?.message || err) });
  } finally { bitmap.close?.(); }
};
