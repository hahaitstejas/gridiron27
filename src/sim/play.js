import { GOAL_X, END_X, HALF_WIDTH, HASH_Z, BALL_CARRY_HEIGHT } from '../core/constants.js';
import { needsRest, energyOf } from '../game/fatigue.js';
import { clamp } from '../core/math.js';
import { makeSimPlayer } from './entities.js';
import { integrate, resolveCollisions } from './movement.js';
import { updateBlocking } from './blocking.js';
import { updateBallFlight, updatePendingThrow } from './passing.js';
import { updateTackles, updateMoves } from './tackling.js';
import { updateAnimations } from './anim.js';
import { getOffFormation, getDefFormation } from '../data/playbook.js';
import { ROUTES } from '../data/routes.js';
import { runOffenseAI } from '../ai/offense.js';
import { runDefenseAI, assignDefense, alignMan, disguiseAlign } from '../ai/defense.js';
import { applyHuman } from './human.js';
import { setupSpecialSnap, updateSpecial, newMeter } from './kicking.js';
import { startMove } from './tackling.js';
import { incomplete } from './passing.js';
import { addFoul, foulRate } from './fouls.js';
import { WEATHER_MODS } from '../game/weather.js';

export const KICK_PLAYS = new Set(['kickoff', 'punt', 'fg']);

const OL_SLOTS = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
// Ratings that fade as a player tires (see game/fatigue.js).
const TIRING = new Set(['speed', 'acceleration', 'agility', 'strength', 'passRush', 'blockShed', 'breakTackle', 'runBlock', 'passBlock']);
export const MAX_PLAY_TIME = 40;

/**
 * Simulates a single scrimmage play from the snap to the whistle. Pure logic: no rendering,
 * no DOM, deterministic for a given RNG seed + inputs. Produces `result` when the play ends.
 */
export class PlaySim {
  constructor(cfg) {
    this.cfg = cfg;
    this.rng = cfg.rng;
    this.offIdx = cfg.offIdx;
    this.defIdx = 1 - cfg.offIdx;
    this.teams = cfg.teams; // [team0, team1] with roster + depth
    this.dir = cfg.dir; // offense attacks toward +x (1) or -x (-1)
    this.losX = cfg.losX;
    this.ballZ = clamp(cfg.ballZ ?? 0, -HASH_Z, HASH_Z);
    this.offPlay = cfg.offPlay;
    this.defPlay = cfg.defPlay;
    this.humanTeam = cfg.humanTeam ?? null;
    this.lockId = -1; // career mode: the human's one player (set by the session), no switching
    // Local 2-player: every human team has its own controlled player (controlled[team]); `humanTeam`
    // is the team whose context the human-control code is running in (see withHuman()).
    this.humanTeams = cfg.humanTeams || (this.humanTeam !== null ? [this.humanTeam] : []);
    this.controlled = {};
    this.camDir = cfg.camDir ?? this.dir;
    this.boost = cfg.boost || [0, 0];
    this.energy = cfg.energy || null; // [Map, Map] roster id -> 0..1 (game/fatigue.js)
    this.subRelax = cfg.subRelax || 0; // big moments: starters stay in longer
    this.difficulty = cfg.difficulty || null;
    this.sliders = cfg.sliders || null; // [team0, team1] gameplay sliders, 0..100 (50 = default)
    this.firstDownX = cfg.firstDownX ?? null;
    this.defAdj = cfg.defAdj || null; // pre-snap coverage call: { cover: 'press'|'off', shade: 'in'|'out' }
    this.motion = null; // a player in pre-snap motion (startMotion)
    this.weather = cfg.weather || null; // { type, wind: {x, z}, time } (game/weather.js)
    this.wx = WEATHER_MODS[this.weather?.type] || {};
    this.wind = this.weather?.wind || { x: 0, z: 0 };

    this.t = 0;
    this.state = 'presnap';
    this.events = [];
    this.players = [];
    this.engagements = [];
    this.injuries = []; // players hurt on this play (tackling.js)
    this.possTeam = this.offIdx;
    this.passThrown = false;
    this.pendingThrow = null;
    this.qbCrossed = false;
    this.handedOff = false;
    this.ballLiveRun = false; // a runner has the ball (handoff, catch, scramble, turnover)
    this.result = null;
    this.deadT = 0;
    this.stats = { passer: null, target: null, receiver: null, rusher: null, tackler: null, assist: null, airYards: 0, catchX: null, catchZ: null };
    this.ball = { state: 'presnap', x: 0, y: 0.15, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, carrier: -1, t: 0, T: 0, kind: '', spin: 0, resolved: false, intended: -1, target: null };
    this.setup();
  }

  // ---- coordinate helpers (offense frame) ----
  toWorld(down, lat) { return { x: this.losX + this.dir * down, z: this.ballZ + this.dir * lat }; }
  toLocal(x, z) { return { down: (x - this.losX) * this.dir, lat: (z - this.ballZ) * this.dir }; }
  teamDir(team) { return team === this.offIdx ? this.dir : -this.dir; }
  R(p, key) { return clamp((p.r[key] ?? 40) + this.boost[p.team] - (p.fatigue && TIRING.has(key) ? p.fatigue : 0) - (this.wx[key] || 0), 0, 115); }
  emit(type, data = {}) { this.events.push({ type, t: this.t, ...data }); }
  carrier() { return this.ball.state === 'held' ? this.players[this.ball.carrier] : null; }
  offense() { return this.players.filter((p) => p.team === this.offIdx); }
  defense() { return this.players.filter((p) => p.team === this.defIdx); }
  bySlot(team, slot) { return this.players.find((p) => p.team === team && p.slot === slot); }
  isHumanControlled(p) { return this.controlled[p.team] === p.id && this.humanTeams.includes(p.team); }
  isHuman(team) { return this.humanTeams.includes(team); }
  /** Gameplay slider for a team as -1..1 (0 = default). */
  sl(team, key) { const v = this.sliders?.[team]?.[key]; return v === undefined ? 0 : (v - 50) / 50; }
  get controlledId() { return this.humanTeam === null ? -1 : this.controlled[this.humanTeam] ?? -1; }
  set controlledId(id) { if (this.humanTeam !== null) this.controlled[this.humanTeam] = id; }
  /** Run fn with `team` as the current human (2-player: each human's input runs in their own context). */
  withHuman(team, fn) {
    const prev = this.humanTeam;
    this.humanTeam = team;
    try { return fn(); } finally { this.humanTeam = prev; }
  }
  /** One human's controller frame: `input` is either a frame (single player) or { perTeam: true, 0: f, 1: f }. */
  inputFor(input, team) {
    if (!input) return null;
    if (input.perTeam) return input[team] || null;
    return team === this.humanTeam ? input : null;
  }

  setup() {
    const offF = getOffFormation(this.offPlay.formation);
    const defF = getDefFormation(this.defPlay.formation);
    if (!offF || !defF) throw new Error(`Missing formation ${this.offPlay.formation} / ${this.defPlay.formation}`);
    this.place(offF, this.offIdx, 'O');
    this.place(defF, this.defIdx, 'D');
    this.alignDefense(defF);
    alignMan(this);
    disguiseAlign(this);
    const oFace = this.dir > 0 ? 0 : Math.PI;
    for (const p of this.players) {
      p.facing = p.pfacing = p.side === 'O' ? oFace : oFace + Math.PI;
      p.px = p.x; p.pz = p.z;
      p.alignX = p.x; p.alignZ = p.z;
      p.anim = stanceFor(p);
    }
    const c = this.bySlot(this.offIdx, 'C');
    this.ball.x = this.ball.px = this.losX;
    this.ball.z = this.ball.pz = this.ballZ;
    this.ball.y = this.ball.py = 0.15;
    this.ball.carrier = c ? c.id : -1;
    this.computeIcons();
    this.isKick = KICK_PLAYS.has(this.offPlay.type);
    if (this.isKick && this.offPlay.type === 'kickoff') { this.ball.state = 'tee'; this.ball.carrier = -1; this.ball.y = 0.25; }
    for (const t of this.humanTeams) this.withHuman(t, () => this.pickControlled());
  }

  /** The human's starting player: kicker/returner on kicks, QB on offense, a defender on defense. */
  pickControlled() {
    if (this.isKick) {
      if (this.humanTeam === this.offIdx) {
        this.meter = newMeter();
        this.kickAim = 0;
        this.controlledId = this.bySlot(this.offIdx, this.offPlay.type === 'punt' ? 'P' : 'K')?.id ?? -1;
      } else if (this.humanTeam === this.defIdx) {
        this.controlledId = (this.bySlot(this.defIdx, 'KR') || this.bySlot(this.defIdx, 'PR') || this.bySlot(this.defIdx, 'B9') || this.defense()[0]).id;
      }
    } else if (this.humanTeam === this.offIdx) this.controlledId = this.bySlot(this.offIdx, 'QB')?.id ?? -1;
    else if (this.humanTeam === this.defIdx) this.controlledId = this.defaultDefender();
  }

  place(formation, teamIdx, side) {
    const team = this.teams[teamIdx];
    // Injured players are unavailable: treat them as already on the field.
    const used = new Set(this.cfg.unavailable?.[teamIdx] || []);
    const byId = new Map(team.roster.map((p) => [p.id, p]));
    // Depth-chart slot if there is one, else players of that position by overall (special teams
    // use position groups like DE/OLB). Never pull the starting QB onto special teams.
    const qb1 = team.depth.QB?.[0];
    const byPos = (pos) => team.roster.filter((p) => p.pos === pos).sort((a, b) => b.ovr - a.ovr).map((p) => p.id);
    for (const fp of formation.players) {
      const list = (team.depth[fp.p] || byPos(fp.p)).filter((id) => fp.p === 'QB' || id !== qb1);
      let rp = null;
      // Rotation: a tired player at this spot sits if someone fresher further down the depth chart can go.
      const rotate = this.energy && !KICK_PLAYS.has(this.offPlay.type);
      const tired = (id) => rotate && byId.has(id) && needsRest(this.energy, teamIdx, byId.get(id), this.subRelax);
      for (let i = fp.d; i < list.length && !rp; i++) {
        if (used.has(list[i])) continue;
        if (tired(list[i]) && list.slice(i + 1).some((id) => !used.has(id) && !tired(id))) continue;
        rp = byId.get(list[i]);
      }
      for (let i = 0; i < list.length && !rp; i++) if (!used.has(list[i])) rp = byId.get(list[i]);
      if (!rp) rp = team.roster.find((p) => !used.has(p.id) && p.id !== qb1 && !['K', 'P'].includes(p.pos));
      if (!rp) rp = team.roster.find((p) => !used.has(p.id));
      used.add(rp.id);
      const sp = makeSimPlayer(this.players.length, rp, teamIdx, side, fp.s);
      if (this.energy) {
        // Tired legs: a step slower, and weaker at the point of attack.
        const e = energyOf(this.energy, teamIdx, rp.id);
        sp.energy = e;
        sp.fatigue = (1 - e) * 14;
        sp.maxSpeed -= (1 - e) * 0.9;
        sp.accel -= (1 - e) * 1.2;
      }
      // Backed up near the goal line: nobody lines up behind the end line (shallower punter/QB).
      let down = fp.at[0];
      if (side === 'O') {
        const room = (this.losX * this.dir + END_X - 0.8); // yards from the LOS back to the end line
        if (-down > room) down = -room;
      }
      const w = this.toWorld(down, fp.at[1]);
      sp.x = w.x;
      sp.z = clamp(w.z, -HALF_WIDTH + 1, HALF_WIDTH - 1);
      sp.at = fp.at;
      sp.align = fp.align;
      this.players.push(sp);
    }
  }

  /** Receivers on each side of the ball, outermost first. */
  receiverSets() {
    const elig = this.offense().filter((p) => !OL_SLOTS.has(p.slot) && p.slot !== 'QB');
    const loc = (p) => this.toLocal(p.x, p.z);
    const backs = elig.filter((p) => loc(p).down < -2.5 && Math.abs(loc(p).lat) < 4.5);
    const line = elig.filter((p) => !backs.includes(p));
    const L = line.filter((p) => loc(p).lat < 0).sort((a, b) => loc(a).lat - loc(b).lat);
    const R = line.filter((p) => loc(p).lat >= 0).sort((a, b) => loc(b).lat - loc(a).lat);
    const TE = line.filter((p) => p.pos === 'TE').sort((a, b) => Math.abs(loc(a).lat) - Math.abs(loc(b).lat));
    return { elig, backs, L, R, TE };
  }

  alignDefense() {
    const sets = this.receiverSets();
    for (const d of this.defense()) {
      if (!d.align) continue;
      let rec = null;
      let outside = 0;
      if (d.align === 'L1') { rec = sets.L[0]; outside = -1; }
      else if (d.align === 'R1') { rec = sets.R[0]; outside = 1; }
      else if (d.align === 'slot') {
        const side = sets.R.length >= sets.L.length ? sets.R : sets.L;
        rec = side[1] || side[0];
        outside = side === sets.R ? -1 : 1; // inside shade
      }
      if (rec) {
        const l = this.toLocal(rec.x, rec.z);
        if (Math.abs(l.lat) > 5) {
          const w = this.toWorld(d.at[0], l.lat + outside * 0.8);
          d.x = w.x; d.z = clamp(w.z, -HALF_WIDTH + 1, HALF_WIDTH - 1);
        }
      }
    }
  }

  /** Receiver buttons. `all` = every eligible receiver, blockers too (for hot routes). */
  computeIcons(all = false) {
    this.icons = {};
    if (this.offPlay.type !== 'pass' && !all) return;
    const routes = this.offPlay.routes || {};
    const runners = this.offense().filter((p) => (all ? !OL_SLOTS.has(p.slot) && p.slot !== 'QB' : routes[p.slot] && ROUTES[routes[p.slot].replace(/_(l|r)$/, '')]));
    const loc = (p) => this.toLocal(p.x, p.z);
    const free = new Set(runners);
    const give = (btn, p) => { if (p && free.has(p)) { this.icons[btn] = p.id; free.delete(p); } };
    give('RB', runners.find((p) => loc(p).down < -2.5 && Math.abs(loc(p).lat) < 4.5));
    give('X', [...free].sort((a, b) => loc(a).lat - loc(b).lat)[0]);
    give('B', [...free].sort((a, b) => loc(b).lat - loc(a).lat)[0]);
    give('Y', [...free].find((p) => p.pos === 'TE'));
    for (const btn of ['A', 'Y', 'RB']) if (!this.icons[btn]) give(btn, [...free][0]);
  }

  defaultDefender() {
    const d = this.bySlot(this.defIdx, 'MLB') || this.defense()[5];
    return d ? d.id : -1;
  }

  // ---- pre-snap motion ----
  /** Players who may go in motion: receivers and backs (not the QB or linemen). */
  motionCandidates() {
    return this.offense().filter((p) => ['WR', 'TE', 'HB', 'FB'].includes(p.pos) && !OL_SLOTS.has(p.slot) && p.slot !== 'QB');
  }

  /**
   * Send a player in motion, parallel to the line: `across` = toward and past the ball to the other
   * side (jet / across motion), otherwise out wider. He's still moving at the snap (a running start)
   * and his route starts from wherever he is.
   */
  startMotion(id, across = true, { depth = null, speed = null } = {}) {
    const p = this.players[id];
    if (!p || this.state !== 'presnap' || this.motion) return false;
    const l = this.toLocal(p.x, p.z);
    const side = Math.abs(l.lat) < 1 ? 1 : Math.sign(l.lat);
    const lim = HALF_WIDTH - 2;
    let lat = across ? -side * Math.max(3, Math.abs(l.lat) * 0.6) : l.lat + side * 6;
    const wz = clamp(this.toWorld(0, lat).z, -lim, lim);
    lat = this.toLocal(this.losX, wz).lat;
    const down = depth ?? Math.min(l.down, -1);
    if (depth !== null) { const w = this.toWorld(down, l.lat); p.x = w.x; p.z = w.z; } // jet: drop off the line first
    const to = this.toWorld(down, lat);
    this.motion = { id, to, speed: speed ?? 5.5 + this.R(p, 'speed') * 0.01 };
    return true;
  }

  updateMotion(dt) {
    const mo = this.motion;
    if (!mo) return;
    const p = this.players[mo.id];
    const dx = mo.to.x - p.x, dz = mo.to.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.15) { p.vx = p.vz = 0; mo.done = true; p.anim = 'idle'; }
    else {
      const v = Math.min(mo.speed, d / dt);
      p.vx = (dx / d) * v; p.vz = (dz / d) * v;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.facing = Math.atan2(p.vz, p.vx);
      p.anim = 'run';
    }
    alignMan(this, dt);
  }

  // ---- snap ----
  snap() {
    if (this.state !== 'presnap') return;
    this.state = 'live';
    this.t = 0;
    if (this.isKick) {
      setupSpecialSnap(this);
      if (this.meter && this.meter.phase === 'idle') this.meter.phase = 'power'; // the snap press starts the meter
      return;
    }
    const qb = this.bySlot(this.offIdx, 'QB');
    const c = this.bySlot(this.offIdx, 'C');
    const play = this.offPlay;
    for (const p of this.players) p.state = 'active';
    // Offense tasks
    for (const p of this.offense()) {
      const a = (play.routes || {})[p.slot];
      if (p.slot === 'QB' && (play.type === 'kneel' || play.type === 'spike')) {
        p.task = { type: play.type };
      } else if (p.slot === 'QB' && play.type === 'run' && (play.run?.carrier === 'QB' || play.run?.style === 'speed_option')) {
        p.task = { type: 'qb_keep', option: play.run.style === 'speed_option' };
      } else if (p.slot === 'QB') {
        p.task = play.type === 'pass'
          ? { type: 'qb_pass', drop: dropFor(play, this.toLocal(p.x, p.z).down), phase: 'drop' }
          : { type: 'qb_handoff' };
      } else if (OL_SLOTS.has(p.slot)) {
        p.task = play.type === 'run' ? { type: 'run_block', pull: (play.run?.pull || []).includes(p.slot) } : { type: 'pass_block' };
      } else if (play.pa && play.type === 'pass' && p.slot === (play.pa.carrier || 'RB') && (!a || a === 'block')) {
        // Play action: carry out the fake through the mesh, then pick up a rusher.
        p.task = { type: 'pa_fake', to: this.toWorld(-3.2, -this.toLocal(p.x, p.z).lat * 0.3 + (play.boot ? -play.boot * 1.5 : 0)) };
      } else if (play.type === 'run' && play.run && play.run.carrier === p.slot) {
        p.task = play.run.style === 'speed_option' ? { type: 'pitch_trail' } : { type: 'run_path', phase: 'mesh' };
      } else if (a && ROUTES[a.replace(/_(l|r)$/, '')]) {
        p.task = this.makeRoute(p, a);
      } else if (a === 'stalk') {
        p.task = { type: 'stalk' };
      } else {
        p.task = play.type === 'run' ? { type: 'run_block' } : { type: 'pass_block' };
      }
    }
    assignDefense(this);
    // Ball: shotgun/pistol snaps fly to the QB, under center is immediate.
    if (qb && c) {
      const qd = this.toLocal(qb.x, qb.z).down;
      if (qd < -2) {
        this.ball.state = 'snap';
        this.ball.t = 0;
        this.ball.T = 0.32 + (-qd - 4) * 0.03;
        this.ball.from = { x: c.x, y: 0.4, z: c.z };
        this.ball.carrier = qb.id;
      } else {
        this.ball.state = 'held';
        this.ball.carrier = qb.id;
      }
    }
    this.emit('snap');
  }

  makeRoute(p, name) {
    const base = name.replace(/_(l|r)$/, '');
    const tpl = ROUTES[base];
    const l = this.toLocal(p.x, p.z);
    let s = name.endsWith('_l') ? -1 : name.endsWith('_r') ? 1 : Math.abs(l.lat) < 0.5 ? 1 : Math.sign(l.lat);
    const pts = tpl.pts.map(([d, o]) => {
      const lat = clamp(l.lat + o * s, -this.ballZ * this.dir - HALF_WIDTH + 1.5, -this.ballZ * this.dir + HALF_WIDTH - 1.5);
      return this.toWorld(l.down + d, lat);
    });
    if (tpl.end === 'continue') {
      const a = pts.length > 1 ? pts[pts.length - 2] : { x: p.x, z: p.z };
      const b = pts[pts.length - 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1;
      pts.push({ x: b.x + (dx / dl) * 40, z: b.z + (dz / dl) * 40 });
    }
    // Keep routes on the field: stop at the sideline and the back of the end zone, then settle
    // and work back to the QB (a simple scramble drill).
    const maxX = GOAL_X + 8, maxZ = HALF_WIDTH - 1.2;
    let end = tpl.end;
    for (let i = 0; i < pts.length; i++) {
      const prev = i ? pts[i - 1] : { x: p.x, z: p.z };
      const q = pts[i];
      let k = 1;
      const tdx = q.x - prev.x, tdz = q.z - prev.z;
      if (q.x * this.dir > maxX) k = Math.min(k, (maxX - prev.x * this.dir) / (tdx * this.dir || 1e-6));
      if (Math.abs(q.z) > maxZ) k = Math.min(k, (maxZ - Math.abs(prev.z)) / (Math.abs(tdz) || 1e-6));
      if (k < 1) {
        pts[i] = { x: prev.x + tdx * Math.max(0, k), z: prev.z + tdz * Math.max(0, k) };
        pts.length = i + 1;
        end = 'settle';
        break;
      }
    }
    return { type: 'route', name: base, pts, idx: 0, end, settled: false };
  }

  // ---- main tick ----
  tick(dt, input) {
    this.events.length = 0;
    for (const p of this.players) { p.px = p.x; p.pz = p.z; p.pfacing = p.facing; }
    const b = this.ball;
    b.px = b.x; b.py = b.y; b.pz = b.z;
    if (this.state === 'presnap') {
      this.updateMotion(dt);
      updateAnimations(this, dt);
      return;
    }
    this.t += dt;
    for (const p of this.players) {
      p.animT += dt;
      if (p.tackleCd > 0) p.tackleCd -= dt;
      if (p.noEngageT > 0) p.noEngageT -= dt;
      if (p.state === 'down') {
        p.downT -= dt;
        p.desired.x = 0; p.desired.z = 0;
        if (p.downT <= 0 && this.state === 'live') { p.state = 'active'; p.anim = 'getup'; p.animT = 0; }
      } else if (p.state === 'active' && p.recoverAt && this.t > p.recoverAt && !p.move) {
        p.speedCap = 1; p.recoverAt = 0;
      } else if (p.state === 'stumble') {
        p.stumbleT -= dt;
        if (p.stumbleT <= 0) { p.state = 'active'; p.speedCap = 1; }
      }
    }

    if (this.state === 'live') {
      this.updateBall(dt);
      if (this.kick) {
        if (input?.perTeam) this.withHuman(this.isHuman(this.offIdx) ? this.offIdx : this.humanTeam, () => updateSpecial(this, dt, this.inputFor(input, this.offIdx)));
        else updateSpecial(this, dt, this.humanTeam !== null ? input : null);
      }
      this.updateQBSpecial();
      this.updateOption();
      updatePendingThrow(this, dt);
      runOffenseAI(this, dt);
      runDefenseAI(this, dt);
      if (input?.perTeam) { for (const t of this.humanTeams) { const f = input[t]; if (f) this.withHuman(t, () => applyHuman(this, f, dt)); } }
      else if (this.humanTeam !== null && input) applyHuman(this, input, dt);
      updateMoves(this, dt);
      updateBlocking(this, dt);
      for (const p of this.players) {
        if (p.state === 'down') { p.vx *= 0.85; p.vz *= 0.85; p.x += p.vx * dt; p.z += p.vz * dt; continue; }
        if (p.state === 'tackled') continue;
        if (p.engagement) continue;
        if (this.ball.state === 'loose') this.chaseLooseBall(p);
        // Running with the ball costs a little top speed, so equal-speed pursuers can close.
        if (this.ballLiveRun && b.state === 'held' && b.carrier === p.id) { p.desired.x *= 0.95; p.desired.z *= 0.95; }
        integrate(p, dt);
      }
      resolveCollisions(this.players);
      updateTackles(this, dt);
      this.checkLateHits(dt);
      this.updateTackledCarrier(dt);
      this.checkRules();
      if (this.t > MAX_PLAY_TIME && this.state === 'live') this.whistle('timeout');
    } else if (this.state === 'dead') {
      this.deadT += dt;
      for (const p of this.players) {
        if (p.engagement) { p.engagement = null; }
        if (p.state === 'tackled' || p.state === 'down') { p.vx *= 0.8; p.vz *= 0.8; p.x += p.vx * dt; p.z += p.vz * dt; continue; }
        p.desired.x *= 0.9; p.desired.z *= 0.9;
        if (this.deadT > 0.6) { p.desired.x = 0; p.desired.z = 0; }
        integrate(p, dt);
      }
      this.engagements.length = 0;
      resolveCollisions(this.players);
      if (b.state === 'air' || b.state === 'loose') this.updateBall(dt);
    }
    this.syncBall();
    updateAnimations(this, dt);
  }

  updateBall(dt) {
    const b = this.ball;
    if (b.state === 'snap') {
      b.t += dt;
      const qb = this.players[b.carrier];
      const k = Math.min(1, b.t / b.T);
      b.x = b.from.x + (qb.x - b.from.x) * k;
      b.z = b.from.z + (qb.z - b.from.z) * k;
      b.y = b.from.y + (BALL_CARRY_HEIGHT - b.from.y) * k + Math.sin(k * Math.PI) * 0.3;
      if (k >= 1) {
        b.state = 'held';
        if (b.pitch) {
          b.pitch = false;
          const rb = this.players[b.carrier];
          this.handedOff = true;
          this.setRunner(rb, 'handoff');
          rb.task.aim = this.toWorld(this.offPlay.run.aim[0], this.offPlay.run.aim[1]);
          rb.task.aimUntil = this.t + 0.6;
        } else this.emit('snapCaught');
      }
    } else if (b.state === 'air') {
      updateBallFlight(this, dt);
    } else if (b.state === 'loose') {
      b.vy -= 10.72 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < 0.12) {
        // A football's bounce is a guess: each hard landing kicks it off at a new angle with a random rebound
        // (sometimes it pops up, sometimes it dies); soft contacts just roll it along.
        b.y = 0.12;
        const hard = Math.abs(b.vy) > 1.2;
        if (hard) {
          const turnA = this.rng.range(-1.1, 1.1), c = Math.cos(turnA), sn = Math.sin(turnA);
          const k = this.rng.range(0.45, 0.8);
          [b.vx, b.vz] = [(b.vx * c - b.vz * sn) * k, (b.vx * sn + b.vz * c) * k];
          b.vy = Math.abs(b.vy) * this.rng.range(0.2, 0.6);
        } else { b.vy = 0; b.vx *= 0.92; b.vz *= 0.92; }
      }
      b.tumble = (b.tumble || 0) + dt * Math.hypot(b.vx, b.vz) * 2.5;
      if (this.state === 'live') this.updateLooseBall();
    }
  }

  // ---- fumbles ----
  fumble(c, by) {
    const b = this.ball;
    b.state = 'loose';
    const a = this.rng.range(0, Math.PI * 2);
    const sp = this.rng.range(1.5, 4.5);
    b.vx = c.vx * 0.4 + Math.cos(a) * sp; b.vz = c.vz * 0.4 + Math.sin(a) * sp; b.vy = this.rng.range(1, 3.5);
    b.carrier = -1;
    b.looseFrom = this.possTeam;
    this.stats.fumbleBy = c.id;
    this.stats.forcedBy = by ? by.id : null;
    this.emit('fumble', { player: c.id, by: by?.id });
  }

  chaseLooseBall(p) {
    if (p.state !== 'active' || (this.isHumanControlled(p) && p.userActive)) return;
    const b = this.ball;
    if (Math.hypot(b.x - p.x, b.z - p.z) < 14) {
      const dx = b.x + b.vx * 0.3 - p.x, dz = b.z + b.vz * 0.3 - p.z, d = Math.hypot(dx, dz) || 1;
      p.desired.x = (dx / d) * p.maxSpeed; p.desired.z = (dz / d) * p.maxSpeed;
    }
  }

  updateLooseBall() {
    const b = this.ball;
    // Out of bounds: the team that fumbled keeps it (through the end zone: touchback/safety).
    if (Math.abs(b.z) > HALF_WIDTH || Math.abs(b.x) > END_X) { this.whistle('fumbleOOB'); return; }
    if (b.y > 1.0) return;
    let best = null, bd = 0.75;
    for (const p of this.players) {
      if (p.state !== 'active') continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && this.rng.next() < 0.18 + this.R(best, 'awareness') * 0.002) {
      this.stats.recoveredBy = best.id;
      this.emit('recovery', { player: best.id, team: best.team });
      best.anim = 'catch'; best.animT = 0;
      const td = this.teamDir(best.team);
      best.caughtInEZ = b.x * td <= -GOAL_X;
      this.setRunner(best, 'fumble');
      // Falling on the ball in a crowd: down by contact right there. Only a clean scoop gets returned.
      const crowd = this.players.some((q) => q.team !== best.team && q.state !== 'down' && Math.hypot(q.x - best.x, q.z - best.z) < 2.2);
      if (crowd || b.y < 0.2 && this.rng.chance(0.6)) {
        best.state = 'tackled'; best.anim = 'falling'; best.animT = 0.45; best.fallT = 0.15; best.vx *= 0.2; best.vz *= 0.2;
      }
    }
  }

  /** Roughing the passer (late hits on a QB who just threw) and defensive holding in man coverage. */
  checkLateHits(dt) {
    if (this.kick) return;
    const qb = this.bySlot(this.offIdx, 'QB');
    if (qb && this.releaseT !== undefined && this.t - this.releaseT > 0.25 && this.t - this.releaseT < 0.6) {
      for (const d of this.players) {
        if (d.team === qb.team || d.engagement || d.state !== 'active') continue;
        if (Math.hypot(d.x - qb.x, d.z - qb.z) < 0.9 && this.rng.next() < 0.06 * foulRate(this) * dt * 60 / 10) {
          addFoul(this, 'roughing', d.team, d, { spotX: qb.x });
          break;
        }
      }
    }
    if (!this.passThrown && this.offPlay.type === 'pass' && this.t > 0.8 && this.t < 3) {
      for (const d of this.players) {
        if (d.task?.type !== 'man') continue;
        const r = this.players[d.task.target];
        const sep = Math.hypot(r.x - d.x, r.z - d.z);
        // Beaten at the break and grabbing to recover.
        if (sep < 1 && Math.hypot(r.vx, r.vz) - Math.hypot(d.vx, d.vz) > 2.5 && this.rng.next() < 0.01 * foulRate(this) * dt * 60) {
          addFoul(this, 'holding_def', d.team, d, { spotX: d.x });
        }
      }
    }
  }

  /** QB-only plays: kneel downs, spikes and designed QB runs. */
  updateQBSpecial() {
    const qb = this.bySlot(this.offIdx, 'QB');
    if (!qb || this.ball.carrier !== qb.id || this.ball.state !== 'held') return;
    const t = qb.task?.type;
    if (t === 'kneel' && this.t > 0.35 && qb.state === 'active') { qb.anim = 'down'; this.tackleCarrier(qb, null, 0); qb.fallT = 0.15; qb.vx = qb.vz = 0; }
    else if (t === 'spike' && this.t > 0.3 && qb.state === 'active') { this.ball.vx = this.ball.vz = 0; this.ball.vy = -6; this.ball.y = 1.6; qb.anim = 'throw'; qb.animT = 0.2; this.stats.spike = true; incomplete(this, 'spike'); }
    // Designed QB runs ride the mesh with the back for a beat so the blocks set up (draws sell the pass longer).
    else if (t === 'qb_keep' && this.t > (this.offPlay.run.style === 'draw' ? 1.0 : qb.task.option || this.toLocal(qb.x, qb.z).down > -2 ? 0.15 : 0.6)) {
      const run = this.offPlay.run;
      const option = qb.task.option;
      // A sneak is a straight-ahead QB run from under center; everything else is a designed run (or the option keep).
      const sneak = !option && Math.abs(run.aim[1]) < 1 && run.style !== 'draw' && this.toLocal(qb.x, qb.z).down > -2;
      const aim = option ? this.toWorld(0.5, (run.side || 1) * 7) : this.toWorld(run.aim[0], run.aim[1]);
      this.setRunner(qb, 'keep');
      qb.task.aim = aim; qb.task.aimUntil = this.t + (sneak ? 0.8 : 1.3);
      if (sneak) {
        qb.task.sneak = true;
        // Lunge over the pile behind the center.
        qb.facing = this.dir > 0 ? 0 : Math.PI;
        startMove(this, qb, 'dive');
      }
      if (option) {
        qb.task.option = true;
        const rb = this.bySlot(this.offIdx, run.carrier);
        if (rb && rb.state === 'active') rb.task = { type: 'pitch_trail' };
      }
    }
  }

  /** Speed option: the QB pitches to the trailing back (CPU when a defender closes; the human with LB). */
  pitchOption() {
    const b = this.ball;
    const qb = this.players[b.carrier];
    if (!qb?.task?.option || b.state !== 'held') return false;
    const rb = this.bySlot(this.offIdx, this.offPlay.run.carrier);
    if (!rb || rb.task?.type !== 'pitch_trail' || rb.state !== 'active') return false;
    if (this.toLocal(qb.x, qb.z).down > 0.5) return false; // no forward laterals
    b.state = 'snap'; b.t = 0; b.T = 0.35; b.from = { x: qb.x, y: 1.1, z: qb.z }; b.carrier = rb.id; b.pitch = true;
    qb.task = { type: 'escort' };
    qb.anim = 'throw'; qb.animT = 0.15;
    this.emit('pitch', { from: qb.id, to: rb.id });
    return true;
  }

  updateOption() {
    const b = this.ball;
    if (b.state !== 'held') return;
    const qb = this.players[b.carrier];
    if (!qb?.task?.option || this.isHumanControlled(qb)) return;
    const l = this.toLocal(qb.x, qb.z);
    let near = 99;
    for (const d of this.players) if (d.team !== qb.team && d.state === 'active' && !d.engagement) near = Math.min(near, Math.hypot(d.x - qb.x, d.z - qb.z));
    if (near < 3 || Math.abs(l.lat) > 6.5) this.pitchOption();
  }

  syncBall() {
    const b = this.ball;
    if (b.state !== 'held') return;
    const c = this.players[b.carrier];
    if (!c) return;
    const pos = this.carrierBallPos(c);
    b.x = pos.x; b.z = pos.z; b.y = pos.y;
  }

  /**
   * Where the ball actually is for a carrier: tucked just in front of the body while running, and
   * carried forward as he falls (matches the falling animation, which pitches the body forward from
   * the feet). The dead-ball spot and goal-line plane both use this, not the player's feet.
   */
  carrierBallPos(c) {
    const fx = Math.cos(c.facing), fz = Math.sin(c.facing);
    const sc = c.height / 2.06;
    let fwd = 0.15, y = BALL_CARRY_HEIGHT;
    const falling = c.state === 'tackled' || (c.state === 'down' && c.anim !== 'getup');
    if (falling && c.move?.type !== 'slide' && !c.slideSpot) {
      const k = c.state === 'down' ? 1 : Math.min(1, c.animT / 0.45);
      const a = k * 1.45;
      fwd = 0.15 + 1.05 * Math.sin(a) * sc;
      y = 0.18 + 1.0 * Math.cos(a) * sc;
    }
    return { x: c.x + fx * fwd, z: c.z + fz * fwd, y };
  }

  /** Called whenever someone new gains possession of the ball as a runner. */
  setRunner(p, how) {
    this.ballLiveRun = true;
    this.ball.state = 'held';
    this.ball.carrier = p.id;
    p.task = { type: 'carrier' };
    p.wantsBall = false;
    if (p.engagement) this.breakEngagement(p.engagement);
    if (p.team !== this.possTeam) {
      this.possTeam = p.team;
      this.emit('turnover', { how, player: p.id });
    }
    for (const t of this.humanTeams) this.withHuman(t, () => {
      if (p.team === t) this.controlledId = this.lockId >= 0 ? this.lockId : p.id; // career: stay on your player
      else if (!this.players[this.controlledId] || this.players[this.controlledId].team !== t) {
        this.controlledId = this.nearestTo(t, p).id;
      }
    });
    for (const q of this.players) {
      if (q === p) continue;
      if (q.team === p.team) {
        if (!q.engagement && q.task?.type !== 'pass_block' && q.task?.type !== 'run_block' && q.task?.type !== 'kr_block') q.task = { type: 'escort' };
        if (q.slot === 'QB' && q.task?.type !== 'escort') q.task = { type: 'escort' };
      } else {
        // Defenders right on top of the catch/handoff react almost instantly.
        const near = Math.hypot(q.x - p.x, q.z - p.z) < 4 ? 0.2 : 1;
        q.task = { type: 'pursue', at: this.t + reactionDelay(this, q) * near * (how === 'handoff' ? 1.3 : 1) };
        // Kick coverage keeps its lanes while closing so the returner can't find a seam.
        if (this.kick && q.team === this.offIdx) q.task.lane = (q.alignZ - this.ballZ) * 0.35;
      }
    }
  }

  nearestTo(team, target) {
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.team !== team || p.state === 'down') continue;
      const d = Math.hypot(p.x - target.x, p.z - target.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best || this.players.find((p) => p.team === team);
  }

  breakEngagement(e) {
    if (!e) return;
    e.b.engagement = null;
    e.d.engagement = null;
    for (const h of e.helpers || []) h.engagement = null;
    const i = this.engagements.indexOf(e);
    if (i >= 0) this.engagements.splice(i, 1);
  }

  tackleCarrier(c, tackler, power = 1) {
    if (c.state === 'tackled') return;
    c.state = 'tackled';
    c.anim = 'falling';
    c.animT = 0;
    c.fallT = 0.35 + Math.min(0.4, Math.hypot(c.vx, c.vz) * 0.04);
    this.stats.tackler = tackler ? tackler.id : null;
    this.emit('tackle', { player: c.id, tackler: tackler?.id, power });
  }

  updateTackledCarrier(dt) {
    // Players who fumbled while being tackled still fall.
    for (const p of this.players) {
      if (p.state !== 'tackled' || p.id === this.ball.carrier && this.ball.state === 'held') continue;
      p.fallT -= dt; p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.9; p.vz *= 0.9;
      if (p.fallT <= 0) { p.state = 'down'; p.downT = 1.5; p.anim = 'down'; }
    }
    const c = this.carrier();
    if (!c || c.state !== 'tackled' || this.state !== 'live') return;
    c.fallT -= dt;
    c.vx *= 0.9; c.vz *= 0.9;
    c.x += c.vx * dt; c.z += c.vz * dt;
    // Reaching the ball over the goal line while going down is a touchdown.
    const bp = this.carrierBallPos(c);
    if (bp.x * this.teamDir(c.team) >= GOAL_X && Math.abs(bp.z) < HALF_WIDTH) { this.whistle('td'); return; }
    if (c.fallT <= 0) {
      c.state = 'down';
      c.downT = 2;
      c.anim = 'down';
      this.whistle('tackle');
    }
  }

  /**
   * Forward progress: while a defender is on the runner, remember the furthest point the ball reached
   * (c.fp, along his team's direction). Wrapped up and driven back 2+ yards = whistle. Breaking free
   * (nobody on him for 0.35 s) starts fresh, so reversing field after shaking a tackle still counts.
   */
  forwardProgress(c, bp, td) {
    let contact = false;
    for (const d of this.players) {
      if (d.team === c.team || d.engagement || (d.state !== 'active' && d.state !== 'down')) continue;
      if (Math.hypot(d.x - c.x, d.z - c.z) < 0.9) { contact = true; break; }
    }
    const f = bp.x * td;
    if (contact) {
      c.fpT = this.t;
      if (c.fp === undefined || f > c.fp) { c.fp = f; c.fpZ = bp.z; }
      const pocketQB = c.slot === 'QB' && !this.passThrown && !this.qbCrossed;
      if (f < c.fp - 2 && c.state === 'active' && !pocketQB) { this.emit('forwardProgress', { player: c.id }); this.tackleCarrier(c, null, 0); c.fallT = 0.1; return false; }
    } else if (c.fp !== undefined && this.t - c.fpT > 0.35) c.fp = undefined;
    return false;
  }

  checkRules() {
    if (this.state !== 'live') return;
    const c = this.carrier();
    if (!c || this.ball.state !== 'held') return;
    const l = this.toLocal(c.x, c.z);
    if (c.slot === 'QB' && c.team === this.offIdx && !this.passThrown && l.down > 0.2 && !this.qbCrossed) {
      this.qbCrossed = true;
      if (c.task?.type !== 'carrier') this.setRunner(c, 'scramble');
    }
    // QB takes off (running at the line before the throw): underneath defenders come up right away.
    if (!this.scramble && c.slot === 'QB' && c.team === this.offIdx && !this.passThrown && this.offPlay.type === 'pass' &&
        c.vx * this.dir > 2.5 && l.down > -2.5) {
      this.scramble = true;
      this.emit('scramble', { player: c.id });
      for (const d of this.players) {
        if (d.team === c.team || d.engagement || d.task?.type === 'rush') continue;
        const dl = this.toLocal(d.x, d.z);
        const deep = d.task?.type === 'zone' && dl.down > 11;
        const manDeep = d.task?.type === 'man' && Math.hypot(d.x - c.x, d.z - c.z) > 12;
        if (deep || manDeep) continue;
        d.task = { type: 'pursue', at: this.t + reactionDelay(this, d) };
      }
    }
    if (Math.abs(c.z) > HALF_WIDTH) { this.whistle('oob'); return; }
    const td = this.teamDir(c.team);
    const bp = this.carrierBallPos(c);
    if (this.forwardProgress(c, bp, td)) return;
    if (bp.x * td >= GOAL_X && c.state !== 'tackled') { this.whistle('td'); return; }
    if (c.x * td <= -END_X) { this.whistle('oob'); return; }
  }

  whistle(reason) {
    if (this.state !== 'live') return;
    this.state = 'dead';
    this.deadT = 0;
    this.result = this.buildResult(reason);
    this.emit('whistle', { reason });
    if (this.result.touchdown !== null) this.emit('touchdown', { team: this.result.touchdown });
    if (this.result.safety) this.emit('safety', {});
    if (this.kick && this.kick.type !== 'fg' && this.result.possTeam === this.offIdx && !this.result.touchdown) this.result.turnover = false;
  }

  buildResult(reason) {
    const c = this.carrier();
    const r = {
      reason,
      offTeam: this.offIdx,
      possTeam: this.possTeam,
      playType: this.offPlay.type,
      losX: this.losX,
      dir: this.dir,
      spotX: this.losX,
      spotZ: this.ballZ,
      yards: 0,
      touchdown: null,
      safety: false,
      touchback: false,
      turnover: !KICK_PLAYS.has(this.offPlay.type) && this.possTeam !== this.offIdx,
      interception: false,
      fumbleLost: false,
      incomplete: reason === 'incomplete',
      sack: false,
      outOfBounds: reason === 'oob',
      passAttempt: this.passThrown && this.stats.passer !== null,
      complete: false,
      duration: this.t,
      ...this.stats,
    };
    if (this.kick) {
      r.kickType = this.kick.type;
      r.turnover = false;
      r.kicker = this.kick.kickerId;
      if (reason === 'fg') {
        r.fgGood = !!this.kick.fgGood;
        r.possTeam = this.offIdx;
        return r;
      }
      if (['touchback', 'fairCatch', 'downed', 'kickOOB'].includes(reason)) {
        r.possTeam = this.defIdx;
        r.touchback = reason === 'touchback';
        r.fairCatch = reason === 'fairCatch';
        r.downed = reason === 'downed';
        r.kickOOB = reason === 'kickOOB';
        const b = this.ball;
        r.spotX = clamp(b.x, -GOAL_X, GOAL_X);
        r.spotZ = b.z;
        r.kickDistance = Math.abs(b.x - this.losX);
        return r;
      }
      r.returnFrom = this.kick.caughtAt ? this.kick.caughtAt.x : null;
      r.kickDistance = this.kick.caughtAt ? Math.abs(this.kick.caughtAt.x - this.losX) : 0;
      r.onside = this.possTeam === this.offIdx;
    }
    if (reason === 'fumbleOOB') {
      // Out of bounds while loose: the fumbling team keeps it at that spot (or touchback/safety in an end zone).
      const b = this.ball;
      const team = b.looseFrom ?? this.possTeam;
      r.possTeam = team;
      r.turnover = this.kick ? false : team !== this.offIdx;
      const td = this.teamDir(team);
      if (b.x * td > GOAL_X) { r.touchback = true; r.possTeam = 1 - team; r.turnover = !this.kick && r.possTeam !== this.offIdx; r.spotX = 0; }
      else if (b.x * td < -GOAL_X) { r.safety = true; r.spotX = -GOAL_X * td; }
      else r.spotX = clamp(b.x, -GOAL_X, GOAL_X);
      r.spotZ = clamp(b.z, -HALF_WIDTH, HALF_WIDTH);
      r.yards = (r.spotX - this.losX) * this.dir;
      r.fumble = true;
      return r;
    }
    if (reason === 'incomplete' || reason === 'timeout' && !c) {
      r.spotX = this.losX;
      return r;
    }
    if (c) {
      r.carrierId = c.id;
      // Spot the ball where it is (or where a QB began his slide), not where the feet are.
      const bp = c.slideSpot || this.carrierBallPos(c);
      r.spotX = clamp(bp.x, -END_X, END_X);
      r.spotZ = bp.z;
      const td = this.teamDir(c.team);
      // Forward progress: a runner pushed back while in a defender's grasp gets the ball where his progress stopped.
      if (reason === 'tackle' && c.fp !== undefined && r.spotX * td < c.fp) { r.ballSpotX = r.spotX; r.spotX = clamp(c.fp * td, -END_X, END_X); r.spotZ = c.fpZ; r.forwardProgress = true; }
      if (reason === 'td') r.touchdown = c.team;
      else if (r.spotX * td <= -GOAL_X) {
        if (c.caughtInEZ) r.touchback = true;
        else r.safety = true;
      }
      r.yards = (r.spotX - this.losX) * this.dir;
      if (r.touchdown === this.offIdx) r.yards = (GOAL_X * this.dir - this.losX) * this.dir;
      r.interception = !!this.stats.intBy;
      r.fumble = this.stats.fumbleBy !== undefined;
      r.fumbleLost = r.fumble && !this.kick && c.team !== this.offIdx;
      r.complete = this.stats.receiver !== null && !r.interception;
      r.sack = c.slot === 'QB' && c.team === this.offIdx && this.offPlay.type === 'pass' && !this.passThrown && !this.qbCrossed && r.yards < 0 && reason === 'tackle';
    }
    return r;
  }

  /** True once the play is over and the dead-ball wind down has played out. */
  get finished() { return this.state === 'dead' && this.deadT > 1.6; }
}

function stanceFor(p) {
  if (['K', 'P', 'H', 'KR', 'KR2', 'PR'].includes(p.slot)) return 'stance2';
  if (p.slot === 'QB') return 'stance_qb';
  if (['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'RE', 'LDT', 'RDT', 'DT', 'NT'].includes(p.slot)) return 'stance3';
  return 'stance2';
}

function dropFor(play, qbDown) {
  const steps = play.dropback || 5;
  const gun = qbDown < -2;
  const yards = gun ? { 1: 0.5, 3: 1.2, 5: 2.2, 7: 3.2 }[steps] ?? 2 : { 1: 1.5, 3: 3.5, 5: 5.5, 7: 7 }[steps] ?? 5;
  return yards;
}

export function reactionDelay(sim, p) {
  const awr = sim.R(p, 'awareness');
  let d = 0.6 - awr * 0.0045;
  if (sim.difficulty && p.team !== sim.humanTeam) d *= sim.difficulty.cpuReact ?? 1;
  d *= 1 - 0.3 * sim.sl(p.team, 'passCoverage');
  return Math.max(0.08, d);
}
