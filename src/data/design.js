// The design vocabulary for uniforms and end zones (pure data, Node-importable): which fonts, patch shapes and end zone
// styles exist, how a patch is written in a spreadsheet cell, and the guide text written into every exported league book
// so a person (or an AI model they paste the file into) knows exactly which values are allowed.
//
// Fonts must be bundled with the game (the game works offline), so only the ones below exist: an unknown font name in a
// spreadsheet is reported and ignored. The render side (render/fonts.js) imports the matching @fontsource packages.

/** id = the value used in spreadsheets (lower case, underscores); family / weight = the CSS font it draws with; squeeze = how much the
 * renderer narrows its digits on a jersey (1 = natural width). */
export const FONTS = [
  { id: 'saira_condensed', squeeze: 1.0, family: 'Saira Condensed', weight: 800, note: 'the game default: sporty, narrow, very readable' },
  { id: 'oswald', squeeze: 0.74, family: 'Oswald', weight: 700, note: 'tall condensed grotesque; the default jersey numbers' },
  { id: 'bebas_neue', squeeze: 0.85, family: 'Bebas Neue', weight: 400, note: 'tall all-caps, clean, modern' },
  { id: 'anton', squeeze: 0.8, family: 'Anton', weight: 400, note: 'very heavy condensed, great for big numbers' },
  { id: 'teko', squeeze: 0.95, family: 'Teko', weight: 600, note: 'techy, squared-off, narrow' },
  { id: 'barlow_condensed', squeeze: 0.85, family: 'Barlow Condensed', weight: 700, note: 'neutral condensed sans, classic modern jersey' },
  { id: 'big_shoulders_display', squeeze: 0.85, family: 'Big Shoulders Display', weight: 800, note: 'industrial, wide strokes, Chicago-style' },
  { id: 'league_gothic', squeeze: 1.0, family: 'League Gothic', weight: 400, note: 'extremely tall and narrow' },
  { id: 'fjalla_one', squeeze: 0.85, family: 'Fjalla One', weight: 400, note: 'condensed, friendly, a little rounded' },
  { id: 'squada_one', squeeze: 0.95, family: 'Squada One', weight: 400, note: 'squared, futuristic block' },
  { id: 'staatliches', squeeze: 0.9, family: 'Staatliches', weight: 400, note: 'rounded-square poster block' },
  { id: 'graduate', squeeze: 0.85, family: 'Graduate', weight: 400, note: 'collegiate slab serif, the classic college football numeral' },
  { id: 'alfa_slab_one', squeeze: 0.75, family: 'Alfa Slab One', weight: 400, note: 'heavy slab serif, old-school pro look' },
  { id: 'archivo_black', squeeze: 0.7, family: 'Archivo Black', weight: 400, note: 'wide, heavy sans, bold and blocky' },
  { id: 'russo_one', squeeze: 0.8, family: 'Russo One', weight: 400, note: 'wide sporty sans with cut corners' },
  { id: 'bungee', squeeze: 0.7, family: 'Bungee', weight: 400, note: 'rounded signage block, loud' },
  { id: 'black_ops_one', squeeze: 0.8, family: 'Black Ops One', weight: 400, note: 'stencil, military' },
  { id: 'orbitron', squeeze: 0.75, family: 'Orbitron', weight: 700, note: 'futuristic, wide, geometric' },
  { id: 'pacifico', squeeze: 0.9, family: 'Pacifico', weight: 400, note: 'brush script (best for end zone names and patch letters, not numbers)' },
  { id: 'lobster', squeeze: 0.9, family: 'Lobster', weight: 400, note: 'bold script (best for end zone names and patch letters, not numbers)' },
];
export const DEFAULT_FONT = 'saira_condensed';
export const NUMBER_FONT = 'oswald';

const fontKey = (s) => String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
/** The font entry for an id or display name ("Bebas Neue", "bebas-neue", "BEBAS_NEUE"), or null. */
export function fontOf(name) {
  const k = fontKey(name);
  return FONTS.find((f) => f.id === k || fontKey(f.family) === k) || null;
}
/** A CSS font shorthand for a font id at a size ("800 40px "Saira Condensed", sans-serif"); unknown ids use the fallback id. */
export function cssFont(name, px, fallback = DEFAULT_FONT) {
  const f = fontOf(name) || fontOf(fallback);
  return `${f.weight} ${px}px "${f.family}", "Arial Narrow", sans-serif`;
}

// ---------- patches ----------
/**
 * Where a patch can sit. Left / right are the WEARER's (his left chest is on your right when he faces you); `collar` is the
 * centre of the chest right under the V-neck, where every jersey carries the league shield (the default is the league logo).
 */
export const PATCH_SLOTS = ['left_chest', 'right_chest', 'left_sleeve', 'right_sleeve', 'collar'];
export const PATCH_NAMES = { left_chest: 'Left chest', right_chest: 'Right chest', left_sleeve: 'Left sleeve', right_sleeve: 'Right sleeve', collar: 'Under the V-neck' };
/** Shapes a patch can have (the same shapes as team logos), plus the special logo choices. */
export const PATCH_SHAPES = ['circle', 'square', 'rounded', 'diamond', 'shield', 'hex', 'star', 'triangle'];
export const PATCH_LOGOS = ['team_logo', 'league_logo'];
export const IMAGE_LINK = /^(https?:\/\/|data:image\/)|\.(png|jpe?g|svg|webp|gif)(\?.*)?$/i;

/**
 * A patch cell: an IMAGE (a web link, or a file name in public/local/logos/), or `team_logo` / `league_logo`, or
 * `shape:text:bg:fg:border` (all but the shape optional), or `none` (no patch, even where there is a default). An empty cell
 * means "not set" (the default). text = up to 3 letters or digits (`_` = none); colors are hex (#rrggbb).
 * Examples: `circle:C:#ffd100:#111111:#111111`, `https://example.com/anniversary.png`, `captain_patch.png`, `league_logo`.
 */
export function parsePatch(cell) {
  const raw = String(cell ?? '').trim();
  if (!raw) return null;
  if (/^(none|off|no|-)$/i.test(raw)) return { none: true };
  const img = raw.replace(/^image\s*:\s*/i, '');
  if (IMAGE_LINK.test(img)) return { image: img };
  const k = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (PATCH_LOGOS.includes(k)) return { logo: k };
  const [shape, text = '', bg, fg, border] = raw.split(':').map((s) => s.trim());
  const sh = shape.toLowerCase();
  if (!PATCH_SHAPES.includes(sh)) return { error: `unknown patch "${raw}" (use an image link like https://.../patch.png or a file name like patch.png, ${PATCH_LOGOS.join(', ')}, none, or shape:text:bg:fg:border with shape = ${PATCH_SHAPES.join(', ')})` };
  const col = (v) => (/^#?[0-9a-f]{6}$/i.test(v || '') ? (v.startsWith('#') ? v : `#${v}`) : null);
  const out = { shape: sh, text: text === '_' ? '' : text.slice(0, 3).toUpperCase() };
  if (bg && !col(bg)) return { error: `bad patch background color "${bg}"` };
  if (fg && !col(fg)) return { error: `bad patch letter color "${fg}"` };
  if (border && !col(border)) return { error: `bad patch border color "${border}"` };
  if (bg) out.bg = col(bg); if (fg) out.fg = col(fg); if (border) out.border = col(border);
  return out;
}
/** A patch back to its cell text. */
export function patchCell(p) {
  if (!p) return '';
  if (p.none) return 'none';
  if (p.image) return p.image;
  if (p.logo) return p.logo;
  return [p.shape, p.text || '_', p.bg, p.fg, p.border].filter((v, i) => i < 2 || v).join(':');
}
/**
 * The captain's badge a uniform gives its team's captains (roster column `captain` = Y): the uniform's `captain_patch` cell, else a
 * rounded patch with a C in the jersey / number / outline colors. `none` = captains wear no badge. Drawn on the wearer's right chest
 * (the left side of the picture when he faces you), where a captain's C sits.
 */
export function resolveCaptainPatch(uni) {
  const p = uni?.captainPatch;
  if (p?.none) return null;
  if (p) return p;
  return { shape: 'rounded', text: 'C', bg: uni?.jersey || '#1d2f5c', fg: uni?.number || '#ffffff', border: uni?.outline || '#ffffff' };
}

/** The patches a uniform really wears: the collar defaults to the league logo; `none` removes a patch. Returns slot → patch. */
export function resolvePatches(patches) {
  const out = {};
  for (const slot of PATCH_SLOTS) {
    const p = patches?.[slot] ?? (slot === 'collar' ? { logo: 'league_logo' } : null);
    if (p && !p.none) out[slot] = p;
  }
  return out;
}

// ---------- end zones ----------
/** End zone paint styles. `primary` / `secondary` = the end zone colors (default: the team colors). */
export const ENDZONE_STYLES = {
  color: 'solid primary color',
  stripes: 'primary with diagonal secondary stripes',
  checker: 'primary and secondary checkerboard (soft)',
  chevron: 'secondary chevrons pointing at the goal line',
  gradient: 'primary fading to secondary toward the back line',
  border: 'primary with a thick secondary border all round',
  split: 'primary on the goal-line half, secondary on the back half',
  hoops: 'horizontal secondary bars across the end zone',
  turf: 'no paint: grass with the lettering on it',
};
export const ENDZONE_LOGOS = ['conference', 'league', 'team', 'none'];
export const TURF_STYLES = ['classic', 'dark', 'bright', 'blue', 'black'];

// ---------- the guide ----------
const list = (a) => a.join(' | ');
/** The text rows written into the [README] section of every exported league book (one row = one line). */
export function guideLines() {
  const L = [];
  L.push('GRIDIRON 27 LEAGUE BOOK: HOW TO EDIT THIS FILE (for people and for AI models)');
  L.push('This file is one spreadsheet holding the whole league. Every [SECTION] marker starts a table with its own header row. Keep the section markers and header rows exactly as they are. Lines starting with # are comments and are ignored. This [README] section is ignored when the file is loaded.');
  L.push('If you are an AI model: when asked to design uniforms or end zones, return ONLY the [UNIFORMS] and/or [STADIUMS] sections (marker line, header row, data rows), as plain CSV text, with every value taken from the allowed lists below. Do not invent values: an unknown font, shape or style is ignored by the game.');
  L.push('');
  L.push('COLORS: always a 6-digit hex like #1f3a93 (with or without the #).');
  L.push('TEAM: the 2-4 letter abbreviation from the [TEAMS] section (column abbr).');
  L.push('');
  L.push('=== [ROSTER]: one row per player (see the header row). Captain badges: the column captain = Y marks a team captain, who wears the captain badge on the jersey. Only a few players per team should be captains (usually 3 to 5: the starting QB, a defensive leader, one more offensive leader); leave the cell blank for everyone else. If a team lists no captain, the game picks the QB, the best defender and the best other offensive player. ===');
  L.push('');
  L.push('=== [UNIFORMS]: one row per team per kind. kind = ' + list(['home', 'away', 'alt', 'throwback', 'color_rush']) + ' ===');
  L.push('Columns: team, kind, jersey, pants, number, number_outline, helmet (colors), then optional: sleeves, shoulders, helmet_stripe, facemask, socks, gloves, cleats (colors; helmet_stripe may be "none").');
  L.push('Optional design columns: number_font, name_font, patch_font, captain_patch, left_chest, right_chest, left_sleeve, right_sleeve, collar.');
  L.push('  number_font = the font of the jersey numbers (default ' + NUMBER_FONT + '); name_font = the player name on the back (default ' + NUMBER_FONT + '); patch_font = the font of letters inside patches (default ' + DEFAULT_FONT + ').');
  L.push('  ALLOWED FONTS (use the id on the left): ');
  for (const f of FONTS) L.push(`    ${f.id}  (${f.family}): ${f.note}`);
  L.push('  captain_patch = the captain\'s badge worn by the players marked captain in the [ROSTER] section (column captain = Y). Same cell format as the patches below; default: a rounded patch with a C in the jersey, number and outline colors; none = no captain badge. It sits on the wearer\'s right chest.');
  L.push('  PATCH CELLS (left_chest, right_chest, left_sleeve, right_sleeve, collar): left and right are the WEARER\'s, so his left chest is on YOUR right when he faces you. collar = the centre of the chest right under the V-neck; every team wears the league logo there unless it is set to none or something else.');
  L.push('    A cell is empty (= default), none, an IMAGE LINK, team_logo, league_logo, or shape:text:background:letters:border.');
  L.push('    IMAGE LINK: a web link (https://...png / .jpg / .svg / .webp) or a file name stored in the logos folder (public/local/logos/, e.g. captain_patch.png). The image is drawn as it is, so a square PNG with a transparent background works best.');
  L.push('    shape = ' + list(PATCH_SHAPES) + ';  text = up to 3 letters or digits (_ for none);  the three colors are optional hex colors.');
  L.push('    Examples: circle:C:#ffd100:#111111:#111111   |   shield:75:#ffffff:#0b1f4d:#0b1f4d   |   star:_:#ffd100   |   team_logo   |   league_logo   |   https://example.com/patch.png   |   anniversary.png   |   none');
  L.push('    Typical use: left_chest = captain patch (circle:C), right_chest = a commemorative patch image, a sleeve = a memorial / anniversary patch (shield:25 or an image), collar = league_logo (the default).');
  L.push('');
  L.push('=== [STADIUMS]: one row per team (kind = home). Columns: team, name, city, capacity, roof, surface, kind, year, then optional design columns ===');
  L.push('  turf = ' + list(TURF_STYLES) + ';  seats = hex color of the stands;  mid_logo = on | off (midfield logo).');
  L.push('  endzone = the paint style: ');
  for (const [k, v] of Object.entries(ENDZONE_STYLES)) L.push(`    ${k}: ${v}`);
  L.push('  endzone_color, endzone_color2 = end zone colors (default: the team primary and secondary colors);  endzone_text_color, endzone_outline_color = the lettering colors.');
  L.push('  endzone_font = the lettering font (an id from the font list above, default ' + DEFAULT_FONT + ').');
  L.push('  endzone_text_left, endzone_text_right = the words in the two end zones (default: the team name in one, the city in the other; use _ for no text).');
  L.push('  endzone_logo_left, endzone_logo_right = ' + list(ENDZONE_LOGOS) + ' (what sits at the left and right of the lettering; default conference on the left, league on the right).');
  L.push('  yard_font = the font of the yard-line numbers on the field (an id from the font list above).');
  L.push('');
  L.push('=== EXAMPLE (UNIFORMS) ===');
  L.push('team,kind,jersey,pants,number,number_outline,helmet,number_font,name_font,left_chest,right_sleeve,collar');
  L.push('BOS,home,#1d2f5c,#f4f4f4,#ffffff,#c8102e,#1d2f5c,graduate,graduate,circle:C:#ffd100:#111111:#111111,shield:75:#ffffff:#1d2f5c:#c8102e,league_logo');
  L.push('=== EXAMPLE (STADIUMS) ===');
  L.push('team,name,city,capacity,roof,surface,kind,year,endzone,endzone_color,endzone_color2,endzone_font,endzone_text_left,endzone_text_right,yard_font');
  L.push('BOS,Harbor Field,Boston,65000,open,grass,home,,chevron,#1d2f5c,#c8102e,bebas_neue,IRONSIDES,BOSTON,oswald');
  return L;
}
