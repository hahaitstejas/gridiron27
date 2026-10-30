// Procedural team logos drawn on a 2D canvas (used on the field, in menus and the score bug).
export const LOGO_SHAPES = ['circle', 'shield', 'diamond', 'hex', 'star', 'triangle'];

function shapePath(ctx, shape, cx, cy, r) {
  ctx.beginPath();
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
  shapePath(ctx, logo.shape, cx, cy, r);
  ctx.fillStyle = logo.border;
  ctx.fill();
  shapePath(ctx, logo.shape, cx, cy, r * 0.86);
  ctx.fillStyle = logo.bg;
  ctx.fill();
  const text = logo.text || '';
  const size = r * (text.length <= 2 ? 0.9 : text.length === 3 ? 0.68 : 0.5) * (logo.shape === 'star' ? 0.7 : 1);
  ctx.font = `800 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`;
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

export function logoCanvas(logo, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawLogo(c.getContext('2d'), logo, size / 2, size / 2, size * 0.46);
  return c;
}

export function logoDataURL(logo, size = 128) {
  return logoCanvas(logo, size).toDataURL();
}
