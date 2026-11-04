// Football decision math (pure logic): expected points for any down/distance/spot and a drive-level win-probability
// model for late in games. The CPU's 4th-down calls, accept/decline choices and the recommended pick on the
// penalty screen all come from here, so they follow what NFL studies say (EP from play-by-play data: ~0.9 for 1st
// & 10 at your 25, ~4 at the opponent's 25; conversion rates by distance; ~41-yd net punts) instead of fixed rules.
import { RNG } from '../core/rng.js';

// Expected points of a 1st & 10 (or 1st & goal) by yard line from the offense's own goal (NFL play-by-play, rounded).
const EP_TABLE = [[1, -0.95], [5, -0.55], [10, -0.1], [15, 0.25], [20, 0.55], [25, 0.85], [30, 1.15], [35, 1.45], [40, 1.8],
  [45, 2.1], [50, 2.4], [55, 2.75], [60, 3.05], [65, 3.35], [70, 3.65], [75, 3.95], [80, 4.15], [85, 4.4], [90, 4.7], [95, 5.0], [99, 5.4]];
// League-average conversion rate of one 3rd/4th-down snap by yards to go.
const CONV = [[1, 0.68], [2, 0.58], [3, 0.53], [4, 0.48], [5, 0.44], [6, 0.4], [7, 0.36], [8, 0.33], [9, 0.3], [10, 0.28],
  [12, 0.24], [15, 0.19], [20, 0.12], [25, 0.08], [30, 0.05], [99, 0.02]];
const KO_START = 30; // where a drive starts after a kickoff (dynamic kickoff average)
export const NET_PUNT = 41;

function lerp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) { const [x0, y0] = table[i - 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return table[table.length - 1][1];
}

export const epFirst = (yl) => lerp(EP_TABLE, Math.max(1, Math.min(99, yl)));
export const TD_VALUE = 7 - epFirst(KO_START); // the next score: the other team gets the kickoff
export const FG_VALUE = 3 - epFirst(KO_START);

/** Chance one snap converts `toGo` (goal-to-go plays are harder: the field is compressed). */
export function convRate(toGo, yl = 50) {
  let p = lerp(CONV, Math.max(1, toGo));
  if (yl + toGo >= 100 && toGo > 2) p *= 0.85;
  return p;
}

/** Field-goal make chance by distance (yds) for a kicker comfortable out to `comfort` yards. */
export function fgMake(dist, comfort = 53) {
  return 1 / (1 + Math.exp((dist - comfort - 4) / 6));
}

/** Where the other team starts (from its own goal) after a punt from `yl`. */
export function puntResult(yl) {
  return Math.max(12, Math.min(60, 100 - yl - NET_PUNT));
}

/** The value of the ball changing hands at the opponent's yard line `oppYL`, to the team giving it up. */
const lose = (oppYL) => -epFirst(oppYL);
const afterSuccess = (yl, toGo) => { const y = yl + toGo + 3; return y >= 100 ? TD_VALUE : epFirst(y); };

/** Values of the three 4th-down options in expected points (fg is null out of range). */
export function fourthOptions(toGo, yl, comfort = 53, maxFG = 57) {
  const c = convRate(toGo, yl);
  const go = c * afterSuccess(yl, toGo) + (1 - c) * lose(100 - yl);
  const punt = yl >= 97 ? -9 : lose(puntResult(yl));
  const dist = 100 - yl + 17;
  let fg = null;
  if (dist <= maxFG + 3) {
    const p = fgMake(dist, comfort);
    fg = p * FG_VALUE + (1 - p) * lose(Math.max(20, 107 - yl));
  }
  return { go, punt, fg };
}

const memo = new Map();
/** Expected points of a down & distance at yard line `yl` (offense's own goal = 0). 4th down = the best option. */
export function expectedPoints(yl, down = 1, toGo = 10, comfort = 53) {
  yl = Math.max(1, Math.min(99, Math.round(yl)));
  toGo = Math.max(1, Math.min(40, Math.round(toGo)));
  if (down === 1 && (toGo === 10 || toGo === 100 - yl)) return epFirst(yl);
  const key = `${yl}|${down}|${toGo}|${comfort}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let v;
  if (down >= 4) {
    const o = fourthOptions(toGo, yl, comfort, comfort + 4);
    v = Math.max(o.go, o.punt, o.fg ?? -99);
  } else {
    // One snap: convert, or gain a little and face the next down; ~3% of snaps are turnovers.
    const scale = down === 3 ? 1 : down === 2 ? 0.9 : 0.85;
    const c = convRate(toGo, yl) * scale;
    const g = Math.max(0, Math.min(toGo - 1, Math.round(toGo * (down === 3 ? 0.3 : 0.4))));
    const next = expectedPoints(yl + g, down + 1, toGo - g, comfort);
    v = 0.97 * (c * afterSuccess(yl, toGo) + (1 - c) * next) + 0.03 * lose(100 - yl);
  }
  if (memo.size > 50000) memo.clear();
  memo.set(key, v);
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Win probability late in games: Monte Carlo over whole drives (score chance by field position, drive time by
// tempo, timeouts stopping the clock, onside kicks), seeded from the state so a decision is reproducible.

/** Chances a drive starting at `yl` ends in a TD / FG / turnover (the rest punt). */
function driveOdds(yl, needTD, hurry) {
  let td = Math.min(0.72, 0.06 + 0.0055 * yl + (yl >= 95 ? 0.08 : 0));
  let fg = Math.min(0.32, 0.04 + 0.0035 * yl);
  let to = hurry ? 0.14 : 0.11;
  if (needTD) { td += fg * 0.25; fg = 0; }
  return { td, fg, to };
}

/**
 * Win probability for team A from a state: { lead (A minus B), secs (game seconds left), ball: 'A'|'B', yl (from the
 * possessing team's goal, as a 1st down), toA, toB (timeouts), ot }. `n` sims.
 */
export function winProb(s, n = 240) {
  const rng = new RNG(1 + ((s.lead * 7919 + s.secs * 31 + s.yl * 131 + (s.ball === 'A' ? 17 : 0) + s.toA * 3 + s.toB) >>> 0) % 100000);
  let w = 0;
  for (let i = 0; i < n; i++) w += playOut(s, rng);
  return w / n;
}

function playOut(s0, rng) {
  let lead = s0.lead, secs = s0.secs, ball = s0.ball, yl = s0.yl, to = { A: s0.toA ?? 0, B: s0.toB ?? 0 };
  for (let guard = 0; guard < 30; guard++) {
    if (secs <= 0) break;
    const other = ball === 'A' ? 'B' : 'A';
    const myLead = ball === 'A' ? lead : -lead;
    // Leading with the ball and the clock killable: kneel it out.
    if (myLead > 0 && secs <= 3 * 40 + 2 - to[other] * 40) return lead > 0 ? 1 : 0;
    const hurry = myLead < 0 && secs < 330 || myLead <= 0 && secs < 120;
    const needTD = myLead < -3 && secs < 240;
    const o = driveOdds(yl, needTD, hurry);
    // Time: a hurry-up drive moves ~1 yd/s, a normal one ~2.5 min, a lead-protecting one runs the clock against timeouts.
    const dist = 100 - yl;
    let tScore = hurry ? 18 + dist * 1.05 : 100 + dist * 1.0;
    let tFail = hurry ? 35 + rng.next() * 30 : 95 + rng.next() * 60;
    if (myLead > 0 && secs < 400) { // milking: the defense uses its timeouts
      const stops = Math.min(to[other], 3);
      tFail = 4 * 40 - stops * 38; tScore = Math.max(tScore, 7 * 40 - stops * 38);
      to[other] -= Math.min(to[other], rng.int(1, 3));
    } else if (hurry) {
      const used = Math.min(to[ball], 2);
      tScore = Math.max(8, tScore - used * 20); to[ball] -= used;
    }
    const r = rng.next();
    let res;
    if (r < o.td) res = 'td'; else if (r < o.td + o.fg) res = 'fg'; else if (r < o.td + o.fg + o.to) res = 'to'; else res = 'punt';
    if ((res === 'td' || res === 'fg') && secs < tScore * (res === 'fg' ? 0.65 : 1)) {
      // Not enough time for a full drive: a long shot.
      const frac = secs / (tScore * (res === 'fg' ? 0.65 : 1));
      if (rng.next() > frac * frac + 0.04) res = 'end';
    }
    const t = res === 'td' ? tScore : res === 'fg' ? tScore * 0.8 : tFail;
    secs -= Math.min(secs, t);
    if (res === 'end') break;
    if (res === 'td' || res === 'fg') {
      const pts = res === 'td' ? 7 : 3;
      lead += ball === 'A' ? pts : -pts;
      const newMy = ball === 'A' ? lead : -lead;
      // Behind late after scoring: onside kick (~10% recovered).
      if (newMy < 0 && secs < 200 && secs > 0) {
        if (rng.next() < 0.1) { yl = 52; continue; }
        ball = other; yl = 55; continue;
      }
      ball = other; yl = KO_START;
    } else if (res === 'to') { ball = other; yl = Math.max(5, Math.min(90, 100 - (yl + rng.int(5, 25)))); }
    else if (res === 'punt') { ball = other; yl = puntResult(Math.min(70, yl + rng.int(0, 20))); }
  }
  if (lead === 0) return s0.ot && s0.otSudden ? 0.5 : 0.5;
  return lead > 0 ? 1 : 0;
}

/**
 * Win probability for the team with the ball (`team`) in a Match-like state, for the ball changing hands or staying
 * as a 1st down at `yl` (`mine` = it stays with `team`). Down & distance states go through their EP-equivalent spot.
 */
export function wpFor(m, team, { mine, yl, lead = null, secs = null }) {
  const opp = 1 - team;
  const qm = m.settings?.quarterMinutes || 15;
  let left = secs ?? (m.quarter >= 5 ? m.clock : Math.max(0, (4 - m.quarter)) * qm * 60 + m.clock);
  // Short quarters: drives use less game clock, so scale everything but the last two minutes to a 15-minute game.
  if (secs === null && left > 120) left = 120 + (left - 120) * 15 / qm;
  return winProb({ lead: lead ?? (m.score[team] - m.score[opp]), secs: left, ball: mine ? 'A' : 'B',
    yl: Math.max(1, Math.min(99, Math.round(yl))), toA: m.timeouts[team], toB: m.timeouts[opp], ot: !!m.ot });
}

/** The yard line whose 1st & 10 is worth `ep` (for feeding down-and-distance states into the drive model). */
export function ylForEP(ep) {
  let lo = 1, hi = 99;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (epFirst(mid) < ep) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Is the game in the window where win probability (not points) should drive decisions? */
export const lateGame = (m) => m.quarter >= 4 && (m.clock < 600 || m.quarter >= 5);

/**
 * The value, to `team` (who has the ball now), of it having (down, toGo) at `yl` — EP early, win probability late.
 * Returns a number on one scale per call site (EP points, or WP × 20 so the two are comparable in thresholds).
 */
export function stateValue(m, team, down, toGo, yl, comfort = 53, leadDelta = 0) {
  const ep = expectedPoints(yl, down, toGo, comfort);
  if (!lateGame(m)) return ep + leadDelta;
  const eqYL = ylForEP(Math.max(epFirst(1), Math.min(epFirst(99), ep)));
  if (ep < epFirst(1)) return wpFor(m, team, { mine: false, yl: ylForEP(Math.min(epFirst(99), -ep)), lead: m.score[team] - m.score[1 - team] + leadDelta }) * 20;
  return wpFor(m, team, { mine: true, yl: eqYL, lead: m.score[team] - m.score[1 - team] + leadDelta }) * 20;
}
