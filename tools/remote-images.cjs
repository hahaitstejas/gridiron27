// Image relay for web logos / face photos (league.csv `logo_image`, roster `face` links). Browsers only let the game draw
// a web image into its 3D textures when that site allows it (CORS), and most image hosts don't, so the game asks its own
// server instead: GET /remote?u=<url>. The server fetches the image once, keeps it in a disk cache and serves it from the
// game's own address. Used by the dev server (vite.config.js) and the Mac app (electron/main.cjs). Images only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TYPES = /^image\/(png|jpe?g|webp|gif|svg\+xml|avif)/i;

/** Returns (req, res) => boolean: handles /remote requests (true), leaves everything else (false). */
function remoteImages(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const pending = new Map();
  const fetchOnce = (url) => {
    const key = crypto.createHash('sha1').update(url).digest('hex');
    const file = path.join(cacheDir, key), meta = `${file}.type`;
    if (fs.existsSync(file) && fs.existsSync(meta)) return Promise.resolve({ file, type: fs.readFileSync(meta, 'utf8') });
    if (pending.has(key)) return pending.get(key);
    const p = (async () => {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Gridiron27 image relay)', Accept: 'image/*' }, redirect: 'follow' });
      const type = (r.headers.get('content-type') || '').split(';')[0];
      if (!r.ok || !TYPES.test(type)) throw new Error(`${r.status} ${type}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8e6) throw new Error('too big');
      fs.writeFileSync(file, buf); fs.writeFileSync(meta, type);
      return { file, type };
    })().finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  };
  return (req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    if (u.pathname !== '/remote') return false;
    const target = u.searchParams.get('u') || '';
    if (!/^https?:\/\//i.test(target)) { res.writeHead(400); res.end('bad url'); return true; }
    fetchOnce(target).then(({ file, type }) => {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=86400' });
      fs.createReadStream(file).pipe(res);
    }).catch((e) => { res.writeHead(502); res.end(`image unavailable: ${e.message}`); });
    return true;
  };
}

module.exports = { remoteImages };
