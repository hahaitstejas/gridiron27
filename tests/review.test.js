import { describe, it, expect } from 'vitest';
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { GameSession } from '../src/game/session.js';
import { emptyFrame } from '../src/input/actions.js';
import { listOffPlays, listDefPlays } from '../src/data/playbook.js';
import { closeCall, settleReview, boothReviews } from '../src/game/review.js';

const base = { offTeam: 0, dir: 1, losX: 0, spotX: 8, yards: 8, touchdown: null, turnover: false, incomplete: false, complete: true,
  carrierId: 5, receiver: 5, reason: 'tackle', interception: false, fumble: false, safety: false, outOfBounds: false };
const simLike = (o = {}) => ({ isKick: false, stats: { catchZ: 0 }, firstDownX: 30, ...o });

describe('close calls and reviews', () => {
  it('a sideline catch can be ruled incomplete; a review restores the catch and the challenge is kept', () => {
    let wrong = null;
    for (let i = 0; i < 60 && !wrong; i++) { const cc = closeCall(base, simLike({ stats: { catchZ: 26.3 } }), new RNG(i)); if (cc.wrong) wrong = cc; }
    expect(wrong.kind).toBe('sideline');
    expect(wrong.call.complete).toBe(false);
    expect(wrong.hurt).toBe(0);
    const m = { challenges: [2, 2], timeouts: [3, 3] };
    const s = settleReview(m, wrong, 0);
    expect(s.reversed).toBe(true);
    expect(s.result.complete).toBe(true);
    expect(m.challenges[0]).toBe(2);
    expect(m.timeouts[0]).toBe(3);
  });
  it('a challenge that loses costs a challenge and a timeout', () => {
    let right = null;
    for (let i = 0; i < 60 && !right; i++) { const cc = closeCall({ ...base, spotX: 30.05 }, simLike(), new RNG(i)); if (cc && !cc.wrong) right = cc; }
    expect(right.kind).toBe('spot');
    const m = { challenges: [2, 2], timeouts: [3, 3] };
    const s = settleReview(m, right, right.hurt);
    expect(s.reversed).toBe(false);
    expect(m.challenges[right.hurt]).toBe(1);
    expect(m.timeouts[right.hurt]).toBe(2);
  });
  it('spots near the line to gain and runners just short of the goal line are close calls; others are not', () => {
    expect(closeCall({ ...base, spotX: 29.8 }, simLike(), new RNG(1))?.kind).toBe('spot');
    expect(closeCall({ ...base, spotX: 49.7, complete: false }, simLike({ firstDownX: 55 }), new RNG(1))?.kind).toBe('goal');
    expect(closeCall({ ...base, spotX: 20 }, simLike(), new RNG(1))).toBe(null);
    expect(boothReviews({ quarter: 4, clock: 90 }, { call: { touchdown: null } })).toBe(true);
    expect(boothReviews({ quarter: 3, clock: 90 }, { call: { touchdown: null } })).toBe(false);
  });
  it('games with reviews run to the end (CPU challenges, booth reviews, a human who never answers)', () => {
    const teams = generateLeagueRosters(defaultTeams(), 21);
    let reviews = 0, done = 0;
    for (const humanTeam of [undefined, 0]) {
      const s = new GameSession({ teams: [teams[8], teams[9]], settings: { quarterMinutes: 3 }, humanTeam, seed: 33 });
      const f = emptyFrame();
      for (let k = 0; k < 60 * 60 * 60 && s.state !== 'over'; k++) {
        if (s.state === 'penalty') s.choosePenalty(true);
        if (s.needsHumanCall) s.humanChoose(s.humanSide === 'defense' ? listDefPlays()[k % 40] : listOffPlays()[k % 100]);
        f.pressed.A = k % 90 === 0; // snap / kick meter / play on
        s.tick(STEP, humanTeam === undefined ? null : f);
        for (const e of s.events) { if (e.type === 'review') reviews++; if (e.type === 'reviewDone') done++; }
      }
      expect(s.state).toBe('over');
    }
    expect(done).toBeLessThanOrEqual(reviews);
  }, 120000);
});

describe('new penalties', async () => {
  const { enforce, valueOfPlay, PENALTIES, KICK_FOULS } = await import('../src/game/penalties.js');
  const { Match } = await import('../src/game/match.js');
  it('enforce the new fouls with the right yardage and first downs', () => {
    const teams = generateLeagueRosters(defaultTeams(), 3);
    const m = new Match({ teams: [teams[0], teams[1]], settings: { quarterMinutes: 15 }, rng: new RNG(1) });
    m.newPossession(0, 40, 0);
    const out = (type, team) => enforce(m, { type, team }, null);
    expect(out('illegal_contact', 1)).toMatchObject({ newYL: 45, autoFirst: true });
    expect(out('opi', 0).newYL).toBe(30);
    expect(out('illegal_formation', 0).newYL).toBe(35);
    expect(out('unr_def', 1)).toMatchObject({ newYL: 55, autoFirst: true });
    expect(out('roughing_kicker', 1)).toMatchObject({ newYL: 55, autoFirst: true });
    expect(KICK_FOULS.has('running_into_kicker')).toBe(true);
    expect(Object.keys(PENALTIES).length).toBeGreaterThanOrEqual(19);
    // A made field goal is worth 3 when deciding whether to take a kicker foul.
    expect(valueOfPlay(m, { offTeam: 0, kickType: 'fg', possTeam: 0, fgGood: true, touchdown: null })).toBe(3);
  });
});
