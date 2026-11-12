import { CONFERENCES } from '../data/teams.js';
import { HASH_Z, HALF_WIDTH } from '../core/constants.js';
import { drawLogo } from './logo.js';
import { LEAGUE } from '../data/leagueInfo.js';
import { cssFont } from '../data/design.js';

// The field texture covers x in [-FX, FX] and z in [-FZ, FZ] (yards).
export const FX = 66;
export const FZ = 33;
const S = 30; // pixels per yard

/** Paint the field: turf stripes, lines, hashes, numbers, end zones and midfield logo. */
/** opts.championship: the league logo takes midfield (the title game is on a neutral field). */
export function makeFieldCanvas(home, away, opts = {}) {
  const W = Math.round(FX * 2 * S), H = Math.round(FZ * 2 * S);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const px = (x) => (x + FX) * S;
  const pz = (z) => (z + FZ) * S;

  // Stadium creator (home team's `stadium`): turf shade, end zone style, midfield logo.
  const sd = (!opts.championship && home.stadium) || {};
  const TURF = { classic: ['#30582a', '#43733a', '#3a6731'], dark: ['#24521f', '#2f6a27', '#285c22'], bright: ['#3a7d2f', '#4c9a3c', '#41893a'], blue: ['#1d3f7a', '#2a56a3', '#234a8e'], black: ['#1a1a1a', '#262626', '#202020'] };
  const turf = TURF[sd.turf] || TURF.classic;
  // Surroundings (sideline turf) and the playing field with mowing stripes.
  g.fillStyle = turf[0];
  g.fillRect(0, 0, W, H);
  for (let x = -50; x < 50; x += 5) {
    g.fillStyle = (Math.floor((x + 50) / 5) % 2) ? turf[1] : turf[2];
    g.fillRect(px(x), pz(-HALF_WIDTH), 5 * S, HALF_WIDTH * 2 * S);
  }
  // Turf speckle for texture.
  const rnd = mulberry(7);
  for (let i = 0; i < 90000; i++) {
    const x = rnd() * W, y = rnd() * H;
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.035)';
    g.fillRect(x, y, 2, 2);
  }
  // Wear: the middle of the field between the hashes gets trampled (most between the 30s), with scuffed
  // patches where the lines set up. Drawn under the paint, so the lines stay crisp.
  for (let i = 0; i < 1400; i++) {
    const x = (rnd() + rnd() + rnd() - 1.5) * 62; // bell-shaped around midfield
    if (Math.abs(x) > 49) continue;
    const z = (rnd() + rnd() - 1) * HASH_Z * 2.2;
    const r = (0.3 + rnd() * 1.1) * S;
    const a = 0.018 + rnd() * 0.03 * (1 - Math.abs(x) / 60);
    g.fillStyle = rnd() < 0.75 ? `rgba(150,150,85,${a.toFixed(3)})` : `rgba(20,40,15,${a.toFixed(3)})`; // dry, lighter grass; a few dark scuffs
    g.beginPath(); g.ellipse(px(x), pz(z), r * 1.6, r, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }

  // End zones (the NFL look): the team name in one, the city in the other, with the conference logo and the league
  // logo on either side of the lettering. In the championship game each end zone belongs to one of the two teams
  // (its name and its logo).
  const confLogo = (t) => {
    // An uploaded conference logo (League & Conferences editor), else a badge with the conference's initials.
    const up = LEAGUE.confLogos?.[t.conference];
    if (up?._img) return { shape: 'circle', bg: '#000000', fg: '#ffffff', border: '#ffffff', text: '', dataUrl: up.dataUrl, _img: up._img };
    const name = CONFERENCES[t.conference] || '';
    const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'C';
    return { shape: 'shield', bg: '#1b1b1b', fg: '#ffffff', border: '#ffffff', text: initials };
  };
  const ez = (x0, team, rot, text, side) => {
    const style = sd.endzone || 'color';
    // Design columns (stadiums.csv): the two paint colors, lettering colors and font, the words and the logos beside them.
    const c1 = (!opts.championship && sd.ezColor) || team.colors.primary, c2 = (!opts.championship && sd.ezColor2) || team.colors.secondary;
    const goalDir = x0 < 0 ? 1 : -1; // along +x toward the goal line (the left end zone's goal line is on its right edge)
    const X0 = px(x0), Y0 = pz(-HALF_WIDTH), EW = 10 * S, EH = HALF_WIDTH * 2 * S;
    const clipEZ = () => { g.save(); g.beginPath(); g.rect(X0, Y0, EW, EH); g.clip(); };
    if (style !== 'turf') { g.fillStyle = c1; g.fillRect(X0, Y0, EW, EH); }
    if (style === 'stripes') {
      // Diagonal stripes in the second color behind the lettering.
      clipEZ();
      g.strokeStyle = c2; g.globalAlpha = 0.35; g.lineWidth = 1.1 * S;
      for (let z = -HALF_WIDTH - 12; z < HALF_WIDTH + 12; z += 3.2) { g.beginPath(); g.moveTo(X0, pz(z)); g.lineTo(X0 + EW, pz(z + 10)); g.stroke(); }
      g.restore();
    } else if (style === 'checker') {
      clipEZ();
      g.fillStyle = c2; g.globalAlpha = 0.3;
      const q = 1.25 * S;
      for (let yy = 0; yy * q < EH; yy++) for (let xx = 0; xx * q < EW; xx++) if ((xx + yy) % 2 === 0) g.fillRect(X0 + xx * q, Y0 + yy * q, q, q);
      g.restore();
    } else if (style === 'chevron') {
      clipEZ();
      g.fillStyle = c2; g.globalAlpha = 0.55;
      // Chevrons (arrow heads) pointing at the goal line, repeated along the end zone and across.
      const w = 0.9 * S, step = 2.2 * S, hh = 3 * S;
      for (let yy = Y0 - hh; yy < Y0 + EH + hh; yy += 2 * hh + 0.8 * S) for (let k = 0; k < 6; k++) {
        const bx = goalDir > 0 ? X0 + k * step : X0 + EW - k * step;
        g.beginPath(); g.moveTo(bx, yy); g.lineTo(bx + goalDir * 1.6 * S, yy + hh); g.lineTo(bx, yy + 2 * hh); g.lineTo(bx - goalDir * w, yy + 2 * hh); g.lineTo(bx + goalDir * (1.6 * S - w), yy + hh); g.lineTo(bx - goalDir * w, yy); g.closePath(); g.fill();
      }
      g.restore();
    } else if (style === 'gradient') {
      const gr = g.createLinearGradient(goalDir > 0 ? X0 + EW : X0, 0, goalDir > 0 ? X0 : X0 + EW, 0); // c1 at the goal line, c2 at the back
      gr.addColorStop(0, c1); gr.addColorStop(1, c2);
      g.fillStyle = gr; g.fillRect(X0, Y0, EW, EH);
    } else if (style === 'border') {
      g.strokeStyle = c2; g.lineWidth = 1.6 * S; g.strokeRect(X0 + 0.8 * S, Y0 + 0.8 * S, EW - 1.6 * S, EH - 1.6 * S);
    } else if (style === 'split') {
      g.fillStyle = c2; g.fillRect(goalDir > 0 ? X0 : X0 + EW / 2, Y0, EW / 2, EH);
    } else if (style === 'hoops') {
      clipEZ();
      g.fillStyle = c2; g.globalAlpha = 0.5;
      for (let xx = X0 + 0.6 * S; xx < X0 + EW; xx += 2.5 * S) g.fillRect(xx, Y0, 0.9 * S, EH);
      g.restore();
    }
    // Lettering: the team name / city (or the words from the spreadsheet), in the chosen font and colors.
    const words = !opts.championship && (x0 < 0 ? sd.ezLeft : sd.ezRight) !== undefined ? (x0 < 0 ? sd.ezLeft : sd.ezRight) : text;
    g.save();
    g.translate(px(x0 + 5), pz(0));
    g.rotate(rot);
    if (words) {
      const fs = Math.min(5.6 * S, (HALF_WIDTH * 2 * S * 0.6) / (words.length * 0.66));
      g.font = sd.ezFont ? cssFont(sd.ezFont, fs) : `800 ${fs}px "Saira Condensed", "Arial Narrow", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = fs * 0.09;
      g.strokeStyle = (!opts.championship && sd.ezOutline) || team.colors.accent;
      g.strokeText(words, 0, 0);
      g.fillStyle = (!opts.championship && sd.ezText) || team.colors.secondary;
      g.fillText(words, 0, 0);
    }
    // Logos either side of the word, turned with it: conference left, league right by default (the spreadsheet can pick
    // team / league / conference / none for each side) — or, in the championship, the team's own logo on both sides.
    const off = HALF_WIDTH * S * 0.78;
    const pickLogo = (which, dflt) => { const w = opts.championship ? null : which; if (w === 'none') return null; if (w === 'team') return team.logo; if (w === 'league') return LEAGUE.logo; if (w === 'conference') return confLogo(team); return dflt; };
    const L = pickLogo(sd.ezLogoLeft, side.left), R = pickLogo(sd.ezLogoRight, side.right);
    // Same frame as the lettering, so they read upright from the same side as the word (like a real end zone).
    if (L) drawLogo(g, L, -off, 0, 2.6 * S);
    if (R) drawLogo(g, R, off, 0, 2.6 * S);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 0.15 * S;
    g.strokeRect(px(x0) + 0.6 * S, pz(-HALF_WIDTH) + 0.6 * S, 8.8 * S, (HALF_WIDTH * 2 - 1.2) * S);
  };
  if (opts.championship) {
    ez(-60, home, -Math.PI / 2, home.name.toUpperCase(), { left: home.logo, right: home.logo });
    ez(50, away, Math.PI / 2, away.name.toUpperCase(), { left: away.logo, right: away.logo });
  } else {
    ez(-60, home, -Math.PI / 2, home.name.toUpperCase(), { left: confLogo(home), right: LEAGUE.logo });
    ez(50, home, Math.PI / 2, home.city.toUpperCase(), { left: confLogo(home), right: LEAGUE.logo });
  }

  g.fillStyle = '#ffffff';
  const line = (x, w = 0.12) => g.fillRect(px(x) - (w * S) / 2, pz(-HALF_WIDTH), w * S, HALF_WIDTH * 2 * S);
  // Yard lines every 5 yards; goal lines thicker.
  for (let x = -50; x <= 50; x += 5) line(x, Math.abs(x) === 50 ? 0.25 : 0.12);
  // Hash marks: inbounds hashes and sideline ticks every yard.
  for (let x = -49; x <= 49; x++) {
    if (x % 5 === 0) continue;
    for (const zc of [-HASH_Z, HASH_Z]) g.fillRect(px(x) - 0.05 * S, pz(zc) - 0.33 * S, 0.1 * S, 0.67 * S);
    for (const zs of [-1, 1]) g.fillRect(px(x) - 0.05 * S, pz(zs * (HALF_WIDTH - 0.66)) - 0.33 * S, 0.1 * S, 0.67 * S);
  }
  // Try line (2-yard line) marks.
  for (const s of [-1, 1]) g.fillRect(px(s * 48) - 0.06 * S, pz(0) - 0.5 * S, 0.12 * S, 1 * S);
  // Sidelines and end lines: 2-yard white border.
  g.fillRect(px(-62), pz(-HALF_WIDTH - 2), 124 * S, 2 * S);
  g.fillRect(px(-62), pz(HALF_WIDTH), 124 * S, 2 * S);
  g.fillRect(px(-62), pz(-HALF_WIDTH - 2), 2 * S, (HALF_WIDTH * 2 + 4) * S);
  g.fillRect(px(60), pz(-HALF_WIDTH - 2), 2 * S, (HALF_WIDTH * 2 + 4) * S);

  // Yard numbers every 10 yards, read from the sidelines, with direction arrows.
  g.font = sd.yardFont ? cssFont(sd.yardFont, 2.2 * S) : `700 ${2.2 * S}px "Saira Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let x = -40; x <= 40; x += 10) {
    const yard = 50 - Math.abs(x);
    const digits = String(yard);
    for (const side of [-1, 1]) {
      const zc = side * (HALF_WIDTH - 10);
      g.save();
      g.translate(px(x), pz(zc));
      g.rotate(side > 0 ? 0 : Math.PI);
      g.fillStyle = '#ffffff';
      g.fillText(digits[0], -0.95 * S, 0);
      g.fillText(digits[1], 0.95 * S, 0);
      if (yard !== 50) {
        // Arrow points toward the nearer goal line.
        const toward = Math.sign(x) * (side > 0 ? 1 : -1);
        g.beginPath();
        const ax = toward * 2.1 * S;
        g.moveTo(ax + toward * 0.45 * S, -0.55 * S);
        g.lineTo(ax, -0.85 * S);
        g.lineTo(ax, -0.25 * S);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }
  // Midfield: the home team's logo (the league's in the championship game).
  if (opts.championship || sd.midLogo !== false) drawLogo(g, opts.championship ? LEAGUE.logo : home.logo, px(0), pz(0), 6 * S); // ~12 yds across, like a real midfield logo
  // League logo at both 25-yard lines.
  for (const x of [-25, 25]) {
    g.save();
    g.globalAlpha = 0.9;
    drawLogo(g, LEAGUE.logo, px(x), pz(0), 1.9 * S);
    g.restore();
  }
  // Team-colored sideline "coaches box" stripes.
  g.fillStyle = home.colors.primary;
  g.fillRect(px(-25), pz(HALF_WIDTH + 2.4), 50 * S, 0.25 * S);
  g.fillStyle = away.colors.primary;
  g.fillRect(px(-25), pz(-HALF_WIDTH - 2.65), 50 * S, 0.25 * S);
  return c;
}

function mulberry(a) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
