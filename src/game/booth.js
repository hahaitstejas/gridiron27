// The commentary booth (pure logic): calls the play AS IT HAPPENS from recorded clips (game/voiceLines.js), so a call
// is a list of clip ids the player stitches together: the throw when the ball leaves, the catch the moment it's caught,
// "he's got room!" and the yard lines counting down on a breakaway, the touchdown, the pick, the sack; a short result
// after the whistle (the gain, "first down"); the analyst between plays (a reaction to a big play, or the situation).
// It has its own little random generator so it never touches the game's seeded RNG (replays stay deterministic).
// Calls: { parts: [clip ids], who: 'pbp' | 'color', pri: 0 filler / 1 normal / 2 cuts in, ttl: seconds it stays worth saying }.
import { VARIANTS, slug } from './voiceLines.js';
import { GOAL_X } from '../core/constants.js';

export class Booth {
  constructor(have, seed = 7) {
    this.have = have instanceof Set ? have : new Set(have || []);
    let s = seed >>> 0 || 7;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.recent = new Map(); // phrase group -> last variant (no back-to-back repeats)
    this.play = null; // what happened on this play so far
    this.lastPlay = null; // the summary of the last play, for the analyst
    this.sinceColor = 0;
  }

  /** A variant of a phrase group that was recorded (never the same one twice in a row), or null. */
  v(group) {
    const n = VARIANTS[group] || 0;
    const opts = [];
    for (let i = 1; i <= n; i++) if (this.have.has(`${group}_${i}`) && this.recent.get(group) !== i) opts.push(i);
    if (!opts.length) for (let i = 1; i <= n; i++) if (this.have.has(`${group}_${i}`)) opts.push(i);
    if (!opts.length) return null;
    const k = opts[Math.floor(this.rand() * opts.length) % opts.length];
    this.recent.set(group, k);
    return `${group}_${k}`;
  }
  clip(id) { return this.have.has(id) ? id : null; }
  /** The recorded clip for sim player i's last name, or null (a custom league's names may not be recorded). */
  name(sim, i) {
    const p = sim?.players?.[i];
    if (!p) return null;
    const n = String(p.name || '');
    const last = n.includes('. ') ? n.split('. ').slice(1).join(' ') : n;
    return this.clip(`name_${slug(last)}`);
  }
  team(t) { return t?.name ? this.clip(`team_${slug(t.name)}`) : null; }
  yards(n) {
    n = Math.round(Math.abs(n));
    if (n <= 0) return null;
    return this.clip(`yds_${n < 30 ? n : Math.min(95, Math.round(n / 5) * 5)}`); // recorded: 1-29, then 30, 35 ... 95
  }

  /** One session event → calls. ctx = { match, sim, teams }. */
  onEvent(e, { match: m, sim, teams }) {
    const out = [];
    const call = (parts, who = 'pbp', pri = 1, ttl = 1.2) => { parts = parts.filter(Boolean); if (parts.length) out.push({ parts, who, pri, ttl }); };
    const P = this.play || (this.play = { said: {} });
    switch (e.type) {
      case 'snap': this.play = { said: {}, t0: sim?.t ?? 0 }; break;
      case 'throw': {
        if (sim?.isKick) break;
        P.said.throw = true;
        if ((e.T ?? 0) > 1.6) call([this.rand() < 0.6 ? this.name(sim, e.qb) : null, this.v('throw_deep')], 'pbp', 1, 0.8);
        else if (this.rand() < 0.55) call(this.rand() < 0.5 ? [this.name(sim, e.qb), this.v('throw')] : [this.v('throw_quick')], 'pbp', 0, 0.6);
        break;
      }
      case 'handoff': if (this.rand() < 0.65) call([this.v('handoff'), this.name(sim, e.to)], 'pbp', 0, 0.8); break;
      case 'catch': {
        P.said.catch = true; P.catcher = e.player;
        const nm = this.name(sim, e.player);
        call(nm ? [this.v(e.contested ? 'catch_big' : 'catch_by'), nm] : [this.v('catch_plain')], 'pbp', 1, 1.0);
        break;
      }
      case 'brokenTackle': if (!P.said.cut && this.rand() < 0.55) { P.said.cut = true; call([this.v('cut')], 'pbp', 1, 0.7); } break;
      case 'bigHit': call([this.v('big_hit')], 'pbp', 1, 0.8); break;
      case 'touchdown': P.big = 'td'; call([this.v('td')], 'pbp', 2, 2); break;
      case 'interception': P.big = 'int'; call([this.v('int'), this.name(sim, e.player)], 'pbp', 2, 2); break;
      case 'fumble': P.big = 'fumble'; call([this.v('fumble')], 'pbp', 2, 1.5); break;
      case 'recovery':
        if (sim && e.team !== sim.offIdx) { const nm = this.name(sim, e.player); call(nm ? [this.v('recovered_by'), nm] : [this.v('defense_ball')], 'pbp', 2, 1.8); }
        break;
      case 'deflection':
        if (sim && sim.players[e.player]?.team !== sim.possTeam && !P.said.incomplete) { P.said.incomplete = 'breakup'; call([this.v('broken_up')], 'pbp', 1, 1); }
        break;
      case 'drop': case 'fingertips': P.said.incomplete = 'drop'; call([this.v('dropped')], 'pbp', 1, 1); break;
      case 'flag': if (e.live) call([this.v('flag')], 'pbp', 1, 1.5); break;
      case 'kick':
        if (e.kind === 'kickoff' && this.rand() < 0.7) call([this.v('kickoff')], 'pbp', 0, 1);
        else if (e.kind === 'fg') call([this.v('fg_up')], 'pbp', 1, 1);
        else if (e.kind === 'punt' && this.rand() < 0.6) call([this.name(sim, e.kicker), this.v('punt')], 'pbp', 0, 1);
        break;
      case 'result': this.result(e, m, sim, call); break;
      case 'message': this.message(e, m, teams, call); break;
      case 'playcall': this.between(m, call); break;
      default: break;
    }
    return out;
  }

  /**
   * Every frame of a live play: the breakaway call. Once the carrier is a few yards past the line with nobody near him:
   * "he's got room!", then the yard lines counting down to the goal line (40, 30, 20, 10), "he's gonna score!" when he's
   * clear and close.
   */
  tick(sim) {
    const out = [];
    if (!sim || sim.state !== 'live' || sim.isKick && !sim.kick?.launched) return out;
    const b = sim.ball;
    if (b.state !== 'held' || b.carrier < 0) return out;
    const c = sim.players[b.carrier];
    if (!c || c.state !== 'active') return out;
    const P = this.play || (this.play = { said: {} });
    const td = sim.teamDir(c.team);
    const toGoal = GOAL_X - c.x * td;
    const gained = (c.x - sim.losX) * td * (c.team === sim.offIdx ? 1 : -1);
    let near = 99;
    for (const d of sim.players) {
      if (d.team === c.team || d.state !== 'active') continue;
      const ahead = (d.x - c.x) * td > -2; // behind him and chasing doesn't stop him being "loose"
      const dd = Math.hypot(d.x - c.x, d.z - c.z);
      if (ahead && dd < near) near = dd;
    }
    const ret = sim.isKick || sim.possTeam !== sim.offIdx; // a return: no line of scrimmage to measure from
    if (!P.said.room && (ret ? near > 9 : gained > 10 && near > 6) && toGoal > 15) {
      P.said.room = true; P.loose = true;
      out.push({ parts: [this.v('room')].filter(Boolean), who: 'pbp', pri: 1, ttl: 0.7 });
    }
    if (P.loose) {
      for (const n of [40, 30, 20, 10]) {
        if (toGoal < n && toGoal > n - 6 && !P.said[`c${n}`] && near > 3) {
          P.said[`c${n}`] = true;
          out.push({ parts: [this.clip(`count_${n}`)].filter(Boolean), who: 'pbp', pri: 1, ttl: 0.5 });
        }
      }
      if (!P.said.score && toGoal < 25 && near > 9) { P.said.score = true; out.push({ parts: [this.v('gonna_score')].filter(Boolean), who: 'pbp', pri: 1, ttl: 0.7 }); }
    }
    return out.filter((x) => x.parts.length);
  }

  /** After the whistle: the gain or the stop (unless a big call covered it), first down. */
  result(e, m, sim, call) {
    const r = e.result;
    const P = this.play || { said: {} };
    this.sinceColor++;
    if (!r || !sim) return;
    const y = Math.round(r.yards || 0);
    this.lastPlay = r.touchdown !== null && r.touchdown !== undefined ? 'td' : r.interception ? 'int' : r.fumbleLost ? 'fumble' : r.sack ? 'sack'
      : r.kickType === 'fg' ? (r.fgGood ? 'fg' : 'fg_miss') : r.kickType === 'punt' ? 'punt' : r.kickType ? 'kick'
      : r.incomplete ? (P.said.incomplete === 'drop' ? 'drop' : P.said.incomplete === 'breakup' ? 'breakup' : 'inc')
      : y >= 20 ? (r.complete ? 'big_catch' : 'big_run') : y <= 0 ? 'stop' : 'gain';
    if (e.outcome?.accepted) return;
    if (P.big === 'td' || P.big === 'int' || (P.big === 'fumble' && r.fumbleLost)) return;
    if (r.kickType === 'fg') { call([this.v(r.fgGood ? 'fg_good' : 'fg_no')], 'pbp', 2, 2); return; }
    if (r.kickType) { if (r.touchback) call([this.v('touchback')], 'pbp', 0, 2); else if (r.reason === 'fairCatch') call([this.v('fair_catch')], 'pbp', 0, 2); return; }
    if (r.safety) { call([this.v('safety')], 'pbp', 2, 2); return; }
    if (r.sack) { const nm = this.name(sim, r.tackler); call([this.v('sack'), nm ? this.v('sack_by') : null, nm], 'pbp', 2, 2); return; }
    if (r.incomplete) {
      if (!P.said.incomplete) call(this.rand() < 0.4 && r.target !== null && r.target !== undefined && this.name(sim, r.target) ? [this.v('incomplete'), this.v('intended_for'), this.name(sim, r.target)] : [this.v('incomplete')], 'pbp', 1, 2);
      return;
    }
    const first = m && m.down === 1 && m.possession === r.offTeam && y > 0 && m.phase === 'scrimmage';
    const parts = [];
    if (y > 0) parts.push(this.v('gain_of'), this.yards(y));
    else if (y === 0) parts.push(this.v('no_gain'));
    else parts.push(this.v('loss_of'), this.yards(-y));
    if (r.outOfBounds && y > 0 && this.rand() < 0.6) parts.push(this.v('out_of_bounds'));
    if (first) parts.push(this.v('first_down'));
    // A short run with nothing said yet gets the runner's name up front ("Sutton… for a gain of four").
    if (!P.said.catch && !P.said.room && r.rusher !== null && r.rusher !== undefined && y > 0 && this.rand() < 0.5) parts.unshift(this.name(sim, r.rusher));
    if (y <= 0 && this.rand() < 0.5) parts.unshift(this.v('stopped'));
    call(parts, 'pbp', 1, 2.2);
  }

  message(e, m, teams, call) {
    const k = e.kind;
    if (k === 'twoMinute') call([this.v('two_minute')], 'pbp', 1, 3);
    else if (k === 'timeout') call([this.v('timeout')], 'pbp', 0, 3);
    else if (k === 'half' && /half/i.test(String(e.text || ''))) call([this.v('half')], 'pbp', 1, 3);
    else if (k === 'final' && m) {
      const w = m.score[0] === m.score[1] ? null : m.score[0] > m.score[1] ? 0 : 1;
      call([this.v('final'), w !== null ? this.team(teams?.[w]) : null, w !== null && this.team(teams?.[w]) ? this.v('win') : null], 'pbp', 2, 4);
    }
  }

  /** The analyst between plays: a reaction to a big play first, else the situation, else now and then a general word. */
  between(m, call) {
    if (!m || m.over || m.phase === 'kickoff' || m.phase === 'try') return;
    const off = m.possession, lead = m.score[off] - m.score[1 - off];
    const say = (k, pri = 0) => { const id = this.v(`c_${k}`); if (id) { call([id], 'color', pri, 6); this.sinceColor = 0; return true; } return false; };
    const lp = this.lastPlay;
    this.lastPlay = null;
    const react = { td: 'after_td', int: 'after_int', sack: 'after_sack', big_run: 'after_big_run', big_catch: 'after_big_catch', drop: 'after_drop', breakup: 'after_breakup', punt: 'after_punt', fg: 'after_fg' }[lp];
    if (react && this.rand() < (lp === 'td' || lp === 'int' ? 0.85 : 0.55) && say(react, 1)) return;
    if (lp === 'stop' && this.rand() < 0.25 && say('after_stop')) return;
    if (m.down === 4 && m.yardLine >= 55 && this.rand() < 0.6 && say('fourth', 1)) return;
    if (m.yardLine >= 97 && this.rand() < 0.6 && say('goal_line', 1)) return;
    if (m.down === 3 && m.toGo >= 8 && this.rand() < 0.45 && say('third_long')) return;
    if (m.down === 3 && m.toGo <= 2 && this.rand() < 0.45 && say('third_short')) return;
    if (m.yardLine >= 80 && m.down === 1 && this.rand() < 0.4 && say('red_zone')) return;
    if (m.quarter >= 4 && m.clock < 300 && Math.abs(lead) <= 8 && this.rand() < 0.4 && say(lead < 0 ? 'late_trailing' : lead > 0 ? 'late_leading' : 'late_tied')) return;
    if (this.sinceColor < 4 || this.rand() < 0.5) return;
    if (Math.abs(lead) >= 17 && say(lead > 0 ? 'blowout_leading' : 'blowout_trailing')) return;
    say(pickOf(this.rand, ['drive_moving', 'defense_good', 'qb_good', 'general', 'general']));
  }
}

const pickOf = (r, a) => a[Math.floor(r() * a.length) % a.length];
