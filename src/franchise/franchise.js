// Franchise mode state machine (pure logic). The state is plain JSON (saved with the league):
//   phase: 'regular' -> 'playoffs' -> 'offseason' (see offseason.js) -> next season's 'regular'.
// Games the human plays are recorded from their Match; everything else goes through quickSim().
import { archiveSeason } from './legacy.js';
import { seedFreeAgents, poolAfterOffseason } from './freeAgents.js';
import { makeSchedule, standings, seeds, nextPlayoffRound, championOf, addStats, STAT_FIELDS, rank } from './season.js';
import { nflSchedule, assignSlots, isPrimetime } from './nflSchedule.js';
import { teamRatings } from '../data/positions.js';
import { quickSim } from './quicksim.js';
import { RNG } from '../core/rng.js';
import { LEAGUE } from '../data/leagueInfo.js';
import { setupMoney, cpuTrades } from './contracts.js';
import { makeConditions } from '../game/weather.js';
import { addNews, gameNews, checkGameRecords, checkSeasonRecords, giveAwards } from './extras.js';
import { healWeek, weeklyHealth, cpuInjuredReserve, unavailableIds, injuryLine } from './health.js';
import { updateMorale, developmentTick } from './development.js';
import { revertElevations, cpuElevations, release as releaseToWaivers, processWaivers, waiverOrder, resetPSSeason } from './practiceSquad.js';
import { cpuSignFreeAgents, addFreeAgent } from './freeAgents.js';
import { fits } from './contracts.js';
import { awardCareerGame } from './career.js';

export const FRANCHISE_VERSION = 1;

export function createFranchise(teams, { userTeam, weeks = 17, difficulty = 'pro', quarterMinutes = 5, name, year = 2027, seed = 1, mode = 'franchise' }) {
  const f = {
    version: FRANCHISE_VERSION,
    mode, // 'franchise' (seasons go on) | 'season' (one season: ends after the championship)
    name: name || `${teams[userTeam].city} ${teams[userTeam].name} ${mode === 'season' ? 'season' : 'franchise'}`,
    userTeam, year, firstYear: year, weeks: 18, week: 0, phase: 'regular',
    settings: { difficulty, quarterMinutes },
    schedule: null,
    stats: {}, // season stats by player id
    playoffs: null,
    history: [], // past seasons: { year, champion, record, playoffs }
    seed: seed * 104729 + year,
    offseason: null,
    cap: setupMoney(teams, seed * 13 + year), // salary cap ($M), see contracts.js
    transactions: [], // newest first: { year, week, text }
    news: [], // headlines, newest first (extras.js)
    records: { game: {}, season: {} },
    recordsSince: year, // the first season sets the marks; later ones can break them
    awards: {}, // year -> [{ award, name, pos, team, line }]
  };
  f.schedule = seasonSchedule(f, teams, seed * 7919 + year);
  f.weeks = f.schedule.length;
  seedFreeAgents(f, seed * 17 + year); // in-season free agents (freeAgents.js)
  return f;
}

/**
 * The regular season: 17 games by the NFL formula over 18 weeks (one bye each), with kickoff times, prime time,
 * holidays and international games (nflSchedule.js). Division ranks from last season set the same-place games and
 * last season's record + roster strength decide who gets prime time. Odd-shaped leagues get a balanced random
 * 17-game schedule instead.
 */
export function seasonSchedule(f, teams, seed) {
  const idx = Math.max(0, f.year - (f.firstYear ?? f.year));
  const sched = nflSchedule(teams, idx, seed, f.lastPlace || null) || makeSchedule(teams, 17, seed);
  const strength = teams.map((t, i) => 0.55 * (f.lastPct?.[i] ?? 0.5) + 0.45 * Math.max(0, Math.min(1, (teamRatings(t).ovr - 65) / 25)));
  assignSlots(sched, teams, { year: f.year, seed, strength, champion: f.history?.length ? f.history[f.history.length - 1].champion : null, venues: f.venues || undefined });
  return sched;
}

/** Remember last season's division finishes and win % (next season's schedule uses them). */
function rememberFinish(f, teams) {
  const rows = standings(teams, f.schedule);
  f.lastPct = teams.map((_, i) => rows.find((r) => r.team === i)?.pct ?? 0.5);
  const place = {};
  const groups = {};
  for (const r of rows) (groups[`${teams[r.team].conference}|${teams[r.team].division}`] ||= []).push(r);
  for (const g of Object.values(groups)) rank(g).forEach((r, i) => { place[r.team] = i; });
  f.lastPlace = place;
}

/** Older franchise saves: add money (salaries + cap) and the transaction log. */
export function upgradeFranchise(f, teams) {
  if (!f.cap) f.cap = setupMoney(teams, f.seed);
  f.transactions ||= [];
  f.news ||= [];
  f.records ||= { game: {}, season: {} };
  f.recordsSince ??= f.year;
  f.awards ||= {};
  if (!f.freeAgents) seedFreeAgents(f, f.seed);
}

/** A team released a player: young players go on waivers for a week, vested veterans straight to free agency. */
export function releasedPlayer(f, teams, team, p) {
  f.teamsIdx = (t) => teams.indexOf(t);
  const to = releaseToWaivers(f, team, p, (q) => addFreeAgent(f, q));
  delete f.teamsIdx;
  return to;
}

/** Log a transaction (trade, signing, release) for the hub's Transactions screen. */
export function logTransaction(f, text) {
  f.transactions.unshift({ year: f.year, week: f.phase === 'regular' ? f.week + 1 : null, text });
  if (f.transactions.length > 150) f.transactions.length = 150;
  addNews(f, text, 'trade');
}

/** The regular season's trade deadline: no trades after 60% of the weeks. */
export function tradeDeadlinePassed(f) {
  return f.phase !== 'regular' || f.week >= Math.ceil(f.weeks * 0.6);
}

/** Games of the current week (regular season) or playoff round. */
export function currentGames(f) {
  if (f.phase === 'regular') return f.schedule[f.week] || [];
  if (f.phase === 'playoffs') return f.playoffs.rounds[f.playoffs.rounds.length - 1] || [];
  return [];
}

/** The human team's game this week/round, or null (eliminated or season over). */
export function userGame(f) {
  return currentGames(f).find((g) => g.home === f.userTeam || g.away === f.userTeam) || null;
}

function playerInfo(teams) {
  const map = new Map();
  teams.forEach((t, ti) => { for (const p of t.roster) map.set(p.id, { name: `${p.first[0]}. ${p.last}`, pos: p.pos, team: t.abbr, teamIdx: ti }); });
  return (rid) => map.get(+rid) || { name: '?', pos: '', team: '', teamIdx: -1 };
}

/** Store a final score and its player lines. */
export function recordGame(f, teams, g, score, lines, injuries = []) {
  g.score = score;
  const info = playerInfo(teams);
  addStats(f, lines, info);
  gameNews(f, teams, g);
  checkGameRecords(f, lines, info);
  if (f.career && (g.home === f.userTeam || g.away === f.userTeam)) awardCareerGame(f, teams, g, lines);
  // Lines since the last development tick (development.js grows players every two weeks).
  for (const [rid, l] of Object.entries(lines || {})) ((f.recentLines ||= {})[rid] ||= []).push(l);
  // Injuries stick to the player until he heals (health.js); game-day knocks (0 weeks) leave him questionable.
  for (const inj of injuries) {
    for (const t of teams) {
      const p = t.roster.find((q) => q.id === inj.rid);
      if (!p) continue;
      const name = inj.name || inj.type || 'Injury';
      if (inj.weeks > 0 || !p.injury) p.injury = { name, part: inj.part || '', weeks: Math.max(inj.weeks || 0, p.injury?.weeks || 0), total: inj.weeks || 0, severe: !!inj.severe, questionable: !(inj.weeks > 0), game: true };
      const mine = t === teams[f.userTeam];
      if ((inj.weeks >= 2 && (mine || p.ovr >= 80)) || (mine && inj.weeks > 0)) addNews(f, `${t.abbr} ${p.pos} ${p.first} ${p.last}: ${injuryLine(p.injury)}`, 'injury');
      if (mine) (f.injuryReport ||= []).unshift({ year: f.year, week: f.week + 1, rid: p.id, name: `${p.first} ${p.last}`, pos: p.pos, text: injuryLine(p.injury) });
      break;
    }
  }
  if (f.injuryReport?.length > 40) f.injuryReport.length = 40;
}

/** A week passes: injured players get a week closer to returning (IR players serve at least 4 games). */
export function heal(teams) {
  for (const t of teams) healWeek(t);
}

/** Roster ids of players who can't play (Out, IR; Doubtful players usually sit) per side: [home ids, away ids]. */
export function unavailableFor(teams, g, rng = null) {
  return [g.home, g.away].map((ti) => unavailableIds(teams[ti], rng));
}

/**
 * The week in between games: practice injuries, CPU teams move long-term injuries to IR and fill holes from free
 * agency, morale moves with results, and every other week young players develop. Returns news-worthy bits.
 */
export function weekInBetween(f, teams) {
  const rng = new RNG((f.seed += 5));
  const rate = f.settings.injuryRate ?? 1;
  teams.forEach((t, ti) => {
    for (const inj of weeklyHealth(t, rng, rate)) {
      const p = t.roster.find((q) => q.id === inj.rid);
      if (ti === f.userTeam && p) {
        addNews(f, `Practice: ${t.abbr} ${p.pos} ${p.first} ${p.last}, ${injuryLine(p.injury)}`, 'injury');
        (f.injuryReport ||= []).unshift({ year: f.year, week: f.week + 1, rid: p.id, name: `${p.first} ${p.last}`, pos: p.pos, text: `${injuryLine(p.injury)} (practice)` });
      }
    }
    if (ti !== f.userTeam) cpuInjuredReserve(t);
    // Morale from last week's result (byes: nothing).
    const g = (f.schedule[f.week] || []).find((x) => x.home === ti || x.away === ti);
    const won = g?.score ? (g.score[0] === g.score[1] ? null : (g.score[0] > g.score[1]) === (g.home === ti)) : null;
    for (const p of updateMorale(f, t, g ? won : null, rng)) {
      addNews(f, `${t.abbr} ${p.pos} ${p.first} ${p.last} has asked to be traded`, 'trade');
    }
  });
  // Waivers clear at the end of the week (worst record claims first; unclaimed players become free agents).
  if (f.waivers?.length) {
    const order = waiverOrder(f, standings(teams, f.schedule));
    for (const w of processWaivers(f, teams, order, { fits: (t, sal) => fits(t, sal, 0, f.cap), toFreeAgency: (p) => addFreeAgent(f, p) })) {
      if (w.to !== null) logTransaction(f, `${teams[w.to].abbr} claim ${w.p.pos} ${w.p.first} ${w.p.last} off waivers`);
    }
  }
  for (const mv of cpuSignFreeAgents(f, teams, rng)) {
    const t = teams[mv.team], p = mv.player;
    if (p.ovr >= 70) logTransaction(f, `${t.abbr} sign ${p.pos} ${p.first} ${p.last} (${p.ovr} OVR)${mv.released ? `; release ${mv.released.pos} ${mv.released.first} ${mv.released.last}` : ''}`);
  }
  if (f.week % 2 === 1) {
    const changes = developmentTick(f, teams, rng, f.recentLines || {});
    f.recentLines = {};
    const mine = changes.filter((c) => c.team === f.userTeam && c.to > c.from);
    if (mine.length) {
      f.devReport = mine.map((c) => ({ name: `${c.p.first} ${c.p.last}`, pos: c.p.pos, from: c.from, to: c.to, week: f.week + 1 }));
      addNews(f, `Player development: ${mine.slice(0, 3).map((c) => `${c.p.pos} ${c.p.last} ${c.from}→${c.to}`).join(', ')}${mine.length > 3 ? ` and ${mine.length - 3} more` : ''}`, 'signing');
    }
  }
}

/** Weather and time for a franchise game (fixed per game; snow only late in the season). */
export function gameConditions(f, g) {
  if (!g.conditions) {
    const late = f.phase === 'regular' ? f.week / Math.max(1, f.weeks - 1) : 1;
    // Kickoff time sets the light: night games under the lights, late-afternoon kicks at dusk late in the year.
    const time = !g.time ? 'random' : isPrimetime(g) ? 'night' : /^4:/.test(g.time) && late > 0.5 ? 'dusk' : 'day';
    g.conditions = makeConditions(new RNG(f.seed * 3 + f.week * 101 + g.home * 7 + g.away), 'random', time, late);
  }
  return g.conditions;
}

/** Quick-sim one game. */
export function simGame(f, teams, g) {
  const seed = (f.seed += 1);
  // Game-day elevations from the practice squad fill injury holes (the CPU's; yours are on the Practice Squad screen).
  for (const ti of [g.home, g.away]) if (ti !== f.userTeam) cpuElevations(teams[ti]);
  const r = quickSim(teams[g.home], teams[g.away], seed, { neutral: !!g.neutral || !!g.venue, noTies: f.phase === 'playoffs', injuryRate: f.settings.injuryRate ?? 1, short: g.short || [], idx: [g.home, g.away] });
  recordGame(f, teams, g, r.score, r.lines, r.injuries);
  return r;
}

/** Quick-sim every unplayed game this week/round except the human's (they play or sim it themselves). */
export function simOthers(f, teams) {
  for (const g of currentGames(f)) if (!g.score && g.home !== f.userTeam && g.away !== f.userTeam) simGame(f, teams, g);
}

/**
 * Turn a finished Match (the human played it) into a score + lines for the franchise game g.
 * The session's team 0 is the home team (see startGame), so map its stats by roster id.
 */
export function matchToResult(match) {
  const lines = {};
  for (const s of Object.values(match.stats.players)) {
    const l = (lines[s.rid] ||= {});
    for (const fld of STAT_FIELDS) if (s[fld]) l[fld] = (l[fld] || 0) + s[fld];
  }
  return { score: [match.score[0], match.score[1]], lines };
}

/** Everything this week/round is decided? Then move on (next week, playoffs, next round, offseason). */
export function advance(f, teams) {
  if (currentGames(f).some((g) => !g.score)) return false;
  heal(teams);
  for (const t of teams) revertElevations(t);
  if (f.phase === 'regular') {
    weekInBetween(f, teams);
    if (!tradeDeadlinePassed(f)) {
      upgradeFranchise(f, teams);
      for (const t of cpuTrades(f, teams, new RNG((f.seed += 3)), f.cap)) logTransaction(f, t);
    }
    f.week++;
    if (f.week >= f.weeks) {
      checkSeasonRecords(f);
      giveAwards(f, teams);
      startPlayoffs(f, teams);
    }
    return true;
  }
  if (f.phase === 'playoffs') {
    const next = nextPlayoffRound(f.playoffs);
    if (next) { f.playoffs.rounds.push(next); return true; }
    const champ = championOf(f.playoffs);
    archiveSeason(f, champ); // careers and rings (legacy.js)
    const rec = standings(teams, f.schedule).find((r) => r.team === f.userTeam);
    addNews(f, `${teams[champ].city} ${teams[champ].name} win the ${f.year} ${LEAGUE.championship}!`, 'playoff');
    f.history.push({ year: f.year, champion: champ, championName: `${teams[champ].city} ${teams[champ].name}`, record: `${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}`, madePlayoffs: f.playoffs.seeds.flat().includes(f.userTeam) });
    // A single season ends here; a franchise goes on to the offseason.
    if (f.mode === 'season') { f.phase = 'done'; return true; }
    f.phase = 'offseason';
    f.offseason = { step: 'summary' };
    return true;
  }
  return false;
}

function startPlayoffs(f, teams) {
  rememberFinish(f, teams);
  const rows = standings(teams, f.schedule);
  f.phase = 'playoffs';
  f.playoffs = { seeds: [seeds(teams, rows, 0), seeds(teams, rows, 1)], rounds: [] };
  f.playoffs.rounds.push(nextPlayoffRound(f.playoffs));
}

/** Start the next season (after the offseason): new schedule, fresh season stats. */
export function startNextSeason(f, teams) {
  f.year++;
  f.week = 0;
  f.phase = 'regular';
  f.schedule = seasonSchedule(f, teams, f.seed * 31 + f.year);
  f.weeks = f.schedule.length;
  f.stats = {};
  f.playoffs = null;
  resetPSSeason(teams);
  poolAfterOffseason(f, f.offseason?.pool); // the unsigned are next season's free agents
  f.offseason = null;
}

/** Record of a team this season: { w, l, t }. */
export function recordOf(f, teams, team) {
  const r = standings(teams, f.schedule).find((x) => x.team === team);
  return r ? { w: r.w, l: r.l, t: r.t } : { w: 0, l: 0, t: 0 };
}
