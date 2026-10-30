// Random-input fuzzing: full human games driven by a button masher (menus aside), checking that nothing throws,
// every game ends and the score stays sane. `node tools/fuzz.js [--games 6] [--quarter 2]`.
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { GameSession, STEP } from '../src/game/session.js';
import { listOffPlays, listDefPlays } from '../src/data/playbook.js';
import { emptyFrame } from '../src/input/actions.js';
import { RNG } from '../src/core/rng.js';
import { createCareerPlayer } from '../src/franchise/career.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const GAMES = arg('--games', 6), Q = arg('--quarter', 2);
const BTNS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right'];
const teams = generateLeagueRosters(defaultTeams(), 77);
const offs = listOffPlays(true), defs = listDefPlays(true);
let failures = 0;

function masher(rng) {
  const f = emptyFrame();
  return () => {
    for (const b in f.pressed) { f.pressed[b] = false; f.down[b] = rng.chance(0.05); }
    if (rng.chance(0.08)) f.pressed[rng.pick(BTNS)] = true;
    if (rng.chance(0.1)) { f.lx = rng.range(-1, 1); f.ly = rng.range(-1, 1); }
    f.rt = rng.chance(0.3) ? 1 : 0; f.lt = rng.chance(0.05) ? 1 : 0;
    f.flick = { up: rng.chance(0.01), down: rng.chance(0.01), left: rng.chance(0.01), right: rng.chance(0.01) };
    return f;
  };
}

for (let g = 0; g < GAMES; g++) {
  const mode = ['human', 'career', 'twoPlayer'][g % 3];
  const rng = new RNG(900 + g);
  const home = teams[(g * 3) % 32], away = teams[(g * 3 + 5) % 32];
  const settings = { quarterMinutes: Q, sliders: null };
  if (mode === 'career') settings.lockPlayer = createCareerPlayer(home, { pos: rng.pick(['QB', 'WR', 'HB', 'CB', 'MLB']) }, rng).id;
  const s = new GameSession({ teams: [home, away], settings, humanTeam: mode === 'twoPlayer' ? null : 0, humanTeams: mode === 'twoPlayer' ? [0, 1] : null, seed: 31 + g });
  const p1 = masher(rng), p2 = masher(new RNG(5000 + g));
  let ticks = 0; const recent = [];
  try {
    while (s.state !== 'over' && ticks < 60 * 60 * 60) {
      if (s.needsHumanCall) {
        const def = s.humanSide === 'defense';
        const list = def ? defs : offs;
        s.humanChoose(list[rng.int(0, list.length - 1)]);
      }
      if (s.state === 'penalty') s.choosePenalty(rng.chance(0.5));
      const f = p1();
      s.tick(STEP, mode === 'twoPlayer' ? { perTeam: true, 0: f, 1: p2() } : f);
      for (const e of s.events) if (e.type === 'message' || e.type === 'flag') { recent.push(e.text || e.outcome?.text || e.type); if (recent.length > 8) recent.shift(); }
      if (s.sim && !Number.isFinite(s.sim.ball.x)) throw new Error('ball position NaN');
      ticks++;
    }
    const m = s.match;
    if (s.state !== 'over') console.log(`  stuck: ${s.state} q${s.match.quarter} ${s.match.clock.toFixed(1)}s ${s.match.phase} yl ${s.match.yardLine.toFixed(1)} · recent: ${recent.join(' || ')}`);
    const ok = s.state === 'over' && m.score.every((x) => Number.isInteger(x) && x >= 0 && x < 120);
    console.log(`${mode.padEnd(10)} ${ok ? 'ok ' : 'BAD'} ${home.abbr} ${m.score[0]} - ${m.score[1]} ${away.abbr}  plays ${s.plays}  ${(ticks / 3600).toFixed(1)} game-min`);
    if (!ok) failures++;
  } catch (e) {
    failures++;
    console.log(`${mode.padEnd(10)} CRASH after ${s.plays} plays (state ${s.state}, q${s.match.quarter}): ${e.stack.split('\n').slice(0, 4).join(' | ')}`);
  }
}
console.log(failures ? `${failures} failing game(s)` : 'All fuzzed games finished cleanly.');
process.exit(failures ? 1 : 0);
