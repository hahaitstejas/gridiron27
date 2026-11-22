import { viaRelay } from '../data/storage.js';
// Player face photos (optional): roster.csv `face` column (also `photo` / `headshot`) = a file name in
// public/local/faces/ (git-ignored, like logos), a web link, or an image uploaded in the roster editor (a small JPEG
// data URL kept in the save). Shown next to the name wherever a player is featured; nothing changes without one.

/** The image URL for a player's face, or null. */
export function faceSrc(p) {
  const f = p?.face;
  if (!f || typeof f !== 'string') return null;
  if (/^(data:|blob:)/i.test(f)) return f;
  if (/^https?:/i.test(f)) return viaRelay(f); // through the game's server: works for the 3D face and skin tone too
  // A bare file name lives in public/local/faces/ (only served by the dev server / a hosted build, not file:).
  if (typeof location !== 'undefined' && location.protocol === 'file:') return null;
  return `/local/faces/${f.replace(/^\/+/, '').replace(/^faces\//i, '')}`;
}

/**
 * An <img> of the player's face (hidden if it fails to load). Without a photo, a drawn portrait (`portraitSrc`), so every
 * created player has a face in the menus; `portrait: false` returns null instead. cls = extra class.
 */
export function faceImg(p, cls = '', { portrait = true } = {}) {
  const src = faceSrc(p) || (portrait && p ? portraitSrc(p) : null);
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
export function faceImage(p, onLoad, opts = {}) {
  const src = faceSrc(p);
  if (!src) return null;
  const c = cache.get(src);
  if (c) {
    if (opts.fit && !c.fitting) { c.fitting = true; c.onFit = onLoad; if (c.ok) fitEntry(c, src); }
    return c.ok ? c.img : null;
  }
  const entry = { img: new Image(), ok: false, fitting: !!opts.fit, onFit: opts.fit ? onLoad : null };
  cache.set(src, entry);
  if (/^https?:/i.test(src)) entry.img.crossOrigin = 'anonymous';
  const img = entry.img;
  img.onload = async () => {
    // Decode off the main thread, then keep only a small square copy: headshots are often ~1000 px PNGs, and drawing
    // the full image into the face atlas / skin sampler every time a player comes on the field decoded and scaled it
    // on the main thread (a visible hitch per substitution with a league full of photos).
    try { await img.decode?.(); } catch { /* already decoded or not decodable: drawImage still works */ }
    entry.full = img; // kept until the face fitter has used it (only the 3D renderer asks for a fit)
    entry.img = thumb(img);
    entry.ok = true;
    onLoad?.(entry.img);
    if (entry.fitting) fitEntry(entry, src);
  };
  img.onerror = () => { entry.ok = false; };
  img.src = src;
  return null;
}

/**
 * Find the face (MediaPipe, render/faceFit.js) on a <= 512 px copy and replace the crop with the photo warped onto our 3D head's
 * face layout (render/faceWarp.js): eyes, nose, mouth and jaw where the mesh has them. Not in the offline single file.
 */
// The fitter runs on the main thread (MediaPipe on the CPU: the model load and each detect block for tens to hundreds of
// ms), so fits wait in a queue and run one at a time only while the gate is open (main.js: not during a live play).
let fitGate = () => true;
export function setFitGate(fn) { fitGate = fn; }
const fitQueue = [];
let fitBusy = false;
function fitEntry(entry, src) {
  if (import.meta.env.MODE === 'offline' || !entry.full) return;
  fitQueue.push([entry, src]);
  pumpFits();
}
function pumpFits() {
  if (fitBusy || !fitQueue.length) return;
  fitBusy = true;
  setTimeout(async () => {
    if (!fitGate()) { fitBusy = false; setTimeout(pumpFits, 400); return; }
    const [entry, src] = fitQueue.shift();
    try { await runFit(entry, src); } finally { fitBusy = false; setTimeout(pumpFits, 150); }
  }, 60);
}
async function runFit(entry, src) {
  if (!entry.full) return;
  try {
    const src512 = shrink(entry.full, 512);
    entry.full = null;
    const [F, W] = await Promise.all([import('../render/faceFit.js'), import('../render/faceWarp.js')]);
    const pts = await F.fitFace(src512, src);
    if (!pts) return;
    const c = document.createElement('canvas');
    c.width = c.height = FACE_PX;
    const g = c.getContext('2d');
    g.drawImage(entry.img, 0, 0, FACE_PX, FACE_PX);
    W.warpFace(g, src512, pts, F.KEYS, F.TRIS, 0, 0, FACE_PX);
    c.warped = true; // the renderer draws it straight into the cell (players.js paintFace)
    entry.img = c;
    entry.onFit?.(c);
  } catch (e) { console.warn('[Gridiron 27] face fit skipped', e); }
}

/** A copy of an image no bigger than `max` px on its long side (canvas), for the face fitter. */
function shrink(img, max) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** A FACE_PX square copy of a photo (crop from the top-middle, where a headshot's face is). Falls back to the image. */
const FACE_PX = 128; // = the 3D face atlas cells (players.js); the menus use the photo itself
function thumb(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = FACE_PX;
    const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, (w - s) / 2, Math.max(0, (h - s) * 0.2), s, s, 0, 0, FACE_PX, FACE_PX);
    return c;
  } catch { return img; }
}

/**
 * Skin tone from a face photo: the middle of the picture (where the face is in a headshot), keeping only pixels that
 * look like skin (the usual YCbCr skin range), then the median by brightness so hair, eyes and shadows don't pull it.
 * Returns '#rrggbb', or null if the image can't be read (cross-origin without CORS) or no skin is found.
 */
const toneMemo = new WeakMap();
export function skinToneFromImage(img) {
  // Memoized per image: the renderer asks again for every player whose photo has no usable skin pixels.
  if (img && typeof img === 'object' && toneMemo.has(img)) return toneMemo.get(img);
  const tone = readTone(img);
  if (img && typeof img === 'object') toneMemo.set(img, tone);
  return tone;
}
function readTone(img) {
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

// ---- Drawn portraits (UPDATE 5.0): a deterministic face for every player without a photo ----
// Built from the player's id / name: skin tone (his own if set), head shape, hair style and color, facial hair, brows,
// eyes, nose and mouth. Original vector art (an SVG data URL), cached per player.
const PORTRAITS = new Map();
function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const shade = (hex, k) => { // k < 0 darker, > 0 lighter
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`;
};
export function portraitSrc(p) {
  const key = `${p.id ?? ''}|${p.first ?? ''}|${p.last ?? ''}|${p.skinColor ?? p.skin ?? ''}`;
  if (PORTRAITS.has(key)) return PORTRAITS.get(key);
  let h = hash32(key);
  const rnd = (n) => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) % n; };
  const ti = typeof p.skin === 'number' ? Math.max(0, Math.min(5, p.skin - 1)) : rnd(6);
  const skin = /^#[0-9a-f]{6}$/i.test(p.skinColor || '') ? p.skinColor : SKIN_TONES[ti];
  const dark = ti >= 3 || parseInt(skin.slice(1, 3), 16) < 0x90;
  const hairCols = dark ? ['#151110', '#1d1612', '#26190f'] : ['#1a1410', '#3b2617', '#5a3a1e', '#8a6232', '#b88a4a', '#7a3418'];
  const hair = hairCols[rnd(hairCols.length)];
  const style = rnd(dark ? 7 : 6); // 0 buzz, 1 fade, 2 short crop, 3 bald, 4 curly top, 5 swept, 6 locs
  const beard = rnd(5); // 0 none, 1 stubble, 2 full, 3 goatee, 4 mustache
  const jaw = 22 + rnd(6), cheek = 25 + rnd(4), eyeY = 55 + rnd(3), browT = 1.6 + rnd(3) * 0.5;
  const skinD = shade(skin, -0.22), skinL = shade(skin, 0.12), lip = shade(skin, -0.32);
  const jersey = ['#1d2a44', '#2a2f38', '#3a1f22', '#1f3a2a', '#2f2a44'][rnd(5)];
  const head = `M${60 - cheek},50 C${60 - cheek},16 ${60 + cheek},16 ${60 + cheek},50 L${60 + cheek - 2},${72} C${60 + jaw - 2},${96} ${60 - jaw + 2},${96} ${60 - cheek + 2},72 Z`;
  let hairSvg = '';
  const top = `M${60 - cheek - 1},48 C${60 - cheek - 3},10 ${60 + cheek + 3},10 ${60 + cheek + 1},48`;
  if (style === 0) hairSvg = `<path d="${top} C${60 + cheek - 4},30 ${60 - cheek + 4},30 ${60 - cheek - 1},48Z" fill="${hair}" opacity="0.55"/>`;
  else if (style === 1) hairSvg = `<path d="${top} C${60 + cheek - 2},28 ${60 - cheek + 2},28 ${60 - cheek - 1},48Z" fill="${hair}"/><path d="M${60 - cheek},50 L${60 - cheek},58 M${60 + cheek},50 L${60 + cheek},58" stroke="${hair}" stroke-width="3" opacity="0.4"/>`;
  else if (style === 2) hairSvg = `<path d="M${60 - cheek - 2},50 C${60 - cheek - 4},6 ${60 + cheek + 4},6 ${60 + cheek + 2},50 C${60 + cheek - 2},28 ${60 - cheek + 2},27 ${60 - cheek - 2},50Z" fill="${hair}"/>`;
  else if (style === 4) hairSvg = Array.from({ length: 14 }, (_, i) => `<circle cx="${60 - cheek + 3 + (i % 7) * ((cheek * 2 - 6) / 6)}" cy="${17 + Math.floor(i / 7) * 6 + (i % 2) * 2}" r="5" fill="${hair}"/>`).join('') + `<path d="${top} C${60 + cheek - 4},30 ${60 - cheek + 4},30 ${60 - cheek - 1},48Z" fill="${hair}"/>`;
  else if (style === 5) hairSvg = `<path d="M${60 - cheek - 2},52 C${60 - cheek - 6},4 ${60 + cheek + 8},4 ${60 + cheek + 2},48 C${60 + 6},24 ${60 - 10},32 ${60 - cheek - 2},52Z" fill="${hair}"/>`;
  else if (style === 6) hairSvg = `<path d="${top} C${60 + cheek - 2},28 ${60 - cheek + 2},28 ${60 - cheek - 1},48Z" fill="${hair}"/>` + Array.from({ length: 8 }, (_, i) => { const x = 60 - cheek - 2 + i * ((cheek * 2 + 4) / 7); return `<path d="M${x},40 Q${x + (i < 4 ? -4 : 4)},70 ${x + (i < 4 ? -2 : 2)},92" stroke="${hair}" stroke-width="5" fill="none" stroke-linecap="round"/>`; }).join('');
  let beardSvg = '';
  const jawLine = `M${60 - cheek + 2},70 C${60 - jaw + 2},96 ${60 + jaw - 2},96 ${60 + cheek - 2},70`;
  if (beard === 1) beardSvg = `<path d="${jawLine} C${60 + cheek - 4},80 ${60 - cheek + 4},80 ${60 - cheek + 1},68Z" fill="${hair}" opacity="0.28"/>`;
  else if (beard === 2) beardSvg = `<path d="${jawLine} C${60 + cheek - 6},76 ${60 - cheek + 6},76 ${60 - cheek + 1},68Z" fill="${hair}" opacity="0.9"/><path d="M52,77 Q60,74 68,77" stroke="${hair}" stroke-width="3.2" fill="none"/>`;
  else if (beard === 3) beardSvg = `<path d="M53,80 Q60,92 67,80 Q60,84 53,80Z" fill="${hair}"/><path d="M53,77 Q60,74 67,77" stroke="${hair}" stroke-width="2.6" fill="none"/>`;
  else if (beard === 4) beardSvg = `<path d="M52,77 Q60,73 68,77" stroke="${hair}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#3a4558"/><stop offset="1" stop-color="#12161f"/></radialGradient>
<linearGradient id="sk" x1="0" x2="1"><stop offset="0" stop-color="${skinD}"/><stop offset="0.45" stop-color="${skin}"/><stop offset="1" stop-color="${skinD}"/></linearGradient></defs>
<rect width="120" height="120" fill="url(#bg)"/>
<path d="M14,120 C18,100 36,94 50,92 L70,92 C84,94 102,100 106,120Z" fill="${jersey}"/>
<path d="M50,92 L60,104 L70,92Z" fill="${shade(jersey, 0.25)}"/>
<rect x="51" y="84" width="18" height="12" fill="${skinD}"/>
<ellipse cx="${60 - cheek}" cy="58" rx="3.6" ry="7" fill="${skinD}"/><ellipse cx="${60 + cheek}" cy="58" rx="3.6" ry="7" fill="${skinD}"/>
<path d="${head}" fill="url(#sk)"/>
${hairSvg}
<path d="M${50 - 6},${eyeY - 6} Q50,${eyeY - 9} ${50 + 5},${eyeY - 6}" stroke="${hair}" stroke-width="${browT}" fill="none" stroke-linecap="round"/>
<path d="M${70 - 5},${eyeY - 6} Q70,${eyeY - 9} ${70 + 6},${eyeY - 6}" stroke="${hair}" stroke-width="${browT}" fill="none" stroke-linecap="round"/>
<ellipse cx="50" cy="${eyeY}" rx="4" ry="2.4" fill="#f4efe8"/><ellipse cx="70" cy="${eyeY}" rx="4" ry="2.4" fill="#f4efe8"/>
<circle cx="50" cy="${eyeY}" r="1.8" fill="#2a1c12"/><circle cx="70" cy="${eyeY}" r="1.8" fill="#2a1c12"/>
<path d="M60,${eyeY + 2} L57,${eyeY + 13} Q60,${eyeY + 15} 63,${eyeY + 13}" stroke="${skinD}" stroke-width="1.6" fill="none" stroke-linejoin="round"/>
<path d="M54,${eyeY + 20} Q60,${eyeY + 22 + rnd(2)} 66,${eyeY + 20}" stroke="${lip}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<ellipse cx="46" cy="${eyeY + 9}" rx="5" ry="3" fill="${skinL}" opacity="0.25"/><ellipse cx="74" cy="${eyeY + 9}" rx="5" ry="3" fill="${skinL}" opacity="0.25"/>
${beardSvg}
</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  PORTRAITS.set(key, url);
  return url;
}
