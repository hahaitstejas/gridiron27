import { GOAL_X, HASH_Z, HALF_WIDTH } from '../core/constants.js';
import { clamp } from '../core/math.js';

// Full-game rules engine (pure logic). Field position is tracked as `yardLine`: yards from the
// possessing team's own goal line (0..100). PlaySim works in absolute x; dirOf() converts.

export const DEFAULT_SETTINGS = {
  quarterMinutes: 5,
  accelClock: 20, // play clock value the clock runs down to before each snap (0 = off)
  difficulty: 'pro',
};

const TOUCHBACK_KICKOFF = 25;
const TOUCHBACK_PUNT = 20;
const KICKOFF_YL = 35;
const PAT_YL = 85; // 15-yard line: 33-yard kick
const TWO_PT_YL = 98;

export class Match {
  constructor({ teams, settings = {}, rng, humanTeam = null }) {
    this.teams = teams; // [home, away]
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = rng;
    this.humanTeam = humanTeam;
    this.score = [0, 0];
    this.quarter = 1;
    this.clock = this.periodLength();
    this.clockRunning = false;
    this.playClock = 40;
    this.timeouts = [3, 3];
    this.down = 1;
    this.toGo = 10;
    this.firstYL = 35;
    this.yardLine = 35;
    this.ballZ = 0;
    this.phase = 'kickoff';
    this.twoMinWarned = {};
    this.log = [];
    this.stats = newStats(teams);
    this.ot = null;
    this.over = false;
    this.endReason = null;
    this.pendingPeriodEnd = false;
    this.messages = [];
    // Coin toss: winner takes the ball; the other team kicks off.
    const winner = rng.chance(0.5) ? 0 : 1;
    this.openingReceiver = winner;
    this.possession = winner; // receiving team
    this.kicker = 1 - winner;
    this.say(`${this.teams[winner].name} win the toss and will receive.`, 'toss');
    this.setupKickoff(1 - winner, KICKOFF_YL);
    this.driveStart = null;
  }

  periodLength() { return this.settings.quarterMinutes * 60 * (this.quarter > 4 ? 10 / 15 : 1); }
  say(text, kind = 'info') { this.messages.push({ text, kind, quarter: this.quarter, clock: this.clock }); }
  takeMessages() { const m = this.messages; this.messages = []; return m; }

  // ---- geometry ----
  /** Direction team t attacks this quarter: home attacks +x in Q1/Q3/OT, -x in Q2/Q4. */
  dirOf(t) {
    const flip = this.quarter === 2 || this.quarter === 4;
    return (t === 0 ? 1 : -1) * (flip ? -1 : 1);
  }
  xOf(team, yl) { return this.dirOf(team) * (yl - 50); }
  ylOf(team, x) { return 50 + x * this.dirOf(team); }

  get inTwoMinutes() { return (this.quarter === 2 || this.quarter >= 4) && this.clock <= 120; }
  get defense() { return 1 - this.possession; }

  situation() {
    return {
      phase: this.phase, possession: this.possession, quarter: this.quarter, clock: this.clock,
      down: this.down, toGo: this.toGo, yardLine: this.yardLine, score: [...this.score],
      timeouts: [...this.timeouts], clockRunning: this.clockRunning, ot: !!this.ot,
      goalToGo: this.firstYL >= 100, lead: this.score[this.possession] - this.score[1 - this.possession],
    };
  }

  // ---- play setup ----
  setupKickoff(kickingTeam, yl) {
    this.phase = 'kickoff';
    this.kicker = kickingTeam;
    this.possession = kickingTeam; // the kicking team "has" the ball for the kick
    this.yardLine = yl;
    this.ballZ = 0;
    this.clockRunning = false;
    this.playClock = 25;
  }

  setupTry(team) {
    this.phase = 'try';
    this.possession = team;
    this.yardLine = PAT_YL;
    this.ballZ = 0;
    this.down = 1;
    this.toGo = 15;
    this.firstYL = 100;
    this.clockRunning = false;
    this.playClock = 25;
  }

  newPossession(team, yl, z = 0) {
    this.possession = team;
    this.phase = 'scrimmage';
    this.yardLine = clamp(yl, 1, 99);
    this.ballZ = clamp(z, -HASH_Z, HASH_Z);
    this.down = 1;
    this.setFirstDown();
    this.driveStart = { team, yl: this.yardLine, quarter: this.quarter, clock: this.clock, plays: 0 };
    if (this.ot) this.ot.poss[team]++;
  }

  setFirstDown() {
    this.firstYL = Math.min(100, this.yardLine + 10);
    this.toGo = this.firstYL - this.yardLine;
  }

  /** PlaySim configuration for the next snap. `choice` = { offPlay, defPlay } chosen by the teams. */
  playConfig(choice) {
    const off = this.possession;
    const kick = choice.offPlay.type === 'kickoff';
    const fgTry = this.phase === 'try' && choice.offPlay.type === 'fg';
    let yl = this.yardLine;
    if (this.phase === 'try' && !fgTry) yl = TWO_PT_YL;
    return {
      offIdx: off,
      dir: this.dirOf(off),
      losX: this.xOf(off, yl),
      ballZ: kick || this.phase === 'try' ? 0 : this.ballZ,
      offPlay: choice.offPlay,
      defPlay: choice.defPlay,
      firstDownX: this.phase === 'scrimmage' && this.firstYL < 100 ? this.xOf(off, this.firstYL) : null,
    };
  }

  // ---- clock ----
  /** Advance the game clock while it is running (live play or runoff). Returns events. */
  tickClock(dt) {
    if (this.over) return;
    const before = this.clock;
    this.clock = Math.max(0, this.clock - dt);
    // Two-minute warning (2nd and 4th quarters).
    if ((this.quarter === 2 || this.quarter === 4) && before > 120 && this.clock <= 120 && !this.twoMinWarned[this.quarter]) {
      this.twoMinWarned[this.quarter] = true;
      this.twoMinPending = true;
    }
  }

  /** Run the clock between plays (if it is running). Stops at exactly 2:00 for the two-minute warning. */
  presnapRunoff(sec) {
    if (!this.clockRunning || this.over || sec <= 0) return 0;
    const before = this.clock;
    const twoMinLine = (this.quarter === 2 || this.quarter === 4) && before > 120 && !this.twoMinWarned[this.quarter];
    this.tickClock(sec);
    if (twoMinLine && this.clock <= 120) {
      this.clock = 120;
      this.clockRunning = false;
      this.twoMinPending = false;
      this.say('Two-minute warning', 'twoMinute');
    }
    return before - this.clock;
  }

  callTimeout(team) {
    if (this.timeouts[team] <= 0 || this.over || this.phase === 'kickoff') return false;
    this.timeouts[team]--;
    this.clockRunning = false;
    this.playClock = 25;
    this.say(`Timeout, ${this.teams[team].name} (${this.timeouts[team]} left)`, 'timeout');
    return true;
  }

  // ---- results ----
  /**
   * Apply a finished play. `r` is PlaySim.result, `sim` the PlaySim (for stats/roster ids).
   * `penalty` (optional) is an enforced penalty outcome from penalties.js.
   */
  applyResult(r, sim, penalty = null) {
    if (this.over) return;
    const off = r.offTeam;
    const def = 1 - off;
    const desc = describePlay(this, r, sim);
    recordStats(this, r, sim);
    if (this.driveStart) this.driveStart.plays++;
    this.lastResult = r;
    let stop = false;
    const wasTry = this.phase === 'try';

    if (penalty && penalty.accepted) {
      stop = true;
      this.applyPenalty(penalty, r);
      this.log.push({ q: this.quarter, clock: this.clock, team: off, text: `${desc} — ${penalty.text}` });
      return this.afterPlay(stop);
    }
    this.log.push({ q: this.quarter, clock: this.clock, team: off, text: desc });

    // ----- Tries (PAT / 2-point) -----
    if (wasTry) {
      if (r.kickType === 'fg') {
        if (r.fgGood) { this.addScore(off, 1, 'PAT'); } else this.say('Extra point is no good', 'miss');
      } else if (r.touchdown === off) this.addScore(off, 2, '2-point conversion');
      else if (r.touchdown === def) this.addScore(def, 2, 'Defensive 2-point return');
      else this.say('2-point try fails', 'miss');
      this.afterScore(off);
      return this.afterPlay(true);
    }

    // ----- Field goals -----
    if (r.kickType === 'fg') {
      const dist = 100 - this.yardLine + 17;
      if (r.fgGood) {
        this.addScore(off, 3, `${dist}-yard field goal`);
        this.afterScore(off);
      } else {
        this.say(`${dist}-yard field goal is no good`, 'miss');
        const spotOfKick = this.yardLine - 7;
        const recvYL = Math.max(20, 100 - spotOfKick);
        this.changePossession(def, recvYL, 0);
      }
      return this.afterPlay(true);
    }

    // ----- Kickoffs and punts -----
    if (r.kickType === 'kickoff' || r.kickType === 'punt') {
      const recv = def;
      if (r.touchdown !== null) {
        this.addScore(r.touchdown, 6, r.touchdown === recv ? `${r.kickType === 'punt' ? 'Punt' : 'Kickoff'} return touchdown` : 'Touchdown');
        this.setupTry(r.touchdown);
        this.possessionChangedForOT(r.touchdown);
        return this.afterPlay(true);
      }
      if (r.safety) {
        this.addScore(off, 2, 'Safety');
        this.setupKickoff(recv, 20);
        return this.afterPlay(true);
      }
      if (r.possTeam === off) {
        // Onside kick or muffed punt recovered by the kicking team.
        this.newPossession(off, this.ylOf(off, r.spotX), r.spotZ);
        if (r.onside) this.say('Onside kick recovered!', 'big');
        return this.afterPlay(true);
      }
      let yl;
      if (r.touchback) yl = r.kickType === 'kickoff' ? TOUCHBACK_KICKOFF : TOUCHBACK_PUNT;
      else if (r.kickOOB) yl = r.kickType === 'kickoff' ? 40 : this.ylOf(recv, r.spotX);
      else yl = this.ylOf(recv, r.spotX);
      if (r.touchback) this.say('Touchback', 'info');
      this.changePossession(recv, yl, r.touchback || r.kickOOB ? 0 : r.spotZ, true);
      return this.afterPlay(true);
    }

    // ----- Scrimmage plays -----
    const pt = r.possTeam;
    if (r.touchdown !== null) {
      this.addScore(r.touchdown, 6, r.touchdown === off ? 'Touchdown' : (r.interception ? 'Pick six' : 'Fumble return touchdown'));
      if (this.ot && this.ot.suddenDeath) return this.endGame('OT');
      this.setupTry(r.touchdown);
      if (r.touchdown !== off) this.possessionChangedForOT(r.touchdown);
      return this.afterPlay(true);
    }
    if (r.safety) {
      // Ball carrier downed in his own end zone: 2 points for the other team, free kick from the 20.
      const scoredOn = r.possTeam;
      this.addScore(1 - scoredOn, 2, 'Safety');
      if (this.ot && (this.ot.suddenDeath || this.ot.poss[1 - scoredOn] === 0)) return this.endGame('OT');
      this.setupKickoff(scoredOn, 20);
      return this.afterPlay(true);
    }
    if (pt !== off) {
      // Interception or fumble recovered by the defense.
      const yl = r.touchback ? 20 : this.ylOf(pt, r.spotX);
      this.say(r.interception ? `Intercepted by ${nameOf(sim, r.intBy)}!` : 'Fumble recovered by the defense!', 'turnover');
      this.changePossession(pt, yl, r.spotZ, true);
      return this.afterPlay(true);
    }
    if (r.fumble && r.touchback) {
      // Offense fumbled through the opponent's end zone.
      this.changePossession(def, 20, 0, true);
      return this.afterPlay(true);
    }

    // Normal scrimmage result for the offense.
    const newYL = r.incomplete ? this.yardLine : clamp(this.ylOf(off, r.spotX), 0.5, 99.5);
    if (!r.incomplete) this.yardLine = newYL;
    if (!r.incomplete) this.ballZ = clamp(r.spotZ, -HASH_Z, HASH_Z);
    stop = r.incomplete || r.outOfBounds && (this.inTwoMinutes || (this.quarter === 4 && this.clock <= 300));
    if (this.yardLine >= this.firstYL && this.firstYL < 100 || this.yardLine >= 100) {
      if (this.down === 3) this.stats.team[off].thirdConv++;
      this.down = 1;
      this.setFirstDown();
      this.stats.team[off].firstDowns++;
      this.firstDownFlag = true;
    } else {
      this.down++;
      this.toGo = Math.max(0.5, this.firstYL - this.yardLine);
      if (this.down > 4) {
        this.say('Turnover on downs', 'turnover');
        this.changePossession(def, 100 - this.yardLine, this.ballZ, true);
        return this.afterPlay(true);
      }
    }
    return this.afterPlay(stop);
  }

  applyPenalty(p, r) {
    // p: { team (offending), yards (+ = against offense means toward offense goal), spotYL, replayDown,
    //      autoFirst, lossOfDown, text, newYL }
    const off = r.offTeam;
    if (this.phase === 'try' && p.replay) { this.yardLine = clamp(p.newYL, 1, 99); this.say(p.text, 'penalty'); return; }
    if (p.kickoffRekick) { this.say(p.text, 'penalty'); this.setupKickoff(this.kicker, p.newYL); return; }
    this.yardLine = clamp(p.newYL, 1, 99);
    this.say(p.text, 'penalty');
    if (p.team === off) {
      if (p.lossOfDown) this.down++;
      this.toGo = this.firstYL - this.yardLine;
      if (this.yardLine >= this.firstYL && this.firstYL < 100) { this.down = 1; this.setFirstDown(); }
      if (this.down > 4) { this.say('Turnover on downs', 'turnover'); this.changePossession(1 - off, 100 - this.yardLine, this.ballZ, true); }
    } else {
      if (p.autoFirst || this.yardLine >= this.firstYL) { this.down = 1; this.setFirstDown(); }
      else this.toGo = this.firstYL - this.yardLine;
    }
    if (this.firstYL >= 100) this.toGo = 100 - this.yardLine;
  }

  addScore(team, pts, what) {
    this.score[team] += pts;
    this.stats.team[team].points += pts;
    this.say(`${what}, ${this.teams[team].name}! ${this.teams[0].abbr} ${this.score[0]} – ${this.teams[1].abbr} ${this.score[1]}`, 'score');
    this.lastScore = { team, pts, what };
    if (this.ot && this.ot.suddenDeath && pts !== 6) this.endGame('OT');
  }

  /** After a touchdown try or field goal, the scoring team kicks off (or OT resolution). */
  afterScore(scoringTeam) {
    if (this.over) return;
    if (this.ot && this.checkOT()) return;
    this.setupKickoff(scoringTeam, KICKOFF_YL);
  }

  changePossession(team, yl, z = 0, countsOT = false) {
    this.newPossession(team, yl, z);
    this.clockRunning = false;
    if (this.ot && countsOT !== null) this.checkOT();
  }

  possessionChangedForOT(team) {
    if (this.ot) this.ot.poss[team]++;
  }

  checkOT() {
    if (!this.ot || this.over) return false;
    const [a, b] = this.ot.poss;
    if (a >= 1 && b >= 1 && this.phase !== 'try') {
      if (this.score[0] !== this.score[1]) { this.endGame('OT'); return true; }
      this.ot.suddenDeath = true;
    }
    return false;
  }

  afterPlay(stopClock) {
    if (stopClock) this.clockRunning = false;
    else this.clockRunning = true;
    this.playClock = stopClock ? 25 : 40;
    if (this.twoMinPending) {
      this.twoMinPending = false;
      this.clockRunning = false;
      this.say('Two-minute warning', 'twoMinute');
    }
    if (this.clock <= 0 && !this.over && this.phase !== 'try') this.endPeriod();
  }

  endPeriod() {
    const q = this.quarter;
    if (q === 2) {
      this.say('Halftime', 'half');
      this.quarter = 3;
      this.clock = this.periodLength();
      this.timeouts = [3, 3];
      this.twoMinWarned = {};
      this.halftime = true;
      // The team that kicked off to start the game receives the second half.
      this.setupKickoff(this.openingReceiver, KICKOFF_YL);
      return;
    }
    if (q === 4 || q >= 5) {
      if (this.score[0] !== this.score[1]) return this.endGame('regulation');
      if (q >= 5) return this.endGame('tie');
      // Overtime: new coin toss, 10-minute period (scaled), 2 timeouts each.
      this.quarter = 5;
      this.clock = this.periodLength();
      this.timeouts = [2, 2];
      this.ot = { poss: [0, 0], suddenDeath: false };
      const recv = this.rng.chance(0.5) ? 0 : 1;
      this.say(`Overtime! ${this.teams[recv].name} will receive.`, 'half');
      this.setupKickoff(1 - recv, KICKOFF_YL);
      return;
    }
    // End of Q1/Q3: teams switch ends; the drive continues.
    this.say(`End of the ${['1st', '2nd', '3rd'][q - 1]} quarter`, 'quarter');
    this.quarter++;
    this.clock = this.periodLength();
  }

  endGame(reason) {
    this.over = true;
    this.endReason = reason;
    this.clockRunning = false;
    const [h, a] = this.score;
    const w = h === a ? null : h > a ? 0 : 1;
    this.winner = w;
    this.say(w === null ? `Final: tie game, ${h}–${a}` : `Final: ${this.teams[w].city} ${this.teams[w].name} win ${Math.max(h, a)}–${Math.min(h, a)}`, 'final');
  }

  /** Called when a kickoff/punt play is about to start, so the receiving team's drive bookkeeping works. */
  get receivingTeam() { return 1 - this.kicker; }
}

// ---------- stats ----------
function newStats(teams) {
  const team = teams.map(() => ({ points: 0, firstDowns: 0, plays: 0, yards: 0, passYds: 0, rushYds: 0, rushAtt: 0, passAtt: 0, passCmp: 0, sacks: 0, turnovers: 0, penalties: 0, penYds: 0, thirdAtt: 0, thirdConv: 0, top: 0 }));
  return { team, players: {} };
}

function pstat(m, team, rid) {
  const key = `${team}:${rid}`;
  return (m.stats.players[key] ||= { team, rid, passAtt: 0, passCmp: 0, passYds: 0, passTD: 0, int: 0, rushAtt: 0, rushYds: 0, rushTD: 0, rec: 0, recYds: 0, recTD: 0, tackles: 0, sacks: 0, defInt: 0, ff: 0, fr: 0, fgAtt: 0, fgMade: 0, xpAtt: 0, xpMade: 0, punts: 0, puntYds: 0, krYds: 0, prYds: 0 });
}

function recordStats(m, r, sim) {
  if (!sim) return;
  const T = m.stats.team;
  const off = r.offTeam;
  const rid = (id) => (id !== null && id !== undefined && sim.players[id] ? sim.players[id].rid : null);
  const team = (id) => sim.players[id]?.team;
  T[off].top += r.duration;
  if (r.kickType) {
    const k = rid(r.kicker);
    if (r.kickType === 'fg' && k !== null) {
      const s = pstat(m, off, k);
      if (m.phase === 'try') { s.xpAtt++; if (r.fgGood) s.xpMade++; } else { s.fgAtt++; if (r.fgGood) s.fgMade++; }
    }
    if (r.kickType === 'punt' && k !== null) { const s = pstat(m, off, k); s.punts++; s.puntYds += r.kickDistance || 0; }
    return;
  }
  if (m.phase === 'try') return;
  T[off].plays++;
  if (m.down === 3) { T[off].thirdAtt++; }
  const yds = r.incomplete ? 0 : r.yards;
  if (r.playType === 'pass' && (r.passAttempt || r.sack)) {
    const qb = rid(r.passer ?? r.carrierId);
    if (r.sack) {
      T[off].sacks++;
      T[off].passYds += yds; T[off].yards += yds;
      const t = rid(r.tackler);
      if (t !== null) pstat(m, 1 - off, t).sacks++;
    } else if (qb !== null) {
      const s = pstat(m, off, qb);
      s.passAtt++; T[off].passAtt++;
      if (r.complete) {
        s.passCmp++; T[off].passCmp++;
        s.passYds += yds; T[off].passYds += yds; T[off].yards += yds;
        const rr = rid(r.receiver);
        if (rr !== null) { const rs = pstat(m, off, rr); rs.rec++; rs.recYds += yds; if (r.touchdown === off) rs.recTD++; }
        if (r.touchdown === off) s.passTD++;
      }
      if (r.interception) { s.int++; T[off].turnovers++; const d = rid(r.intBy); if (d !== null) pstat(m, 1 - off, d).defInt++; }
    }
  } else if (r.carrierId !== undefined && !r.interception) {
    const c = rid(r.carrierId);
    if (c !== null && team(r.carrierId) === off && r.reason !== 'incomplete' && !r.stats?.spike) {
      const s = pstat(m, off, c);
      s.rushAtt++; s.rushYds += yds; T[off].rushAtt++; T[off].rushYds += yds; T[off].yards += yds;
      if (r.touchdown === off) s.rushTD++;
    }
  }
  if (r.fumbleLost) T[off].turnovers++;
  if (r.fumble && r.forcedBy !== null && r.forcedBy !== undefined) { const f = rid(r.forcedBy); if (f !== null) pstat(m, 1 - off, f).ff++; }
  const tk = rid(r.tackler);
  if (tk !== null && !r.sack && team(r.tackler) !== undefined) pstat(m, team(r.tackler), tk).tackles++;
}

// ---------- text ----------
function nameOf(sim, id) {
  const p = sim?.players[id];
  return p ? `${p.name}` : '';
}

const ORD = ['', '1st', '2nd', '3rd', '4th'];
export function downText(m) {
  if (m.phase === 'kickoff') return 'Kickoff';
  if (m.phase === 'try') return 'PAT';
  const togo = m.firstYL >= 100 ? 'Goal' : String(Math.max(1, Math.round(m.toGo)));
  return `${ORD[Math.min(4, m.down)]} & ${togo}`;
}

export function yardLineText(m, team = m.possession, yl = m.yardLine) {
  const y = Math.round(yl);
  if (y === 50) return '50';
  const own = y < 50;
  return `${(own ? m.teams[team] : m.teams[1 - team]).abbr} ${own ? y : 100 - y}`;
}

export function clockText(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function describePlay(m, r, sim) {
  const n = (id) => nameOf(sim, id);
  if (r.kickType === 'kickoff') return r.touchback ? 'Kickoff, touchback' : r.kickOOB ? 'Kickoff out of bounds' : `Kickoff returned by ${n(r.carrierId)}`;
  if (r.kickType === 'punt') return r.fairCatch ? 'Punt, fair catch' : r.touchback ? 'Punt, touchback' : r.downed ? 'Punt, downed' : `Punt returned by ${n(r.carrierId)}`;
  if (r.kickType === 'fg') return r.fgGood ? 'Kick is good' : 'Kick is no good';
  const y = Math.round(r.yards);
  if (r.stats?.spike || r.reason === 'incomplete' && r.passer === null) return 'Spike';
  if (r.sack) return `${n(r.carrierId)} sacked for ${y}`;
  if (r.interception) return `Pass intercepted by ${n(r.intBy)}`;
  if (r.incomplete) return r.target !== null ? `Pass incomplete to ${n(r.target)}` : 'Pass incomplete';
  if (r.complete) return `${n(r.passer)} pass to ${n(r.receiver)} for ${y}`;
  return `${n(r.carrierId)} run for ${y}`;
}
