import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { RNG } from '../src/core/rng.js';
import { createFranchise, simGame, userGame } from '../src/franchise/franchise.js';
import { createCareerPlayer, startCareer, careerPlayer, gameXP, trainRating, upgradeCost, careerKeys } from '../src/franchise/career.js';
import { GameSession } from '../src/game/session.js';
import { STEP } from '../src/core/constants.js';
import { emptyFrame } from '../src/input/actions.js';

describe('career mode', () => {
  it('creates a starter flagged as the career player', () => {
    const teams = generateLeagueRosters(defaultTeams(), 11);
    const p = createCareerPlayer(teams[4], { first: 'Test', last: 'Player', pos: 'WR', number: 88 }, new RNG(3));
    expect(p.career).toBe(true);
    expect(teams[4].roster).toContain(p);
    expect(teams[4].depth.WR[0]).toBe(p.id);
    expect(p.age).toBe(21);
    expect(careerKeys('WR').slice(0, 3)).toEqual(expect.arrayContaining(['speed', 'catching']));
  });

  it('earns XP from games and spends points on ratings', () => {
    const teams = generateLeagueRosters(defaultTeams(), 12);
    const f = createFranchise(teams, { userTeam: 2, weeks: 6, seed: 5 });
    const p = createCareerPlayer(teams[2], { first: 'A', last: 'B', pos: 'HB', number: 30 }, new RNG(4));
    startCareer(f, p);
    expect(gameXP({ rushAtt: 20, rushYds: 120, rushTD: 2 }, 'HB')).toBeGreaterThan(gameXP({ rushAtt: 5, rushYds: 10 }, 'HB'));
    const before = f.career.points;
    simGame(f, teams, userGame(f)); // quick-simmed games count too
    expect(f.career.games.length).toBe(1);
    expect(f.career.points * 100 + f.career.xp).toBeGreaterThan(before * 100);
    const v = p.ratings.speed;
    f.career.points = 10;
    expect(trainRating(f, p, 'speed')).toBe(true);
    expect(p.ratings.speed).toBe(v + 1);
    expect(f.career.points).toBe(10 - upgradeCost(v));
    expect(careerPlayer(f, teams)).toBe(p);
  });

  it('locks control to the player: CPU snaps, he never switches, off-field snaps run CPU vs CPU', () => {
    const teams = generateLeagueRosters(defaultTeams(), 13);
    const p = createCareerPlayer(teams[0], { first: 'C', last: 'D', pos: 'WR', number: 81 }, new RNG(5));
    const s = new GameSession({ teams: [teams[0], teams[1]], settings: { quarterMinutes: 2, lockPlayer: p.id, sliders: { injuries: 0 } }, humanTeam: 0, seed: 9 });
    const f = emptyFrame();
    let onField = 0, watched = 0, plays = 0, lastSim = null;
    for (let k = 0; k < 60 * 60 * 12 && s.state !== 'over' && plays < 40; k++) {
      expect(s.needsHumanCall).toBe(false); // a WR never calls plays
      s.tick(STEP, f);
      if (s.sim && s.sim !== lastSim && s.state === 'presnap') {
        lastSim = s.sim; plays++;
        if (s.watching) watched++;
        else { onField++; expect(s.sim.players[s.sim.lockId].rid).toBe(p.id); }
      }
      if (s.sim && !s.watching && s.sim.lockId >= 0 && s.sim.humanTeam === 0) expect(s.sim.controlledId).toBe(s.sim.lockId);
    }
    expect(plays).toBeGreaterThan(10); // the CPU snaps for him: the game moves on without input
    expect(onField).toBeGreaterThan(2);
    expect(watched).toBeGreaterThan(2);
  }, 60000);

  it('the offseason never retires or cuts the career player', async () => {
    const O = await import('../src/franchise/offseason.js');
    const teams = generateLeagueRosters(defaultTeams(), 14);
    const f = createFranchise(teams, { userTeam: 1, weeks: 6, seed: 2 });
    const p = createCareerPlayer(teams[1], { first: 'E', last: 'F', pos: 'CB', number: 21 }, new RNG(6));
    startCareer(f, p);
    p.age = 37; p.ratings.coverage = 40;
    f.offseason = { step: 'progression' };
    O.progressPlayers(f, teams);
    expect(teams[1].roster).toContain(p);
    expect(p.years).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) teams[1].roster.push({ ...teams[1].roster[0], id: 900000 + i, ovr: 30 });
    O.cutDown(teams[1], 53);
    expect(teams[1].roster).toContain(p);
  });
});
