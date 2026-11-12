// Procedural team logos drawn on a 2D canvas (used on the field, in menus and the score bug, and as uniform patches).
import { cssFont } from '../data/design.js';
export const LOGO_SHAPES = ['circle', 'shield', 'diamond', 'hex', 'star', 'triangle'];

function shapePath(ctx, shape, cx, cy, r, box = null) {
  ctx.beginPath();
  if (box === 'square') { ctx.rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8); return; }
  if (box === 'rounded') { const k = r * 0.9, rr = r * 0.4; ctx.moveTo(cx - k + rr, cy - k); ctx.arcTo(cx + k, cy - k, cx + k, cy + k, rr); ctx.arcTo(cx + k, cy + k, cx - k, cy + k, rr); ctx.arcTo(cx - k, cy + k, cx - k, cy - k, rr); ctx.arcTo(cx - k, cy - k, cx + k, cy - k, rr); ctx.closePath(); return; }
  switch (shape) {
    case 'shield':
      ctx.moveTo(cx - r * 0.85, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.85, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.85, cy + r * 0.05);
      ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.7, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.7, cx - r * 0.85, cy + r * 0.05);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.5 : r;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.95, cy + r * 0.75); ctx.lineTo(cx - r * 0.95, cy + r * 0.75); ctx.closePath();
      break;
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}

/** Draw a logo centered at (cx, cy) with radius r. */
export function drawLogo(ctx, logo, cx, cy, r) {
  // A custom image (from public/local/logos, see teams.csv) replaces the generated logo.
  if (logo._img) {
    const img = logo._img, k = Math.min((2 * r) / img.width, (2 * r) / img.height);
    ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
    return;
  }
  ctx.save();
  shapePath(ctx, logo.shape, cx, cy, r, logo.box);
  ctx.fillStyle = logo.border;
  ctx.fill();
  shapePath(ctx, logo.shape, cx, cy, r * 0.86, logo.box);
  ctx.fillStyle = logo.bg;
  ctx.fill();
  const text = logo.text || '';
  const size = r * (text.length <= 2 ? 0.9 : text.length === 3 ? 0.68 : 0.5) * (logo.shape === 'star' ? 0.7 : 1);
  ctx.font = logo.font ? cssFont(logo.font, size) : `800 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`; // logo.font: an id from data/design.js (patches)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * 0.12;
  ctx.strokeStyle = logo.border;
  const ty = cy + (logo.shape === 'triangle' ? r * 0.2 : logo.shape === 'shield' ? -r * 0.05 : 0);
  ctx.strokeText(text, cx, ty);
  ctx.fillStyle = logo.fg;
  ctx.fillText(text, cx, ty);
  ctx.restore();
}

export function logoCanvas(logo, size = 128, gloss = true) {
  const c = document.createElement('canvas');
  // Draw at 2x for crisp edges, then the gloss pass.
  const k = 2;
  c.width = c.height = size * k;
  c.style.width = c.style.height = `${size}px`;
  const g = c.getContext('2d');
  g.scale(k, k);
  if (gloss) {
    // A soft drop shadow lifts it off the page.
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = size * 0.06; g.shadowOffsetY = size * 0.03;
  }
  drawLogo(g, logo, size / 2, size / 2, size * 0.44);
  if (gloss) glossOver(g, size);
  return c;
}

/**
 * Make a flat logo look like a glossy 3D badge: a light sweep over the top half and a darker rim at the bottom,
 * applied only where the logo has paint (source-atop), so it follows any shape or uploaded image.
 */
function glossOver(g, size) {
  g.save();
  g.shadowColor = 'transparent';
  g.globalCompositeOperation = 'source-atop';
  const top = g.createLinearGradient(0, 0, 0, size);
  top.addColorStop(0, 'rgba(255,255,255,0.42)');
  top.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  top.addColorStop(0.5, 'rgba(255,255,255,0)');
  top.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = top;
  g.fillRect(0, 0, size, size);
  // A specular arc across the upper third.
  const spec = g.createRadialGradient(size * 0.38, size * 0.2, 0, size * 0.38, size * 0.2, size * 0.42);
  spec.addColorStop(0, 'rgba(255,255,255,0.35)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.fillRect(0, 0, size, size);
  g.restore();
}

export function logoDataURL(logo, size = 128, gloss = true) {
  return logoCanvas(logo, size, gloss).toDataURL();
}
