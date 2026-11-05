import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { buildDepthChart, fbFallback } from '../src/data/depthChart.js';
import { createFranchise, weekInBetween } from '../src/franchise/franchise.js';
import { releasePlayer } from '../src/data/rosterOps.js';

describe('Update 1.1', () => {
  it('no fullback: the third tight end plays FB before a halfback', () => {
    const teams = generateLeagueRosters(defaultTeams(), 4);
    const t = teams[3];
    t.roster = t.roster.filter((p) => p.pos !== 'FB');
    t.depth = buildDepthChart(t.roster);
    const tes = t.roster.filter((p) => p.pos === 'TE').length;
    const first = t.roster.find((p) => p.id === fbFallback(t)[0]);
    expect(first.pos).toBe(tes >= 3 ? 'TE' : 'HB');
    expect(t.depth.FB[0]).toBe(first.id);
  });

  it('CPU teams always have a kicker and a punter', () => {
    const teams = generateLeagueRosters(defaultTeams(), 5);
    const f = createFranchise(teams, { userTeam: 0, seed: 2 });
    for (const p of teams[7].roster.filter((q) => q.pos === 'K')) releasePlayer(teams[7], p.id);
    for (const p of teams[8].roster.filter((q) => q.pos === 'P')) p.injury = { name: 'Hamstring strain', weeks: 3 };
    weekInBetween(f, teams);
    expect(teams[7].roster.some((p) => p.pos === 'K')).toBe(true);
    const k = teams[7].roster.find((p) => p.id === teams[7].depth.K[0]);
    expect(k.pos).toBe('K');
    const pt = teams[8].roster.find((p) => p.id === teams[8].depth.P[0]);
    expect(pt.pos).toBe('P');
    expect(pt.injury?.weeks > 0).toBe(false);
  });
});

describe('practice squad', () => {
  it('undoing an elevation gives it back; releasing makes him a free agent', async () => {
    const { addToPS, elevate, unelevate, releaseFromPS } = await import('../src/franchise/practiceSquad.js');
    const { generatePlayer } = await import('../src/data/generator.js');
    const { RNG } = await import('../src/core/rng.js');
    const teams = generateLeagueRosters(defaultTeams(), 6);
    const t = teams[0];
    const p = generatePlayer('WR', new RNG(1), -10, { age: 22 });
    addToPS(t, p);
    const n = t.roster.length;
    expect(elevate(t, p)).toBe(true);
    expect(t.roster.length).toBe(n + 1);
    expect(unelevate(t, p)).toBe(true);
    expect(t.roster.length).toBe(n);
    expect(p.elevations).toBe(0);
    expect(Object.values(t.depth).some((ids) => ids.includes(p.id))).toBe(false);
    const pool = [];
    elevate(t, p);
    expect(releaseFromPS(t, p, (q) => pool.push(q))).toBe(true);
    expect(pool).toEqual([p]);
    expect(t.ps.includes(p)).toBe(false);
    expect(t.roster.includes(p)).toBe(false);
  });
});

describe('names', () => {
  it('generated leagues never use a blocked (real) name', async () => {
    const { blockedName, FIRST_NAMES, LAST_NAMES } = await import('../src/data/names.js');
    expect(blockedName('Caleb', 'Williams')).toBe(true);
    const teams = generateLeagueRosters(defaultTeams(), 11);
    expect(teams.flatMap((t) => t.roster).some((p) => blockedName(p.first, p.last))).toBe(false);
    expect(FIRST_NAMES.length * LAST_NAMES.length).toBeGreaterThan(1000);
  });
});

describe('pre-snap movement', () => {
  it('a human defender walks around before the snap but never into the neutral zone', async () => {
    const { PlaySim } = await import('../src/sim/play.js');
    const { RNG } = await import('../src/core/rng.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const lg = generateLeagueRosters(defaultTeams(), 3);
    const sim = new PlaySim({ rng: new RNG(2), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -10, ballZ: 0, offPlay: getOffPlay('ace_inside_zone'), defPlay: getDefPlay('43_cover3'), humanTeam: 1, camDir: -1 });
    const me = sim.players[sim.controlledId];
    expect(me.team).toBe(1);
    const x0 = me.x, z0 = me.z;
    // Stick "up" for the defense's camera = toward the offense; hold it for 4 seconds.
    const f = { lx: 0.4, ly: -1, rx: 0, ry: 0, lt: 0, rt: 0, down: {}, pressed: {}, released: {}, held: {}, flick: {} };
    for (let k = 0; k < 240; k++) sim.tick(STEP, f);
    expect(Math.hypot(me.x - x0, me.z - z0)).toBeGreaterThan(1);
    expect(sim.toLocal(me.x, me.z).down).toBeGreaterThanOrEqual(0.9);
    sim.snap();
    for (let k = 0; k < 600 && !sim.finished; k++) sim.tick(STEP, null);
    expect(sim.state === 'dead' || sim.finished).toBe(true);
  });
});

describe('league book (one spreadsheet)', () => {
  it('round-trips the league through one file with sections', async () => {
    const { exportLeagueBook, importLeagueBook, isLeagueBook, splitLeagueBook } = await import('../src/data/leagueBook.js');
    const { ensureCoaches } = await import('../src/data/extraCSV.js');
    const a = generateLeagueRosters(defaultTeams(), 21);
    ensureCoaches(a, 3);
    a[4].city = 'Harbor Point'; a[4].roster[0].last = 'Testerson'; a[4].roster[0].ratings.speed = 97;
    a[2].retired = [{ number: 12, player: 'Old Star' }];
    const text = exportLeagueBook(a, { playAs: 4 });
    expect(isLeagueBook(text)).toBe(true);
    expect(Object.keys(splitLeagueBook(text))).toEqual(['LEAGUE', 'TEAMS', 'ROSTER', 'DEPTH', 'COACHES', 'UNIFORMS', 'STADIUMS', 'RETIRED_NUMBERS', 'FREE_AGENTS', 'SCHEDULE']);
    // Spreadsheet apps pad marker rows with commas and add blank rows: still fine.
    const padded = text.replace(/^\[(\w+)\]$/gm, '[$1],,,,').replace(/\n\[/g, '\n,,,\n[');
    const b = generateLeagueRosters(defaultTeams(), 99);
    const r = importLeagueBook(b, padded);
    expect(r.playAs).toBe(4);
    expect(b[4].city).toBe('Harbor Point');
    expect(b[4].roster.some((p) => p.last === 'Testerson' && p.ratings.speed === 97)).toBe(true);
    expect(b[2].retired).toEqual([{ number: 12, player: 'Old Star' }]);
    expect(b[5].coaches.hc.name).toBe(a[5].coaches.hc.name);
    expect(r.freeAgents).toBe(null);
    expect(r.problems.filter((p) => !/depth/i.test(p))).toEqual([]);
  });
  it('a [LEAGUE] section sets the league name and the league / conference logo images (links or logos/ files)', async () => {
    const { LEAGUE, leagueInfoJSON, setLeagueInfo } = await import('../src/data/leagueInfo.js');
    const { importLeagueBook } = await import('../src/data/leagueBook.js');
    const before = leagueInfoJSON();
    const t = generateLeagueRosters(defaultTeams(), 5);
    const r = importLeagueBook(t, '[TEAMS]\nid,city,name,abbr,conference\n0,Aa,Bb,AAB,East\n1,Cc,Dd,CCD,West\n[LEAGUE]\nkey,value\nname,Test League\nlogo_image,https://x.test/l.png\nEast logo,e.png\nconference2_logo,https://x.test/w.png\n');
    expect(LEAGUE.name).toBe('Test League');
    expect(r.leagueImages).toEqual([{ target: 'league', file: 'https://x.test/l.png' }, { target: 0, file: 'e.png' }, { target: 1, file: 'https://x.test/w.png' }]);
    expect(leagueInfoJSON().confLogos).toEqual([{ image: 'e.png' }, { image: 'https://x.test/w.png' }]);
    setLeagueInfo(before);
  });
});

describe('RPO', () => {
  it('the CPU QB both hands off and pulls; a human holding LT always pulls and can throw', async () => {
    const { PlaySim } = await import('../src/sim/play.js');
    const { RNG } = await import('../src/core/rng.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, listDefPlays } = await import('../src/data/playbook.js');
    const lg = generateLeagueRosters(defaultTeams(), 8);
    let pulls = 0, gives = 0;
    for (let i = 0; i < 40; i++) {
      const sim = new PlaySim({ rng: new RNG(50 + i), teams: [lg[i % 32], lg[(i + 3) % 32]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: getOffPlay('rpo_iz_slant'), defPlay: listDefPlays()[i % listDefPlays().length], humanTeam: null });
      sim.snap();
      for (let k = 0; k < 900 && !sim.finished; k++) { sim.tick(STEP, null); if (sim.events.some((e) => e.type === 'rpoPull')) pulls++; if (sim.events.some((e) => e.type === 'handoff')) gives++; }
    }
    expect(pulls).toBeGreaterThan(3);
    expect(gives).toBeGreaterThan(3);
    const sim = new PlaySim({ rng: new RNG(5), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: getOffPlay('rpo_iz_slant'), defPlay: listDefPlays()[0], humanTeam: 0 });
    sim.snap();
    const f = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 1, rt: 0, down: {}, pressed: {}, released: {}, held: {}, flick: {} };
    let pulled = false;
    for (let k = 0; k < 60; k++) { sim.tick(STEP, f); if (sim.events.some((e) => e.type === 'rpoPull')) pulled = true; }
    expect(pulled).toBe(true);
    expect(sim.offPlay.type).toBe('pass');
  });
});

describe('audible packages', () => {
  it('the audible menu uses the saved package for that formation', async () => {
    const { offenseAudibles, setAudiblePackages, defaultPackage } = await import('../src/game/audibles.js');
    const { getOffPlay, listOffPlays } = await import('../src/data/playbook.js');
    const play = getOffPlay('ace_inside_zone');
    const def = defaultPackage('off', 'singleback_ace');
    expect(Object.keys(def).length).toBeGreaterThan(2);
    const ace = listOffPlays().filter((p) => p.formation === 'singleback_ace').map((p) => p.id);
    setAudiblePackages({ off: { singleback_ace: { A: 'ace_seams', B: 'ace_smash', X: 'ace_power_l', Y: 'ace_counter' } } });
    const opts = offenseAudibles(play);
    expect(opts.map((o) => o.btn)).toEqual(['A', 'B', 'X', 'Y', 'RB']);
    expect(opts[0].play.id).toBe('ace_seams');
    expect(ace.includes('ace_seams')).toBe(true);
    setAudiblePackages({});
    expect(offenseAudibles(play).length).toBeGreaterThan(2);
  });
});

describe('pre-snap read', () => {
  it('reads two-high vs one-high correctly most of the time for an aware QB', async () => {
    const { PlaySim } = await import('../src/sim/play.js');
    const { RNG } = await import('../src/core/rng.js');
    const { getOffPlay, listDefPlays } = await import('../src/data/playbook.js');
    const { coverageRead } = await import('../src/game/reads.js');
    const { shellOf } = await import('../src/ai/defense.js');
    const lg = generateLeagueRosters(defaultTeams(), 4);
    let right = 0, n = 0;
    for (const dp of listDefPlays()) {
      const sim = new PlaySim({ rng: new RNG(3), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: getOffPlay('ace_drive'), defPlay: dp, humanTeam: 0 });
      const r = coverageRead(sim);
      expect(r.text.length).toBeGreaterThan(5);
      n++; if (r.shell === Math.min(2, shellOf(dp))) right++;
    }
    expect(right / n).toBeGreaterThan(0.6);
  });
});

describe('kickoff out of bounds', () => {
  it('the human receiving team chooses: ball at the 40 or a re-kick from 5 yards back', async () => {
    const { GameSession } = await import('../src/game/session.js');
    const { STEP } = await import('../src/core/constants.js');
    const lg = generateLeagueRosters(defaultTeams(), 12);
    for (const accept of [false, true]) {
      const s = new GameSession({ teams: [lg[0], lg[1]], settings: { quarterMinutes: 15 }, humanTeam: 1, seed: 4, fast: false });
      const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
      // The CPU (team 0) kicks off to the human; force the kick out of bounds and let the session judge it.
      s.match.setupKickoff(0, 35);
      s.choice = { off: getOffPlay('st_kickoff'), def: getDefPlay('st_kick_return') };
      s.state = 'playcall';
      s.tick(STEP, null);
      expect(s.state).toBe('presnap');
      s.sim.snap();
      s.sim.result = { ...s.sim.buildResult('kickOOB'), kickOOB: true };
      s.sim.state = 'dead';
      s.finishPlay();
      expect(s.state).toBe('penalty');
      expect(s.pendingPenalty.choice.name).toBe('Kickoff out of bounds');
      s.choosePenalty(accept);
      if (accept) { expect(s.match.phase).toBe('kickoff'); expect(s.match.yardLine).toBe(30); }
      else { expect(s.match.phase).toBe('scrimmage'); expect(s.match.possession).toBe(1); expect(s.match.yardLine).toBe(40); }
    }
  });
});

describe('league book: other leagues\' sheets', () => {
  it('takes custom conference names, extra uniform sets, 24-hour kickoffs and salaries in dollars', async () => {
    const { importLeagueBook } = await import('../src/data/leagueBook.js');
    const { CONFERENCES } = await import('../src/data/teams.js');
    const { uniformFor } = await import('../src/data/uniforms.js');
    const keep = [...CONFERENCES];
    const lg = generateLeagueRosters(defaultTeams(), 30);
    const t0 = lg[0].abbr, t1 = lg[1].abbr;
    const rows = lg.map((t, i) => `${i},${t.city},${t.name},${t.abbr},#112233,#445566,#ffffff,${i < 16 ? 'East Conf' : 'West Conf'},North,circle,${t.abbr},,`).join('\n');
    const text = `[TEAMS]\nid,city,name,abbr,primary,secondary,accent,conference,division,logo_shape,logo_text,logo_image,play_as\n${rows}\n\n`
      + `[ROSTER]\nteam,first,last,pos,number,salary,years\n${t0},Test,Passer,QB,9,42000000,3\n\n`
      + `[UNIFORMS]\nteam,kind,jersey,pants,number,number_outline,helmet\n${t0},throwback,#aa0000,#ffffff,#ffffff,#000000,#ffffff\n${t0},Color Rush,#00aa00,#00aa00,#ffffff,#000000,#00aa00\n\n`
      + `[SCHEDULE]\nweek,away,home,day,date,time\n1,${t1},${t0},Thu,2027-09-09,20:20\n`;
    const r = importLeagueBook(lg, text);
    expect(r.problems).toEqual([]);
    expect(CONFERENCES.slice(0, 2)).toEqual(['East Conf', 'West Conf']);
    expect(lg[20].conference).toBe(1);
    expect(lg[0].roster.find((p) => p.last === 'Passer').salary).toBe(42);
    expect(uniformFor(lg[0], 'throwback').jersey).toBe('#aa0000');
    expect(uniformFor(lg[0], 'color_rush').jersey).toBe('#00aa00');
    expect(r.schedule[0][0].time).toBe('8:20 PM');
    CONFERENCES.splice(0, 2, ...keep.slice(0, 2));
  });
});

describe('local co-op', () => {
  it('player 2 runs his own man on the same team (a receiver on offense, a defender on defense)', async () => {
    const { PlaySim } = await import('../src/sim/play.js');
    const { RNG } = await import('../src/core/rng.js');
    const { STEP } = await import('../src/core/constants.js');
    const { getOffPlay, getDefPlay } = await import('../src/data/playbook.js');
    const lg = generateLeagueRosters(defaultTeams(), 13);
    for (const humanTeam of [0, 1]) {
      const sim = new PlaySim({ rng: new RNG(1), teams: [lg[0], lg[1]], offIdx: 0, dir: 1, losX: -20, ballZ: 0, offPlay: getOffPlay('ace_drive'), defPlay: getDefPlay('43_cover3'), humanTeam, coop: true, camDir: humanTeam === 0 ? 1 : -1 });
      const p2 = sim.players[sim.coopId];
      expect(p2.team).toBe(humanTeam);
      expect(p2.id).not.toBe(sim.controlled[humanTeam]);
      sim.snap();
      const start = { x: p2.x, z: p2.z };
      const idle = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, down: {}, pressed: {}, released: {}, held: {}, flick: {} };
      const f = { ...idle, coop: { ...idle, lx: 1 } }; // player 2 holds the stick sideways
      for (let k = 0; k < 40; k++) sim.tick(STEP, f);
      expect(Math.abs(p2.z - start.z)).toBeGreaterThan(1.5);
      expect(sim.isHumanControlled(p2)).toBe(true);
    }
  });
});

describe('uniform creator', () => {
  it('details round-trip through the uniforms sheet; plain sheets keep their columns', async () => {
    const { exportUniforms, importUniforms } = await import('../src/data/extraCSV.js');
    const { parseCSV } = await import('../src/data/csv.js');
    const a = generateLeagueRosters(defaultTeams(), 40);
    expect(exportUniforms(a).split('\n')[0]).toBe('team,kind,jersey,pants,number,number_outline,helmet');
    a[3].uniforms = { home: { jersey: '#123456', sleeves: '#abcdef', stripe: '#ff0000', socks: '#00ff00' } };
    const csv = exportUniforms(a);
    expect(csv.split('\n')[0]).toContain('sleeves');
    const b = generateLeagueRosters(defaultTeams(), 41);
    importUniforms(b, parseCSV(csv));
    expect(b[3].uniforms.home).toMatchObject({ jersey: '#123456', sleeves: '#abcdef', stripe: '#ff0000', socks: '#00ff00' });
  });
});

describe('play designer', () => {
  it('custom routes, custom defenses and share codes', async () => {
    const D = await import('../src/data/customDesign.js');
    const { buildPlay, newSpec } = await import('../src/data/customPlays.js');
    const { listDefPlays, getDefPlay } = await import('../src/data/playbook.js');
    const { testPlay } = await import('../src/game/playtest.js');
    const { chooseDefense } = await import('../src/ai/playcaller.js');
    const { Match } = await import('../src/game/match.js');
    const { RNG } = await import('../src/core/rng.js');
    const lg = generateLeagueRosters(defaultTeams(), 50);
    // A drawn route: out 8, then up the sideline.
    const route = { id: 'cr_test', name: 'Out and up', pts: [[8, 0], [9, 6], [25, 7]], end: 'continue' };
    D.registerCustomRoutes([route]);
    const spec = newSpec('my_test');
    const slot = Object.keys(spec.routes).find((s) => spec.routes[s] !== 'block');
    spec.routes[slot] = 'cr_test';
    const play = buildPlay(spec);
    expect(play.routes[slot]).toBe('cr_test');
    expect(testPlay(play, lg, 2).ok).toBe(true);
    // Share code round-trip carries the route along.
    const code = D.shareCode('off', spec, [route]);
    const back = D.readShareCode(code);
    expect(back.spec.routes[slot]).toBe('cr_test');
    expect(back.routes[0].pts).toEqual(route.pts);
    // A custom defense: all-out blitz from the base 4-3.
    const ds = D.newDefSpec('mydef_test', '43_base');
    for (const s of ['MLB', 'LOLB', 'ROLB']) ds.assign[s] = 'blitz';
    D.registerCustomDefPlays([ds]);
    expect(listDefPlays().some((p) => p.id === 'mydef_test' && p.custom)).toBe(true);
    expect(getDefPlay('mydef_test').assign.MLB).toBe('blitz');
    // The CPU never calls it.
    const m = new Match({ teams: [lg[0], lg[1]], settings: { quarterMinutes: 5 }, rng: new RNG(1) });
    m.newPossession(0, 30, 0);
    for (let i = 0; i < 200; i++) expect(chooseDefense(m, 1, new RNG(i)).custom).toBeFalsy();
    D.registerCustomDefPlays([]); D.registerCustomRoutes([]);
  });
});

describe('mod packs', () => {
  it('the example pack validates, its plays run, and it switches off cleanly', async () => {
    const { validateMod, applyMod, removeMod, exampleMod } = await import('../src/data/mods.js');
    const { getOffPlay } = await import('../src/data/playbook.js');
    const { testPlay } = await import('../src/game/playtest.js');
    const v = validateMod(exampleMod());
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    applyMod(v.pack);
    const lg = generateLeagueRosters(defaultTeams(), 60);
    for (const id of ['ex_wide_out_up', 'ex_wide_draw']) expect(testPlay(getOffPlay(id), lg, 3).ok).toBe(true);
    removeMod(v.pack.id);
    expect(getOffPlay('ex_wide_out_up')).toBeUndefined();
    const bad = validateMod({ name: 'Bad', offense: [{ id: 'x', formation: 'nope', type: 'pass' }] });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatch(/unknown formation/);
  });
});

describe('face photos', () => {
  it('reads an optional face column and writes file names / links back out (not uploaded data)', async () => {
    const { parseCSV, importRosterRows, exportRosterCSV } = await import('../src/data/csv.js');
    const teams = generateLeagueRosters(defaultTeams(), 5);
    const abbr = teams[3].abbr;
    const csv = `team,first,last,pos,face\n${abbr},Ava,Stone,QB,stone.png\n${abbr},Bo,Reed,WR,https://example.org/reed.jpg\n${abbr},Cy,Lane,HB,\n`;
    importRosterRows(teams, parseCSV(csv));
    const by = (l) => teams[3].roster.find((p) => p.last === l);
    expect(by('Stone').face).toBe('stone.png');
    expect(by('Reed').face).toBe('https://example.org/reed.jpg');
    expect(by('Lane').face).toBeUndefined();
    by('Lane').face = 'data:image/jpeg;base64,AAAA';
    const rows = parseCSV(exportRosterCSV([teams[3]]));
    expect(rows.find((r) => r.last === 'Stone').face).toBe('stone.png');
    expect(rows.find((r) => r.last === 'Lane').face).toBe('');
  });
});
