import { listOffPlays, listDefPlays, getOffPlay, getDefPlay, getOffFormation } from '../data/playbook.js';
import { fgDistance } from '../sim/kicking.js';

// Situational CPU play calling: run/pass mix by down, distance, field, score and clock; 4th-down
// decisions; two-minute drill; kneel-downs; PAT vs 2-point; defensive calls; timeouts.

const DEEP = new Set(['go', 'fade', 'post', 'corner', 'seam', 'wheel', 'skinny_post', 'out_up', 'deep_out']);
const QUICK = new Set(['slant', 'quick_out', 'hitch', 'flat', 'swing', 'screen', 'arrow', 'stick', 'sit', 'drag', 'shallow', 'whip']);

/** Tags derived from a play's routes so the caller can pick by depth. */
export function playTags(p) {
  if (p._tags) return p._tags;
  const routes = Object.values(p.routes || {}).map((r) => r.replace(/_(l|r)$/, ''));
  const deep = routes.filter((r) => DEEP.has(r)).length;
  const quick = routes.filter((r) => QUICK.has(r)).length;
  const f = getOffFormation(p.formation);
  const tags = {
    run: p.type === 'run',
    pass: p.type === 'pass',
    deep: p.type === 'pass' && deep >= 2,
    quick: p.type === 'pass' && quick >= Math.max(2, routes.length / 2),
    goalLine: /goal/i.test(p.formation) || /goal/i.test(f?.family || ''),
    shotgun: /gun/i.test(p.formation),
    sneak: p.run?.carrier === 'QB',
  };
  p._tags = tags;
  return tags;
}

export function kickerMaxFG(team) {
  const k = team.roster.find((p) => p.id === team.depth.K?.[0]);
  const kpw = k ? k.ratings.kickPower : 80;
  return Math.round(44 + (kpw - 80) * 0.45);
}

/** Decide what to do on the current snap. Returns a play object (may be special teams). */
export function chooseOffense(m, team, rng, smart = 0.85) {
  const s = m.situation();
  if (m.phase === 'kickoff') {
    const trailingLate = m.quarter >= 4 && m.clock < 150 && s.lead < 0 && s.lead >= -16;
    return getOffPlay(trailingLate && rng.chance(0.8) ? 'st_onside' : 'st_kickoff');
  }
  if (m.phase === 'try') return chooseTry(m, team) === '2pt' ? pickPlay(m, rng, { goalLine: true, shortYardage: true }) : getOffPlay('st_fg');
  const lead = s.lead;
  const q4 = m.quarter >= 4;
  // Victory formation.
  if (shouldKneel(m, team)) return getOffPlay('st_kneel');
  // Spike to stop the clock in a hurry.
  if (m.inTwoMinutes && lead <= 0 && m.clockRunning && m.timeouts[team] === 0 && m.clock < 35 && m.clock > 4 && m.down < 4) return getOffPlay('st_spike');
  // 4th down / end-of-half field goals.
  if (m.down === 4) {
    const d = fourthDown(m, team, rng);
    if (d === 'punt') return getOffPlay('st_punt');
    if (d === 'fg') return getOffPlay('st_fg');
  }
  const fgDist = fgDistance(m.yardLine);
  if ((m.quarter === 2 || q4) && m.clock < 8 && !m.clockRunning && fgDist <= kickerMaxFG(m.teams[team]) && (m.quarter === 2 || (lead >= -3 && lead <= 0))) return getOffPlay('st_fg');
  if ((m.quarter === 2 || q4) && m.clock < 4 && m.clockRunning && fgDist <= kickerMaxFG(m.teams[team])) return getOffPlay('st_fg');

  // Run/pass mix.
  let run = 0.45;
  const toGo = m.toGo;
  if (m.down === 1) run = 0.5;
  if (m.down === 2) run = toGo >= 8 ? 0.35 : toGo <= 3 ? 0.55 : 0.45;
  if (m.down >= 3) run = toGo <= 2 ? 0.55 : toGo <= 4 ? 0.3 : 0.1;
  if (m.yardLine >= 95) run += 0.15;
  if (m.inTwoMinutes && lead <= 0) run = 0.12;
  if (q4 && lead > 0 && m.clock < 360) run = 0.75;
  if (q4 && lead < -8 && m.clock < 480) run *= 0.5;
  const wantRun = rng.chance(run);
  return pickPlay(m, rng, {
    run: wantRun,
    deep: !wantRun && (toGo >= 12 || (m.inTwoMinutes && lead < 0 && m.yardLine < 60)) && rng.chance(0.55),
    quick: !wantRun && (toGo <= 5 || (m.down === 3 && toGo <= 7)) && rng.chance(0.6),
    goalLine: m.yardLine >= 97,
    shortYardage: toGo <= 1,
  });
}

function pickPlay(m, rng, want) {
  let pool = listOffPlays();
  const score = (p) => {
    const t = playTags(p);
    let w = 1;
    if (want.run !== undefined) w *= want.run === t.run ? 6 : 0.2;
    if (want.deep && t.deep) w *= 3;
    if (want.quick && t.quick) w *= 3;
    if (want.deep && t.quick) w *= 0.4;
    if (want.goalLine) w *= t.goalLine ? 3 : t.deep ? 0.2 : 1;
    if (want.shortYardage && t.sneak) w *= 3;
    if (!want.goalLine && t.goalLine) w *= 0.15;
    if (!want.shortYardage && t.sneak) w *= 0.1;
    return w;
  };
  return rng.weighted(pool, score);
}

export function shouldKneel(m, team) {
  const lead = m.score[team] - m.score[1 - team];
  if (lead <= 0) return false;
  const oppTO = m.timeouts[1 - team];
  // Snaps left before a turnover on downs, each burning ~40s, minus opponent timeouts.
  const snaps = 5 - m.down;
  const killable = snaps * 40 + 2 - oppTO * 40;
  if (m.quarter >= 4 && m.clock <= killable) return true;
  if (m.quarter === 2 && m.clock <= 25 && m.yardLine < 50 && lead >= -100) return true;
  return false;
}

export function fourthDown(m, team, rng) {
  const s = m.situation();
  const yl = m.yardLine, toGo = m.toGo;
  const lead = s.lead;
  const fgDist = fgDistance(yl);
  const inRange = fgDist <= kickerMaxFG(m.teams[team]);
  const late = m.quarter >= 4 && m.clock < 240;
  // Desperation: trailing late, must keep the ball.
  if (late && lead < 0 && !(inRange && lead >= -3)) return 'go';
  if (late && lead < -3 && m.clock < 120) return 'go';
  if (toGo <= 1 && yl >= 45 && !(inRange && toGo > 0.9 && rng.chance(0.3))) return 'go';
  if (toGo <= 2 && yl >= 60 && yl < 75 && !inRange) return 'go';
  if (inRange) return 'fg';
  if (toGo <= 3 && yl >= 55) return rng.chance(0.4) ? 'go' : 'punt';
  return 'punt';
}

export function chooseTry(m, team) {
  // Classic two-point chart (margin after the touchdown, before the try), used in the 4th quarter.
  const diff = m.score[team] - m.score[1 - team];
  if (m.quarter < 4) return 'kick';
  return [-10, -9, -5, -2, 1, 5, 12].includes(diff) ? '2pt' : 'kick';
}

/** Defensive call for the situation. */
export function chooseDefense(m, team, rng, blitzRate = 0.2) {
  if (m.phase === 'kickoff') return getDefPlay('st_kick_return');
  const all = listDefPlays();
  const s = m.situation();
  const off = s.possession;
  // Special teams looks.
  return pickDefense(m, rng, all, blitzRate, off);
}

function pickDefense(m, rng, all, blitzRate) {
  const toGo = m.toGo;
  const passDown = m.down >= 3 && toGo >= 6 || m.down === 2 && toGo >= 10 || (m.inTwoMinutes && m.score[m.possession] <= m.score[1 - m.possession]);
  const shortYds = toGo <= 2 || m.yardLine >= 96;
  const blitz = rng.chance(blitzRate * (m.down === 3 ? 1.5 : 1));
  const prevent = m.inTwoMinutes && m.score[1 - m.possession] - m.score[m.possession] >= 4;
  return rng.weighted(all, (p) => {
    const f = p.formation;
    let w = 1;
    const nickelish = /nickel|dime/.test(f);
    const goal = /goal/.test(f);
    if (passDown) w *= nickelish ? 4 : 0.6;
    if (shortYds) w *= goal ? 6 : nickelish ? 0.3 : 1.5;
    if (!shortYds && goal) w *= 0.05;
    const isBlitz = /blitz|fire|zero|cover0/i.test(p.id);
    w *= blitz ? (isBlitz ? 4 : 0.6) : (isBlitz ? 0.3 : 1);
    if (prevent) w *= /cover4|quarters|prevent|cover3|deep/i.test(p.id) ? 4 : 0.4;
    return w;
  });
}

/** Special-teams defensive look for a known special offensive call. */
export function defenseForSpecial(offPlay) {
  if (offPlay.type === 'kickoff') return getDefPlay('st_kick_return');
  if (offPlay.type === 'punt') return getDefPlay('st_punt_return');
  if (offPlay.type === 'fg') return getDefPlay('st_fg_block');
  return null;
}

/** Seconds of play clock the CPU offense uses before snapping (tempo). */
export function cpuTempo(m, team, rng) {
  const lead = m.score[team] - m.score[1 - team];
  if (m.inTwoMinutes && lead <= 0) return 8 + rng.next() * 6; // hurry-up
  if (m.quarter >= 4 && lead > 0 && m.clock < 360) return 37 + rng.next() * 2; // milk the clock
  return 31 + rng.next() * 7; // pro offenses snap with a few seconds left on the 40-second clock
}

/** Should this team call a timeout right now (between plays)? */
export function cpuTimeout(m, team) {
  if (m.timeouts[team] <= 0 || !m.clockRunning || m.over) return false;
  const late = (m.quarter === 2 && m.clock < 120) || (m.quarter >= 4 && m.clock < 150);
  if (!late) return false;
  const lead = m.score[team] - m.score[1 - team];
  const onOffense = m.possession === team;
  if (onOffense) return lead <= 0 || m.quarter === 2 ? m.clock < 60 || (m.quarter === 2 && m.yardLine > 45) : false;
  // Defense trailing (or tied/close) stops the clock to get the ball back.
  return m.quarter >= 4 ? lead <= 8 && lead <= 0 || lead < 0 : m.clock < 60 && m.yardLine < 35;
}
