// Unified controller state used by the game. Both the Xbox pad and the keyboard feed this.
export const BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right'];
/** The controller buttons that can be swapped in Settings → Button Mapping (triggers stay analog, menus stay standard). */
export const REMAPPABLE = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LS', 'RS'];

export function emptyFrame() {
  const f = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, down: {}, pressed: {}, released: {}, held: {}, flick: { left: false, right: false, up: false, down: false } };
  for (const b of BUTTONS) { f.down[b] = false; f.pressed[b] = false; f.released[b] = false; f.held[b] = 0; }
  return f;
}

/**
 * Tracks edges (pressed/released this frame) and latches them until the simulation consumes
 * them, so a quick tap is never lost even if no sim step runs during that render frame.
 */
export class ControllerState {
  constructor() {
    this.frame = emptyFrame();
    this.prevRs = { x: 0, y: 0 };
  }
  update(raw, dt) {
    const f = this.frame;
    // Button remapping (Settings → Button Mapping): `remap` = { logical: physical } for the action buttons, applied in games
    // only (the session sets it; menus keep the standard layout so nobody can lock themselves out).
    if (this.remap) {
      const src = raw.buttons, out = { ...src };
      for (const [logical, physical] of Object.entries(this.remap)) out[logical] = !!src[physical];
      raw = { ...raw, buttons: out };
    }
    f.lx = raw.lx; f.ly = raw.ly; f.rx = raw.rx; f.ry = raw.ry; f.lt = raw.lt; f.rt = raw.rt;
    for (const b of BUTTONS) {
      const now = !!raw.buttons[b];
      if (now && !f.down[b]) f.pressed[b] = true;
      if (!now && f.down[b]) f.released[b] = true;
      f.down[b] = now;
      f.held[b] = now ? f.held[b] + dt : 0;
    }
    // Right-stick flicks (jukes, truck, hit stick, rush moves).
    const T = 0.65, R = 0.35;
    const was = this.prevRs;
    if (raw.rx > T && was.x <= R) f.flick.right = true;
    if (raw.rx < -T && was.x >= -R) f.flick.left = true;
    if (raw.ry < -T && was.y >= -R) f.flick.up = true;
    if (raw.ry > T && was.y <= R) f.flick.down = true;
    this.prevRs = { x: raw.rx, y: raw.ry };
  }
  consumeEdges() {
    const f = this.frame;
    for (const b of BUTTONS) { f.pressed[b] = false; f.released[b] = false; }
    f.flick.left = f.flick.right = f.flick.up = f.flick.down = false;
  }
}
