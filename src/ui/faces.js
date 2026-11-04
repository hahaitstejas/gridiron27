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
