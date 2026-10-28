// Xbox controller via the Gamepad API ("standard" mapping, as exposed by Chrome and Safari on macOS
// for Xbox Wireless controllers over Bluetooth).
const MAP = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right'];
const DEAD = 0.18;

function dead(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * ((a - DEAD) / (1 - DEAD));
}

export function readGamepad(index) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads[index];
  if (!gp || !gp.connected) return null;
  const buttons = {};
  MAP.forEach((name, i) => { buttons[name] = gp.buttons[i] ? gp.buttons[i].pressed || gp.buttons[i].value > 0.5 : false; });
  // Radial dead zone for the sticks.
  const stick = (x, y) => {
    const m = Math.hypot(x, y);
    if (m < DEAD) return [0, 0];
    const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
    return [x * k, y * k];
  };
  const [lx, ly] = stick(gp.axes[0] || 0, gp.axes[1] || 0);
  const [rx, ry] = stick(gp.axes[2] || 0, gp.axes[3] || 0);
  return {
    lx, ly, rx, ry,
    lt: gp.buttons[6] ? gp.buttons[6].value : 0,
    rt: gp.buttons[7] ? gp.buttons[7].value : 0,
    buttons,
    id: gp.id,
  };
}

/** Index of any connected pad whose A button is down (used for "Press A to connect"). */
export function findPadPressingA() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) if (gp && gp.connected && gp.buttons[0] && gp.buttons[0].pressed) return gp.index;
  return -1;
}

export function rumble(index, strength = 0.5, ms = 120) {
  const gp = navigator.getGamepads?.()[index];
  const act = gp?.vibrationActuator;
  if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
}

export { dead };
