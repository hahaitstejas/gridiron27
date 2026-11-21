// Piecewise-affine warp of a photo into a face-atlas cell (render only, no MediaPipe here so the offline build can use it).
// `pts` are the photo's key points (faceFit.js KEYS order, pixels); each triangle of TRIS is drawn with its own affine map
// from the photo to where those features are on our head. A whole-photo similarity fit (eyes + chin) is drawn first, so the
// skin around the triangles (the cell border the shader fades into) is the photo too, not a hard edge.

// The atlas cell's q = st * 0.84 + 0.08 (body.js), y flipped (canvas rows go down).
const cellPt = (st, x, y, S) => [x + (st[0] * 0.84 + 0.08) * S, y + (1 - (st[1] * 0.84 + 0.08)) * S];

/** Affine transform taking triangle s (3 points) onto triangle d: [a, b, c, d, e, f] for ctx.setTransform. */
function affine(s, d) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s, [[u0, v0], [u1, v1], [u2, v2]] = d;
  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-6) return null;
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
  const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
  const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
  const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
  const dd = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
  return [a, b, c, dd, e, f];
}

/** Draw the photo warped onto our face layout into the S x S cell at (x, y). keys = KEYS, tris = TRIS (faceFit.js). */
export function warpFace(g, img, pts, keys, tris, x, y, S) {
  const dst = keys.map(([, sx, sy]) => cellPt([sx, sy], x, y, S));
  g.save();
  g.beginPath(); g.rect(x, y, S, S); g.clip();
  // Base: a whole-photo map from the eye centers and the chin (keeps the border in the photo's own skin).
  const eyeL = mid(pts[3], pts[4]), eyeR = mid(pts[5], pts[6]), dEyeL = mid(dst[3], dst[4]), dEyeR = mid(dst[5], dst[6]);
  const base = affine([eyeL, eyeR, pts[14]], [dEyeL, dEyeR, dst[14]]);
  if (base) { g.setTransform(...base); g.drawImage(img, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0); }
  // The features: each triangle on its own (grown half a pixel so no seams show between them).
  for (const t of tris) {
    const s = t.map((k) => pts[k]), d = t.map((k) => dst[k]);
    const m = affine(s, d);
    if (!m) continue;
    const cx = (d[0][0] + d[1][0] + d[2][0]) / 3, cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
    g.save();
    g.beginPath();
    d.forEach(([px, py], i) => { const dx = px - cx, dy = py - cy, l = Math.hypot(dx, dy) || 1, ex = px + (dx / l) * 0.6, ey = py + (dy / l) * 0.6; if (i) g.lineTo(ex, ey); else g.moveTo(ex, ey); });
    g.closePath(); g.clip();
    g.setTransform(...m);
    g.drawImage(img, 0, 0);
    g.restore();
  }
  g.restore();
}

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
