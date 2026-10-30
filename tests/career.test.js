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

describe('hard count', () => {
  it('sometimes draws the defense offside (free play), sometimes flinches, once per play', async () => {
    const { defaultTeams: dt } = await import('../src/data/teams.js');
    const teams = generateLeagueRosters(dt(), 21);
    let jump = 0, flinch = 0, none = 0;
    for (let i = 0; i < 200; i++) {
      const s = new GameSession({ teams: [teams[0], teams[1]], settings: { quarterMinutes: 5 }, humanTeam: 0, seed: 100 + i, fast: true });
      s.match.newPossession(0, 30, 0); s.enterPlaycall();
      s.humanChoose((await import('../src/data/playbook.js')).listOffPlays()[i % 20]);
      for (let k = 0; k < 5 && s.state === 'playcall'; k++) s.tick(STEP, null);
      s.events.length = 0;
      expect(s.hardCount()).toBe(true);
      expect(s.hardCount()).toBe(false); // once per play
      const r = s.events.find((e) => e.type === 'hardCount').result;
      if (r === 'jump') { jump++; expect(s.state).toBe('live'); expect(s.sim.fouls.some((f) => f.type === 'offsides_live')).toBe(true); }
      else if (r === 'flinch') flinch++; else none++;
    }
    expect(jump).toBeGreaterThan(2); expect(jump).toBeLessThan(30);
    expect(flinch).toBeGreaterThan(0); expect(none).toBeGreaterThan(140);
  });
});

describe('broadcast info', () => {
  it('logs a play-by-play line for every play and a summary for every drive', async () => {
    const { defaultTeams: dt } = await import('../src/data/teams.js');
    const teams = generateLeagueRosters(dt(), 31);
    const s = new GameSession({ teams: [teams[2], teams[3]], settings: { quarterMinutes: 15 }, seed: 8, fast: true });
    const lines = [], drives = [];
    for (let k = 0; k < 2e6 && s.state !== 'over'; k++) {
      s.tick(STEP, null);
      for (const e of s.events) {
        if (e.type === 'result') lines.push(s.match.lastPlayText);
        if (e.type === 'message' && e.kind === 'drive') drives.push(e.text);
      }
    }
    expect(lines.length).toBeGreaterThan(80);
    expect(lines.every((l) => typeof l === 'string' && l.length > 5 && !/undefined|NaN/.test(l))).toBe(true);
    const D = s.match.drives;
    expect(D.length).toBeGreaterThan(12);
    expect(D.length).toBe(drives.length);
    const ok = ['Touchdown', 'Field goal', 'Missed field goal', 'Interception', 'Fumble', 'Punt', 'Safety', 'Turnover on downs', 'End of half', 'End of game'];
    expect(D.every((d) => ok.includes(d.result) && d.plays >= 1 && d.yards <= 100 && d.secs >= 0)).toBe(true);
    // Every touchdown drive covered the rest of the field from where it started.
    for (const d of D.filter((x) => x.result === 'Touchdown')) expect(d.yards).toBe(100 - Math.round(d.start));
  }, 60000);
});

describe('traits', () => {
  it('come from ratings and fire during plays', async () => {
    const { traitsOf } = await import('../src/data/traits.js');
    expect(traitsOf({ pos: 'WR', ratings: { catching: 90, routeRunning: 70 } })).toEqual(['sureHands']);
    expect(traitsOf({ pos: 'CB', ratings: { catching: 90 } })).toEqual([]); // wrong position for Sure Hands
    const { defaultTeams: dt } = await import('../src/data/teams.js');
    const teams = generateLeagueRosters(dt(), 41);
    // Give one team stars everywhere so the traits come up.
    for (const p of teams[5].roster) for (const k of ['catching', 'routeRunning', 'passBlock', 'coverage', 'tackling', 'hitPower', 'passRush', 'breakTackle']) p.ratings[k] = 95;
    const seen = new Set();
    for (let g = 0; g < 2; g++) {
      const s = new GameSession({ teams: g ? [teams[5], teams[6]] : [teams[6], teams[5]], settings: { quarterMinutes: 15 }, seed: 50 + g, fast: true });
      for (let k = 0; k < 2e6 && s.state !== 'over'; k++) { s.tick(STEP, null); for (const e of s.events) if (e.type === 'trait') seen.add(e.trait); }
    }
    for (const t of ['sureHands', 'lockdown', 'enforcer']) expect(seen.has(t)).toBe(true);
  }, 90000);
});

describe('defensive hot routes', () => {
  it('reassign the controlled defender and keep him controlled', async () => {
    const { defaultTeams: dt } = await import('../src/data/teams.js');
    const { emptyFrame: ef } = await import('../src/input/actions.js');
    const teams = generateLeagueRosters(dt(), 61);
    const s = new GameSession({ teams: [teams[0], teams[1]], settings: { quarterMinutes: 5, penalties: false }, humanTeam: 1, seed: 4, fast: true });
    s.match.newPossession(0, 30, 0); s.enterPlaycall();
    const { listDefPlays } = await import('../src/data/playbook.js');
    s.humanChoose(listDefPlays().find((p) => p.coverage === 'zone'));
    for (let k = 0; k < 5 && s.state === 'playcall'; k++) s.tick(STEP, null);
    const sim = s.sim;
    const me = sim.withHuman(1, () => sim.players[sim.controlledId]);
    s.openAudible('dhot', 1);
    expect(s.audible.mode).toBe('dhot');
    const f = ef(); f.pressed.A = true; // blitz
    s.audibleInput(f);
    expect(s.choice.def.assign[me.slot]).toBe('blitz');
    const now = s.sim.withHuman(1, () => s.sim.players[s.sim.controlledId]);
    expect(now.slot).toBe(me.slot);
  });
});

describe('career over several seasons', () => {
  it('keeps the career player through three full seasons and offseasons with valid rosters', async () => {
    const O = await import('../src/franchise/offseason.js');
    const F = await import('../src/franchise/franchise.js');
    const { payroll } = await import('../src/franchise/contracts.js');
    const lg = generateLeagueRosters((await import('../src/data/teams.js')).defaultTeams(), 71);
    const f = F.createFranchise(lg, { userTeam: 6, weeks: 6, seed: 3 });
    const p = createCareerPlayer(lg[6], { first: 'Long', last: 'Haul', pos: 'WR', number: 11 }, new RNG(8));
    startCareer(f, p);
    for (let season = 0; season < 3; season++) {
      while (f.phase !== 'offseason') { F.simOthers(f, lg); const g = F.userGame(f); if (g && !g.score) F.simGame(f, lg, g); F.advance(f, lg); }
      O.progressPlayers(f, lg);
      O.finishResigning(f, lg);
      O.cpuFreeAgency(f, lg);
      O.makeDraft(f, lg);
      O.simToUserPick(f, lg);
      while (f.offseason.draft.at < f.offseason.draft.picks.length) {
        if (f.offseason.draft.picks[f.offseason.draft.at].team === 6) O.makePick(f, lg, f.offseason.draft.cls[0].id);
        O.simToUserPick(f, lg);
        if (f.offseason.draft.picks[f.offseason.draft.at]?.team !== 6) break;
      }
      O.finishDraft(f, lg);
      O.cpuCutDowns(f, lg);
      O.cutDown(lg[6], 53, f.cap);
      O.fillRoster(f, lg[6], 46); // as the offseason screen does for your team
      F.startNextSeason(f, lg);
      expect(lg[6].roster).toContain(p);
      expect(p.age).toBe(22 + season);
      // Every regular-season game he was healthy for counts (injuries sit him out).
      const played = f.career.games.filter((g) => g.year === f.year - 1 && g.week !== null);
      expect(played.length).toBeGreaterThanOrEqual(2);
      expect(played.every((g) => g.xp >= 10)).toBe(true);
      for (const t of lg) {
        expect(t.roster.length).toBeLessThanOrEqual(53);
        expect(t.roster.length).toBeGreaterThanOrEqual(45);
        for (const ids of Object.values(t.depth)) for (const id of ids) expect(t.roster.some((q) => q.id === id)).toBe(true);
      }
      expect(payroll(lg[6])).toBeLessThanOrEqual(f.cap + 1e-6);
    }
    expect(f.year).toBe(2030);
    expect(f.career.points * 100 + f.career.xp).toBeGreaterThan(300);
  }, 120000);
});
