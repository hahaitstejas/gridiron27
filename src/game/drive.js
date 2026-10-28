import { RNG } from '../core/rng.js';
import { GOAL_X, HASH_Z } from '../core/constants.js';
import { PlaySim } from '../sim/play.js';
import { listOffPlays, listDefPlays } from '../data/playbook.js';

/**
 * Phase 1 "drive" mode: the human runs plays against the CPU with downs and distance.
 * Possession resets to the 25 after a score, turnover or turnover on downs.
 * (Phase 2 replaces this with the full game state machine.)
 */
export class DriveSession {
  constructor({ teams, humanSide = 'offense', seed = Date.now() % 100000, auto = false }) {
    this.auto = auto; // CPU vs CPU
    this.teams = teams; // [home, away]
    this.rng = new RNG(seed);
    this.humanSide = humanSide;
    this.offPlays = listOffPlays();
    this.defPlays = listDefPlays();
    this.playIndex = 0;
    this.message = null;
    this.events = [];
    this.resetSeries('Start');
  }

  get humanTeam() { return this.auto ? null : this.humanSide === 'offense' ? this.offIdx : 1 - this.offIdx; }

  resetSeries(why) {
    this.offIdx = this.auto ? (this.offIdx === 0 ? 1 : 0) : this.humanSide === 'offense' ? 0 : 1;
    this.dir = this.offIdx === 0 ? 1 : -1;
    this.losX = -this.dir * 25; // own 25
    this.ballZ = 0;
    this.down = 1;
    this.firstX = this.losX + this.dir * 10;
    this.lastWhy = why;
    this.newPlay();
  }

  yardLineText() {
    const own = (this.losX * this.dir) < 0;
    const yl = Math.round(GOAL_X - Math.abs(this.losX));
    if (yl === 50) return 'the 50';
    const team = own ? this.teams[this.offIdx] : this.teams[1 - this.offIdx];
    return `${team.abbr} ${yl}`;
  }

  toGoText() {
    const togo = (this.firstX - this.losX) * this.dir;
    const goal = Math.abs(this.firstX) >= GOAL_X;
    return goal ? 'Goal' : String(Math.max(1, Math.round(togo)));
  }

  newPlay() {
    const humanOff = this.humanSide === 'offense';
    let op, dp;
    if (this.auto) {
      op = this.rng.pick(this.offPlays);
      dp = this.rng.pick(this.defPlays);
    } else if (humanOff) {
      op = this.offPlays[this.playIndex % this.offPlays.length];
      dp = this.rng.pick(this.defPlays);
    } else {
      op = this.rng.pick(this.offPlays);
      dp = this.defPlays[this.playIndex % this.defPlays.length];
    }
    this.sim = new PlaySim({
      rng: this.rng,
      teams: this.teams,
      offIdx: this.offIdx,
      dir: this.dir,
      losX: this.losX,
      ballZ: this.ballZ,
      offPlay: op,
      defPlay: dp,
      humanTeam: this.humanTeam,
      camDir: humanOff || this.auto ? this.dir : -this.dir,
      firstDownX: Math.abs(this.firstX) < GOAL_X ? this.firstX : null,
    });
    this.presnapT = 0;
    this.postT = 0;
  }

  /** Cycle the selected play (X pre-snap). */
  nextPlay(step = 1) {
    if (this.sim.state !== 'presnap') return;
    const n = this.humanSide === 'offense' ? this.offPlays.length : this.defPlays.length;
    this.playIndex = (this.playIndex + step + n) % n;
    this.newPlay();
  }

  swapSides() {
    if (this.sim.state !== 'presnap') return;
    this.humanSide = this.humanSide === 'offense' ? 'defense' : 'offense';
    this.playIndex = 0;
    this.resetSeries('Swap');
  }

  tick(dt, input) {
    const sim = this.sim;
    this.events.length = 0;
    if (sim.state === 'presnap') {
      this.presnapT += dt;
      if (input && !this.auto) {
        if (input.pressed.X) { this.nextPlay(1); return; }
        if (input.pressed.LB) { this.swapSides(); return; }
        if (this.humanSide === 'offense' && input.pressed.A) { sim.snap(); input = null; } // the snap press isn't also a throw
      }
      if ((this.auto || this.humanSide === 'defense') && this.presnapT > (this.auto ? 0.6 : 2.2)) sim.snap();
    }
    sim.tick(dt, input);
    for (const e of sim.events) this.events.push(e);
    if (sim.state === 'dead' && !this.message) this.message = this.describe(sim.result);
    if (sim.finished) {
      this.postT += dt;
      if (this.postT > 0.9) this.advance(sim.result);
    }
  }

  describe(r) {
    const name = (id) => { const p = this.sim.players[id]; return p ? `#${p.number} ${p.name}` : ''; };
    if (r.touchdown !== null) return { big: 'TOUCHDOWN!', small: r.touchdown === this.offIdx ? `${name(r.carrierId)}` : 'Defensive score' };
    if (r.safety) return { big: 'SAFETY', small: '' };
    if (r.interception) return { big: 'INTERCEPTED!', small: name(r.intBy) };
    if (r.incomplete) return { big: 'Incomplete', small: '' };
    if (r.sack) return { big: 'SACK', small: `${name(r.tackler)}  ${r.yards.toFixed(0)} yds` };
    const y = Math.round(r.yards);
    const who = r.complete ? `Pass to ${name(r.receiver)}` : `Run by ${name(r.carrierId)}`;
    return { big: `${y > 0 ? '+' : ''}${y} yds`, small: who + (r.outOfBounds ? ' (out of bounds)' : '') };
  }

  advance(r) {
    this.message = null;
    this.playsRun = (this.playsRun || 0) + 1;
    if (r.touchdown !== null || r.safety || r.turnover) {
      this.resetSeries(r.touchdown !== null ? 'TD' : 'Turnover');
      return;
    }
    if (!r.incomplete) {
      this.losX = r.spotX;
      this.ballZ = Math.max(-HASH_Z, Math.min(HASH_Z, r.spotZ));
    }
    if ((this.losX - this.firstX) * this.dir >= 0) {
      this.down = 1;
      this.firstX = this.losX + this.dir * 10;
      if (Math.abs(this.firstX) > GOAL_X) this.firstX = this.dir * GOAL_X;
      this.events.push({ type: 'firstDown' });
    } else {
      this.down++;
      if (this.down > 4) { this.resetSeries('Downs'); return; }
    }
    this.newPlay();
  }
}
