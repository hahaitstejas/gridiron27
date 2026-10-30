// Close calls, coach's challenges and booth reviews (pure logic). The sim always knows the truth; on a close call
// the officials' ruling on the field can be wrong, and a review (a challenge, or the booth inside two minutes, in
// overtime and on scoring plays) gets it right. `closeCall()` builds the ruling; the session decides who reviews.
import { HALF_WIDTH, GOAL_X } from '../core/constants.js';

export const CHALLENGES = 2;
export const REVIEW_T = 3.2; // seconds "under review"
export const CHALLENGE_T = 3.5; // the window to throw the flag
const MISS = { sideline: 0.3, spot: 0.5, goal: 0.3 }; // how often the ruling on the field is wrong on a close call

/**
 * A reviewable close call in this play's result, or null. Returns { kind, truth, call, wrong, hurt, text } where
 * `call` is the ruling on the field (a copy of the result, or the result itself when right) and `hurt` the team the
 * ruling went against.
 */
export function closeCall(r, sim, rng) {
  if (!r || sim.isKick || r.reason === 'fg' || r.interception || r.fumble || r.safety) return null;
  const off = r.offTeam, td = r.dir;
  // Sideline catch: feet in or out?
  const cz = sim.stats.catchZ;
  if (r.complete && cz !== null && cz !== undefined && Math.abs(cz) > HALF_WIDTH - 0.7) {
    const wrong = rng.next() < MISS.sideline;
    const call = wrong ? incompleteVersion(r) : r;
    return { kind: 'sideline', truth: r, call, wrong, hurt: wrong ? off : 1 - off, text: wrong ? 'Pass ruled incomplete at the sideline' : 'Catch ruled complete at the sideline' };
  }
  // Short of the goal line.
  if (r.touchdown === null && r.carrierId !== undefined && !r.turnover && !r.outOfBounds) {
    const short = (GOAL_X - r.spotX * td);
    if (short > 0 && short < 0.5) {
      const wrong = rng.next() < MISS.goal;
      const call = wrong ? { ...r, touchdown: off, yards: (GOAL_X * td - r.losX) * td, spotX: GOAL_X * td, reason: 'td', ruledTD: true } : r;
      return { kind: 'goal', truth: r, call, wrong, hurt: wrong ? 1 - off : off, text: wrong ? 'Touchdown on the field — did the ball break the plane?' : 'Ruled down short of the goal line' };
    }
  }
  // Spot against the line to gain.
  const first = sim.firstDownX;
  if (first !== null && first !== undefined && r.touchdown === null && !r.turnover && !r.incomplete && r.carrierId !== undefined && Math.abs(first) < GOAL_X) {
    const gap = (r.spotX - first) * td; // + = past the line
    if (Math.abs(gap) < 0.4) {
      // The officials' spot is off by a few inches: the closer it is, the likelier it lands on the wrong side.
      const wrong = rng.next() < MISS.spot * (1 - Math.abs(gap) / 0.4);
      const callX = wrong ? first + td * (gap >= 0 ? -0.15 : 0.15) : r.spotX;
      const call = wrong ? { ...r, spotX: callX, yards: (callX - r.losX) * td } : r;
      const longOfIt = (callX - first) * td >= 0;
      return { kind: 'spot', truth: r, call, wrong, hurt: longOfIt ? 1 - off : off, text: longOfIt ? 'Spotted at the line to gain: first down' : 'Spotted just short of the line to gain' };
    }
  }
  return null;
}

/** The same play ruled incomplete (receiver out of bounds at the catch). */
function incompleteVersion(r) {
  return { ...r, reason: 'incomplete', complete: false, incomplete: true, receiver: null, catchX: null, spotX: r.losX, yards: 0,
    touchdown: null, carrierId: undefined, tackler: null, assist: null, outOfBounds: false, forwardProgress: false };
}

/** The booth reviews this one itself: inside two minutes of a half, overtime, or a touchdown on the field. */
export function boothReviews(m, cc) {
  return m.quarter >= 5 || (m.clock <= 120 && (m.quarter === 2 || m.quarter === 4)) || cc.call.touchdown !== null;
}

/** Can `team` challenge right now? (Challenges left, a timeout to risk, not a booth situation.) */
export function canChallenge(m, team) {
  m.challenges ||= [CHALLENGES, CHALLENGES];
  return m.challenges[team] > 0 && m.timeouts[team] > 0;
}

/** CPU coaches throw the flag on most bad calls against them and rarely on good ones. */
export function cpuChallenges(cc, rng) {
  return rng.next() < (cc.wrong ? 0.65 : 0.06);
}

/**
 * Settle a review. `by` = the challenging team (null for the booth). Returns { result, reversed, text } and charges a
 * failed challenge (a challenge and a timeout).
 */
export function settleReview(m, cc, by = null) {
  m.challenges ||= [CHALLENGES, CHALLENGES];
  const reversed = cc.wrong;
  if (by !== null) {
    if (!reversed) { m.challenges[by]--; m.timeouts[by] = Math.max(0, m.timeouts[by] - 1); }
  }
  const text = reversed
    ? `After review, the ruling on the field is reversed: ${reverseText(cc)}`
    : `After review, the ruling on the field stands${by !== null ? ` (${'challenge'} lost: timeout charged)` : ''}`;
  return { result: reversed ? cc.truth : cc.call, reversed, text };
}

function reverseText(cc) {
  if (cc.kind === 'sideline') return 'the receiver got both feet in. Complete.';
  if (cc.kind === 'goal') return 'he was down short of the goal line. No touchdown.';
  return (cc.truth.spotX - cc.call.spotX) * cc.truth.dir > 0 ? 'the ball reached the line to gain. First down.' : 'the ball was short of the line to gain.';
}
