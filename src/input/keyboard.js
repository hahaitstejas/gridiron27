// Keyboard fallback for testing without a controller. See KEY_HELP for the layout.
const KEYMAP = {
  KeyJ: 'A', Space: 'A', KeyK: 'B', KeyU: 'X', KeyI: 'Y', KeyO: 'RB', KeyQ: 'LB',
  ShiftLeft: 'RT', ShiftRight: 'RT', KeyE: 'LT', KeyT: 'View', Enter: 'Menu', Escape: 'Menu', KeyR: 'RS', KeyF: 'LS',
  Digit1: 'Up', Digit2: 'Down', Digit3: 'Left', Digit4: 'Right',
};

export const KEY_HELP = [
  ['Move (left stick)', 'W A S D'],
  ['Right stick (juke / truck / hit stick)', 'Arrow keys'],
  ['A', 'J or Space'], ['B', 'K'], ['X', 'U'], ['Y', 'I'], ['RB', 'O'], ['LB', 'Q'],
  ['RT (sprint)', 'Shift'], ['LT', 'E'], ['View (timeout)', 'T'], ['Menu', 'Enter / Esc'], ['RS click (throw away)', 'R'],
];

export class Keyboard {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set(); // keys pressed since the last read, so very short taps still register
    this.any = false;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      this.any = true;
      if (KEYMAP[e.code] || e.code.startsWith('Arrow') || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  read() {
    const k = new Set([...this.keys, ...this.tapped]);
    this.tapped.clear();
    const ax = (neg, pos) => (k.has(pos) ? 1 : 0) - (k.has(neg) ? 1 : 0);
    let lx = ax('KeyA', 'KeyD'), ly = ax('KeyW', 'KeyS');
    const m = Math.hypot(lx, ly);
    if (m > 1) { lx /= m; ly /= m; }
    const buttons = {};
    for (const [code, b] of Object.entries(KEYMAP)) if (k.has(code)) buttons[b] = true;
    return {
      lx, ly,
      rx: ax('ArrowLeft', 'ArrowRight'), ry: ax('ArrowUp', 'ArrowDown'),
      lt: buttons.LT ? 1 : 0, rt: buttons.RT ? 1 : 0,
      buttons,
    };
  }
}
