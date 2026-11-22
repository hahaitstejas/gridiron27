// Between-play presentation (render-only; the sim and replays never see it):
//  - after the whistle players get up and jog to their huddles (offense behind the new spot, defense across),
//  - when the next play is set they break the huddle and run to the line (the session waits LINEUP_T before
//    a human can snap),
//  - a seven-man officiating crew works every play: positions by the ball, signals (touchdown, incomplete,
//    first down, penalties) and the referee faces the camera to announce fouls.
import { LINEUP_T } from '../game/session.js';
import { HALF_WIDTH } from '../core/constants.js';

const JOG = 4.2; // yd/s
const HUDDLE_DELAY = 0.8; // seconds after the whistle before players head to the huddle
const CEL_T = 3.2; // touchdown celebration (scorer + teammates, close-up camera) before the walk back
const CEL_STYLES = ['cel_spike', 'cel_point', 'cel_flex', 'cel_leap'];

// Officials: [name, downfield, lateral] from the ball in the offense frame (lateral 'S' = on the sideline).
const CREW = [
  ['R', -12, 4], // referee (white cap) behind the backfield, to the QB's arm side
  ['U', -7, -3], // umpire in the offensive backfield
  ['DJ', 0, 'S-'], // down judge on one sideline at the line
  ['LJ', 0, 'S+'], // line judge on the other
  ['SJ', 18, 'S+'], // side judge
  ['FJ', 18, 'S-'], // field judge
  ['BJ', 24, 0], // back judge deep in the middle
];

const SIGNAL = {
  holding_off: 'sig_holding', holding_def: 'sig_holding', dpi: 'sig_pi', offsides: 'sig_offside', offsides_live: 'sig_offside',
  false_start: 'sig_false_start', delay_of_game: 'sig_false_start', roughing: 'sig_personal', facemask_def: 'sig_personal',
  facemask_off: 'sig_personal', grounding: 'sig_grounding', illegal_formation: 'sig_formation', illegal_motion: 'sig_motion',
  opi: 'sig_pi', illegal_contact: 'sig_contact', unr_def: 'sig_personal', unr_off: 'sig_personal',
  running_into_kicker: 'sig_kicker', roughing_kicker: 'sig_kicker',
};

function proxyOf(p) {
  return { id: p.id, team: p.team, number: p.number, skin: p.skin, height: p.height, bulk: p.bulk, slot: p.slot, pos: p.pos,
    state: 'active', move: null, x: p.x, z: p.z, px: p.x, pz: p.z, facing: p.facing, pfacing: p.facing, vx: 0, vz: 0, anim: 'idle', animT: 0, cycle: 0 };
}

export class Presentation {
  constructor() {
    this.spots = new Map(); // `${team}:${k}` -> { x, z, f } last shown position (huddle -> line-up hand-off)
    this.disp = []; // per player index proxy
    this.refs = CREW.map(([name], i) => ({ id: 100 + i, name, team: -1, number: 0, skin: i, height: i === 0 ? 2.02 : 1.98, bulk: 0.15,
      state: 'active', move: null, x: 0, z: 0, px: 0, pz: 0, facing: 0, pfacing: 0, vx: 0, vz: 0, anim: 'idle', animT: 0, cycle: 0, sig: null, sigT: 0 }));
    this.refsPlaced = false;
    this.mode = null;
    this.modeT = 0;
    this.lastSim = null;
    this.announce = null; // { sig, until }
    this.bench = null; // sideline players and a head coach per team (built on the first frame)
  }

  /** Ten reserves and a coach on each team's sideline (home on one side, visitors across), facing the field. */
  makeBench(session) {
    const out = [];
    session.teams.forEach((t, team) => {
      const side = team === 0 ? -1 : 1;
      const reserves = [...t.roster].sort((a, b) => a.ovr - b.ovr).slice(0, 10);
      reserves.forEach((rp, k) => {
        const x = -16 + k * 3.4 + (k % 2) * 0.8, z = side * (HALF_WIDTH + 4.2 + (k % 3) * 1.3);
        out.push({ id: 200 + out.length, team, number: rp.number, skin: rp.skin ?? k, height: 1.95 + (rp.height ? (rp.height - 74) * 0.02 : 0), bulk: ['T', 'G', 'C', 'DT', 'DE'].includes(rp.pos) ? 0.8 : 0.25,
          state: 'active', move: null, x, z, px: x, pz: z, hx: x, hz: z, facing: -side * Math.PI / 2, pfacing: -side * Math.PI / 2, vx: 0, vz: 0, anim: 'idle', animT: k * 0.37, cycle: 0 });
      });
      const x = 2 * side, z = side * (HALF_WIDTH + 3.4);
      out.push({ id: 200 + out.length, team, coach: true, number: 0, skin: team * 3 + 1, height: 1.9, bulk: 0.2, state: 'active', move: null,
        x, z, px: x, pz: z, hx: x, hz: z, facing: -side * Math.PI / 2, pfacing: -side * Math.PI / 2, vx: 0, vz: 0, anim: 'idle', animT: 0, cycle: 0 });
    });
    return out;
  }

  /** The sidelines: reserves drift a little and watch the ball; they celebrate their team's touchdowns. */
  sidelines(sim, dt) {
    const b = sim.ball;
    for (const p of this.bench) {
      p.px = p.x; p.pz = p.z; p.pfacing = p.facing;
      p.animT += dt;
      // The coach paces along his sideline with the ball; reserves shuffle within a couple of yards.
      const tx = p.coach ? Math.max(-18, Math.min(18, b.x * 0.5)) : p.hx + Math.sin(p.animT * 0.23 + p.id) * 1.2;
      const dx = tx - p.x, dist = Math.abs(dx);
      const v = dist > 0.3 ? Math.min(1.6, dist) * Math.sign(dx) : 0;
      p.vx = v; p.x += v * dt;
      const look = Math.atan2(b.z - p.z, b.x - p.x);
      p.facing = turn(p.facing, Math.abs(v) > 0.4 ? Math.atan2(0, v) : look, dt * 3);
      const party = this.cel && this.cel.team === p.team && !p.coach;
      const anim = party ? 'celebrate' : Math.abs(v) > 0.4 ? 'run' : p.coach ? (sim.state === 'live' ? 'idle' : 'playsheet') : sim.state === 'live' && (p.id % 3 === 0) ? 'clap' : 'idle';
      if (anim === 'run') p.cycle += dt * 3;
      if (anim !== p.anim) { p.anim = anim; p.animT = 0; }
    }
  }

  /** Session events: officials react (TD, incomplete, flags, first downs). */
  onEvent(e, session) {
    const sim = session?.sim;
    if (!sim) return;
    const nearest = (x, z, skip = -1) => {
      let best = null, bd = 1e9;
      this.refs.forEach((r, i) => { if (i === skip) return; const d = Math.hypot(r.x - x, r.z - z); if (d < bd) { bd = d; best = r; } });
      return best;
    };
    const ball = sim.ball;
    if (e.type === 'message' && e.kind === 'timeout') { this.signal(this.refs[0], 'sig_timeout', 2.4); return; }
    if (e.type === 'touchdown') {
      // The two officials nearest the goal line signal it.
      const a = nearest(ball.x, ball.z);
      const b = nearest(ball.x, ball.z, this.refs.indexOf(a));
      for (const r of [a, b]) this.signal(r, 'sig_td', 3);
      // The scorer celebrates (style by player, so a star keeps his own) and his teammates join him.
      const idx = ball.carrier >= 0 ? ball.carrier : -1;
      const sp = sim.players[idx];
      if (sp && !session.fast) this.cel = { idx, team: sp.team, t: 0, style: CEL_STYLES[(sp.number + sp.id) % CEL_STYLES.length], x: sp.x, z: sp.z, dir: session.match.dirOf(sp.team) };
    } else if (e.type === 'incomplete' && e.why !== 'spike') this.signal(nearest(ball.x, ball.z), 'sig_incomplete', 1.8);
    else if (e.type === 'recovery' && e.team !== undefined) {
      // A loose ball recovered: the nearest official points the way the recovering team is going (whose ball it is).
      const pl = sim.players[e.player];
      this.signal(nearest(pl ? pl.x : ball.x, pl ? pl.z : ball.z), 'sig_first', 1.8, session.match.dirOf(e.team) > 0 ? 0 : Math.PI);
    } else if (e.type === 'flag' && e.live) {
      // A flag flies on the field: the nearest official throws it.
      const pl = sim.players.find((p) => p.team === e.team) || null;
      this.signal(pl ? nearest(pl.x, pl.z) : this.refs[1], 'sig_flag', 0.6);
    } else if (e.type === 'flag' && e.outcome) {
      // After the play the referee announces it, facing the camera, with the signal for the foul.
      this.announce = { sig: SIGNAL[e.foul?.type] || 'sig_holding', t: 0 };
    } else if (e.type === 'result' && e.result && !e.result.touchdown && !e.result.turnover && e.result.offTeam === session.match.possession && session.match.down === 1 && session.match.phase === 'scrimmage' && !sim.isKick && (e.result.yards || 0) > 0) {
      this.signal(nearest(ball.x, ball.z), 'sig_first', 1.6);
      if ((e.result.yards || 0) >= 4 && e.result.carrierId !== undefined) this.moment = { idx: e.result.carrierId, style: 'cel_first', t: 0, dir: session.match.dirOf(e.result.offTeam) };
    }
    // Big defensive plays get a moment too: the sacker and the interceptor celebrate after the whistle.
    if (e.type === 'result' && e.result && !session.fast) {
      if (e.result.sack && e.result.tackler !== null && e.result.tackler !== undefined) this.moment = { idx: e.result.tackler, style: 'cel_sack', t: 0 };
      else if (e.result.interception && e.result.intBy !== null && e.result.intBy !== undefined && !e.result.touchdown) this.moment = { idx: e.result.intBy, style: 'cel_pick', t: 0 };
    }
  }

  signal(r, sig, secs, faceAng = null) { if (r) { r.sig = sig; r.sigT = secs; r.animT = 0; r.sigFace = faceAng; } }

  /**
   * Per frame: returns { display, refs } — display[i] overrides sim player i (or null when the sim's own
   * positions should be drawn), refs are the officials.
   */
  frame(session, sim, dt) {
    const m = session.match;
    if (sim !== this.lastSim) { this.lastSim = sim; this.mode = null; }
    const scrim = m.phase === 'scrimmage' || m.phase === 'try';
    const dir = m.dirOf(m.possession);
    const losX = m.xOf(m.possession, m.yardLine);
    const ballZ = m.phase === 'scrimmage' ? m.ballZ : 0;
    let display = null;
    const st = session.state;

    // ---- players ----
    const huddling = !sim.isKick && scrim && !session.fast && (st === 'post' || st === 'playcall' || st === 'penalty' || st === 'review') && sim.state !== 'presnap';
    const lining = !sim.isKick && scrim && !session.fast && st === 'presnap' && sim.state === 'presnap' && session.presnapT < LINEUP_T && this.spots.size;
    const mode = huddling ? 'huddle' : lining ? 'lineup' : null;
    if (mode !== this.mode) { this.mode = mode; this.modeT = 0; if (mode === 'huddle') this.startHuddle(sim); }
    this.modeT += dt;
    if (this.cel && mode === 'huddle') this.cel.t += dt;
    if (this.spot) { if (mode === 'huddle') this.spot.t += dt; else if (this.spot.t > 0) this.spot = null; }
    if (this.moment && mode !== 'huddle') this.moment = null;
    if (this.cel && (this.cel.t > CEL_T || (mode !== 'huddle' && sim.state === 'presnap'))) this.cel = null;
    this.hurry = !!session.hurry || (m.clock < 120 && (m.quarter === 2 || m.quarter >= 4)); // no strolling in a hurry-up
    if (this.introT !== null && this.introT !== undefined) display = this.runout(sim, this.introT);
    else if (mode === 'huddle') display = this.huddle(sim, m, dir, losX, ballZ, dt);
    else if (mode === 'lineup') display = this.lineup(sim, session.presnapT, dt);
    else if (!mode && sim.state === 'presnap') this.spots.clear();

    // ---- officials, sidelines ----
    this.officials(sim, session, dir, losX, ballZ, dt);
    if (!this.bench) this.bench = this.makeBench(session);
    this.sidelines(sim, dt);
    return { display, refs: [...this.refs, ...this.bench], bench: this.bench, ballAt: mode === 'huddle' && this.modeT > HUDDLE_DELAY + 0.5 ? { x: losX, z: ballZ } : null };
  }

  /** Close-up camera target while a touchdown celebration runs: { x, z, dir } or null. */
  /** The celebration wheel (RS after your touchdown): Dance / Flex / Spike / Team. */
  pickCelebration(style) {
    if (!this.cel) return false;
    this.cel.style = style === 'team' ? 'cel_leap' : style === 'dance' ? 'cel_dance' : style === 'spike' ? 'cel_spike' : 'cel_flex';
    this.cel.team = style === 'team' ? this.cel.team : this.cel.team;
    this.cel.teamParty = style === 'team';
    this.cel.picked = true;
    this.cel.t = Math.min(this.cel.t, CEL_T - 2.8); // the picked celebration gets its own ~2.5 s close-up
    return true;
  }

  /** Player spotlight (the user's gameplay 8 reference): after a big play the camera holds close on the player for a beat. */
  spotlight(idx, secs = 2.6, from = null) { this.spot = { idx, t: 0, dur: secs, from }; }

  celebration() {
    const sp = this.spot;
    if (!this.cel && sp && sp.t < sp.dur && this.mode === 'huddle') {
      const d = this.disp[sp.idx];
      if (d) {
        // From the game camera's side of him (in front of him and toward the viewer), whichever way he's walking.
        // In front of him (the way he's facing / walking), easing as he turns, so it's his face and number, not his back.
        sp.camAt ||= { x: d.x, z: d.z, facing: d.facing };
        sp.camAt.x += (d.x - sp.camAt.x) * 0.08; sp.camAt.z += (d.z - sp.camAt.z) * 0.08; // drift with him as he walks
        sp.camAt.facing = turn(sp.camAt.facing, d.facing, 0.04);
        return { x: sp.camAt.x, z: sp.camAt.z, facing: sp.camAt.facing, t: sp.t, close: 0.75 };
      }
    }
    const c = this.cel;
    if (!c || c.t > CEL_T - 0.3) return null;
    // Until the huddle phase starts (the whistle's wind-down) the display proxies are last play's: use the live player.
    const d = (this.mode === 'huddle' && this.disp[c.idx]) || this.lastSim?.players[c.idx];
    if (!d) return null;
    // One fixed angle on the scorer for the whole celebration (he turns to face the field; the camera doesn't swing).
    c.camAt ||= { x: d.x, z: d.z, facing: c.dir > 0 ? Math.PI : 0 };
    // ...but it stays on him: he's often still running through the end zone when the shot starts.
    c.camAt.x += (d.x - c.camAt.x) * 0.12; c.camAt.z += (d.z - c.camAt.z) * 0.12;
    // Once you've picked a celebration the camera moves in close on him (a team one stays wider for the group).
    return { x: c.camAt.x, z: c.camAt.z, facing: c.camAt.facing, t: c.t, close: c.picked ? (c.teamParty ? 0.6 : 1) : 0 };
  }

  /** Touchdown: the scorer celebrates facing the field; teammates run over and celebrate around him. */
  celebrate(sim, i, d, dt) {
    const c = this.cel, p = sim.players[i];
    if (i === c.idx) {
      d.vx = d.vz = 0;
      d.facing = turn(d.facing, c.dir > 0 ? Math.PI : 0, dt * 5); // back toward the field (and the camera)
      if (d.anim !== c.style) { d.anim = c.style; d.animT = 0; }
      c.x = d.x; c.z = d.z;
      return true;
    }
    if (p.team !== c.team || Math.hypot(d.x - c.x, d.z - c.z) > 28) return false;
    // An arc behind the scorer (toward the end line), so the camera in front of him sees everyone.
    const a = (c.dir > 0 ? 0 : Math.PI) + ((i % 11) / 10 - 0.5) * 2.6;
    const r = 1.5 + (i % 3) * 0.55;
    const tx = c.x + Math.cos(a) * r, tz = c.z + Math.sin(a) * r;
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
    if (dist > 0.4) {
      const v = Math.min(7, dist / dt);
      d.vx = (dx / dist) * v; d.vz = (dz / dist) * v;
      d.x += d.vx * dt; d.z += d.vz * dt;
      d.facing = turn(d.facing, Math.atan2(dz, dx), dt * 9);
      if (d.anim !== 'run') { d.anim = 'run'; d.animT = 0; }
      d.cycle += dt * (2.2 + v * 1.05);
    } else {
      d.vx = d.vz = 0;
      d.facing = turn(d.facing, Math.atan2(c.z - d.z, c.x - d.x), dt * 6);
      if (d.anim !== 'celebrate') { d.anim = 'celebrate'; d.animT = 0; }
    }
    return true;
  }

  /** After-play reactions (startHuddle): true while player i is busy with one. */
  react(i, d, dt) {
    const r = this.reacts?.get(i);
    if (!r || d.down) return false;
    r.t += dt;
    if (r.kind === 'frustrated') {
      if (r.t > r.dur) return false;
      d.vx = d.vz = 0;
      if (d.anim !== 'frustrated') { d.anim = 'frustrated'; d.animT = 0; }
      return true;
    }
    // High five: walk to just short of the meeting point (each from his side), turn to his mate, slap.
    if (r.done || r.t > 2.2) return false;
    const o = this.disp[r.other];
    const ang = Math.atan2(o.z - d.z, o.x - d.x);
    const tx = r.meet.x - Math.cos(ang) * 0.42, tz = r.meet.z - Math.sin(ang) * 0.42;
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
    if (!r.slap && dist > 0.1) {
      const sp = Math.min(3, dist / dt);
      d.vx = (dx / dist) * sp; d.vz = (dz / dist) * sp; d.x += d.vx * dt; d.z += d.vz * dt;
      d.facing = turn(d.facing, Math.atan2(dz, dx), dt * 8);
      if (d.anim !== 'run') { d.anim = 'run'; d.animT = 0; }
      d.cycle += dt * (2.2 + sp * 1.05);
      return true;
    }
    if (!r.slap) { r.slap = 0; d.anim = 'hi5'; d.animT = 0; }
    d.vx = d.vz = 0;
    d.facing = turn(d.facing, ang, dt * 10);
    r.slap += dt;
    if (r.slap > 0.85) r.done = true;
    return true;
  }

  /** The helper's part of a help-up: walk to the downed teammate, reach down, pull, then go on (true while busy). */
  helpUp(sim, i, d, dt) {
    if (this.modeT < HUDDLE_DELAY * 0.5 || !this.helpers?.size) return false;
    for (const [di, h] of this.helpers) {
      if (h.by !== i) continue;
      const v = this.disp[di];
      if (!v || h.t > 1.1) return false;
      const ang = Math.atan2(d.z - v.z, d.x - v.x), tx = v.x + Math.cos(ang) * 0.85, tz = v.z + Math.sin(ang) * 0.85;
      const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
      if (!h.arrived && dist > 0.12) {
        const sp = Math.min(2.2, dist / dt);
        d.vx = (dx / dist) * sp; d.vz = (dz / dist) * sp; d.x += d.vx * dt; d.z += d.vz * dt;
        d.facing = turn(d.facing, Math.atan2(dz, dx), dt * 8);
        if (d.anim !== 'run') { d.anim = 'run'; d.animT = 0; }
        d.cycle += dt * (2.2 + sp * 1.05);
        if (this.modeT > HUDDLE_DELAY + 2) h.t = 9; // couldn't get there: give up
        return true;
      }
      h.arrived = true; h.t += dt;
      d.vx = d.vz = 0;
      d.facing = turn(d.facing, Math.atan2(v.z - d.z, v.x - d.x), dt * 10);
      if (d.anim !== 'helpup') { d.anim = 'helpup'; d.animT = 0; }
      // The downed player takes the hand: he starts getting up as the pull begins.
      if (h.t > 0.3 && v.anim === 'down') { v.anim = 'getup'; v.animT = 0; v.facing = turn(v.facing, Math.atan2(d.z - v.z, d.x - v.x), 1); }
      return true;
    }
    return false;
  }

  startHuddle(sim) {
    sim.players.forEach((p, i) => {
      const d = (this.disp[i] = proxyOf(p));
      if (p.kneeling) { d.anim = 'kneel'; d.down = false; } // victory formation: he just stands back up
      else if (p.state === 'down' || p.state === 'tackled') { d.anim = 'down'; d.down = true; }
    });
    // A teammate helps a downed player up (about half the time, only someone standing within 4 yds, one helper each).
    this.helpers = new Map(); // down player index -> { by, t, arrived }
    const used = new Set();
    sim.players.forEach((p, i) => {
      const d = this.disp[i];
      if (!d?.down || ((p.id * 7 + p.number) % 2) || this.moment?.idx === i) return;
      let best = -1, bd = 4;
      sim.players.forEach((q, k) => {
        const e = this.disp[k];
        if (k === i || q.team !== p.team || e?.down || used.has(k) || this.helpers.has(k)) return;
        const dd = Math.hypot(e.x - d.x, e.z - d.z);
        if (dd < bd) { bd = dd; best = k; }
      });
      if (best >= 0) { used.add(best); this.helpers.set(i, { by: best, t: 0, arrived: false }); }
    });
    // Reactions: the target of an incompletion grabs his helmet; on a stop (a tackle for a yard or less) the tackler and the
    // nearest standing teammate meet for a high five.
    this.reacts = new Map(); // player index -> { kind, dur?, meet?, t }
    const res = sim.result, st = sim.stats || {};
    if (res?.incomplete && st.target !== null && st.target !== undefined && this.disp[st.target] && !this.disp[st.target].down) this.reacts.set(st.target, { kind: 'frustrated', t: 0, dur: 1.3 });
    // A stop (a tackle for a yard or less): the two defenders standing nearest the tackle meet for a high five (the tackler
    // himself is usually on the ground; the sacker has his own celebration).
    const tk = st.tackler;
    if (res && !res.incomplete && !res.touchdown && !res.turnover && (res.yards ?? 9) <= 1 && tk !== null && tk !== undefined && sim.players[tk]) {
      const dteam = sim.players[tk].team, bx = sim.ball.x, bz = sim.ball.z;
      const near = sim.players.map((q, k) => ({ k, e: this.disp[k], q }))
        .filter(({ k, e, q }) => q.team === dteam && e && !e.down && !used.has(k) && this.moment?.idx !== k && Math.hypot(e.x - bx, e.z - bz) < 7)
        .sort((a, b) => Math.hypot(a.e.x - bx, a.e.z - bz) - Math.hypot(b.e.x - bx, b.e.z - bz));
      if (near.length >= 2) {
        const [{ k: k1, e: a }, { k: k2, e: b }] = near;
        const meet = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        this.reacts.set(k1, { kind: 'hi5', t: 0, meet, other: k2 }); this.reacts.set(k2, { kind: 'hi5', t: 0, meet, other: k1 });
      }
    }
  }

  /**
   * Pregame run-out (intro.js): each team comes out of the tunnel at its end line — home at -x, away at +x — in a
   * stream, and jogs to its kickoff spot. t = intro time; before 3 s they wait in the tunnel (off the field).
   */
  runout(sim, t) {
    this.disp ||= sim.players.map((p) => ({ ...p }));
    const out = [];
    sim.players.forEach((p, i) => {
      const d = (this.disp[i] ||= { ...p });
      d.px = d.x; d.pz = d.z; d.pfacing = d.facing;
      const end = p.team === 0 ? -1 : 1;
      const k = sim.players.filter((q, j) => q.team === p.team && j < i).length;
      const start = 3.0 + (p.team === 0 ? 0 : 0.6) + k * 0.16;
      const run = Math.max(0, Math.min(1, (t - start) / 4.2));
      const sx = end * 61, sz = (k % 3 - 1) * 1.2;
      const tx = p.x, tz = p.z;
      const x = sx + (tx - sx) * run, z = sz + (tz - sz) * run;
      d.vx = (x - d.x) * 60; d.vz = (z - d.z) * 60;
      const moving = run > 0 && run < 1;
      d.x = x; d.z = z;
      d.facing = moving ? Math.atan2(tz - sz, tx - sx) : p.facing;
      d.anim = moving ? 'run' : t > start ? 'idle' : 'idle';
      d.cycle = (d.cycle || 0) + (moving ? 0.25 : 0);
      d.animT = (d.animT || 0) + 1 / 60;
      d.state = 'active';
      out.push(d);
    });
    return out;
  }

  /** Where player k of a team stands in its huddle (a ring facing the middle). */
  huddleSpot(off, k, dir, losX, ballZ) {
    const cx = losX - dir * (off ? 8 : -7), cz = ballZ;
    const a = (k / 11) * Math.PI * 2 + (off ? 0 : 0.3);
    const r = 1.75;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, cx, cz };
  }

  huddle(sim, m, dir, losX, ballZ, dt) {
    const count = [0, 0];
    sim.players.forEach((p, i) => {
      const d = this.disp[i];
      d.px = d.x; d.pz = d.z; d.pfacing = d.facing;
      const k = count[p.team]++;
      const off = p.team === m.possession;
      const s = this.huddleSpot(off, k, dir, losX, ballZ);
      d.animT += dt;
      if (this.cel && d.anim !== 'down' && !(d.anim === 'getup' && d.animT < 0.6) && this.celebrate(sim, i, d, dt)) {
        // celebrating
      } else if (this.moment && this.moment.idx === i && this.modeT < HUDDLE_DELAY + 0.9 && !(d.down && d.anim === 'down' && this.modeT < 0.5)) {
        // A short celebration (first down point, sack, pick) before heading to the huddle.
        d.vx = d.vz = 0; d.down = false;
        if (this.moment.dir) d.facing = turn(d.facing, this.moment.dir > 0 ? 0 : Math.PI, dt * 6);
        if (d.anim !== this.moment.style) { d.anim = this.moment.style; d.animT = 0; }
      } else if (this.react(i, d, dt)) {
        // an after-play reaction (helmet grab, high five)
      } else if (this.helpUp(sim, i, d, dt)) {
        // walking over to / pulling up a teammate who went down
      } else if (d.down && d.anim === 'down' && this.helpers.has(i) && this.modeT < HUDDLE_DELAY + 2.2) {
        // stays down until the teammate coming to help him has his hand out
      } else if (this.modeT < HUDDLE_DELAY || (!d.down && (p.energy ?? 1) < 0.66 && this.modeT < HUDDLE_DELAY + 1.1)) {
        // A beat after the whistle: whoever is down stays down for a moment, the rest stand; a gassed player
        // bends over with his hands on his knees before he jogs back.
        if (!d.down) { const a = (p.energy ?? 1) < 0.66 ? 'tired' : 'idle'; if (d.anim !== a) { d.anim = a; d.animT = 0; } d.vx = d.vz = 0; }
      } else if (d.down && d.anim === 'down') { d.anim = 'getup'; d.animT = 0; }
      else if (d.anim === 'getup' && d.animT < 0.6) { /* getting up */ }
      else {
        const dx = s.x - d.x, dz = s.z - d.z, dist = Math.hypot(dx, dz);
        if (dist > 0.25) {
          // About a third walk back with their hands on their hips when the huddle is close and there's time (not hurrying).
          const walk = dist < 12 && ((p.id * 13 + p.number) % 3 === 0) && !this.hurry;
          const v = Math.min(walk ? 1.6 : JOG * (dist > 12 ? 1.3 : 1), dist / dt);
          d.vx = (dx / dist) * v; d.vz = (dz / dist) * v;
          d.x += d.vx * dt; d.z += d.vz * dt;
          d.facing = turn(d.facing, Math.atan2(dz, dx), dt * 8);
          const ja = walk ? 'walk_hips' : 'run';
          if (d.anim !== ja) { d.anim = ja; d.animT = 0; }
          d.cycle += dt * (2.2 + v * 1.05);
        } else {
          d.vx = d.vz = 0;
          d.facing = turn(d.facing, Math.atan2(s.cz - d.z, s.cx - d.x), dt * 6);
          if (d.anim !== 'huddle') { d.anim = 'huddle'; d.animT = 0; }
        }
      }
      this.spots.set(`${p.team}:${k}`, { x: d.x, z: d.z, f: d.facing });
    });
    return this.disp;
  }

  /** Break the huddle: everyone runs from where he was shown to his spot in the formation. */
  lineup(sim, t, dt) {
    const count = [0, 0];
    const k0 = Math.min(1, t / LINEUP_T);
    sim.players.forEach((p, i) => {
      const k = count[p.team]++;
      const from = this.spots.get(`${p.team}:${k}`);
      const d = (this.disp[i] ||= proxyOf(p));
      Object.assign(d, { id: p.id, team: p.team, number: p.number, skin: p.skin, height: p.height, bulk: p.bulk, slot: p.slot, pos: p.pos });
      d.px = d.x; d.pz = d.z; d.pfacing = d.facing;
      if (!from) { d.x = p.x; d.z = p.z; d.facing = p.facing; d.anim = p.anim; return; }
      if (k0 < 0.12) {
        // Clap and break.
        d.x = from.x; d.z = from.z; d.facing = from.f; d.vx = d.vz = 0;
        if (d.anim !== 'clap') { d.anim = 'clap'; d.animT = 0; }
        d.animT += dt;
        return;
      }
      const e = Math.min(1, (k0 - 0.12) / 0.8);
      const ease = e * e * (3 - 2 * e);
      const nx = from.x + (p.x - from.x) * ease, nz = from.z + (p.z - from.z) * ease;
      d.vx = (nx - d.x) / Math.max(dt, 1e-3); d.vz = (nz - d.z) / Math.max(dt, 1e-3);
      d.x = nx; d.z = nz;
      if (e < 1) {
        const sp = Math.hypot(d.vx, d.vz);
        if (sp > 0.3) d.facing = turn(d.facing, Math.atan2(d.vz, d.vx), dt * 10);
        if (d.anim !== 'run') { d.anim = 'run'; d.animT = 0; }
        d.cycle += dt * (2.2 + sp * 1.05);
      } else {
        // Set: settle into the stance the sim has him in.
        d.facing = turn(d.facing, p.facing, dt * 10);
        d.vx = d.vz = 0;
        if (d.anim !== p.anim) { d.anim = p.anim; d.animT = 0; }
      }
      d.animT += dt;
    });
    return this.disp;
  }

  officials(sim, session, dir, losX, ballZ, dt) {
    const b = sim.ball;
    const live = sim.state === 'live';
    // Ball position the crew keys on (the dead-ball spot after the whistle).
    const bx = live || sim.state === 'dead' ? b.x : losX, bz = live || sim.state === 'dead' ? b.z : ballZ;
    const lz = (side) => (side === 'S+' ? 1 : -1) * dir * (HALF_WIDTH + 1.2);
    const place = (spec, down) => {
      const [, d0, lat] = spec;
      const x = (sim.state === 'presnap' || !live ? losX : losX) + dir * (down ?? d0);
      const z = typeof lat === 'string' ? lz(lat) : ballZ + dir * lat;
      return { x, z };
    };
    if (!this.refsPlaced || sim.state === 'presnap' && !this.placedFor) {
      this.refs.forEach((r, i) => { const p = place(CREW[i]); r.x = r.px = p.x; r.z = r.pz = p.z; });
      this.refsPlaced = true;
    }
    this.placedFor = sim.state !== 'presnap' ? null : this.placedFor;
    if (this.announce) this.announce.t += dt;
    this.refs.forEach((r, i) => {
      r.px = r.x; r.pz = r.z; r.pfacing = r.facing;
      r.animT += dt;
      if (r.sigT > 0) r.sigT -= dt;
      const spec = CREW[i];
      let tx, tz, face = null;
      if (live) {
        // Work the play: sideline officials stay level with the ball, deep ones stay deeper than it,
        // everyone keeps a few yards from the ball carrier.
        const ballDown = (bx - losX) * dir;
        const base = place(spec);
        if (typeof spec[2] === 'string') { tx = bx - dir * 1; tz = base.z; }
        else if (spec[1] > 0) { tx = losX + dir * Math.max(spec[1], ballDown + 10); tz = bz * 0.5 + base.z * 0.5; }
        else { tx = base.x; tz = base.z; }
        const away = Math.hypot(r.x - bx, r.z - bz);
        if (away < 5) { tx = r.x + (r.x - bx) / (away || 1) * 2; tz = r.z + (r.z - bz) / (away || 1) * 2; }
        face = { x: bx, z: bz };
      } else if (this.announce && i === 0 && this.announce.t < 4) {
        // Referee announces the penalty from the middle of the field, facing the offense's backfield (camera).
        tx = losX - dir * 6; tz = ballZ;
        face = { x: losX - dir * 30, z: ballZ };
        if (Math.hypot(tx - r.x, tz - r.z) < 1.2) { r.sig = this.announce.sig; r.sigT = 0.2; }
      } else {
        // Between plays: walk back to the next play's spots (the nearest one spots the ball).
        const p = place(spec);
        tx = p.x; tz = p.z;
        face = { x: losX, z: ballZ };
      }
      if (!live && this.announce && this.announce.t >= 4) this.announce = null;
      const dx = tx - r.x, dz = tz - r.z, dist = Math.hypot(dx, dz);
      const signaling = r.sigT > 0 && r.sig !== 'sig_flag';
      if (dist > 0.3 && !signaling) {
        // Officials run at a real stride (no creeping at a few inches a second when nearly there).
        const v = Math.min(live ? 7.5 : 4.5, Math.max(dist * 2.5, Math.min(1.6, dist / dt)), dist / dt);
        r.vx = (dx / dist) * v; r.vz = (dz / dist) * v;
        r.x += r.vx * dt; r.z += r.vz * dt;
        const moveF = Math.atan2(r.vz, r.vx);
        const want = face ? Math.atan2(face.z - r.z, face.x - r.x) : moveF;
        // Backpedal when the target is behind the way he wants to face.
        r.facing = turn(r.facing, Math.cos(moveF - want) < -0.2 ? want : moveF, dt * 7);
        r.cycle += dt * (2.2 + v * 1.05);
      } else {
        r.vx = r.vz = 0;
        if (signaling && r.sigFace != null) r.facing = turn(r.facing, r.sigFace, dt * 8);
        else if (face) r.facing = turn(r.facing, Math.atan2(face.z - r.z, face.x - r.x), dt * 5);
      }
      const sp = Math.hypot(r.vx, r.vz);
      // Any movement gets a stride (slow drifts used to slide in the idle pose: "floating" officials); sideways
      // movement shuffles, backward backpedals.
      const rel = sp > 0.05 ? Math.cos(Math.atan2(r.vz, r.vx) - r.facing) : 1;
      const anim = r.sigT > 0 ? r.sig : sp > 0.15 ? (rel < -0.3 ? 'backpedal' : rel < 0.45 ? 'shuffle' : 'run') : 'idle';
      if (anim !== r.anim) { r.anim = anim; r.animT = 0; }
    });
  }
}

function turn(a, b, max) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + Math.max(-max, Math.min(max, d));
}
