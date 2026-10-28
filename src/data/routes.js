// Route templates. Each point is [downfield, outside] in yards relative to the receiver's
// alignment. "outside" is toward the sideline on the receiver's side of the ball (negative = inside).
// end: 'continue' keeps running along the last segment, 'settle' sits down and works open.
export const ROUTES = {
  go: { pts: [[2, 0.5], [45, 1.5]], end: 'continue' },
  fade: { pts: [[2, 1.5], [45, 5]], end: 'continue' },
  seam: { pts: [[2, -0.5], [45, -1]], end: 'continue' },
  slant: { pts: [[2.5, 0], [8, -6]], end: 'continue' },
  quick_out: { pts: [[5, 0], [5.5, 8]], end: 'continue' },
  out: { pts: [[10, 0], [10, 10]], end: 'continue' },
  deep_out: { pts: [[15, 0], [14, 10]], end: 'continue' },
  in: { pts: [[12, 0], [12, -14]], end: 'continue' },
  dig: { pts: [[14, 0], [14, -16]], end: 'continue' },
  drag: { pts: [[1.5, -1], [3, -6], [4, -26]], end: 'continue' },
  shallow: { pts: [[2, -1], [5, -8], [6, -24]], end: 'continue' },
  cross: { pts: [[6, -2], [14, -24]], end: 'continue' },
  curl: { pts: [[12, 0], [10.5, -1.5]], end: 'settle' },
  hitch: { pts: [[6, 0], [5, 0]], end: 'settle' },
  stick: { pts: [[6, 0], [6, -1]], end: 'settle' },
  comeback: { pts: [[16, 0], [13, 3]], end: 'settle' },
  post: { pts: [[12, 0], [30, -12]], end: 'continue' },
  skinny_post: { pts: [[10, 0], [30, -5]], end: 'continue' },
  corner: { pts: [[12, 0], [26, 11]], end: 'continue' },
  flat: { pts: [[1, 2], [3, 10]], end: 'continue' },
  arrow: { pts: [[2, 2], [5, 10]], end: 'continue' },
  swing: { pts: [[-1, 3], [0, 9]], end: 'continue' },
  wheel: { pts: [[0, 5], [4, 9], [40, 10]], end: 'continue' },
  angle: { pts: [[2, 3], [6, -3]], end: 'continue' },
  sit: { pts: [[5, 0]], end: 'settle' },
  whip: { pts: [[5, -2], [5, 5]], end: 'continue' },
  zig: { pts: [[6, -4], [6, 6]], end: 'continue' },
  out_up: { pts: [[6, 0], [6, 4], [40, 5]], end: 'continue' },
  screen: { pts: [[-1.5, 2], [-1.5, 4]], end: 'settle' },
};

// Non-route assignments for skill players.
export const NON_ROUTES = new Set(['block', 'stalk', 'run', 'fake']);

export function isRoute(name) {
  return !!ROUTES[(name || '').replace(/_(l|r)$/, '')];
}
