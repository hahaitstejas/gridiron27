import { RNG } from '../core/rng.js';
import { STEP } from '../core/constants.js';
import { PlaySim } from '../sim/play.js';
import { Match, playStatLines } from './match.js';
import { newEnergy, applyPlayFatigue, restAll } from './fatigue.js';
import { offenseAudibles, defenseAudibles, hotRoute, HOT_ROUTES } from './audibles.js';
import { enforce, rollPresnapFoul, PENALTIES } from './penalties.js';
import { chooseOffense, chooseDefense, defenseForSpecial, cpuTempo, cpuTimeout } from '../ai/playcaller.js';
import { difficultyConfig, DIFFICULTY } from '../ai/difficulty.js';
import { getOffPlay, getDefPlay } from '../data/playbook.js';

/**
 * Drives a full game: play calling, pre-snap, the live play, results, clock, timeouts, penalties.
 * Pure logic (no DOM). humanTeam: 0 (home), 1 (away) or null (CPU vs CPU).
 *
 * States: 'playcall' (waiting for calls) -> 'presnap' (at the line) -> 'live' -> 'post' -> ...
 */
export class GameSession {
  constructor({ teams, settings = {}, humanTeam = null, seed = 1, fast = false }) {
    this.teams = teams;
    this.rng = new RNG(seed);
    this.humanTeam = humanTeam;
    this.fast = fast; // headless autosim: no waiting for animations or UI
    this.match = new Match({ teams, settings, rng: this.rng, humanTeam });
    this.settings = this.match.settings;
    this.diff = difficultyConfig(this.settings.difficulty, humanTeam);
    this.energy = newEnergy(); // player fatigue for substitutions (game/fatigue.js)
    this.smart = humanTeam === null ? 0.9 : (DIFFICULTY[this.settings.difficulty] || DIFFICULTY.pro).smart;
    this.state = 'playcall';
    this.sim = null;
    this.events = [];
    this.choice = { off: null, def: null };
    this.wait = 0;
    this.pendingPenalty = null;
    this.plays = 0;
    this.enterPlaycall();
  }

  get offTeam() { return this.match.possession; }
  get defTeam() { return 1 - this.match.possession; }
  /** 'offense' | 'defense' | null — which side the human is on for the coming play. */
  get humanSide() {
    if (this.humanTeam === null) return null;
    return this.humanTeam === this.offTeam ? 'offense' : 'defense';
  }
  /** True when the play-call screen should be open for the human. */
  get needsHumanCall() {
    if (this.state !== 'playcall' || this.humanTeam === null) return false;
    return this.humanSide === 'offense' ? !this.choice.off : !this.choice.def;
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  enterPlaycall() {
    const m = this.match;
    this.audible = null;
    this.state = m.over ? 'over' : 'playcall';
    if (m.over) { this.flushMessages(); this.emit('gameOver', { winner: m.winner }); return; }
    this.choice = { off: null, def: null };
    this.presnapUsed = 0;
    // CPU timeouts (stopping the clock between plays).
    for (const t of [0, 1]) if (t !== this.humanTeam && cpuTimeout(m, t) && m.callTimeout(t)) restAll(this.energy, 0.06);
    const off = this.offTeam, def = this.defTeam;
    if (off !== this.humanTeam) this.choice.off = chooseOffense(m, off, this.rng, this.smart);
    if (def !== this.humanTeam) this.choice.def = this.cpuDefenseFor(this.choice.off);
    // The human's special-teams unit comes on automatically (kick return, punt return, FG block).
    else if (m.phase === 'kickoff' || (this.choice.off && defenseForSpecial(this.choice.off))) this.choice.def = this.cpuDefenseFor(this.choice.off);
    this.flushMessages();
    this.emit('playcall', { human: this.humanSide });
  }

  cpuDefenseFor(offPlay) {
    const m = this.match;
    if (m.phase === 'kickoff') return getDefPlay('st_kick_return');
    if (offPlay) { const st = defenseForSpecial(offPlay); if (st) return st; }
    const blitz = (DIFFICULTY[this.settings.difficulty] || DIFFICULTY.pro).blitz;
    return chooseDefense(m, this.defTeam, this.rng, blitz);
  }

  /** The human picked a play on the play-call screen. */
  humanChoose(play) {
    if (this.state !== 'playcall') return;
    if (this.humanSide === 'offense') this.choice.off = play;
    else this.choice.def = play;
  }

  callTimeout(team = this.humanTeam) {
    if (this.state !== 'playcall' && !(this.state === 'presnap' && this.sim?.state === 'presnap')) return false;
    const ok = this.match.callTimeout(team);
    if (ok) restAll(this.energy, 0.06);
    this.flushMessages();
    return ok;
  }

  flushMessages() {
    for (const msg of this.match.takeMessages()) this.emit('message', msg);
  }

  /** Build the PlaySim once both sides have a call. */
  startPresnap() {
    const m = this.match;
    let off = this.choice.off;
    let def = this.choice.def;
    // A special-teams call on offense brings the matching unit on defense.
    const st = defenseForSpecial(off);
    if (st) def = st;
    if (m.phase === 'kickoff') def = getDefPlay('st_kick_return');
    const cfg = m.playConfig({ offPlay: off, defPlay: def });
    const human = this.humanTeam;
    this.sim = new PlaySim({
      ...cfg,
      rng: this.rng,
      teams: this.teams,
      humanTeam: human,
      camDir: m.dirOf(m.possession),
      boost: this.diff.boost,
      energy: this.energy,
      // Starters stay in for the big moments: late in a close game, two-minute drill, goal line.
      subRelax: (m.quarter >= 4 && Math.abs(m.score[0] - m.score[1]) <= 8) || m.inTwoMinutes || m.yardLine >= 92 ? 0.15 : 0,
      difficulty: this.diff.difficulty,
      penaltyRate: m.phase === 'scrimmage' ? 1 : 0,
    });
    this.state = 'presnap';
    this.presnapT = 0;
    this.emit('presnap', { sim: this.sim });
  }

  /** Snap (human pressed A, or the CPU's tempo ran out). Applies pre-snap clock runoff and fouls. */
  snap() {
    const m = this.match;
    const sim = this.sim;
    const cpuOff = this.offTeam !== this.humanTeam;
    // Clock between plays.
    if (m.clockRunning && m.phase === 'scrimmage') {
      const target = cpuOff ? cpuTempo(m, this.offTeam, this.rng) : this.presnapUsed;
      const extra = Math.max(0, target - this.presnapUsed);
      const accel = m.settings.accelClock > 0 && !(m.inTwoMinutes && m.score[m.possession] <= m.score[1 - m.possession]);
      const want = cpuOff ? extra : Math.max(0, (accel ? 40 - m.settings.accelClock : 0) - this.presnapUsed);
      m.presnapRunoff(want);
      if (m.clock <= 0) { m.afterPlay(true); this.flushMessages(); this.enterPlaycall(); return; }
      if (!m.clockRunning) { this.flushMessages(); } // two-minute warning stopped it
    }
    // Pre-snap fouls (false start / offsides) kill the play before it starts.
    const foul = rollPresnapFoul(m, sim, this.rng, this.settings.penalties === false ? 0 : 1);
    if (foul) {
      const out = enforce(m, foul, null);
      m.stats.team[foul.team].penalties++;
      m.stats.team[foul.team].penYds += Math.round(Math.abs(out.newYL - m.yardLine));
      m.applyPenalty(out, { offTeam: m.possession });
      m.clockRunning = false;
      this.emit('flag', { foul, outcome: out, presnap: true });
      this.flushMessages();
      this.enterPlaycall();
      return;
    }
    this.audible = null;
    sim.snap();
    this.state = 'live';
    this.plays++;
  }

  // ---------- audibles & hot routes ----------
  openAudible(mode) {
    const humanOff = this.offTeam === this.humanTeam;
    if (mode === 'menu') {
      const options = humanOff ? offenseAudibles(this.sim.offPlay) : defenseAudibles(this.sim.defPlay);
      if (options.length) this.audible = { mode, options };
    } else {
      this.sim.computeIcons(true); // every eligible receiver gets a button
      this.audible = { mode: 'hot', slot: null };
    }
  }

  closeAudible() {
    this.audible = null;
    this.sim?.computeIcons();
  }

  audibleInput(input) {
    const a = this.audible;
    const humanOff = this.offTeam === this.humanTeam;
    if (input.pressed.LB || input.pressed.View) { this.closeAudible(); return; }
    if (a.mode === 'menu') {
      const opt = a.options.find((o) => input.pressed[o.btn]);
      if (!opt) return;
      if (humanOff) this.choice.off = opt.play; else this.choice.def = opt.play;
      this.audible = null;
      this.rebuildPresnap();
      this.emit('audible', { label: opt.label, play: opt.play.name, side: humanOff ? 'offense' : 'defense' });
      return;
    }
    // Hot route: pick a receiver, then a direction (or A to keep him in to block).
    if (!a.slot) {
      for (const [btn, id] of Object.entries(this.sim.icons)) {
        if (input.pressed[btn]) { a.slot = this.sim.players[id].slot; a.id = id; return; }
      }
      return;
    }
    let route = null;
    if (input.pressed.A) route = HOT_ROUTES.block;
    else if (input.ly < -0.6) route = HOT_ROUTES.up;
    else if (input.ly > 0.6) route = HOT_ROUTES.down;
    else if (Math.abs(input.lx) > 0.6) {
      const rec = this.sim.players[a.id];
      const dz = input.lx * this.sim.camDir; // stick right = screen right = +z * camDir
      const side = rec.z - this.sim.ballZ;
      route = Math.abs(side) < 1 || Math.sign(dz) !== Math.sign(side) ? HOT_ROUTES.in : HOT_ROUTES.out;
    }
    if (!route) return;
    this.choice.off = hotRoute(this.sim.offPlay, a.slot, route);
    this.audible = null;
    this.rebuildPresnap();
    this.emit('hotRoute', { slot: a.slot, route, player: this.sim.players.find((p) => p.team === this.offTeam && p.slot === a.slot)?.name });
  }

  /** Re-line up after an audible without restarting the CPU's snap count. */
  rebuildPresnap() {
    const t = this.presnapT;
    this.startPresnap();
    this.presnapT = t;
  }

  /** Advance the game by dt seconds. `input` is the human's controller frame (or null). */
  tick(dt, input) {
    this.events.length = 0;
    const m = this.match;
    if (this.state === 'over') return;
    const humanInvolved = this.humanTeam !== null;

    if (this.state === 'playcall') {
      // The play clock (and a running game clock) tick while the human picks a play.
      if (humanInvolved && !this.fast) this.realtimePresnap(dt);
      if (this.choice.off && this.choice.def) this.startPresnap();
      return;
    }

    if (this.state === 'presnap') {
      const sim = this.sim;
      if (humanInvolved && !this.fast) this.realtimePresnap(dt);
      if (this.state !== 'presnap') return;
      this.presnapT += dt;
      const humanOff = this.offTeam === this.humanTeam;
      if (input && humanInvolved && this.audible) {
        // Audible / hot-route menus are modal: the play waits (the play clock doesn't).
        this.audibleInput(input);
        if (this.state === 'presnap') this.sim.tick(dt, null);
        return;
      }
      if (input && humanInvolved && !sim.isKick && (input.pressed.X || (humanOff && input.pressed.Y && this.match.phase === 'scrimmage'))) {
        this.openAudible(input.pressed.X ? 'menu' : 'hot');
        this.sim.tick(dt, null);
        return;
      }
      if (input && humanInvolved) {
        if (input.pressed.View) this.callTimeout(this.humanTeam);
        if (humanOff && input.pressed.A) { this.snap(); if (this.sim && this.state === 'live') this.sim.tick(dt, null); return; }
        if (!humanOff && input.pressed.B && sim.isKick === false) cyclePresnapDefender(sim);
      }
      // CPU offense snaps after a short beat at the line (instantly in fast mode).
      if (!humanOff && this.presnapT >= (this.fast ? 0 : humanInvolved ? 1.6 : 0.5)) { this.snap(); return; }
      sim.tick(dt, input);
      return;
    }

    if (this.state === 'live') {
      const sim = this.sim;
      sim.tick(dt, humanInvolved ? input : null);
      for (const e of sim.events) this.events.push(e);
      // Game clock runs during live plays (not during tries, or while a kick is in the air before it's touched).
      const kickInAir = sim.isKick && (sim.ball.state === 'kick' || sim.ball.state === 'tee' || sim.ball.state === 'snap');
      if (m.phase !== 'try' && sim.state === 'live' && !kickInAir) m.tickClock(dt);
      if (sim.state === 'dead' && (this.fast || sim.finished)) this.finishPlay();
      return;
    }

    if (this.state === 'post') {
      this.wait -= dt;
      if (this.wait <= 0) this.enterPlaycall();
    }
  }

  realtimePresnap(dt) {
    const m = this.match;
    if (m.clockRunning && m.phase === 'scrimmage') m.presnapRunoff(dt);
    this.presnapUsed += dt;
    m.playClock = Math.max(0, m.playClock - dt);
    this.flushMessages();
    if (m.clock <= 0 && m.clockRunning) { m.afterPlay(true); this.flushMessages(); this.enterPlaycall(); return; }
    // Delay of game on the human offense.
    if (m.playClock <= 0 && this.humanTeam === this.offTeam && m.phase === 'scrimmage') {
      const foul = { type: 'delay_of_game', team: this.offTeam };
      const out = enforce(m, foul, null);
      m.applyPenalty(out, { offTeam: m.possession });
      m.clockRunning = false;
      this.emit('flag', { foul, outcome: out, presnap: true });
      this.flushMessages();
      this.enterPlaycall();
    }
  }

  finishPlay() {
    const m = this.match;
    const sim = this.sim;
    const r = sim.result;
    let outcome = null;
    const fouls = (sim.fouls || []).filter(() => !sim.isKick && m.phase === 'scrimmage');
    if (fouls.length) {
      const offF = fouls.filter((f) => f.team === r.offTeam);
      const defF = fouls.filter((f) => f.team !== r.offTeam);
      if (offF.length && defF.length) {
        outcome = { accepted: true, text: 'Offsetting penalties, replay the down', newYL: m.yardLine, team: -1, offsetting: true };
      } else {
        // The most damaging foul for the offending team.
        const f = fouls[0];
        outcome = enforce(m, f, r);
        if (outcome.accepted) { m.stats.team[f.team].penalties++; m.stats.team[f.team].penYds += Math.round(Math.abs(outcome.newYL - m.yardLine)); }
      }
      this.emit('flag', { foul: fouls[0], outcome });
    }
    const scrimmage = m.phase === 'scrimmage';
    const quarter = m.quarter;
    applyPlayFatigue(this.energy, sim, r.duration || 5);
    m.applyResult(r, sim, outcome && outcome.accepted ? outcome : null);
    if (m.quarter !== quarter) restAll(this.energy, m.quarter === 3 ? 1 : 0.2); // halftime / quarter break
    if (outcome && !outcome.accepted) m.say(outcome.text, 'penalty');
    this.flushMessages();
    // Who made the play and their game totals (skipped on tries and plays wiped out by a flag).
    const statLines = scrimmage && !(outcome && outcome.accepted) ? playStatLines(m, r, sim) : [];
    this.emit('result', { result: r, outcome, statLines });
    this.state = 'post';
    this.wait = this.fast ? 0 : 0.7;
  }
}

function cyclePresnapDefender(sim) {
  const defs = sim.players.filter((p) => p.team === sim.defIdx).sort((a, b) => sim.toLocal(a.x, a.z).lat - sim.toLocal(b.x, b.z).lat);
  const i = defs.findIndex((p) => p.id === sim.controlledId);
  sim.controlledId = defs[(i + 1) % defs.length].id;
}

export { STEP };
