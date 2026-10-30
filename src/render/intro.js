// Pregame intro (render-only): three camera shots before the opening kickoff.
//   1. a high sweep around the lit stadium, 2. a low dolly across midfield past the logo,
//   3. a crane down behind the kicking team that hands off to the game camera.
export const INTRO_T = 8.5;

const ease = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;

/** Camera at intro time t (seconds). kickX/dir: where the kickoff is and which way it goes. */
export function introShot(t, kickX = 0, dir = 1) {
  if (t < 3.2) {
    const k = ease(t / 3.2);
    const a = lerp(-2.2, -0.9, k);
    return { pos: [Math.cos(a) * 100, lerp(52, 34, k), Math.sin(a) * 70], look: [0, 0, 0] };
  }
  if (t < 6) {
    const k = ease((t - 3.2) / 2.8);
    return { pos: [lerp(-26, 22, k), lerp(2.6, 3.6, k), 24], look: [lerp(-8, 8, k), 0.5, 0] };
  }
  const k = ease(Math.min(1, (t - 6) / (INTRO_T - 6)));
  return { pos: [lerp(kickX + dir * 10, kickX - dir * 15, k), lerp(34, 7.2, k), lerp(-30, 0, k)], look: [kickX + dir * lerp(25, 8, k), 0.5, 0] };
}
