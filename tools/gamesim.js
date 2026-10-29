#!/usr/bin/env node
// Full CPU-vs-CPU games, headless, with rule invariants checked every tick. Usage:
//   npm run games -- --games 50 [--quarter 15] [--seed 1] [--weather clear|rain|snow|windy|random] [--verbose]
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { GameSession } from '../src/game/session.js';
import { makeConditions } from '../src/game/weather.js';
import { RNG } from '../src/core/rng.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('games', 20);
const quarter = +arg('quarter', 15);
const seed0 = +arg('seed', 1);
const verbose = process.argv.includes('--verbose');
const weather = arg('weather', null);
const teams = generateLeagueRosters(defaultTeams(), 2027);

const errors = [];
const tot = {};
const add = (k, v = 1) => (tot[k] = (tot[k] || 0) + v);
const t0 = Date.now();

for (let g = 0; g < N; g++) {
  const home = teams[(g * 5) % 32], away = teams[(g * 11 + 7) % 32];
  const s = new GameSession({ teams: [home, away], settings: { quarterMinutes: quarter, accelClock: 20, weather: weather ? makeConditions(new RNG(seed0 + g), weather, 'night') : null }, humanTeam: null, seed: seed0 + g * 977, fast: true });
  const m = s.match;
  const fail = (msg) => { errors.push(`game ${g} (seed ${seed0 + g * 977}) Q${m.quarter} ${m.clock.toFixed(0)}s: ${msg}`); };
  // Track scoring independently of the match totals.
  const scored = [0, 0];
  const origAdd = m.addScore.bind(m);
  m.addScore = (team, pts, what) => {
    if (![1, 2, 3, 6].includes(pts)) fail(`odd score ${pts} (${what})`);
    scored[team] += pts;
    add(`score:${what.replace(/\d+-yard /, '')}`);
    origAdd(team, pts, what);
  };
  let lastQ = 1, lastClock = m.clock, ticks = 0, lastPlays = 0;
  while (s.state !== 'over' && ticks < 60 * 60 * 60 * 2) {
    s.tick(STEP, null);
    ticks++;
    if (m.quarter < lastQ) fail('quarter went backwards');
    if (m.quarter === lastQ && m.clock > lastClock + 1e-6) fail(`clock went up ${lastClock.toFixed(2)} -> ${m.clock.toFixed(2)}`);
    if (m.quarter > lastQ + 1) fail('skipped a quarter');
    lastQ = m.quarter; lastClock = m.clock;
    if (m.phase === 'scrimmage' && (m.down < 1 || m.down > 4)) fail(`bad down ${m.down}`);
    if (m.phase === 'scrimmage' && !(m.yardLine > 0 && m.yardLine < 100)) fail(`bad yard line ${m.yardLine}`);
    if (m.phase === 'scrimmage' && !(m.toGo > 0)) fail(`bad to-go ${m.toGo}`);
    if (m.timeouts.some((t) => t < 0 || t > 3)) fail('bad timeouts');
    if (scored[0] !== m.score[0] || scored[1] !== m.score[1]) fail(`score mismatch ${scored} vs ${m.score}`);
    if (s.plays > lastPlays + 0 && verbose && s.state === 'post') {}
    if (errors.length > 30) break;
  }
  if (s.state !== 'over') fail('game never ended');
  for (const t of [0, 1]) {
    const st = m.stats.team[t];
    add('points', m.score[t]); add('plays', st.plays); add('yards', st.yards); add('passYds', st.passYds); add('rushYds', st.rushYds);
    add('rushAtt', st.rushAtt); add('passAtt', st.passAtt); add('passCmp', st.passCmp); add('sacks', st.sacks); add('turnovers', st.turnovers);
    add('penalties', st.penalties); add('penYds', st.penYds); add('firstDowns', st.firstDowns); add('thirdAtt', st.thirdAtt); add('thirdConv', st.thirdConv);
  }
  add('ot', m.ot ? 1 : 0); add('ties', m.winner === null ? 1 : 0);
  if (verbose) console.log(`game ${g}: ${home.abbr} ${m.score[0]} - ${away.abbr} ${m.score[1]}${m.ot ? ' (OT)' : ''}  plays ${s.plays}`);
}
const T = N * 2;
const per = (k) => ((tot[k] || 0) / T).toFixed(1);
console.log(`\n${N} games (${quarter}-min quarters) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Per team per game: ${per('points')} pts, ${per('plays')} plays, ${per('yards')} yds (${per('passYds')} pass / ${per('rushYds')} rush), ${per('firstDowns')} 1st downs`);
console.log(`  passing ${per('passCmp')}/${per('passAtt')}, rushing ${per('rushAtt')} att, sacks ${per('sacks')}, turnovers ${per('turnovers')}, penalties ${per('penalties')} for ${per('penYds')} yds`);
console.log(`  3rd down ${(100 * (tot.thirdConv || 0) / Math.max(1, tot.thirdAtt || 0)).toFixed(0)}%, OT games ${tot.ot || 0}, ties ${tot.ties || 0}`);
console.log('Scoring plays:', Object.entries(tot).filter(([k]) => k.startsWith('score:')).map(([k, v]) => `${k.slice(6)}=${v}`).join(', '));
if (errors.length) { console.log(`\n${errors.length} ERRORS`); for (const e of errors.slice(0, 25)) console.log(' -', e); process.exit(1); }
console.log('\nNo invariant violations.');
