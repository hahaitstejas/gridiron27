// Player face photos (optional): roster.csv `face` column (also `photo` / `headshot`) = a file name in
// public/local/faces/ (git-ignored, like logos), a web link, or an image uploaded in the roster editor (a small JPEG
// data URL kept in the save). Shown next to the name wherever a player is featured; nothing changes without one.

/** The image URL for a player's face, or null. */
export function faceSrc(p) {
  const f = p?.face;
  if (!f || typeof f !== 'string') return null;
  if (/^(https?:|data:|blob:)/i.test(f)) return f;
  // A bare file name lives in public/local/faces/ (only served by the dev server / a hosted build, not file:).
  if (typeof location !== 'undefined' && location.protocol === 'file:') return null;
  return `/local/faces/${f.replace(/^\/+/, '').replace(/^faces\//i, '')}`;
}

/** An <img> of the player's face (hidden if it fails to load), or null when he has none. cls = extra class. */
export function faceImg(p, cls = '') {
  const src = faceSrc(p);
  if (!src) return null;
  const img = document.createElement('img');
  img.className = `face${cls ? ` ${cls}` : ''}`;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  if (/^https?:/i.test(src)) img.referrerPolicy = 'no-referrer';
  img.onerror = () => { img.style.display = 'none'; };
  img.src = src;
  return img;
}

/** An uploaded photo → a square, face-centred JPEG data URL (size px), small enough to keep in a league save. */
export function shrinkFace(img, size = 160) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const s = Math.min(img.width, img.height);
  // Square crop from the top-middle (head shots are usually framed with the face in the upper part).
  const sx = (img.width - s) / 2, sy = Math.max(0, (img.height - s) * 0.2);
  c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.85);
}

// The six preset skin tones (players.js draws with these when a player has no photo-derived tone).
export const SKIN_TONES = ['#f1c9a5', '#e0ac85', '#c68a62', '#a0663f', '#7a4a2c', '#53321e'];

// Loaded face images by URL: { img, ok } once settled (so each photo is fetched once per session).
const cache = new Map();
/**
 * The player's face photo as a loaded image, or null while loading / when there is none. onLoad runs once the first
 * time it finishes (the renderer repaints its face atlas then). Web links need CORS for the 3D face and the skin
 * tone; without it the photo still shows in the menus (as an <img>), just not on the 3D player.
 */
export function faceImage(p, onLoad) {
  const src = faceSrc(p);
  if (!src) return null;
  const c = cache.get(src);
  if (c) return c.ok ? c.img : null;
  const entry = { img: new Image(), ok: false };
  cache.set(src, entry);
  if (/^https?:/i.test(src)) entry.img.crossOrigin = 'anonymous';
  entry.img.onload = () => { entry.ok = true; onLoad?.(entry.img); };
  entry.img.onerror = () => { entry.ok = false; };
  entry.img.src = src;
  return null;
}

/**
 * Skin tone from a face photo: the middle of the picture (where the face is in a headshot), keeping only pixels that
 * look like skin (the usual YCbCr skin range), then the median by brightness so hair, eyes and shadows don't pull it.
 * Returns '#rrggbb', or null if the image can't be read (cross-origin without CORS) or no skin is found.
 */
export function skinToneFromImage(img) {
  try {
    const N = 48, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    const s = Math.min(img.width, img.height);
    g.drawImage(img, (img.width - s) / 2, Math.max(0, (img.height - s) * 0.2), s, s, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const skin = [];
    for (let y = Math.floor(N * 0.28); y < N * 0.72; y++) for (let x = Math.floor(N * 0.3); x < N * 0.7; x++) {
      const i = (y * N + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
      const Y = 0.299 * r + 0.587 * gg + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * gg + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * gg - 0.081312 * b;
      if (Y > 35 && Y < 245 && cb > 77 && cb < 127 && cr > 133 && cr < 175) skin.push([Y, r, gg, b]);
    }
    const pool = skin.length >= 25 ? skin : null;
    if (!pool) return null;
    pool.sort((a, b) => a[0] - b[0]);
    // Average the middle half (by brightness): robust against highlights and shadow.
    const mid = pool.slice(Math.floor(pool.length * 0.25), Math.ceil(pool.length * 0.75));
    const avg = [1, 2, 3].map((k) => mid.reduce((t, v) => t + v[k], 0) / mid.length);
    // Studio photos are lit brighter than a stadium: pull it a touch toward the middle so it sits with the others.
    return `#${avg.map((v) => Math.round(Math.min(255, v * 0.94)).toString(16).padStart(2, '0')).join('')}`;
  } catch { return null; }
}

/** The preset (0-5) closest to a color, so the roster editor's "Skin tone" row matches the photo. */
export function nearestSkin(hex) {
  const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const a = rgb(hex);
  let best = 2, bd = Infinity;
  SKIN_TONES.forEach((t, i) => { const b = rgb(t); const dd = a.reduce((s, v, k) => s + (v - b[k]) ** 2, 0); if (dd < bd) { bd = dd; best = i; } });
  return best;
}

/**
 * Give a player his skin tone from his photo (once: stored as p.skinColor, saved with the league), unless the tone
 * was picked by hand in the roster editor (p.skinManual). Calls back when it changed something.
 */
export function deriveSkin(p, onChange) {
  if (!p || p.skinManual || p.skinColor || !faceSrc(p)) return;
  const img = faceImage(p, (im) => apply(im));
  const apply = (im) => {
    if (p.skinColor || p.skinManual) return;
    const tone = skinToneFromImage(im);
    if (!tone) return;
    p.skinColor = tone; p.skin = nearestSkin(tone);
    onChange?.(p);
  };
  if (img) apply(img);
}
