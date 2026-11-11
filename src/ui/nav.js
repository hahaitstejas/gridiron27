// Controller/keyboard/mouse navigation for menus. Items are DOM elements laid out in a grid of
// `columns` columns. Left/right on an item with a `spin(dir)` handler changes its value instead of
// moving focus (used for team pickers, difficulty, quarter length...).
export class Nav {
  constructor() {
    if (typeof window !== 'undefined' && !Nav.tracking) {
      Nav.tracking = true;
      window.addEventListener('mousemove', (e) => { Nav.mouse = { x: e.clientX, y: e.clientY }; });
    }
    this.items = [];
    this.index = 0;
    this.columns = 1;
    this.held = null;
    this.repeatT = 0;
    this.onBack = null;
    this.onTab = null;
  }

  set(items, { columns = 1, onBack = null, onTab = null, index = 0, spatial = false } = {}) {
    this.items = items.filter(Boolean);
    // Coming back to a list you left with A (edit a player, then back out) puts you on the row you picked, not
    // at the top. Lists are told apart by their screen and title; the row by its text (else its old index).
    // A caller that asks for a specific row (index > 0) still gets it.
    this.key = this.listKey();
    const mem = Nav.memory.get(this.key);
    if (mem && !index) {
      const j = this.items.findIndex((el) => el.textContent === mem.text);
      index = j >= 0 ? j : mem.index;
    }
    this.columns = columns;
    // List menus are laid out as tile grids now (style.css): move by what's on screen.
    if (!spatial && this.items[0]?.closest?.('.menu-screen .menu-list')) spatial = true;
    this.spatial = spatial; // free layouts (tile grids): move to the nearest item in the stick's direction
    this.onBack = onBack;
    this.onTab = onTab;
    for (const [i, el] of this.items.entries()) {
      el.classList.add('nav-item');
      // Only a mouse that actually moved takes focus: when the stick scrolls a list, rows slide under a resting
      // pointer and the browser fires hover events, which used to yank focus back up the list.
      el.onmouseenter = null;
      el.onmousemove = (e) => {
        if (e.clientX === Nav.mouse.x && e.clientY === Nav.mouse.y) return; // same spot as the last event: content moved, not the mouse
        if (this.items[this.index] !== el) this.focus(i);
      };
      el.onclick = (e) => { e.stopPropagation(); this.focus(i); this.activate(); };
    }
    this.focus(Math.min(index, this.items.length - 1));
  }

  clear() { this.items = []; this.onBack = null; this.onTab = null; }

  // Pointer position of the previous mousemove anywhere (a window listener updates it after the item handlers run).
  static mouse = { x: -1, y: -1 };

  focus(i) {
    if (!this.items.length) return;
    this.index = Math.max(0, Math.min(this.items.length - 1, i));
    for (const [j, el] of this.items.entries()) el.classList.toggle('focused', j === this.index);
    const el = this.items[this.index];
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    el.onfocusitem?.();
    this.onFocus?.(el); // screen-wide hook (Screens: the settings description panel)
  }

  get current() { return this.items[this.index]; }

  activate() {
    const el = this.current;
    if (el && this.key) Nav.memory.set(this.key, { index: this.index, text: el.textContent });
    el?.activate?.();
  }

  listKey() {
    const scr = this.items[0]?.closest?.('.screen');
    if (!scr) return null;
    return `${scr.className.replace(/\s*(hidden|focused)\b/g, '')}|${scr.querySelector('h1,h2')?.textContent || ''}|${this.items.length}`;
  }

  // Last row picked in each list (see set()).
  static memory = new Map();

  move(dx, dy) {
    const el = this.current;
    if (dx && el?.spin) { el.spin(dx); return; }
    // An item can name where a direction goes (navTo: { left: el }), e.g. a card back to its own mode on a rail.
    const to = el?.navTo?.[dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down'];
    if (to && this.items.includes(to)) { this.focus(this.items.indexOf(to)); return; }
    if (this.spatial) { this.moveSpatial(dx, dy); return; }
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

  moveSpatial(dx, dy) {
    // Layout boxes (offsetLeft/Top), not getBoundingClientRect: slanted or scaled tiles overlap on screen.
    // Offsets summed up the offsetParent chain, so items in different positioned panels share one frame.
    const box = (el) => {
      let l = 0, t = 0;
      for (let n = el; n; n = n.offsetParent) { l += n.offsetLeft - (n !== el ? n.scrollLeft : 0); t += n.offsetTop - (n !== el ? n.scrollTop : 0); }
      return { l, t, r: l + el.offsetWidth, b: t + el.offsetHeight };
    };
    const r0 = box(this.current);
    const cx = (r0.l + r0.r) / 2, cy = (r0.t + r0.b) / 2;
    let best = -1, bestS = Infinity;
    for (const [i, el] of this.items.entries()) {
      if (i === this.index) continue;
      const r = box(el);
      // Gap along the direction (must be ahead of me), plus how far off my row / column it is.
      const along = dx ? (dx > 0 ? r.l - r0.r : r0.l - r.r) : (dy > 0 ? r.t - r0.b : r0.t - r.b);
      if (along < -8) continue;
      const off = dx ? Math.max(0, r.t - r0.b, r0.t - r.b) + Math.abs((r.t + r.b) / 2 - cy) * 0.1
        : Math.max(0, r.l - r0.r, r0.l - r.r) + Math.abs((r.l + r.r) / 2 - cx) * 0.1;
      const s = Math.max(0, along) + off * 3;
      if (s < bestS) { bestS = s; best = i; }
    }
    if (best >= 0) this.focus(best);
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
    if (f.pressed.B && this.onBack) { Nav.memory.delete(this.key); this.onBack(); return true; } // backing out of a list: next visit starts fresh
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
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv; } } // custom properties need setProperty
    else if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}
