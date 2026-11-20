import { describe, it, expect } from 'vitest';
import { ControllerState } from '../src/input/actions.js';
import { setKeymap, keymap, DEFAULT_KEYMAP } from '../src/input/keyboard.js';

describe('button mapping', () => {
  it('a swapped A / B: pressing the physical B is the game\'s A', () => {
    const c = new ControllerState();
    c.remap = { A: 'B', B: 'A' };
    c.update({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: { B: true } }, 1 / 60);
    expect(c.frame.pressed.A).toBe(true);
    expect(c.frame.pressed.B).toBe(false);
  });
  it('keyboard bindings replace the defaults and reset back', () => {
    setKeymap({ KeyZ: 'A' });
    expect(keymap()).toEqual({ KeyZ: 'A' });
    setKeymap(null);
    expect(keymap()).toEqual(DEFAULT_KEYMAP);
  });
});
