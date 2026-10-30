import { HASH_Z, HALF_WIDTH } from '../core/constants.js';
import { drawLogo } from './logo.js';
import { LEAGUE } from '../data/leagueInfo.js';

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

  // Surroundings (sideline turf) and the playing field with mowing stripes.
  g.fillStyle = '#2f6b2a';
  g.fillRect(0, 0, W, H);
  for (let x = -50; x < 50; x += 5) {
    g.fillStyle = (Math.floor((x + 50) / 5) % 2) ? '#3c8a35' : '#368030';
    g.fillRect(px(x), pz(-HALF_WIDTH), 5 * S, HALF_WIDTH * 2 * S);
  }
  // Turf speckle for texture.
  const rnd = mulberry(7);
  for (let i = 0; i < 90000; i++) {
    const x = rnd() * W, y = rnd() * H;
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.035)';
    g.fillRect(x, y, 2, 2);
  }

  // End zones.
  const ez = (x0, team, rot) => {
    g.fillStyle = team.colors.primary;
    g.fillRect(px(x0), pz(-HALF_WIDTH), 10 * S, HALF_WIDTH * 2 * S);
    g.save();
    g.translate(px(x0 + 5), pz(0));
    g.rotate(rot);
    const name = team.name.toUpperCase();
    const fs = Math.min(5.6 * S, (HALF_WIDTH * 2 * S * 0.86) / (name.length * 0.72));
    g.font = `900 ${fs}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = fs * 0.09;
    g.strokeStyle = team.colors.accent;
    g.strokeText(name, 0, 0);
    g.fillStyle = team.colors.secondary;
    g.fillText(name, 0, 0);
    g.restore();
    // Diagonal border stripes for style.
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 0.15 * S;
    g.strokeRect(px(x0) + 0.6 * S, pz(-HALF_WIDTH) + 0.6 * S, 8.8 * S, (HALF_WIDTH * 2 - 1.2) * S);
  };
  ez(-60, home, -Math.PI / 2);
  ez(50, home, Math.PI / 2);

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
  g.font = `bold ${2 * S}px "Arial Narrow", Arial, sans-serif`;
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
  drawLogo(g, opts.championship ? LEAGUE.logo : home.logo, px(0), pz(0), 4.2 * S);
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
