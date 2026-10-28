import { ControllerState } from './actions.js';
import { readGamepad, findPadPressingA, rumble } from './gamepad.js';
import { Keyboard } from './keyboard.js';

/**
 * Input manager for player 1. Starts unassigned; the first gamepad to press A claims the slot
 * (browsers only expose pads after a button press). The keyboard always works as a fallback.
 */
export class InputManager {
  constructor() {
    this.keyboard = new Keyboard();
    this.padIndex = -1;
    this.padId = '';
    this.state = new ControllerState();
    this.onConnect = null;
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.padIndex) { this.padIndex = -1; this.onDisconnect?.(); }
    });
  }
  get connected() { return this.padIndex >= 0; }
  poll(dt) {
    if (this.padIndex < 0) {
      const i = findPadPressingA();
      if (i >= 0) {
        this.padIndex = i;
        this.padId = navigator.getGamepads()[i].id;
        this.swallowA = true; // the connecting press shouldn't also act in-game
        this.onConnect?.(this.padId);
      }
    }
    const kb = this.keyboard.read();
    const gp = this.padIndex >= 0 ? readGamepad(this.padIndex) : null;
    let raw = kb;
    if (gp) {
      raw = {
        lx: Math.abs(gp.lx) > Math.abs(kb.lx) ? gp.lx : kb.lx,
        ly: Math.abs(gp.ly) > Math.abs(kb.ly) ? gp.ly : kb.ly,
        rx: Math.abs(gp.rx) > Math.abs(kb.rx) ? gp.rx : kb.rx,
        ry: Math.abs(gp.ry) > Math.abs(kb.ry) ? gp.ry : kb.ry,
        lt: Math.max(gp.lt, kb.lt), rt: Math.max(gp.rt, kb.rt),
        buttons: { ...kb.buttons },
      };
      for (const [b, v] of Object.entries(gp.buttons)) if (v) raw.buttons[b] = true;
      if (this.swallowA) { if (!gp.buttons.A) this.swallowA = false; else raw.buttons.A = false; }
    }
    this.state.update(raw, dt);
  }
  get frame() { return this.state.frame; }
  consume() { this.state.consumeEdges(); }
  rumble(strength, ms) { if (this.padIndex >= 0) rumble(this.padIndex, strength, ms); }
}
