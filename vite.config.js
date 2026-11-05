import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createRequire } from 'node:module';

const { remoteImages } = createRequire(import.meta.url)('./tools/remote-images.cjs');
// Dev server: /remote?u=<image url> relays web logos / face photos (see tools/remote-images.cjs).
const relay = () => ({ name: 'g27-remote-images', configureServer(server) { const h = remoteImages('node_modules/.cache/g27-remote'); server.middlewares.use((req, res, next) => { if (!h(req, res)) next(); }); } });

// `npm run build:offline` (mode "offline") inlines everything (JS, CSS, fonts) into one HTML file that opens from disk.
export default defineConfig(({ mode }) => ({
  base: mode === 'offline' ? './' : '/',
  // The offline file never copies public/ (personal league files stay out of it; use League → Saves & Files instead).
  // The Mac app (mode "app") doesn't either: it serves your league folder as /local/ itself (electron/main.cjs).
  publicDir: mode === 'offline' || mode === 'app' ? false : 'public',
  server: { port: 5173, open: false },
  build: mode === 'offline'
    ? { target: 'es2022', chunkSizeWarningLimit: 4000, outDir: 'dist-offline', assetsInlineLimit: 1e8, emptyOutDir: true }
    : mode === 'app' ? { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: 'dist-app', emptyOutDir: true }
    : { target: 'es2022', chunkSizeWarningLimit: 2000 },
  plugins: mode === 'offline' ? [viteSingleFile()] : [relay()],
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
}));
