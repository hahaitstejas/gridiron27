import { getOffFormation, getDefFormation } from '../data/playbook.js';
import { ROUTES } from '../data/routes.js';
import { ZONES } from '../ai/zones.js';

// Draws play diagrams for the play-call screen from the JSON playbook data.
const OL = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
const cache = new Map();

function setup(w, h, dark = false) {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const sy = h / 34;
  const losY = h * 0.72;
  if (dark) {
    // Play-call style: dark field, faint yard lines with sideways numbers, gold line of scrimmage.
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#15191f'); grd.addColorStop(1, '#0b0e12');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 1;
    for (let d = -10; d <= 30; d += 5) { const y = losY - d * sy; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.font = `800 ${Math.round(sy * 3.2)}px "Saira Condensed", sans-serif`;
    g.textAlign = 'center';
    for (const [d, n] of [[10, '30'], [20, '20']]) {
      for (const x of [w * 0.12, w * 0.88]) { g.save(); g.translate(x, losY - d * sy); g.rotate(x < w / 2 ? Math.PI / 2 : -Math.PI / 2); g.fillText(n, 0, sy * 1.1); g.restore(); }
    }
    g.strokeStyle = 'rgba(255,214,80,0.75)';
  } else {
    // Turf with yard lines.
    g.fillStyle = '#1f5a2a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    for (let d = -10; d <= 30; d += 5) { const y = losY - d * sy; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = 'rgba(80,150,255,0.85)';
  }
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, losY); g.lineTo(w, losY); g.stroke();
  const sx = w / 50;
  return { c, g, P: (down, lat) => [w / 2 + lat * sx, losY - down * sy], sx, sy, w, h };
}

function arrow(g, pts, color, dashed = false, head = true) {
  if (pts.length < 2) return;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 2;
  g.setLineDash(dashed ? [4, 3] : []);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.stroke();
  g.setLineDash([]);
  if (!head) return;
  const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  g.beginPath();
  g.moveTo(b[0], b[1]);
  g.lineTo(b[0] - Math.cos(ang - 0.5) * 7, b[1] - Math.sin(ang - 0.5) * 7);
  g.lineTo(b[0] - Math.cos(ang + 0.5) * 7, b[1] - Math.sin(ang + 0.5) * 7);
  g.closePath();
  g.fill();
}

function tBlock(g, x, y, up = true) {
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 2;
  const d = up ? -1 : 1;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + d * 7); g.moveTo(x - 4, y + d * 7); g.lineTo(x + 4, y + d * 7); g.stroke();
}

const ROUTE_COLORS = ['#ffd84d', '#ff6b6b', '#5ec8ff', '#9cff6b', '#ff9df5'];

/** Offensive play (or formation when routes are missing) diagram. Returns a canvas. */
export function offenseArt(play, w = 210, h = 120, dark = false) {
  const key = `o:${play.id || play.formation}:${play.rev || 0}:${w}x${h}:${dark}`;
  if (cache.has(key)) return cloneCanvas(cache.get(key));
  const f = getOffFormation(play.formation);
  const { c, g, P } = setup(w, h, dark);
  const routes = play.routes || {};
  let ci = 0;
  for (const p of f.players) {
    const [x, y] = P(p.at[0], p.at[1]);
    const a = routes[p.s];
    if (play.run && play.run.carrier === p.s) {
      const mesh = play.run.mesh ? P(play.run.mesh[0], play.run.mesh[1]) : [x, y];
      const aim = P(play.run.aim[0], play.run.aim[1]);
      const beyond = P(play.run.aim[0] + 6, play.run.aim[1] + (play.run.aim[1] > 0 ? 1 : -1) * 1.5);
      arrow(g, [[x, y], mesh, aim, beyond], '#ff4d4d', play.run.style === 'pitch');
    } else if (a && ROUTES[a.replace(/_(l|r)$/, '')]) {
      const tpl = ROUTES[a.replace(/_(l|r)$/, '')];
      const side = a.endsWith('_l') ? -1 : a.endsWith('_r') ? 1 : Math.abs(p.at[1]) < 0.5 ? 1 : Math.sign(p.at[1]);
      const pts = [[x, y], ...tpl.pts.map(([d, o]) => P(p.at[0] + d, p.at[1] + o * side))];
      if (tpl.end === 'continue' && tpl.pts.length) {
        const [d1, o1] = tpl.pts.length > 1 ? tpl.pts[tpl.pts.length - 2] : [0, 0];
        const [d2, o2] = tpl.pts[tpl.pts.length - 1];
        const L = Math.hypot(d2 - d1, o2 - o1) || 1;
        pts.push(P(p.at[0] + d2 + ((d2 - d1) / L) * 5, p.at[1] + (o2 + ((o2 - o1) / L) * 5) * side));
      }
      arrow(g, pts, ROUTE_COLORS[ci++ % ROUTE_COLORS.length]);
    } else if (!OL.has(p.s) && p.s !== 'QB' && play.routes) {
      tBlock(g, x, y);
    } else if (OL.has(p.s) && play.type) tBlock(g, x, y);
  }
  if (play.run && play.run.carrier === 'QB') { const q = f.players.find((p) => p.s === 'QB'); const [x, y] = P(q.at[0], q.at[1]); arrow(g, [[x, y], P(play.run.aim[0] + 3, play.run.aim[1])], '#ff4d4d'); }
  // Players on top.
  for (const p of f.players) {
    const [x, y] = P(p.at[0], p.at[1]);
    g.fillStyle = OL.has(p.s) ? '#d8dde6' : p.s === 'QB' ? '#ffffff' : '#ffffff';
    g.strokeStyle = '#0b1530';
    g.lineWidth = 1.5;
    g.beginPath();
    if (OL.has(p.s)) g.rect(x - 4, y - 4, 8, 8); else g.arc(x, y, 4.5, 0, Math.PI * 2);
    g.fill(); g.stroke();
  }
  cache.set(key, c);
  return cloneCanvas(c);
}

/** Defensive play diagram: zones, man assignments, rushers and blitzers. */
export function defenseArt(play, w = 210, h = 120, dark = false) {
  const key = `d:${play.id || play.formation}:${w}x${h}:${dark}`;
  if (cache.has(key)) return cloneCanvas(cache.get(key));
  const f = getDefFormation(play.formation);
  const { c, g, P, sx, sy } = setup(w, h, dark);
  const assign = play.assign || {};
  for (const p of f.players) {
    const [x, y] = P(p.at[0], p.at[1]);
    const a = assign[p.s] || '';
    if (a.startsWith('zone:')) {
      const z = ZONES[a.slice(5)];
      if (z) {
        const [zx, zy] = P(z.down, z.lat);
        g.fillStyle = z.deep ? 'rgba(70,140,255,0.35)' : 'rgba(255,215,60,0.35)';
        g.beginPath(); g.ellipse(zx, zy, z.r * sx * 0.8, z.r * sy * 0.45, 0, 0, Math.PI * 2); g.fill();
        arrow(g, [[x, y], [zx, zy]], 'rgba(255,255,255,0.55)', true, false);
      }
    } else if (a === 'rush' || a === 'blitz') {
      arrow(g, [[x, y], P(Math.min(-3, p.at[0] - 5), p.at[1] * 0.5)], a === 'blitz' ? '#ff3b3b' : '#ff9b9b');
    } else if (a.startsWith('man:')) {
      const rule = a.slice(4);
      const lat = { L1: -18, L2: -9, L3: -5, R1: 18, R2: 9, R3: 5, RB: -1.5, TE: 3.9 }[rule] ?? 0;
      const down = rule === 'RB' ? -5 : -0.8;
      arrow(g, [[x, y], P(down + 2, lat)], '#c08cff', true);
    } else if (a === 'spy') {
      arrow(g, [[x, y], P(2, 0)], '#ff9df5', true);
    }
  }
  for (const p of f.players) {
    const [x, y] = P(p.at[0], p.at[1]);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke();
  }
  cache.set(key, c);
  return cloneCanvas(c);
}

/** Special teams icon art (no diagram data needed). */
export function specialArt(label, w = 210, h = 120, dark = false) {
  const { c, g } = setup(w, h, dark);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = '700 24px "Saira Condensed", sans-serif';
  g.textAlign = 'center';
  g.fillText(label, w / 2, h / 2 + 8);
  return c;
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.style.width = src.style.width; c.style.height = src.style.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
