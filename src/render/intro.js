// Pregame intro (render-only), skippable with A: a broadcast open before the kickoff.
//   1. a high sweep around the lit stadium
//   2. the run-out: the teams come out of their tunnels at the end lines and jog to their sidelines (low camera)
//   3. the home head coach on his sideline (close-up, name on the lower third)
//   4. the crowd: a low shot up into the stands
//   5. a crane down behind the kicking team that hands off to the game camera
export const INTRO_T = 13;
export const SHOTS = [
  { until: 3.0, caption: null },
  { until: 6.4, caption: 'runout' },
  { until: 8.6, caption: 'coach' },
  { until: 10.4, caption: 'crowd' },
  { until: INTRO_T, caption: 'kickoff' },
];
export const shotAt = (t) => SHOTS.findIndex((s) => t < s.until);

const ease = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;

/** Camera at intro time t (seconds). kickX/dir: where the kickoff is and which way it goes; coach = {x, z} on the sideline. */
export function introShot(t, kickX = 0, dir = 1, coach = null) {
  if (t < 3.0) {
    const k = ease(t / 3.0);
    const a = lerp(-2.2, -0.9, k);
    return { pos: [Math.cos(a) * 100, lerp(52, 34, k), Math.sin(a) * 70], look: [0, 0, 0] };
  }
  if (t < 6.4) {
    // Run-out: low behind the home team coming out of the tunnel at the -x end, tracking them up the field.
    const k = ease((t - 3.0) / 3.4);
    return { pos: [lerp(-63, -46, k), lerp(2.2, 3.4, k), lerp(-6, -12, k)], look: [lerp(-48, -22, k), 1.2, lerp(-4, -14, k)] };
  }
  if (t < 8.6) {
    // The head coach: a slow push-in from the field side.
    const k = ease((t - 6.4) / 2.2);
    const cx = coach?.x ?? 0, cz = coach?.z ?? -30;
    const s = Math.sign(cz) || -1;
    return { pos: [cx + lerp(4, 2.2, k), 1.9, cz - s * lerp(6, 3.6, k)], look: [cx, 1.6, cz] };
  }
  if (t < 10.4) {
    // The crowd: low on the far sideline, panning along the stands.
    const k = ease((t - 8.6) / 1.8);
    return { pos: [lerp(-20, 12, k), 1.6, 24], look: [lerp(-14, 18, k), 12, 60] };
  }
  const k = ease(Math.min(1, (t - 10.4) / (INTRO_T - 10.4)));
  return { pos: [lerp(kickX + dir * 10, kickX - dir * 15, k), lerp(34, 7.2, k), lerp(-30, 0, k)], look: [kickX + dir * lerp(25, 8, k), 0.5, 0] };
}
