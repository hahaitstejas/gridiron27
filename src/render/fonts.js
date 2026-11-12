// Bundled fonts for uniforms and end zones (all OFL, from @fontsource, so the game works offline). The ids and their CSS
// weights are listed in data/design.js (FONTS); the weight imported here must match the one listed there.
import '@fontsource/oswald/latin-700.css';
import '@fontsource/saira-condensed/latin-800.css';
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/anton/latin-400.css';
import '@fontsource/teko/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/league-gothic/latin-400.css';
import '@fontsource/fjalla-one/latin-400.css';
import '@fontsource/squada-one/latin-400.css';
import '@fontsource/staatliches/latin-400.css';
import '@fontsource/graduate/latin-400.css';
import '@fontsource/alfa-slab-one/latin-400.css';
import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/russo-one/latin-400.css';
import '@fontsource/bungee/latin-400.css';
import '@fontsource/black-ops-one/latin-400.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/lobster/latin-400.css';
import { fontOf, cssFont, DEFAULT_FONT } from '../data/design.js';

/** Load the given font ids (the browser fetches only these files); resolves when they can be drawn on a canvas. */
export function ensureFonts(ids) {
  const want = [...new Set(ids.filter(Boolean).map((i) => fontOf(i)).filter(Boolean))];
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return Promise.all(want.map((f) => document.fonts.load(`${f.weight} 40px "${f.family}"`).catch(() => null))).then(() => undefined);
}
export { cssFont, DEFAULT_FONT };
