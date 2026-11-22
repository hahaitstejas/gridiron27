import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { remoteImages } = createRequire(import.meta.url)('./tools/remote-images.cjs');
// Dev server: /remote?u=<image url> relays web logos / face photos (see tools/remote-images.cjs).
const relay = () => ({ name: 'g27-remote-images', configureServer(server) { const h = remoteImages('node_modules/.cache/g27-remote'); server.middlewares.use((req, res, next) => { if (!h(req, res)) next(); }); } });

// Commentary clips (voice/, recorded by `npm run voices`): served at /voice in dev and copied next to every build except
// the one-file offline build (too big to inline).
const voiceClips = (mode) => ({
  name: 'g27-voice',
  configureServer(server) {
    server.middlewares.use('/voice', (req, res, next) => {
      const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
      const f = path.join('voice', rel);
      if (!rel || rel.includes('..') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return next();
      res.setHeader('Content-Type', f.endsWith('.json') ? 'application/json' : 'audio/mpeg');
      fs.createReadStream(f).pipe(res);
    });
  },
  writeBundle(opts) {
    if (mode === 'offline' || !fs.existsSync('voice/index.json') || !fs.existsSync('voice/clips')) return;
    const out = path.join(opts.dir || 'dist', 'voice');
    fs.mkdirSync(path.join(out, 'clips'), { recursive: true });
    fs.copyFileSync('voice/index.json', path.join(out, 'index.json'));
    for (const f of fs.readdirSync('voice/clips')) if (f.endsWith('.mp3')) fs.copyFileSync(path.join('voice/clips', f), path.join(out, 'clips', f));
  },
});

// `npm run build:offline` (mode "offline") inlines everything (JS, CSS, fonts) into one HTML file that opens from disk.
export default defineConfig(({ mode }) => ({
  // "web" (GitHub Pages, .github/workflows/pages.yml): served from https://<user>.github.io/gridiron27/, so a relative base.
  base: mode === 'offline' || mode === 'web' ? './' : '/',
  // The offline file never copies public/ (personal league files stay out of it; use League → Saves & Files instead).
  // The Mac app (mode "app") doesn't either: it serves your league folder as /local/ itself (electron/main.cjs).
  // The public web build never copies public/ either: personal league files must never be published.
  publicDir: mode === 'offline' || mode === 'app' || mode === 'web' ? false : 'public',
  server: { port: 5173, open: false },
  build: mode === 'offline'
    ? { target: 'es2022', chunkSizeWarningLimit: 4000, outDir: 'dist-offline', assetsInlineLimit: 1e8, emptyOutDir: true }
    : mode === 'app' ? { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: 'dist-app', emptyOutDir: true }
    : mode === 'web' ? { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: 'dist-web', emptyOutDir: true }
    : { target: 'es2022', chunkSizeWarningLimit: 2000 },
  plugins: mode === 'offline' ? [viteSingleFile()] : [relay(), voiceClips(mode)],
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
}));
