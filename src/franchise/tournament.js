// Tournament mode (pure logic): a 4, 8 or 16-team single-elimination bracket at neutral sites. Your team plus the
// best of the rest by team rating, seeded 1..N by rating (1 plays N, 2 plays N-1…). Plain JSON (the UI keeps it in
// localStorage `g27.tournament`); team indexes refer to the current league.
import { teamRatings } from '../data/positions.js';
import { quickSim } from './quicksim.js';

export const TOURNAMENT_SIZES = [4, 8, 16];
const ROUND_NAMES = { 16: 'Round of 16', 8: 'Quarterfinals', 4: 'Semifinals', 2: 'Final' };

export function createTournament(teams, { size = 8, userTeam = 0, difficulty = 'pro', quarterMinutes = 5, seed = 1 }) {
  const ovr = (i) => teamRatings(teams[i]).ovr;
  const others = teams.map((_, i) => i).filter((i) => i !== userTeam).sort((a, b) => ovr(b) - ovr(a)).slice(0, size - 1);
  const field = [userTeam, ...others].sort((a, b) => ovr(b) - ovr(a));
  const t = { size, userTeam, difficulty, quarterMinutes, seed, seeds: field, rounds: [], champion: null };
  // Bracket order keeps 1 and 2 apart until the final: 1v8, 4v5, 2v7, 3v6 (for 8).
  t.rounds.push(firstRound(field).map(([a, b]) => ({ home: a, away: b, score: null })));
  return t;
}

/** Standard bracket order: [[1,N],[N/2,N/2+1],…] with seed 1's half first. */
function firstRound(field) {
  const n = field.length;
  let order = [1];
  while (order.length < n) {
    const m = order.length * 2;
    order = order.flatMap((s) => [s, m + 1 - s]);
  }
  const pairs = [];
  for (let i = 0; i < n; i += 2) pairs.push([field[order[i] - 1], field[order[i + 1] - 1]]);
  return pairs;
}

export const roundName = (t, r = t.rounds.length - 1) => ROUND_NAMES[t.size >> r] || `Round ${r + 1}`;
export const currentRound = (t) => t.rounds[t.rounds.length - 1];
export const userGame = (t) => currentRound(t).find((g) => g.home === t.userTeam || g.away === t.userTeam) || null;
export const winnerOf = (g) => (g.score ? (g.score[0] > g.score[1] ? g.home : g.away) : null);
export const eliminated = (t) => t.rounds.some((r) => r.some((g) => g.score && (g.home === t.userTeam || g.away === t.userTeam) && winnerOf(g) !== t.userTeam));

/** Record a result (a played game's score, [home, away]); ties aren't allowed. */
export function recordResult(t, g, score) {
  if (score[0] === score[1]) score = [score[0] + 3, score[1]]; // safety net: a quick-sim never ties here
  g.score = score;
}

/** Quick-sim one game (the user's, or the CPU's). */
export function simTournamentGame(t, teams, g, salt = 0) {
  const r = quickSim(teams[g.home], teams[g.away], t.seed * 31 + t.rounds.length * 101 + salt, { neutral: true, noTies: true, injuryRate: 0 });
  recordResult(t, g, r.score);
}

/** Sim the rest of the round's games, then start the next round (or crown the champion). Returns true if it moved on. */
export function advanceTournament(t, teams) {
  const round = currentRound(t);
  round.forEach((g, i) => { if (!g.score) simTournamentGame(t, teams, g, i); });
  const winners = round.map(winnerOf);
  if (winners.length === 1) { t.champion = winners[0]; return true; }
  const next = [];
  for (let i = 0; i < winners.length; i += 2) {
    // The better seed is the "home" team (a neutral site, it only decides the jerseys).
    const [a, b] = [winners[i], winners[i + 1]].sort((x, y) => t.seeds.indexOf(x) - t.seeds.indexOf(y));
    next.push({ home: a, away: b, score: null });
  }
  t.rounds.push(next);
  return true;
}

export const seedOf = (t, team) => t.seeds.indexOf(team) + 1;
