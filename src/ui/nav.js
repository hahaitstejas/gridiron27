// Controller/keyboard/mouse navigation for menus. Items are DOM elements laid out in a grid of
// `columns` columns. Left/right on an item with a `spin(dir)` handler changes its value instead of
// moving focus (used for team pickers, difficulty, quarter length...).
export class Nav {
  constructor() {
    this.items = [];
    this.index = 0;
    this.columns = 1;
    this.held = null;
    this.repeatT = 0;
    this.onBack = null;
    this.onTab = null;
  }

  set(items, { columns = 1, onBack = null, onTab = null, index = 0 } = {}) {
    this.items = items.filter(Boolean);
    this.columns = columns;
    this.onBack = onBack;
    this.onTab = onTab;
    for (const [i, el] of this.items.entries()) {
      el.classList.add('nav-item');
      el.onmouseenter = () => this.focus(i);
      el.onclick = (e) => { e.stopPropagation(); this.focus(i); this.activate(); };
    }
    this.focus(Math.min(index, this.items.length - 1));
  }

  clear() { this.items = []; this.onBack = null; this.onTab = null; }

  focus(i) {
    if (!this.items.length) return;
    this.index = Math.max(0, Math.min(this.items.length - 1, i));
    for (const [j, el] of this.items.entries()) el.classList.toggle('focused', j === this.index);
    const el = this.items[this.index];
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    el.onfocusitem?.();
  }

  get current() { return this.items[this.index]; }

  activate() { this.current?.activate?.(); }

  move(dx, dy) {
    const el = this.current;
    if (dx && el?.spin) { el.spin(dx); return; }
    const c = this.columns;
    let i = this.index;
    if (dx) i += dx;
    if (dy) i += dy * c;
    if (i < 0 || i >= this.items.length) {
      if (dy && c > 1) i = Math.max(0, Math.min(this.items.length - 1, i));
      else return;
    }
    // Don't wrap across rows when moving horizontally in a grid.
    if (dx && c > 1 && Math.floor(i / c) !== Math.floor(this.index / c)) return;
    this.focus(i);
  }

  /** Call once per animation frame with the input frame. Returns true if input was consumed. */
  update(f, dt) {
    if (!this.items.length && !this.onBack) return false;
    let dir = null;
    if (f.down.Up || f.ly < -0.6) dir = 'up';
    else if (f.down.Down || f.ly > 0.6) dir = 'down';
    else if (f.down.Left || f.lx < -0.6) dir = 'left';
    else if (f.down.Right || f.lx > 0.6) dir = 'right';
    if (dir !== this.held) { this.held = dir; this.repeatT = 0.38; if (dir) this.step(dir); }
    else if (dir) { this.repeatT -= dt; if (this.repeatT <= 0) { this.repeatT = 0.11; this.step(dir); } }
    if (f.pressed.A) { this.activate(); return true; }
    if (f.pressed.B && this.onBack) { this.onBack(); return true; }
    if (this.onTab && (f.pressed.LB || f.pressed.RB)) { this.onTab(f.pressed.LB ? -1 : 1); return true; }
    return !!dir;
  }

  step(dir) {
    if (dir === 'up') this.move(0, -1);
    else if (dir === 'down') this.move(0, 1);
    else if (dir === 'left') this.move(-1, 0);
    else this.move(1, 0);
  }
}

/** Small DOM helper: el('div.cls#id', {attrs}, children...) */
export function el(spec, attrs = {}, ...kids) {
  const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const node = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1)); else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}
