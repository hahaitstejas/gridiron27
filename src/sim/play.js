import { GOAL_X, END_X, HALF_WIDTH, HASH_Z, BALL_CARRY_HEIGHT } from '../core/constants.js';
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
import { runDefenseAI, assignDefense, alignMan } from '../ai/defense.js';
import { applyHuman } from './human.js';

const OL_SLOTS = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
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
    this.camDir = cfg.camDir ?? this.dir;
    this.boost = cfg.boost || [0, 0];
    this.difficulty = cfg.difficulty || null;
    this.firstDownX = cfg.firstDownX ?? null;

    this.t = 0;
    this.state = 'presnap';
    this.events = [];
    this.players = [];
    this.engagements = [];
    this.possTeam = this.offIdx;
    this.controlledId = -1;
    this.passThrown = false;
    this.pendingThrow = null;
    this.qbCrossed = false;
    this.handedOff = false;
    this.ballLiveRun = false; // a runner has the ball (handoff, catch, scramble, turnover)
    this.result = null;
    this.deadT = 0;
    this.stats = { passer: null, target: null, receiver: null, rusher: null, tackler: null, assist: null, airYards: 0, catchX: null };
    this.ball = { state: 'presnap', x: 0, y: 0.15, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, carrier: -1, t: 0, T: 0, kind: '', spin: 0, resolved: false, intended: -1, target: null };
    this.setup();
  }

  // ---- coordinate helpers (offense frame) ----
  toWorld(down, lat) { return { x: this.losX + this.dir * down, z: this.ballZ + this.dir * lat }; }
  toLocal(x, z) { return { down: (x - this.losX) * this.dir, lat: (z - this.ballZ) * this.dir }; }
  teamDir(team) { return team === this.offIdx ? this.dir : -this.dir; }
  R(p, key) { return clamp((p.r[key] ?? 40) + this.boost[p.team], 0, 115); }
  emit(type, data = {}) { this.events.push({ type, t: this.t, ...data }); }
  carrier() { return this.ball.state === 'held' ? this.players[this.ball.carrier] : null; }
  offense() { return this.players.filter((p) => p.team === this.offIdx); }
  defense() { return this.players.filter((p) => p.team === this.defIdx); }
  bySlot(team, slot) { return this.players.find((p) => p.team === team && p.slot === slot); }
  isHumanControlled(p) { return p.id === this.controlledId && this.humanTeam === p.team; }

  setup() {
    const offF = getOffFormation(this.offPlay.formation);
    const defF = getDefFormation(this.defPlay.formation);
    if (!offF || !defF) throw new Error(`Missing formation ${this.offPlay.formation} / ${this.defPlay.formation}`);
    this.place(offF, this.offIdx, 'O');
    this.place(defF, this.defIdx, 'D');
    this.alignDefense(defF);
    alignMan(this);
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
    if (this.humanTeam === this.offIdx) this.controlledId = this.bySlot(this.offIdx, 'QB')?.id ?? -1;
    else if (this.humanTeam === this.defIdx) this.controlledId = this.defaultDefender();
  }

  place(formation, teamIdx, side) {
    const team = this.teams[teamIdx];
    const used = new Set();
    const byId = new Map(team.roster.map((p) => [p.id, p]));
    for (const fp of formation.players) {
      const list = team.depth[fp.p] || [];
      let rp = null;
      for (let i = fp.d; i < list.length && !rp; i++) if (!used.has(list[i])) rp = byId.get(list[i]);
      for (let i = 0; i < list.length && !rp; i++) if (!used.has(list[i])) rp = byId.get(list[i]);
      if (!rp) rp = team.roster.find((p) => !used.has(p.id));
      used.add(rp.id);
      const sp = makeSimPlayer(this.players.length, rp, teamIdx, side, fp.s);
      const w = this.toWorld(fp.at[0], fp.at[1]);
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

  computeIcons() {
    this.icons = {};
    if (this.offPlay.type !== 'pass') return;
    const routes = this.offPlay.routes || {};
    const runners = this.offense().filter((p) => routes[p.slot] && ROUTES[routes[p.slot].replace(/_(l|r)$/, '')]);
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

  // ---- snap ----
  snap() {
    if (this.state !== 'presnap') return;
    this.state = 'live';
    this.t = 0;
    const qb = this.bySlot(this.offIdx, 'QB');
    const c = this.bySlot(this.offIdx, 'C');
    const play = this.offPlay;
    for (const p of this.players) p.state = 'active';
    // Offense tasks
    for (const p of this.offense()) {
      const a = (play.routes || {})[p.slot];
      if (p.slot === 'QB') {
        p.task = play.type === 'pass'
          ? { type: 'qb_pass', drop: dropFor(play, this.toLocal(p.x, p.z).down), phase: 'drop' }
          : { type: 'qb_handoff' };
      } else if (OL_SLOTS.has(p.slot)) {
        p.task = play.type === 'pass' ? { type: 'pass_block' } : { type: 'run_block', pull: (play.run?.pull || []).includes(p.slot) };
      } else if (play.type === 'run' && play.run && play.run.carrier === p.slot) {
        p.task = { type: 'run_path', phase: 'mesh' };
      } else if (a && ROUTES[a.replace(/_(l|r)$/, '')]) {
        p.task = this.makeRoute(p, a);
      } else if (a === 'stalk') {
        p.task = { type: 'stalk' };
      } else {
        p.task = play.type === 'pass' ? { type: 'pass_block' } : { type: 'run_block' };
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
      updatePendingThrow(this, dt);
      runOffenseAI(this, dt);
      runDefenseAI(this, dt);
      if (this.humanTeam !== null && input) applyHuman(this, input, dt);
      updateMoves(this, dt);
      updateBlocking(this, dt);
      for (const p of this.players) {
        if (p.state === 'down') { p.vx *= 0.85; p.vz *= 0.85; p.x += p.vx * dt; p.z += p.vz * dt; continue; }
        if (p.state === 'tackled') continue;
        if (p.engagement) continue;
        // Running with the ball costs a little top speed, so equal-speed pursuers can close.
        if (this.ballLiveRun && b.state === 'held' && b.carrier === p.id) { p.desired.x *= 0.95; p.desired.z *= 0.95; }
        integrate(p, dt);
      }
      resolveCollisions(this.players);
      updateTackles(this, dt);
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
      if (k >= 1) { b.state = 'held'; this.emit('snapCaught'); }
    } else if (b.state === 'air') {
      updateBallFlight(this, dt);
    } else if (b.state === 'loose') {
      b.vy -= 10.72 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < 0.12) { b.y = 0.12; b.vy = Math.abs(b.vy) * 0.35; b.vx *= 0.6; b.vz *= 0.6; }
    }
  }

  syncBall() {
    const b = this.ball;
    if (b.state === 'held' || b.state === 'presnap') {
      const c = this.players[b.carrier];
      if (!c) return;
      if (b.state === 'presnap') return;
      b.x = c.x; b.z = c.z; b.y = c.state === 'tackled' ? 0.4 : BALL_CARRY_HEIGHT;
    }
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
    if (this.humanTeam !== null) {
      if (p.team === this.humanTeam) this.controlledId = p.id;
      else if (!this.players[this.controlledId] || this.players[this.controlledId].team !== this.humanTeam) {
        this.controlledId = this.nearestTo(this.humanTeam, p).id;
      }
    }
    for (const q of this.players) {
      if (q === p) continue;
      if (q.team === p.team) {
        if (!q.engagement && q.task?.type !== 'pass_block' && q.task?.type !== 'run_block') q.task = { type: 'escort' };
        if (q.slot === 'QB' && q.task?.type !== 'escort') q.task = { type: 'escort' };
      } else {
        // Defenders right on top of the catch/handoff react almost instantly.
        const near = Math.hypot(q.x - p.x, q.z - p.z) < 4 ? 0.2 : 1;
        q.task = { type: 'pursue', at: this.t + reactionDelay(this, q) * near * (how === 'handoff' ? 1.3 : 1) };
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
    const c = this.carrier();
    if (!c || c.state !== 'tackled' || this.state !== 'live') return;
    c.fallT -= dt;
    c.vx *= 0.9; c.vz *= 0.9;
    c.x += c.vx * dt; c.z += c.vz * dt;
    if (c.fallT <= 0) {
      c.state = 'down';
      c.downT = 2;
      c.anim = 'down';
      this.whistle('tackle');
    }
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
    if (c.x * td >= GOAL_X && c.state !== 'tackled') { this.whistle('td'); return; }
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
      turnover: this.possTeam !== this.offIdx,
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
    if (reason === 'incomplete' || reason === 'timeout' && !c) {
      r.spotX = this.losX;
      return r;
    }
    if (c) {
      r.carrierId = c.id;
      r.spotX = clamp(c.x, -END_X, END_X);
      r.spotZ = c.z;
      const td = this.teamDir(c.team);
      if (reason === 'td') r.touchdown = c.team;
      else if (c.x * td <= -GOAL_X) {
        if (c.caughtInEZ) r.touchback = true;
        else r.safety = true;
      }
      r.yards = (r.spotX - this.losX) * this.dir;
      if (r.touchdown === this.offIdx) r.yards = (GOAL_X * this.dir - this.losX) * this.dir;
      r.interception = !!this.stats.intBy;
      r.complete = this.stats.receiver !== null && !r.interception;
      r.sack = c.slot === 'QB' && c.team === this.offIdx && this.offPlay.type === 'pass' && !this.passThrown && !this.qbCrossed && r.yards < 0 && reason === 'tackle';
    }
    return r;
  }

  /** True once the play is over and the dead-ball wind down has played out. */
  get finished() { return this.state === 'dead' && this.deadT > 1.6; }
}

function stanceFor(p) {
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
  return Math.max(0.08, d);
}
