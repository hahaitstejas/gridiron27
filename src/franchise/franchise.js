// Franchise mode state machine (pure logic). The state is plain JSON (saved with the league):
//   phase: 'regular' -> 'playoffs' -> 'offseason' (see offseason.js) -> next season's 'regular'.
// Games the human plays are recorded from their Match; everything else goes through quickSim().
import { makeSchedule, standings, seeds, nextPlayoffRound, championOf, addStats, STAT_FIELDS } from './season.js';
import { quickSim } from './quicksim.js';

export const FRANCHISE_VERSION = 1;

export function createFranchise(teams, { userTeam, weeks = 17, difficulty = 'pro', quarterMinutes = 5, name, year = 2027, seed = 1 }) {
  return {
    version: FRANCHISE_VERSION,
    name: name || `${teams[userTeam].city} ${teams[userTeam].name} franchise`,
    userTeam, year, weeks, week: 0, phase: 'regular',
    settings: { difficulty, quarterMinutes },
    schedule: makeSchedule(teams, weeks, seed * 7919 + year),
    stats: {}, // season stats by player id
    playoffs: null,
    history: [], // past seasons: { year, champion, record, playoffs }
    seed: seed * 104729 + year,
    offseason: null,
  };
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
export function recordGame(f, teams, g, score, lines) {
  g.score = score;
  addStats(f, lines, playerInfo(teams));
}

/** Quick-sim one game. */
export function simGame(f, teams, g) {
  const seed = (f.seed += 1);
  const r = quickSim(teams[g.home], teams[g.away], seed, { neutral: !!g.neutral, noTies: f.phase === 'playoffs' });
  recordGame(f, teams, g, r.score, r.lines);
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
  if (f.phase === 'regular') {
    f.week++;
    if (f.week >= f.weeks) startPlayoffs(f, teams);
    return true;
  }
  if (f.phase === 'playoffs') {
    const next = nextPlayoffRound(f.playoffs);
    if (next) { f.playoffs.rounds.push(next); return true; }
    const champ = championOf(f.playoffs);
    const rec = standings(teams, f.schedule).find((r) => r.team === f.userTeam);
    f.history.push({ year: f.year, champion: champ, championName: `${teams[champ].city} ${teams[champ].name}`, record: `${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}`, madePlayoffs: f.playoffs.seeds.flat().includes(f.userTeam) });
    f.phase = 'offseason';
    f.offseason = { step: 'summary' };
    return true;
  }
  return false;
}

function startPlayoffs(f, teams) {
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
  f.schedule = makeSchedule(teams, f.weeks, f.seed * 31 + f.year);
  f.stats = {};
  f.playoffs = null;
  f.offseason = null;
}

/** Record of a team this season: { w, l, t }. */
export function recordOf(f, teams, team) {
  const r = standings(teams, f.schedule).find((x) => x.team === team);
  return r ? { w: r.w, l: r.l, t: r.t } : { w: 0, l: 0, t: 0 };
}
