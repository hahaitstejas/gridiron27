// Uniforms (pure data): each team has a home, away and alternate ("rivalry") set — jersey, pants, number and number
// outline colors (and the helmet). Defaults come from the team colors; `team.uniforms[kind]` (saved in the league, and
// editable through League → Uniforms or uniforms.csv) overrides any of them.
export const UNIFORM_KINDS = ['home', 'away', 'alt', 'throwback', 'color_rush'];
export const UNIFORM_NAMES = { home: 'Home', away: 'Away', alt: 'Alternate', throwback: 'Throwback', color_rush: 'Color Rush' };
export const UNIFORM_FIELDS = ['jersey', 'pants', 'number', 'outline', 'helmet'];
// Uniform creator extras (optional; unset = derived from the base colors in the renderer): sleeves, shoulder caps,
// helmet stripe ('none' = no stripe), facemask, socks, gloves, cleats.
export const UNIFORM_EXTRAS = ['sleeves', 'shoulders', 'stripe', 'facemask', 'socks', 'gloves', 'cleats'];
export const EXTRA_NAMES = { sleeves: 'Sleeves', shoulders: 'Shoulder caps', stripe: 'Helmet stripe', facemask: 'Facemask', socks: 'Socks', gloves: 'Gloves', cleats: 'Cleats' };

const hex = (c) => (c || '#000000').replace('#', '');
export function isDark(c) {
  const h = hex(c);
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/** The generated look for a team (before any edits). */
export function defaultUniforms(team) {
  const c = team.colors, u = team.uniform || {};
  const pick = (w) => (w === 'white' ? '#f4f4f4' : w === 'secondary' ? c.secondary : w === 'accent' ? c.accent : c.primary);
  const homeJersey = pick(u.jersey || 'primary');
  const pants = pick(u.pants || 'white');
  const numOn = (jersey) => (isDark(jersey) ? (isDark(c.secondary) ? '#ffffff' : c.secondary) : (isDark(c.primary) ? c.primary : '#111111'));
  const helmet = pick(u.helmet || 'primary');
  const altJersey = isDark(c.secondary) || !isDark(c.primary) ? c.secondary : '#141414';
  return {
    home: { jersey: homeJersey, pants, number: numOn(homeJersey), outline: isDark(homeJersey) ? c.primary : c.secondary, helmet },
    away: { jersey: '#f4f4f4', pants, number: isDark(c.primary) ? c.primary : c.secondary, outline: c.secondary, helmet },
    alt: { jersey: altJersey, pants: altJersey, number: numOn(altJersey), outline: c.primary, helmet: altJersey },
    // Generated looks for the extra sets (a file can define them): a classic home set, and all one color.
    throwback: { jersey: homeJersey, pants: '#e8dcc0', number: numOn(homeJersey), outline: isDark(homeJersey) ? c.secondary : c.primary, helmet: '#f4f4f4' },
    color_rush: { jersey: c.primary, pants: c.primary, number: numOn(c.primary), outline: c.secondary, helmet: c.primary },
  };
}

/** The colors a team wears in `kind` ('home' | 'away' | 'alt'). */
export function uniformFor(team, kind = 'home') {
  const d = defaultUniforms(team)[kind] || defaultUniforms(team).home;
  return { ...d, ...(team.uniforms?.[kind] || {}) };
}

/** How different two colors look (0 = identical, ~1.7 = black vs white), weighting brightness like the eye does. */
export function colorGap(a, b) {
  const rgb = (c) => { const h = hex(c); return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255); };
  const [x, y] = [rgb(a), rgb(b)];
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 0.6 + Math.abs(lum(x) - lum(y)) * 1.4;
}
/** Two uniforms clash when the jerseys are too close to tell the teams apart on the field. */
export function uniformsClash(a, b) { return colorGap(a.jersey, b.jersey) < 0.45; }
