import { RNG } from '../core/rng.js';

/** Seconds after a play is set for the players to break the huddle and line up (the renderer animates it). */
export const LINEUP_T = 1.3;
import { addFoul } from '../sim/fouls.js';
import { STEP } from '../core/constants.js';
import { PlaySim } from '../sim/play.js';
import { Match, playStatLines, yardLineText } from './match.js';
import { newEnergy, applyPlayFatigue, restAll } from './fatigue.js';
import { applyScenario, scenarioById, scenarioCheck } from './scenarios.js';
import { newDrill, drillSpot, drillPlays, drillControl, drillWatch, drillScore, DRILLS } from './drills.js';
import { closeCall, boothReviews, canChallenge, cpuChallenges, settleReview, CHALLENGE_T, REVIEW_T } from './review.js';
import { offenseAudibles, defenseAudibles, hotRoute, HOT_ROUTES, COVERAGE_CALLS, cpuCoverageCall, DEF_HOT, defHotRoute, PROTECTION_CALLS, protectCall } from './audibles.js';
import { ReplayRecorder } from '../replay/replay.js';
import { injuryText } from '../sim/injuries.js';
import { enforce, rollPresnapFoul, PENALTIES, describeChoice , KICK_FOULS } from './penalties.js';
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
  constructor({ teams, settings = {}, humanTeam = null, humanTeams = null, seed = 1, fast = false }) {
    this.teams = teams;
    this.rng = new RNG(seed);
    // Human-controlled teams: [] (CPU vs CPU), [0] or [1], or [0, 1] for local 2-player.
    this.humanTeams = humanTeams || (humanTeam !== null ? [humanTeam] : []);
    humanTeam = this.humanTeams.length === 1 ? this.humanTeams[0] : null;
    this.fast = fast; // headless autosim: no waiting for animations or UI
    this.match = new Match({ teams, settings, rng: this.rng, humanTeam });
    this.settings = this.match.settings;
    // Difficulty only applies against the CPU (none in 2-player).
    this.diff = difficultyConfig(this.settings.difficulty, humanTeam);
    this.energy = newEnergy(); // player fatigue for substitutions (game/fatigue.js)
    this.recorder = new ReplayRecorder(); // last play, for instant replay (not in fast/headless mode)
    this.lastReplay = null;
    this.smart = humanTeam === null ? 0.9 : (DIFFICULTY[this.settings.difficulty] || DIFFICULTY.pro).smart;
    this.pendingPenalty = null;
    // Injuries this game ({ team, rid, name, pos, type, weeks }); those players sit out the rest of the game.
    // settings.unavailable = [[ids], [ids]] lists players already hurt (franchise).
    this.injuries = [];
    this.state = 'playcall';
    this.sim = null;
    this.events = [];
    this.choice = { off: null, def: null };
    this.wait = 0;
    this.pendingPenalty = null;
    this.plays = 0;
    // Practice: { side: 'offense'|'defense', yardLine, down, toGo, after: 'reset'|'continue' }.
    // No clock, no penalties, no fatigue; the situation resets after each play (or when a drive ends).
    this.practice = settings.practice || null;
    // Skills drill (drills.js): practice with fixed reps, the drill's plays and a score.
    this.drill = settings.drill ? newDrill(settings.drill.id) : null;
    if (this.drill) this.practice = { side: DRILLS[this.drill.id].side, after: 'reset', ...drillSpot(this.drill) };
    // The drill's human team (settings.drillAuto: the CPU runs the drill, for tools/tests).
    this.drillHuman = this.humanTeams[0] ?? 0;
    if (this.drill && settings.drillAuto) this.humanTeams = [];
    if (this.practice) this.practiceReset();
    // Career mode: settings.lockPlayer = roster id. The human plays only as him: he calls plays only as a QB
    // (offense) or MLB (defense), and snaps he isn't on the field for run CPU vs CPU (`watching`).
    this.lock = settings.lockPlayer ?? null;
    this.baseHumans = [...this.humanTeams];
    this.watching = false;
    if (this.lock !== null) {
      const t = teams[this.baseHumans[0]];
      this.lockPos = t?.roster.find((p) => p.id === this.lock)?.pos || null;
    }
    // Scenario (scenarios.js): the game starts in a late situation with a goal; the human is the home team.
    this.scenario = settings.scenario ? applyScenario(this.match, scenarioById(settings.scenario.id)) : null;
    this.enterPlaycall();
  }

  /** Does the human call this team's plays? (Career: only his own side, and only as QB / MLB.) */
  calls(team) {
    if (!this.isHuman(team)) return false;
    if (this.lock === null) return true;
    return team === this.offTeam ? this.lockPos === 'QB' : this.lockPos === 'MLB';
  }

  practiceReset() {
    if (this.drill) Object.assign(this.practice, drillSpot(this.drill));
    const pr = this.practice;
    const m = this.match;
    const me = this.drill ? this.drillHuman : this.humanTeam;
    const off = pr.side === 'offense' ? me : 1 - me;
    m.over = false;
    m.quarter = 1;
    m.clock = m.settings.quarterMinutes * 60;
    m.newPossession(off, pr.yardLine, 0);
    m.down = pr.down;
    m.toGo = Math.min(pr.toGo, 100 - pr.yardLine);
    m.firstYL = Math.min(100, pr.yardLine + pr.toGo);
    m.clockRunning = false;
    m.timeouts = [3, 3];
    m.takeMessages(); // no coin toss / drive chatter in practice
  }

  get twoPlayer() { return this.humanTeams.length === 2; }
  /** Gameplay sliders for a team: the user set for human teams, the CPU set otherwise. */
  slidersFor(team) {
    const s = this.settings.sliders;
    if (!s) return null;
    return this.isHuman(team) ? s.user : s.cpu;
  }
  /** Penalty frequency (Penalties off = 0; the slider scales it, 50 = normal). */
  penaltyRate() {
    if (this.settings.penalties === false) return 0;
    return (this.settings.sliders?.penalties ?? 50) / 50;
  }
  isHuman(team) { return this.humanTeams.includes(team); }
  /**
   * The human the UI is serving right now. One player: that team. Two players: whoever is calling a play,
   * then whoever decides a pending penalty, otherwise the offense.
   */
  get humanTeam() {
    if (!this.humanTeams.length) return null;
    if (!this.twoPlayer) return this.humanTeams[0];
    if (this.state === 'playcall' && this.choice) {
      if (!this.choice.off) return this.offTeam;
      if (!this.choice.def) return this.defTeam;
    }
    if (this.state === 'penalty' && this.pendingPenalty) return 1 - this.pendingPenalty.outcome.team;
    return this.offTeam;
  }
  /** One human's controller frame from `input` (a frame for one player, { perTeam, 0, 1 } for two). */
  inputFor(input, team) {
    if (!input || !this.isHuman(team)) return null;
    if (input.perTeam) return input[team] || null;
    return input;
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
    if (this.state !== 'playcall' || !this.humanTeams.length) return false;
    return (this.calls(this.offTeam) && !this.choice.off) || (this.calls(this.defTeam) && !this.choice.def);
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  enterPlaycall() {
    const m = this.match;
    this.audible = null;
    this.state = m.over ? 'over' : 'playcall';
    if (m.over) { this.flushMessages(); this.emit('gameOver', { winner: m.winner }); return; }
    this.choice = { off: null, def: null };
    this.defAdj = null;
    this.cpuMotionAt = 0;
    if (this.lock !== null) { this.humanTeams = [...this.baseHumans]; this.watching = false; }
    this.presnapUsed = 0;
    // CPU timeouts (stopping the clock between plays).
    for (const t of [0, 1]) if (!this.isHuman(t) && cpuTimeout(m, t) && m.callTimeout(t)) restAll(this.energy, 0.06);
    const off = this.offTeam, def = this.defTeam;
    if (this.drill) { const d = drillPlays(this.drill); this.choice = { off: d.off, def: d.def }; this.flushMessages(); this.emit('playcall', { human: this.humanSide }); return; }
    if (!this.calls(off)) this.choice.off = chooseOffense(m, off, this.rng, this.smart);
    if (!this.calls(def)) { this.choice.def = this.cpuDefenseFor(this.choice.off); this.defAdj = cpuCoverageCall(this.choice.def, this.rng); }
    // CPU offense: sometimes motion a receiver before the snap (only when someone's watching).
    if (!this.isHuman(off) && this.humanTeam !== null && !this.fast && this.rng.next() < 0.3) this.cpuMotionAt = 0.35;
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
    if (this.humanSide === 'offense') {
      this.choice.off = play;
      if (!/^st_/.test(play.id)) this.lastOffPlay = play;
      // 2-player: a special-teams call brings the other human's matching unit on automatically.
      if (this.isHuman(this.defTeam) && !this.choice.def && (this.match.phase === 'kickoff' || defenseForSpecial(play))) this.choice.def = this.cpuDefenseFor(play);
    } else this.choice.def = play;
    this.hurry = false;
  }

  /** No-huddle: rerun the last offensive play straight away (no extra accelerated-clock runoff). */
  noHuddle() {
    if (this.state !== 'playcall' || this.humanSide !== 'offense' || !this.lastOffPlay || this.match.phase !== 'scrimmage') return false;
    this.choice.off = this.lastOffPlay;
    this.hurry = true;
    return true;
  }

  /** Spike the ball: at the line, switch to a spike and snap right away (stops the clock, uses a down). */
  spike() {
    if (this.state !== 'presnap' || this.humanSide !== 'offense' || this.match.phase !== 'scrimmage' || this.sim?.isKick) return false;
    this.choice.off = getOffPlay('st_spike');
    this.rebuildPresnap();
    this.hurry = true;
    this.snap();
    return true;
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
      humanTeams: this.humanTeams,
      camDir: m.dirOf(m.possession),
      boost: this.diff.boost,
      energy: this.energy,
      // Starters stay in for the big moments: late in a close game, two-minute drill, goal line.
      subRelax: (m.quarter >= 4 && Math.abs(m.score[0] - m.score[1]) <= 8) || m.inTwoMinutes || m.yardLine >= 92 ? 0.15 : 0,
      difficulty: this.diff.difficulty,
      penaltyRate: m.phase === 'scrimmage' ? this.penaltyRate() : 0,
      sliders: [0, 1].map((t) => this.slidersFor(t)),
      injuryRate: this.practice ? 0 : (this.settings.sliders?.injuries ?? 50) / 50,
      unavailable: [0, 1].map((t) => [...(this.settings.unavailable?.[t] || []), ...this.injuries.filter((i) => i.team === t).map((i) => i.rid)]),
      defAdj: this.defAdj,
      weather: this.settings.weather || null,
    });
    if (this.lock !== null) this.lockOn(this.sim);
    if (this.drill) drillControl(this.sim, this.drill);
    this.state = 'presnap';
    this.presnapT = 0;
    this.jetWait = false;
    this.hardCounted = false;
    this.emit('presnap', { sim: this.sim });
  }

  /** Career: control locks to the player when he's on the field; otherwise this snap is CPU vs CPU. */
  lockOn(sim) {
    const me = sim.players.find((p) => p.rid === this.lock);
    const team = this.baseHumans[0];
    // On kicks he's only involved as the kicker / returner the sim gave the human.
    const onField = me && (!sim.isKick || sim.withHuman(team, () => sim.controlledId) === me.id);
    if (!onField) {
      this.watching = true;
      this.humanTeams = [];
      sim.humanTeam = null; sim.humanTeams = []; sim.controlled = {};
      this.emit('watching', {});
      return;
    }
    sim.lockId = me.id;
    sim.withHuman(team, () => { sim.controlledId = me.id; });
    // The behind-the-player camera looks the other way for a defender: the stick follows the camera.
    if (this.settings.playerCam && me.team !== sim.offIdx) sim.camDir = -sim.dir;
  }

  /** Snap (human pressed A, or the CPU's tempo ran out). Applies pre-snap clock runoff and fouls. */
  snap() {
    const m = this.match;
    const sim = this.sim;
    // Jet motion plays: the snap call starts the motion; the ball is snapped as he reaches the QB (see tick).
    const mo = sim.offPlay.motion;
    if (mo && !sim.isKick && !this.jetGo) {
      const p = sim.offense().find((q) => q.slot === mo.slot);
      if (p && !sim.motion) sim.startMotion(p.id, mo.across !== false, { depth: mo.depth ?? null, speed: mo.speed ?? null });
      if (sim.motion) { this.jetWait = true; return; }
    }
    const cpuOff = !this.calls(this.offTeam);
    // Clock between plays.
    if (m.clockRunning && m.phase === 'scrimmage') {
      const target = cpuOff ? cpuTempo(m, this.offTeam, this.rng) : this.presnapUsed;
      const extra = Math.max(0, target - this.presnapUsed);
      const accel = m.settings.accelClock > 0 && !(m.inTwoMinutes && m.score[m.possession] <= m.score[1 - m.possession]);
      const want = cpuOff ? extra : this.hurry ? 0 : Math.max(0, (accel ? 40 - m.settings.accelClock : 0) - this.presnapUsed);
      m.presnapRunoff(want);
      if (m.clock <= 0) { m.afterPlay(true); this.flushMessages(); this.enterPlaycall(); return; }
      if (!m.clockRunning) { this.flushMessages(); } // two-minute warning stopped it
    }
    // Pre-snap fouls: a false start kills the play; a defender jumping offsides gets flagged and the
    // offense has a free play (enforced after it, take the better of the play or the 5 yards).
    const forced = this.forceFoul; this.forceFoul = null;
    const foul = forced || rollPresnapFoul(m, sim, this.rng, this.penaltyRate());
    if (foul?.type === 'offsides') {
      this.audible = null;
      sim.snap();
      jumpOffsides(sim, foul.player);
      if (!this.fast) { this.recorder.reset(); this.recorder.capture(sim); }
      this.state = 'live';
      this.plays++;
      return;
    }
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
    const motion = !!sim.motion;
    sim.snap();
    // Illegal formation / illegal motion: flagged at the snap, the play goes on (a live-ball foul).
    if (m.phase === 'scrimmage' && !sim.isKick && this.rng.next() < 0.002 * this.penaltyRate()) {
      const skill = sim.offense().filter((p) => ['WR', 'TE', 'HB', 'FB'].includes(p.pos));
      const who = motion && sim.motion ? sim.players[sim.motion.id] : this.rng.pick(skill.length ? skill : sim.offense());
      addFoul(sim, motion ? 'illegal_motion' : 'illegal_formation', sim.offIdx, who, { spotX: sim.losX });
    }
    if (!this.fast) { this.recorder.reset(); this.recorder.capture(sim); }
    this.state = 'live';
    this.plays++;
  }

  /**
   * Hard count (LT at the line, once per play): an eager defender may jump (offsides, a free play), rarely one
   * of your own linemen flinches (false start). Disciplined (high awareness) defensive lines bite less.
   */
  hardCount() {
    const sim = this.sim, m = this.match;
    if (this.state !== 'presnap' || sim.isKick || m.phase !== 'scrimmage' || this.hardCounted || this.isHuman(this.defTeam)) return false;
    this.hardCounted = true;
    const dl = sim.defense().filter((p) => /E$|DT/.test(p.slot));
    const awr = dl.reduce((a, p) => a + p.r.awareness, 0) / Math.max(1, dl.length);
    const pJump = Math.max(0.02, Math.min(0.12, 0.05 + (70 - awr) / 300)) * (this.settings.penalties === false ? 0 : 1);
    const r = this.rng.next();
    if (r < pJump) {
      this.forceFoul = { type: 'offsides', team: this.defTeam, player: this.rng.pick(dl.length ? dl : sim.defense()) };
      this.emit('hardCount', { result: 'jump' });
      this.snap();
    } else if (r < pJump + 0.04 * (this.settings.penalties === false ? 0 : 1)) {
      const ol = sim.offense().filter((p) => ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot));
      this.forceFoul = { type: 'false_start', team: this.offTeam, player: this.rng.pick(ol) };
      this.emit('hardCount', { result: 'flinch' });
      this.snap();
    } else this.emit('hardCount', { result: 'none' });
    return true;
  }

  // ---------- audibles & hot routes ----------
  openAudible(mode, team = this.humanTeam) {
    const humanOff = this.offTeam === team;
    if (mode === 'menu') {
      const options = humanOff ? offenseAudibles(this.sim.offPlay) : defenseAudibles(this.sim.defPlay);
      if (options.length) this.audible = { mode, options, team };
    } else if (mode === 'adjust') {
      this.audible = { mode, options: COVERAGE_CALLS, team };
    } else if (mode === 'protect') {
      if (this.sim.offPlay.type === 'pass') this.audible = { mode, options: PROTECTION_CALLS, team };
    } else if (mode === 'dhot') {
      const me = this.sim.withHuman(team, () => this.sim.players[this.sim.controlledId]);
      if (me) this.audible = { mode, options: DEF_HOT, team, slot: me.slot, name: me.name };
    } else {
      this.sim.computeIcons(true); // every eligible receiver gets a button
      this.audible = { mode, slot: null, team };
    }
  }

  closeAudible() {
    this.audible = null;
    this.sim?.computeIcons();
  }

  audibleInput(input) {
    const a = this.audible;
    const humanOff = this.offTeam === a.team;
    if (input.pressed.LB || input.pressed.View) { this.closeAudible(); return; }
    if (a.mode === 'adjust') {
      const opt = a.options.find((o) => input.pressed[o.btn]);
      if (!opt) return;
      this.defAdj = opt.key === 'reset' ? null : { ...this.defAdj, ...opt.set };
      this.audible = null;
      this.rebuildPresnap();
      this.emit('audible', { label: opt.label, play: 'Coverage', side: 'defense' });
      return;
    }
    if (a.mode === 'protect') {
      const opt = a.options.find((o) => input.pressed[o.btn]);
      if (!opt) return;
      this.choice.off = protectCall(this.sim.offPlay, opt.key);
      this.audible = null;
      this.rebuildPresnap();
      this.emit('audible', { label: opt.label.replace(/ \(.*\)$/, ''), play: 'Protection', side: 'offense' });
      return;
    }
    if (a.mode === 'dhot') {
      const opt = a.options.find((o) => input.pressed[o.btn]);
      if (!opt) return;
      const sim = this.sim, me = sim.players.find((p) => p.team === a.team && p.slot === a.slot);
      this.choice.def = defHotRoute(sim.defPlay, a.slot, opt.key, me ? sim.toLocal(me.x, me.z).lat : 0);
      this.audible = null;
      this.rebuildPresnap();
      // Stay on the same defender after the re-line-up.
      const again = this.sim.players.find((p) => p.team === a.team && p.slot === a.slot);
      if (again) this.sim.withHuman(a.team, () => { this.sim.controlledId = again.id; });
      this.emit('audible', { label: `${a.name}: ${opt.label}`, play: 'Hot route', side: 'defense' });
      return;
    }
    if (a.mode === 'motion') {
      // Pick a receiver, then the stick: toward the ball = across the formation, away = wider.
      if (!a.slot) {
        for (const [btn, id] of Object.entries(this.sim.icons)) {
          if (input.pressed[btn] && this.sim.motionCandidates().some((p) => p.id === id)) { a.slot = this.sim.players[id].slot; a.id = id; return; }
        }
        return;
      }
      if (Math.abs(input.lx) < 0.6) return;
      const rec = this.sim.players[a.id];
      const side = rec.z - this.sim.ballZ;
      const across = Math.abs(side) < 1 || Math.sign(input.lx * this.sim.camDir) !== Math.sign(side);
      this.closeAudible();
      if (this.sim.startMotion(a.id, across)) this.emit('motion', { slot: a.slot, player: rec.name });
      return;
    }
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
      if (this.jetWait) {
        const p = sim.players[sim.motion.id];
        const lat = sim.toLocal(p.x, p.z).lat - (sim.offPlay.run?.mesh?.[1] ?? 0);
        if (Math.abs(lat) < 1.3 || sim.motion.done) {
          this.jetWait = false;
          this.jetGo = true;
          this.snap();
          this.jetGo = false;
          if (this.sim && this.state === 'live') this.sim.tick(dt, null);
        } else sim.tick(dt, input);
        return;
      }
      const off = this.offTeam, def = this.defTeam;
      const offIn = this.inputFor(input, off), defIn = this.inputFor(input, def);
      if (this.audible) {
        // Audible / hot-route menus are modal: the play waits (the play clock doesn't).
        const f = this.inputFor(input, this.audible.team);
        if (f) this.audibleInput(f);
        if (this.state === 'presnap') this.sim.tick(dt, null);
        return;
      }
      for (const [team, f] of [[off, offIn], [def, defIn]]) {
        if (!f || sim.isKick || !this.calls(team)) continue;
        const scrim = this.match.phase === 'scrimmage';
        const mode = f.pressed.X ? 'menu'
          : team === off && scrim && f.pressed.Y ? 'hot'
            : team === off && scrim && f.pressed.RB && !sim.motion ? 'motion'
              : team === def && f.pressed.LB ? 'adjust'
                : team === off && scrim && f.pressed.LB ? 'protect'
                : team === def && scrim && f.pressed.Y ? 'dhot' : null;
        if (mode) {
          this.openAudible(mode, team);
          this.sim.tick(dt, null);
          return;
        }
      }
      for (const [team, f] of [[off, offIn], [def, defIn]]) if (f?.pressed.View) this.callTimeout(team);
      if (offIn?.pressed.B && this.calls(off) && this.spike()) { if (this.sim && this.state === 'live') this.sim.tick(dt, null); return; }
      const lineup = this.fast || sim.isKick ? 0 : LINEUP_T; // players still running to the line: wait for them
      if (offIn?.pressed.LT && this.presnapT >= lineup && this.calls(off) && !this.audible) { this.hardCount(); if (this.state !== 'presnap') { if (this.sim && this.state === 'live') this.sim.tick(dt, null); return; } }
      if (offIn?.pressed.A && this.presnapT >= lineup && this.calls(off)) { this.snap(); if (this.sim && this.state === 'live') this.sim.tick(dt, null); return; }
      if (defIn?.pressed.B && sim.isKick === false && this.lock === null) sim.withHuman(def, () => cyclePresnapDefender(sim));
      const humanOff = this.calls(off); // career: a non-QB doesn't snap the ball, the CPU keeps the tempo
      if (this.cpuMotionAt && this.presnapT >= this.cpuMotionAt && !sim.isKick) {
        this.cpuMotionAt = 0;
        const c = sim.motionCandidates().filter((p) => p.task?.type !== 'run_path' && p.pos !== 'HB' && p.pos !== 'FB');
        if (c.length) sim.startMotion(this.rng.pick(c).id, this.rng.next() < 0.7);
      }
      // CPU offense snaps after a short beat at the line (instantly in fast mode).
      if (!humanOff && this.presnapT >= (this.fast ? 0 : humanInvolved ? 1.6 : LINEUP_T + 0.2)) { this.snap(); return; }
      sim.tick(dt, input);
      return;
    }

    if (this.state === 'live') {
      const sim = this.sim;
      sim.tick(dt, humanInvolved ? input : null);
      if (this.drill) drillWatch(sim, this.drill, sim.events);
      if (!this.fast) this.recorder.capture(sim);
      for (const e of sim.events) this.events.push(e);
      // Game clock runs during live plays (not during tries, or while a kick is in the air before it's touched).
      const kickInAir = sim.isKick && (sim.ball.state === 'kick' || sim.ball.state === 'tee' || sim.ball.state === 'snap');
      if (!this.practice && m.phase !== 'try' && sim.state === 'live' && !kickInAir) m.tickClock(dt);
      if (sim.state === 'dead' && (this.fast || sim.finished)) this.finishPlay();
      return;
    }

    if (this.state === 'penalty') {
      // Waiting for the fouled human: A accepts, X declines.
      const f = this.inputFor(input, 1 - this.pendingPenalty.outcome.team);
      if (f?.pressed.A) this.choosePenalty(true);
      else if (f?.pressed.X) this.choosePenalty(false);
      return;
    }

    if (this.state === 'review') { this.updateReview(dt, input); return; }

    if (this.state === 'post') {
      this.wait -= dt;
      if (this.wait <= 0) this.enterPlaycall();
    }
  }

  realtimePresnap(dt) {
    const m = this.match;
    if (this.practice) { this.presnapUsed += dt; return; } // no clocks in practice
    if (m.clockRunning && m.phase === 'scrimmage') m.presnapRunoff(dt);
    this.presnapUsed += dt;
    m.playClock = Math.max(0, m.playClock - dt);
    this.flushMessages();
    if (m.clock <= 0 && m.clockRunning) { m.afterPlay(true); this.flushMessages(); this.enterPlaycall(); return; }
    // Delay of game on the human offense.
    if (m.playClock <= 0 && this.calls(this.offTeam) && m.phase === 'scrimmage') {
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
    const fouls = (sim.fouls || []).filter((f) => (!sim.isKick || KICK_FOULS.has(f.type)) && m.phase === 'scrimmage');
    if (fouls.length) {
      const offF = fouls.filter((f) => f.team === r.offTeam);
      const defF = fouls.filter((f) => f.team !== r.offTeam);
      if (offF.length && defF.length) {
        outcome = { accepted: true, text: 'Offsetting penalties, replay the down', newYL: m.yardLine, team: -1, offsetting: true };
      } else {
        // The most damaging foul for the offending team.
        outcome = enforce(m, fouls[0], r);
        // A foul against the human's opponent: the human accepts or declines (the play waits).
        if (!this.fast && this.isHuman(1 - outcome.team) && !outcome.dead) {
          const choice = describeChoice(m, outcome, r, (yl) => yardLineText(m, m.possession, yl));
          this.pendingPenalty = { outcome, choice, foul: fouls[0], recommend: outcome.accepted };
          this.state = 'penalty';
          this.emit('flag', { foul: fouls[0], outcome, pending: true });
          return;
        }
      }
      this.emit('flag', { foul: fouls[0], outcome });
    }
    // A close call (sideline catch, spot at the line to gain, short of the goal line): the ruling on the field may
    // be wrong. The booth reviews late in halves / scores; otherwise the team it went against may challenge.
    if (!fouls.length && !this.fast && !this.practice && m.phase === 'scrimmage') {
      const cc = closeCall(r, sim, this.rng);
      if (cc && this.startReview(cc)) return;
    }
    this.completePlay(outcome);
  }

  /** Returns true when the play waits for a challenge decision or a review. */
  startReview(cc) {
    const m = this.match, sim = this.sim;
    sim.result = cc.call; // the ruling on the field
    const rv = { ...cc, t: 0, by: null, booth: false, phase: null };
    if (boothReviews(m, cc)) { rv.phase = 'review'; rv.booth = true; }
    else if (canChallenge(m, cc.hurt)) {
      if (this.isHuman(cc.hurt)) rv.phase = 'call';
      else if (cpuChallenges(cc, this.rng)) { rv.phase = 'review'; rv.by = cc.hurt; }
    }
    if (!rv.phase) return false;
    this.review = rv;
    this.state = 'review';
    this.emit('review', { phase: rv.phase, booth: rv.booth, by: rv.by, text: cc.text });
    return true;
  }

  /** The human coach throws the challenge flag (Y during the window). */
  challenge() {
    const rv = this.review;
    if (this.state !== 'review' || !rv || rv.phase !== 'call') return;
    rv.phase = 'review'; rv.by = rv.hurt; rv.t = 0;
    this.emit('review', { phase: 'review', booth: false, by: rv.by, text: rv.text });
  }

  updateReview(dt, input) {
    const rv = this.review;
    rv.t += dt;
    if (rv.phase === 'call') {
      const f = this.inputFor(input, rv.hurt);
      if (f?.pressed.Y) { this.challenge(); return; }
      if (rv.t < CHALLENGE_T && !f?.pressed.A) return;
    } else if (rv.t < REVIEW_T) return;
    const reviewed = rv.phase === 'review';
    this.review = null;
    if (reviewed) {
      const s = settleReview(this.match, rv, rv.by);
      this.sim.result = s.result;
      this.match.say(s.text, 'review');
      this.emit('reviewDone', { reversed: s.reversed, text: s.text, by: rv.by });
    }
    this.completePlay(null);
  }

  /** The human's accept/decline answer for a pending penalty. */
  choosePenalty(accept) {
    const p = this.pendingPenalty;
    if (this.state !== 'penalty' || !p) return;
    p.outcome.accepted = accept;
    p.outcome.text = accept ? p.outcome.acceptText || p.outcome.text : `${p.choice.name} — declined`;
    this.pendingPenalty = null;
    this.completePlay(p.outcome);
  }

  /** Apply the play (and any penalty decision) to the game and move on. */
  completePlay(outcome) {
    const m = this.match;
    const sim = this.sim;
    const r = sim.result;
    for (const inj of sim.injuries) {
      this.injuries.push({ team: inj.team, rid: inj.rid, name: inj.name, pos: inj.pos, number: inj.number, type: inj.type, weeks: inj.weeks });
      m.say(`Injury: ${this.teams[inj.team].abbr} ${inj.pos} #${inj.number} ${inj.name} (${inj.type}), ${injuryText(inj.weeks)}`, 'injury');
    }
    if (outcome && outcome.accepted && !outcome.offsetting) {
      m.stats.team[outcome.team].penalties++;
      m.stats.team[outcome.team].penYds += Math.round(Math.abs(outcome.newYL - m.yardLine));
    }
    const scrimmage = m.phase === 'scrimmage';
    const quarter = m.quarter;
    if (!this.fast) this.lastReplay = this.recorder.take();
    applyPlayFatigue(this.energy, sim, (r.duration || 5) * ((this.settings.sliders?.fatigue ?? 50) / 50));
    m.applyResult(r, sim, outcome && outcome.accepted ? outcome : null);
    if (m.quarter !== quarter) restAll(this.energy, m.quarter === 3 ? 1 : 0.2); // halftime / quarter break
    let drillRep = null;
    if (this.drill) drillRep = drillScore(this.drill, r, sim);
    if (this.practice) {
      // Fresh legs every rep; back to the chosen spot after each play, or when the drive is over.
      restAll(this.energy, 1);
      const me = this.drill ? this.drillHuman : this.humanTeam;
      const off = this.practice.side === 'offense' ? me : 1 - me;
      if (this.practice.after !== 'continue' || m.over || m.phase !== 'scrimmage' || m.possession !== off) this.practiceReset();
      m.clockRunning = false;
    }
    if (this.scenario && !this.scenario.result) {
      const v = scenarioCheck(m, this.scenario, r);
      if (v) { this.scenario.result = v; m.over = true; this.emit('scenarioDone', v); }
    }
    if (drillRep) {
      this.emit('drillRep', { ...drillRep, rep: this.drill.rep, reps: DRILLS[this.drill.id].reps, score: this.drill.score });
      if (this.drill.done) m.over = true; // enterPlaycall ends it (gameOver); main.js shows the drill results
    }
    if (outcome && !outcome.accepted) m.say(outcome.text, 'penalty');
    this.flushMessages();
    // Who made the play and their game totals (skipped on tries and plays wiped out by a flag).
    const statLines = scrimmage && !(outcome && outcome.accepted) ? playStatLines(m, r, sim) : [];
    // Per-game call counts and yards for the play-call screen ("3 CALLS | 5.3 AVG YDS").
    if (this.sim && !this.sim.isKick) {
      this.callStats ||= {};
      for (const play of [this.sim.offPlay, this.sim.defPlay]) {
        const id = play.id.replace(/__flip$/, '');
        const cs = (this.callStats[id] ||= { n: 0, yds: 0 });
        cs.n++; cs.yds += r.yards || 0;
      }
    }
    this.emit('result', { result: r, outcome, statLines });
    this.state = 'post';
    // A touchdown gets a few seconds for the celebration (render/presentation.js); the clock is stopped anyway.
    this.wait = this.fast ? 0 : r.touchdown !== null && r.touchdown !== undefined && !this.practice ? 3.0 : 0.7;
  }
}

function cyclePresnapDefender(sim) {
  const defs = sim.players.filter((p) => p.team === sim.defIdx).sort((a, b) => sim.toLocal(a.x, a.z).lat - sim.toLocal(b.x, b.z).lat);
  const i = defs.findIndex((p) => p.id === sim.controlledId);
  sim.controlledId = defs[(i + 1) % defs.length].id;
}

export { STEP };

/** The offsides defender is caught across the line at the snap; the flag flies right away. */
function jumpOffsides(sim, p) {
  if (!p) return;
  const l = sim.toLocal(p.x, p.z);
  const w = sim.toWorld(Math.min(l.down, -0.6), l.lat);
  p.x = p.px = w.x; p.z = p.pz = w.z;
  addFoul(sim, 'offsides_live', p.team, p, { spotX: sim.losX });
}
