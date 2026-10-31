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

  it('dynamic kickoff spots: touchback to the 35 (20 after landing in the zone), short of the zone to the 40', () => {
    for (const [extra, yl] of [[{ touchback: true, touchbackYL: 20 }, 20], [{ kickShort: true }, 40]]) {
      const m2 = newMatch(3);
      m2.applyResult({ ...res(m2, { yl: 35 }), kickType: 'kickoff', possTeam: 1 - m2.possession, ...extra });
      expect(m2.yardLine).toBe(yl);
    }
    const m = newMatch(3);
    const kicker = m.possession;
    m.applyResult({ ...res(m, { yl: 35 }), kickType: 'kickoff', touchback: true, possTeam: 1 - kicker });
    expect(m.phase).toBe('scrimmage');
    expect(m.possession).toBe(1 - kicker);
    expect(m.yardLine).toBe(35);
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

describe('fatigue and rotation', () => {
  it('rotates backs and receivers but keeps the QB and line in', async () => {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const s = new GameSession({ teams, settings: { quarterMinutes: 15, sliders: { injuries: 0 } }, humanTeam: null, seed: 3, fast: true });
    for (let i = 0; i < 2e6 && !s.match.over; i++) s.tick(STEP, null);
    const snaps = (t, slot, i) => s.match.stats.players[`${t}:${teams[t].depth[slot][i]}`]?.snaps || 0;
    for (const t of [0, 1]) {
      const plays = s.match.stats.team[t].plays;
      expect(snaps(t, 'HB', 1)).toBeGreaterThan(plays * 0.1); // the backup back gets real work
      expect(snaps(t, 'HB', 0)).toBeGreaterThan(snaps(t, 'HB', 1));
      // Every snap except a fake punt / fake field goal (the QB isn't in the kicking unit).
      expect(snaps(t, 'QB', 0)).toBeGreaterThanOrEqual(plays - 2);
      expect(snaps(t, 'LT', 0)).toBeGreaterThanOrEqual(plays - 2);
    }
  }, 60000);
});

describe('audibles and hot routes', () => {
  async function presnapOffense() {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const s = new GameSession({ teams, settings: { quarterMinutes: 15 }, humanTeam: 0, seed: 2, fast: false });
    s.match.newPossession(0, 30, 0);
    s.choice = { off: getOffPlay('gun_doubles_mesh'), def: getDefPlay('43_cover3') };
    s.state = 'playcall';
    s.tick(STEP, null);
    return { s, STEP };
  }
  const press = async (btn, extra = {}) => {
    const { emptyFrame } = await import('../src/input/actions.js');
    const f = emptyFrame();
    if (btn) f.pressed[btn] = true;
    return Object.assign(f, extra);
  };

  it('audibles to a play in the same formation', async () => {
    const { s, STEP } = await presnapOffense();
    expect(s.state).toBe('presnap');
    s.tick(STEP, await press('X'));
    expect(s.audible?.mode).toBe('menu');
    const opt = s.audible.options.find((o) => o.btn === 'Y'); // run right
    s.tick(STEP, await press('Y'));
    expect(s.audible).toBeNull();
    expect(s.sim.offPlay.id).toBe(opt.play.id);
    expect(s.sim.offPlay.type).toBe('run');
    expect(s.sim.offPlay.formation.replace('__flip', '')).toBe('gun_doubles');
  }, 30000);

  it('hot routes a receiver and makes him the first read', async () => {
    const { s, STEP } = await presnapOffense();
    s.tick(STEP, await press('Y'));
    expect(s.audible?.mode).toBe('hot');
    const [btn, id] = Object.entries(s.sim.icons)[0];
    const slot = s.sim.players[id].slot;
    s.tick(STEP, await press(btn));
    s.tick(STEP, await press(null, { ly: -1 })); // stick up = go route
    expect(s.sim.offPlay.routes[slot]).toBe('go');
    expect(s.sim.offPlay.read[0]).toBe(slot);
    s.snap();
    expect(s.sim.players.find((p) => p.team === 0 && p.slot === slot).task.type).toBe('route');
  });
});

describe('practice mode', () => {
  it('resets to the chosen situation after every rep and never runs the clock', async () => {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const { listOffPlays } = await import('../src/data/playbook.js');
    const practice = { side: 'offense', yardLine: 80, down: 3, toGo: 8, after: 'reset' };
    const s = new GameSession({ teams, settings: { quarterMinutes: 5, practice, penalties: false }, humanTeam: 0, seed: 9, fast: true });
    const m = s.match;
    const clock0 = m.clock;
    let reps = 0;
    for (let i = 0; i < 200000 && reps < 6; i++) {
      if (s.needsHumanCall) s.humanChoose(listOffPlays()[(reps * 7) % listOffPlays().length]);
      if (s.state === 'presnap') { s.snap(); reps++; }
      s.tick(STEP, null);
      if (s.state === 'playcall') {
        expect([m.possession, m.yardLine, m.down, Math.round(m.toGo)]).toEqual([0, 80, 3, 8]);
        expect(m.clock).toBe(clock0);
      }
    }
    expect(reps).toBe(6);
    expect(m.over).toBe(false);
  }, 60000);
});

describe('box score', () => {
  it('lists every player with stats in each category', async () => {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const { STAT_TABS, statRows, passerRating } = await import('../src/game/boxscore.js');
    const s = new GameSession({ teams, settings: { quarterMinutes: 5 }, humanTeam: null, seed: 4, fast: true });
    for (let i = 0; i < 2e6 && !s.match.over; i++) s.tick(STEP, null);
    const m = s.match;
    for (const tab of STAT_TABS) {
      const rows = statRows(m, tab.id);
      expect(rows.length, tab.id).toBeGreaterThan(0);
      for (const r of rows) expect(r.cells).toHaveLength(tab.cols.length);
    }
    // Rushing rows add up to the team totals.
    for (const t of [0, 1]) {
      const yds = Object.values(m.stats.players).filter((p) => p.team === t).reduce((a, p) => a + p.rushYds, 0);
      expect(Math.round(yds)).toBe(Math.round(m.stats.team[t].rushYds));
      expect(statRows(m, 'defense', t).every((r) => r.team === t)).toBe(true);
    }
    expect(passerRating({ passAtt: 20, passCmp: 20, passYds: 400, passTD: 5, int: 0 })).toBeCloseTo(158.3, 1);
  }, 60000);
});

describe('no-huddle and spike', () => {
  it('Y reruns the last play; B at the line spikes the ball', async () => {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const s = new GameSession({ teams, settings: { quarterMinutes: 15, penalties: false }, humanTeam: 0, seed: 12, fast: true });
    s.match.newPossession(0, 30, 0);
    s.enterPlaycall();
    s.humanChoose(getOffPlay('gun_doubles_mesh'));
    s.choice.def = getDefPlay('43_cover3');
    s.tick(STEP, null);
    expect(s.state).toBe('presnap');
    s.snap();
    for (let i = 0; i < 4000 && s.state !== 'playcall'; i++) s.tick(STEP, null);
    expect(s.state).toBe('playcall');
    expect(s.noHuddle()).toBe(true);
    expect(s.choice.off.id).toBe('gun_doubles_mesh');
    s.choice.def = getDefPlay('43_cover3');
    s.tick(STEP, null);
    expect(s.state).toBe('presnap');
    const down = s.match.down;
    s.match.clockRunning = true;
    expect(s.spike()).toBe(true);
    for (let i = 0; i < 4000 && s.state !== 'playcall'; i++) s.tick(STEP, null);
    if (s.match.phase === 'scrimmage' && s.match.possession === 0 && down < 4) {
      expect(s.match.down).toBe(down + 1);
      expect(s.match.clockRunning).toBe(false);
    }
  }, 60000);
});

describe('penalty choice', () => {
  async function playWithFoul(foulTeam) {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const s = new GameSession({ teams, settings: { quarterMinutes: 15, penalties: false }, humanTeam: 0, seed: 21 }); // only the planted foul
    s.match.newPossession(0, 30, 0);
    s.enterPlaycall();
    s.humanChoose(getOffPlay('gun_doubles_iz'));
    s.choice.def = getDefPlay('43_cover3');
    s.tick(STEP, null);
    s.snap();
    s.sim.fouls = [{ type: 'holding_def', team: foulTeam }];
    for (let i = 0; i < 6000 && s.state === 'live'; i++) s.tick(STEP, null);
    return s;
  }
  it('waits for the human to accept or decline a foul by the CPU', async () => {
    const s = await playWithFoul(1);
    expect(s.state).toBe('penalty');
    const c = s.pendingPenalty.choice;
    expect(c.name).toBe('Defensive holding');
    expect(c.accept).toMatch(/^1st & 10 on /);
    expect(c.decline).toMatch(/& |stands|downs/);
    const { emptyFrame } = await import('../src/input/actions.js');
    const f = emptyFrame(); f.pressed.A = true;
    s.tick(1 / 60, f);
    expect(s.state).toBe('post');
    expect(s.match.down).toBe(1);
    expect(s.match.yardLine).toBe(35);
  });
  it('decides automatically when the human committed the foul', async () => {
    const s = await playWithFoul(0);
    expect(['post', 'playcall']).toContain(s.state);
  });
});

describe('local 2-player', () => {
  it('lets both humans call plays and routes each controller to its own team', async () => {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const { emptyFrame } = await import('../src/input/actions.js');
    const s = new GameSession({ teams, settings: { quarterMinutes: 15 }, humanTeams: [0, 1], seed: 4 });
    expect(s.twoPlayer).toBe(true);
    s.match.newPossession(0, 30, 0);
    s.enterPlaycall();
    expect(s.needsHumanCall).toBe(true);
    expect(s.humanSide).toBe('offense');       // offense (team 0) calls first
    s.humanChoose(getOffPlay('gun_doubles_mesh'));
    expect(s.humanTeam).toBe(1);               // then the defense (team 1)
    expect(s.humanSide).toBe('defense');
    s.humanChoose(getDefPlay('43_cover3'));
    s.tick(STEP, null);
    expect(s.state).toBe('presnap');
    const sim = s.sim;
    expect(sim.controlled[0]).toBe(sim.bySlot(0, 'QB').id);
    expect(sim.players[sim.controlled[1]].team).toBe(1);
    // Player 2's A must not snap the ball; player 1's A does.
    const p2 = emptyFrame(); p2.pressed.A = true;
    s.tick(STEP, { perTeam: true, 0: emptyFrame(), 1: p2 });
    expect(s.state).toBe('presnap');
    // Players break the huddle and line up first (LINEUP_T), then the snap goes.
    for (let i = 0; i < 90; i++) s.tick(STEP, { perTeam: true, 0: emptyFrame(), 1: emptyFrame() });
    const p1 = emptyFrame(); p1.pressed.A = true;
    s.tick(STEP, { perTeam: true, 0: p1, 1: emptyFrame() });
    expect(s.state).toBe('live');
    for (let i = 0; i < 3000 && s.state === 'live'; i++) s.tick(STEP, { perTeam: true, 0: emptyFrame(), 1: emptyFrame() });
    expect(['post', 'penalty', 'playcall']).toContain(s.state);
  });
});

describe('injuries', () => {
  it('injured players sit out the rest of the game', async () => {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const sl = { user: {}, cpu: {}, penalties: 50, fatigue: 50, injuries: 5000 }; // absurd rate to force injuries
    const s = new GameSession({ teams, settings: { quarterMinutes: 15, sliders: sl }, humanTeam: null, seed: 6, fast: true });
    let checked = false;
    for (let i = 0; i < 400000 && !s.match.over && !checked; i++) {
      s.tick(STEP, null);
      if (s.injuries.length && s.state === 'presnap' && s.sim?.state === 'presnap') {
        const hurt = new Set(s.injuries.map((x) => `${x.team}:${x.rid}`));
        for (const p of s.sim.players) expect(hurt.has(`${p.team}:${p.rid}`)).toBe(false);
        checked = true;
      }
    }
    expect(checked).toBe(true);
    expect(s.injuries[0].type).toBeTruthy();
  }, 60000);
});

describe('delay of game', () => {
  it('resets the play clock instead of repeating forever', async () => {
    const { GameSession, STEP } = await import('../src/game/session.js');
    const { defaultTeams } = await import('../src/data/teams.js');
    const { generateLeagueRosters } = await import('../src/data/generator.js');
    const { listOffPlays } = await import('../src/data/playbook.js');
    const t = generateLeagueRosters(defaultTeams(), 5);
    const s = new GameSession({ teams: [t[0], t[1]], settings: { quarterMinutes: 5 }, humanTeam: 0, seed: 2 });
    s.match.newPossession(0, 30, 0); s.enterPlaycall();
    let flags = 0;
    for (let k = 0; k < 60 * 40; k++) { // 40 s without snapping
      if (s.needsHumanCall) s.humanChoose(listOffPlays()[0]);
      s.tick(STEP, null);
      for (const e of s.events) if (e.type === 'flag' && e.foul?.type === 'delay_of_game') flags++;
    }
    expect(flags).toBe(1);
    expect(s.match.playClock).toBeGreaterThan(5);
  });
});
