// Penalty definitions, enforcement and automatic accept/decline (pure logic).
// Yard lines are from the offense's own goal line (0..100), as in Match.

export const PENALTIES = {
  false_start: { name: 'False start', side: 'off', yards: 5, dead: true },
  delay_of_game: { name: 'Delay of game', side: 'off', yards: 5, dead: true },
  offsides: { name: 'Offsides', side: 'def', yards: 5, dead: true },
  holding_off: { name: 'Holding', side: 'off', yards: 10 },
  holding_def: { name: 'Defensive holding', side: 'def', yards: 5, autoFirst: true },
  dpi: { name: 'Pass interference', side: 'def', spot: true, autoFirst: true },
  roughing: { name: 'Roughing the passer', side: 'def', yards: 15, autoFirst: true },
  facemask_def: { name: 'Face mask', side: 'def', yards: 15, autoFirst: true },
  facemask_off: { name: 'Face mask', side: 'off', yards: 15 },
  grounding: { name: 'Intentional grounding', side: 'off', yards: 10, lossOfDown: true },
};

/** Rough expected points for the team with the ball. */
export function expectedPoints(yl, down = 1, toGo = 10) {
  return -0.7 + 0.075 * yl - [0, 0, 0.35, 0.9, 1.8][Math.min(4, down)] - 0.04 * (toGo - 10);
}

/**
 * Value (to the offense) of the state the play itself produced, if the penalty were declined.
 * `m` = Match before the play, `r` = PlaySim result.
 */
export function valueOfPlay(m, r) {
  const off = r.offTeam;
  if (r.touchdown === off) return 7;
  if (r.touchdown !== null && r.touchdown !== undefined) return -7;
  if (r.safety) return -2 - 1;
  if (r.possTeam !== off) {
    const yl = r.touchback ? 20 : m.ylOf(r.possTeam, r.spotX);
    return -expectedPoints(yl);
  }
  const yl = r.incomplete ? m.yardLine : m.ylOf(off, r.spotX);
  if (yl >= m.firstYL) return expectedPoints(yl, 1, Math.min(10, 100 - yl));
  const down = m.down + 1;
  if (down > 4) return -expectedPoints(100 - yl);
  return expectedPoints(yl, down, m.firstYL - yl);
}

/**
 * Enforce a foul. Returns the outcome: { accepted, text, newYL, autoFirst, lossOfDown, team, replay }.
 * foul = { type, team (offending team index), spotX (absolute x for spot fouls), player }
 */
export function enforce(m, foul, r) {
  const def = PENALTIES[foul.type];
  const off = m.possession;
  const offending = foul.team === off ? 'off' : 'def';
  const yl = m.yardLine;
  let newYL;
  if (def.spot && foul.spotX !== undefined) {
    // Spot foul (pass interference): ball at the spot; in the end zone it goes to the 1.
    newYL = Math.min(99, m.ylOf(off, foul.spotX));
    if (newYL <= yl) newYL = Math.min(99, yl + 1);
  } else if (offending === 'off') {
    // Half the distance to the goal if the full penalty would be more than that.
    const yards = Math.min(def.yards, yl / 2);
    newYL = yl - yards;
    if (foul.type === 'grounding' && foul.spotX !== undefined) newYL = Math.min(newYL, m.ylOf(off, foul.spotX));
  } else {
    const yards = Math.min(def.yards, (100 - yl) / 2);
    newYL = yl + yards;
  }
  const who = foul.player ? `, #${foul.player.number}` : '';
  const sideTxt = offending === 'off' ? 'offense' : 'defense';
  const yds = Math.round(Math.abs(newYL - yl));
  const autoFirst = !!def.autoFirst;
  const lossOfDown = !!def.lossOfDown;
  let text = `${def.name}, ${sideTxt}${who}. ${yds} yard penalty`;
  if (autoFirst) text += ', automatic first down';
  else if (lossOfDown) text += ', loss of down';
  else if (!def.dead) text += `, repeat ${['', '1st', '2nd', '3rd', '4th'][m.down]} down`;
  const outcome = { type: foul.type, team: foul.team, newYL, autoFirst, lossOfDown, text, accepted: true, dead: !!def.dead, replay: !lossOfDown };

  if (def.dead || !r) return outcome;
  // Accept or decline: the fouled team takes whichever leaves them better off.
  const playVal = valueOfPlay(m, r);
  let penVal;
  if (offending === 'off') {
    const down = lossOfDown ? m.down + 1 : m.down;
    penVal = down > 4 ? -expectedPoints(100 - newYL) : expectedPoints(newYL, down, m.firstYL - newYL);
    outcome.accepted = penVal < playVal; // defense wants the lower offensive value
  } else {
    penVal = autoFirst || newYL >= m.firstYL ? expectedPoints(newYL, 1, 10) : expectedPoints(newYL, m.down, m.firstYL - newYL);
    outcome.accepted = penVal > playVal;
  }
  if (!outcome.accepted) outcome.text = `${def.name}, ${sideTxt}${who} — declined`;
  return outcome;
}

/** Random pre-snap fouls (CPU-side mistakes). Returns a foul or null. */
export function rollPresnapFoul(m, sim, rng, rate = 1) {
  if (m.phase !== 'scrimmage' || sim.isKick) return null;
  const off = sim.offense();
  const ol = off.filter((p) => ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot));
  const awr = ol.reduce((a, p) => a + p.r.awareness, 0) / Math.max(1, ol.length);
  if (rng.chance(0.007 * rate * (1 + (70 - awr) / 40))) {
    const p = rng.pick(ol.length ? ol : off);
    return { type: 'false_start', team: sim.offIdx, player: p };
  }
  if (rng.chance(0.005 * rate)) {
    const dl = sim.defense().filter((p) => /E$|DT/.test(p.slot));
    return { type: 'offsides', team: sim.defIdx, player: rng.pick(dl.length ? dl : sim.defense()) };
  }
  return null;
}
