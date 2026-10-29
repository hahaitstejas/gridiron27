// Run a play headless against a few defenses (playbook editor "test"; also catches broken custom plays).
import { RNG } from '../core/rng.js';
import { STEP } from '../core/constants.js';
import { PlaySim, MAX_PLAY_TIME } from '../sim/play.js';
import { listDefPlays } from '../data/playbook.js';

/** Returns { ok, error, reps, avgYds, cmpPct (pass plays) }. */
export function testPlay(play, teams, reps = 12, seed = 1) {
  const defs = listDefPlays().filter((d) => !/^st_/.test(d.id));
  let yds = 0, att = 0, cmp = 0;
  try {
    for (let i = 0; i < reps; i++) {
      const sim = new PlaySim({ rng: new RNG(seed + i * 31), teams: [teams[0], teams[1]], offIdx: 0, dir: 1, losX: -15, ballZ: 0,
        offPlay: play, defPlay: defs[(i * 7) % defs.length], humanTeam: null });
      sim.snap();
      let n = 0;
      while (!sim.finished && n < (MAX_PLAY_TIME + 5) / STEP) { sim.tick(STEP, null); n++; }
      if (!sim.result) return { ok: false, error: 'The play never ended.' };
      yds += sim.result.yards || 0;
      if (play.type === 'pass' && sim.stats.passer !== null && sim.stats.target !== null) { att++; if (sim.stats.receiver !== null) cmp++; }
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, reps, avgYds: yds / reps, cmpPct: att ? cmp / att : null };
}
