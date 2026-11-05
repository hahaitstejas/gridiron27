// Download every face photo linked in your league spreadsheets into public/local/faces/ and point the `face` column at
// the local files (a backup of each spreadsheet is kept). Local photos work everywhere: menus, the 3D face, the skin
// tone (web links need the image host to allow CORS for those), offline, and without fetching thousands of images from
// someone else's server every game. public/local/ is git-ignored: the photos stay on your machine.
//   npm run fetch-faces                 (public/local/league.csv, roster.csv and free_agents.csv, whichever exist)
//   npm run fetch-faces -- path/to/file.csv
import fs from 'node:fs';
import path from 'node:path';

const LOCAL = path.resolve('public/local');
const FACES = path.join(LOCAL, 'faces');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['league.csv', 'roster.csv', 'free_agents.csv'].map((f) => path.join(LOCAL, f)).filter((f) => fs.existsSync(f));
if (!files.length) { console.log('No spreadsheets found in public/local/ (league.csv, roster.csv, free_agents.csv).'); process.exit(0); }
fs.mkdirSync(FACES, { recursive: true });

const URL_RE = /https?:\/\/[^\s",]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s",]*)?/gi;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'face';
/** A stable, readable file name per URL: the last path part (e.g. ESPN's player id) + the extension. */
function nameFor(url, used) {
  const u = new URL(url);
  const base = slug(path.basename(u.pathname).replace(/\.[a-z0-9]+$/i, '') || u.hostname);
  const ext = (path.extname(u.pathname).toLowerCase().match(/\.(png|jpe?g|webp|gif)$/) || ['.png'])[0];
  let n = `${base}${ext}`, k = 2;
  while (used.has(n) && used.get(n) !== url) n = `${base}-${k++}${ext}`;
  used.set(n, url);
  return n;
}

const urls = new Set();
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(URL_RE)) urls.add(m[0]);
console.log(`${urls.size} photo links in ${files.map((f) => path.basename(f)).join(', ')}`);
const used = new Map(), map = new Map();
for (const u of urls) map.set(u, nameFor(u, used));

let done = 0, ok = 0, skipped = 0;
const failed = [];
const queue = [...map.entries()];
async function worker() {
  while (queue.length) {
    const [url, name] = queue.shift();
    const dest = path.join(FACES, name);
    try {
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) skipped++;
      else {
        const res = await fetch(url, { headers: { 'User-Agent': 'Gridiron27-face-fetch' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        ok++;
      }
    } catch (e) { failed.push([url, e.message]); map.delete(url); }
    if (++done % 100 === 0) console.log(`  ${done} / ${urls.size}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`downloaded ${ok}, already there ${skipped}, failed ${failed.length}`);
for (const [u, why] of failed.slice(0, 10)) console.log(`  failed: ${u} (${why})`);

// Point the spreadsheets at the local files (only links that downloaded; failed ones stay links).
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const out = text.replace(URL_RE, (u) => map.get(u) || u);
  if (out === text) continue;
  fs.copyFileSync(f, `${f}.${stamp}.bak`);
  fs.writeFileSync(f, out);
  console.log(`updated ${path.basename(f)} (backup: ${path.basename(f)}.${stamp}.bak)`);
}
