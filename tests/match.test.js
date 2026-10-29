import { describe, it, expect } from 'vitest';
import { RNG } from '../src/core/rng.js';
import { Match } from '../src/game/match.js';
import { enforce } from '../src/game/penalties.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';

const teams = generateLeagueRosters(defaultTeams(), 2027).slice(0, 2);
const newMatch = (seed = 1, settings = {}) => new Match({ teams, settings: { quarterMinutes: 15, ...settings }, rng: new RNG(seed) });

// Minimal PlaySim-like result for team `off` ending at yard line `yl` (from off's goal).
function res(m, { off = m.possession, yl, td = null, incomplete = false, kickType, fgGood, possTeam = off, touchback = false, safety = false, interception = false, oob = false }) {
  return {
    offTeam: off, possTeam, spotX: yl === undefined ? 0 : m.xOf(possTeam, possTeam === off ? yl : 100 - yl), spotZ: 0,
    yards: 0, touchdown: td, safety, touchback, incomplete, kickType, fgGood, interception, outOfBounds: oob,
    reason: incomplete ? 'incomplete' : 'tackle', playType: 'run', duration: 5, fumble: false,
  };
}

function toScrimmage(m, team = 0, yl = 25) {
  m.newPossession(team, yl, 0);
}

describe('Match rules', () => {
  it('starts with a kickoff by the team that lost the toss', () => {
    const m = newMatch(3);
    expect(m.phase).toBe('kickoff');
    expect(m.possession).toBe(1 - m.openingReceiver);
    expect(m.yardLine).toBe(35);
  });

  it('kickoff touchback gives the receiver the 25', () => {
    const m = newMatch(3);
    const kicker = m.possession;
    m.applyResult({ ...res(m, { yl: 35 }), kickType: 'kickoff', touchback: true, possTeam: 1 - kicker });
    expect(m.phase).toBe('scrimmage');
    expect(m.possession).toBe(1 - kicker);
    expect(m.yardLine).toBe(25);
    expect(m.down).toBe(1);
    expect(m.toGo).toBe(10);
  });

  it('moves the chains and counts downs', () => {
    const m = newMatch();
    toScrimmage(m, 0, 25);
    m.applyResult(res(m, { yl: 29 }));
    expect([m.down, m.toGo]).toEqual([2, 6]);
    m.applyResult(res(m, { yl: 36 }));
    expect([m.down, m.toGo, m.yardLine]).toEqual([1, 10, 36]);
    m.applyResult(res(m, { incomplete: true }));
    expect([m.down, m.yardLine]).toEqual([2, 36]);
    expect(m.clockRunning).toBe(false);
  });

  it('turns it over on downs', () => {
    const m = newMatch();
    toScrimmage(m, 0, 60);
    for (let i = 0; i < 4; i++) m.applyResult(res(m, { incomplete: true }));
    expect(m.possession).toBe(1);
    expect(m.yardLine).toBe(40);
    expect(m.down).toBe(1);
  });

  it('touchdown -> try -> kickoff by the scoring team', () => {
    const m = newMatch();
    toScrimmage(m, 0, 80);
    m.applyResult(res(m, { yl: 100, td: 0 }));
    expect(m.score).toEqual([6, 0]);
    expect(m.phase).toBe('try');
    m.applyResult({ ...res(m, { yl: 85 }), kickType: 'fg', fgGood: true });
    expect(m.score).toEqual([7, 0]);
    expect(m.phase).toBe('kickoff');
    expect(m.possession).toBe(0);
  });

  it('missed field goal: ball to the defense at the spot of the kick (or the 20)', () => {
    const m = newMatch();
    toScrimmage(m, 0, 60); // 57-yard attempt, spot of kick = own 53
    m.down = 4;
    m.applyResult({ ...res(m, { yl: 60 }), kickType: 'fg', fgGood: false });
    expect(m.possession).toBe(1);
    expect(m.yardLine).toBe(47);
    const m2 = newMatch();
    toScrimmage(m2, 0, 85);
    m2.applyResult({ ...res(m2, { yl: 85 }), kickType: 'fg', fgGood: false });
    expect(m2.yardLine).toBe(22); // spot of kick (own 78) -> their 22
  });

  it('safety: 2 points and a free kick from the 20', () => {
    const m = newMatch();
    toScrimmage(m, 0, 3);
    m.applyResult(res(m, { yl: -1, safety: true }));
    expect(m.score).toEqual([0, 2]);
    expect(m.phase).toBe('kickoff');
    expect(m.possession).toBe(0);
    expect(m.yardLine).toBe(20);
  });

  it('interception changes possession at the spot', () => {
    const m = newMatch();
    toScrimmage(m, 0, 40);
    // Picked off at the offense's own 30 = 70 yards from the defense's own goal line.
    m.applyResult(res(m, { yl: 30, possTeam: 1, interception: true }));
    expect(m.possession).toBe(1);
    expect(m.yardLine).toBe(70);
  });

  it('two-minute warning stops the clock at 2:00', () => {
    const m = newMatch();
    toScrimmage(m, 0, 40);
    m.quarter = 2; m.clock = 140; m.clockRunning = true;
    m.presnapRunoff(35);
    expect(m.clock).toBe(120);
    expect(m.clockRunning).toBe(false);
  });

  it('halftime: the opening kicker receives the second half', () => {
    const m = newMatch(5);
    const firstReceiver = m.openingReceiver;
    toScrimmage(m, 0, 40);
    m.quarter = 2; m.clock = 0;
    m.applyResult(res(m, { yl: 42 }));
    expect(m.quarter).toBe(3);
    expect(m.phase).toBe('kickoff');
    expect(m.possession).toBe(firstReceiver); // kicking team is the opening receiver
    expect(m.timeouts).toEqual([3, 3]);
  });

  it('ends in regulation or goes to overtime when tied', () => {
    const m = newMatch();
    toScrimmage(m, 0, 40);
    m.quarter = 4; m.clock = 0; m.score = [10, 3];
    m.applyResult(res(m, { yl: 42 }));
    expect(m.over).toBe(true);
    expect(m.winner).toBe(0);
    const t = newMatch();
    toScrimmage(t, 0, 40);
    t.quarter = 4; t.clock = 0; t.score = [10, 10];
    t.applyResult(res(t, { yl: 42 }));
    expect(t.over).toBe(false);
    expect(t.quarter).toBe(5);
    expect(t.phase).toBe('kickoff');
    expect(t.timeouts).toEqual([2, 2]);
  });

  it('overtime: both teams get the ball, then a lead wins', () => {
    const m = newMatch();
    m.quarter = 5; m.ot = { poss: [0, 0], suddenDeath: false }; m.clock = 600;
    m.newPossession(0, 25);
    toScrimmage(m, 0, 80);
    m.ot.poss = [1, 0];
    m.applyResult(res(m, { yl: 100, td: 0 }));
    m.applyResult({ ...res(m, { yl: 85 }), kickType: 'fg', fgGood: true });
    expect(m.over).toBe(false); // team 1 still gets a possession
    m.newPossession(1, 25);
    for (let i = 0; i < 4; i++) m.applyResult(res(m, { incomplete: true }));
    expect(m.over).toBe(true);
    expect(m.winner).toBe(0);
  });

  it('penalties: half the distance and automatic first downs', () => {
    const m = newMatch();
    toScrimmage(m, 0, 6);
    const hold = enforce(m, { type: 'holding_off', team: 0 }, null);
    expect(hold.newYL).toBe(3); // half the distance to the goal
    toScrimmage(m, 0, 30);
    m.down = 3; m.toGo = 8; m.firstYL = 38;
    const dh = enforce(m, { type: 'holding_def', team: 1 }, null);
    expect(dh.newYL).toBe(35);
    expect(dh.autoFirst).toBe(true);
  });
});

describe('post-play stat card', () => {
  it('shows the passer, receiver and tackler with their game totals', async () => {
    const { playStatLines } = await import('../src/game/match.js');
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const s = new GameSession({ teams, settings: { quarterMinutes: 15 }, humanTeam: null, seed: 7, fast: true });
    let found = null;
    for (let i = 0; i < 400000 && !found && !s.match.over; i++) {
      s.tick(STEP, null);
      for (const e of s.events) if (e.type === 'result' && e.result.complete && e.statLines.length >= 2) found = e;
    }
    expect(found).not.toBeNull();
    const [rec, qb] = found.statLines;
    expect(rec.line).toMatch(/^\d+ REC · -?\d+ YDS/);
    expect(qb.line).toMatch(/^\d+\/\d+ · -?\d+ YDS/);
    expect(rec.team).toBe(found.result.offTeam);
    // Totals include this play.
    const p = s.sim.players[found.result.receiver];
    expect(s.match.stats.players[`${p.team}:${p.rid}`].rec).toBeGreaterThan(0);
    expect(playStatLines(s.match, { kickType: 'punt' }, s.sim)).toEqual([]);
  });
});
