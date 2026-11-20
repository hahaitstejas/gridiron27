// Build the web version and zip it for itch.io (Kind of project: HTML). itch wants index.html at the top of
// the zip and serves it from its own CDN sub-folder, which the web build's relative base ('./') handles.
// Output: release/gridiron27-itch.zip (git-ignored). Upload it on the game's itch.io edit page.
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const root = resolve(import.meta.dirname, '..');
execSync('npx vite build --mode web', { cwd: root, stdio: 'inherit' });

const dist = join(root, 'dist-web');
const files = []; // itch limits: 1000 files, 500 MB unpacked, 200 MB per file
const walk = (d) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(statSync(p).size); });
walk(dist);
const mb = files.reduce((a, b) => a + b, 0) / 1e6;
if (files.length > 1000 || mb > 500) throw new Error(`too big for itch: ${files.length} files, ${mb.toFixed(1)} MB`);

const out = join(root, 'release', 'gridiron27-itch.zip');
mkdirSync(join(root, 'release'), { recursive: true });
if (existsSync(out)) rmSync(out);
execSync(`zip -qr "${out}" .`, { cwd: dist, stdio: 'inherit' });
console.log(`\n${out}\n${files.length} files, ${mb.toFixed(1)} MB unpacked, ${(statSync(out).size / 1e6).toFixed(1)} MB zipped`);
