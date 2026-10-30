// Scenarios / comeback challenges (pure logic): a real game dropped into a late, tight situation with a goal. The
// human is team 0 (home). `applyScenario()` sets the match up; `scenarioCheck()` after every play decides when the
// goal is met or lost (the game ends there); otherwise the game plays out and `scenarioFinal()` judges the result.

// score: [you, them]; yardLine from the possessing team's own goal; side: who has the ball ('you' | 'them').
export const SCENARIOS = [
  { id: 'two_minute', name: 'Two-Minute Drill', goal: 'win', quarter: 4, clock: 120, score: [17, 21], side: 'you', yardLine: 25, timeouts: [2, 3],
    desc: 'Down four with two minutes left and two timeouts. Go 75 yards and win it.' },
  { id: 'hail_mary', name: 'Last Gasp', goal: 'td', quarter: 4, clock: 9, score: [20, 24], side: 'you', yardLine: 52, timeouts: [0, 1],
    desc: 'Nine seconds, no timeouts, 48 yards to go. Only a touchdown wins it.' },
  { id: 'goal_line', name: 'Goal-Line Stand', goal: 'stop', quarter: 4, clock: 55, score: [24, 20], side: 'them', yardLine: 95, timeouts: [1, 2],
    desc: 'Up four. They have first and goal at your 5. Keep them out of the end zone.' },
  { id: 'protect', name: 'Protect the Lead', goal: 'win', quarter: 4, clock: 270, score: [23, 20], side: 'you', yardLine: 20, timeouts: [1, 2],
    desc: 'Up three, 4:30 left, ball at your 20. Move the chains and run out the clock.' },
  { id: 'fourth_long', name: 'Fourth and Long', goal: 'win', quarter: 4, clock: 70, score: [27, 30], side: 'you', yardLine: 58, down: 4, toGo: 12, timeouts: [1, 0],
    desc: 'Down three, 4th and 12 at their 42 with 1:10 left. Convert, kick it or go for the win.' },
  { id: 'comeback', name: 'Seventeen Down', goal: 'win', quarter: 4, clock: 600, score: [10, 27], side: 'you', yardLine: 25, timeouts: [3, 3],
    desc: 'Ten minutes left, down seventeen. It takes three scores. Find them.' },
  { id: 'overtime', name: 'Sudden Pressure', goal: 'win', quarter: 4, clock: 35, score: [21, 21], side: 'them', yardLine: 30, timeouts: [2, 0],
    desc: 'Tied with 35 seconds left and they have the ball at their 30. Get a stop and win it in overtime or better.' },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);

/** Put the match in the scenario's situation (call before the first play call). Human = team 0. */
export function applyScenario(m, sc) {
  const off = sc.side === 'you' ? 0 : 1;
  m.quarter = sc.quarter;
  m.clock = Math.min(sc.clock, m.periodLength());
  m.score = [...sc.score];
  m.timeouts = [...sc.timeouts];
  m.newPossession(off, sc.yardLine, 0);
  if (sc.down) m.down = sc.down;
  if (sc.toGo) { m.toGo = Math.min(sc.toGo, 100 - sc.yardLine); m.firstYL = Math.min(100, sc.yardLine + sc.toGo); }
  // Past the two-minute warning already if the clock says so (no warning stoppage right away).
  if (m.clock <= 120) m.twoMinWarned[m.quarter] = true;
  m.clockRunning = false;
  m.takeMessages();
  m.say(`${sc.name}: ${sc.desc}`, 'info');
  return { id: sc.id, startPoss: off, drives: 0 };
}

/**
 * After each play. Returns { done, success, text } once the goal is decided early, else null.
 * td: a touchdown by you (fail when the ball changes hands or time runs out); stop: no points on their drive.
 */
export function scenarioCheck(m, state, r) {
  const sc = scenarioById(state.id);
  if (sc.goal === 'td') {
    if (r.touchdown === 0) return { done: true, success: true, text: 'Touchdown! You pulled it off.' };
    if (m.possession !== 0 || m.over || m.phase !== 'scrimmage') return { done: true, success: false, text: 'Time ran out short of the end zone.' };
  }
  if (sc.goal === 'stop') {
    const theyScored = m.score[1] > sc.score[1];
    if (theyScored) return { done: true, success: false, text: 'They scored. The stand fell short.' };
    if (m.possession === 0 || m.over) return { done: true, success: true, text: 'Stopped them! The lead holds.' };
  }
  return null;
}

/** The game ended without an early verdict ('win' goals). */
export function scenarioFinal(m) {
  if (m.winner === 0) return { success: true, text: `You won ${m.score[0]}–${m.score[1]}.` };
  if (m.winner === null) return { success: false, text: `A tie, ${m.score[0]}–${m.score[1]}. Not quite.` };
  return { success: false, text: `You lost ${m.score[0]}–${m.score[1]}.` };
}
