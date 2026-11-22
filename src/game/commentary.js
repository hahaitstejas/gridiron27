// Commentary brain (pure logic, no audio): turns session / sim events and the match state into lines for a two-man
// booth: `pbp` (play-by-play, during and right after the play) and `color` (the analyst, between plays). The voice
// layer (audio/voice.js) speaks them. It has its own little random generator so it never touches the game's seeded RNG
// (replays and the autosim stay deterministic). Our own booth: no real announcers' lines or catchphrases.

const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const ord = (n) => ['', 'first', 'second', 'third', 'fourth'][n] || `${n}th`;

/** Last name of sim player i ("M. Sutton" → "Sutton"). */
function lastName(sim, i) {
  const p = sim?.players?.[i];
  if (!p) return null;
  const n = String(p.name || '');
  return n.includes('. ') ? n.split('. ').slice(1).join(' ') : n || `number ${p.number}`;
}

const yardsText = (y) => {
  const n = Math.round(Math.abs(y));
  if (n === 0) return 'no gain';
  if (n === 1) return y < 0 ? 'a loss of one' : 'a yard';
  return y < 0 ? `a loss of ${n}` : `${n} yards`;
};

export class Commentary {
  constructor(seed = 7) {
    let s = seed >>> 0 || 7;
    this.rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    this.lastSaid = {}; // line text -> time said (no repeats for a while)
    this.t = 0;
    this.bigThisPlay = false;
    this.playsSinceColor = 0;
  }

  /** Pick a line from a pool, avoiding ones said in the last ~3 minutes when possible. */
  choose(pool) {
    const fresh = pool.filter((l) => !(this.lastSaid[l] > this.t - 180));
    const line = pick(this.rand, fresh.length ? fresh : pool);
    this.lastSaid[line] = this.t;
    return line;
  }

  /**
   * One session event (main.js onSessionEvent) → lines to say: [{ who: 'pbp' | 'color', text, pri }], pri 2 = cut in
   * (touchdown, turnover), 1 = normal, 0 = filler (dropped if the booth is busy).
   */
  onEvent(e, { match: m, sim, teams, now = 0 }) {
    this.t = now;
    const out = [];
    const say = (who, pool, pri = 1) => { const text = this.choose(Array.isArray(pool) ? pool : [pool]); if (text) out.push({ who, text, pri }); };
    const team = (t) => teams?.[t]?.name || 'the offense';
    const nm = (i) => lastName(sim, i);
    switch (e.type) {
      case 'snap': this.bigThisPlay = false; break;
      case 'throw': {
        if (sim?.isKick) break;
        const qb = nm(e.qb);
        const deep = (e.T ?? sim?.ball?.T ?? 0) > 1.6;
        if (this.rand() < (deep ? 0.9 : 0.45)) say('pbp', deep
          ? [`${qb} lets it fly`, `${qb} goes deep`, 'Here comes the deep ball', `${qb} airs it out`]
          : [`${qb} throws`, `${qb} fires`, 'Quick throw', `${qb} looking, throws`], 0);
        break;
      }
      case 'interception': this.bigThisPlay = true; say('pbp', [`Intercepted! ${nm(e.player)} picks it off!`, `Picked off! ${nm(e.player)} has it!`, `It's intercepted by ${nm(e.player)}!`], 2); break;
      case 'fumble': this.bigThisPlay = true; say('pbp', ['The ball is out!', 'Fumble!', `${nm(e.player)} coughs it up!`, 'Loose ball!'], 2); break;
      case 'recovery': if (sim && e.team !== sim.offIdx) say('pbp', [`Recovered by ${nm(e.player)}!`, `And ${team(e.team)} come up with it!`, `${nm(e.player)} falls on it!`], 2); break;
      case 'touchdown': {
        this.bigThisPlay = true;
        const who = sim?.ball?.carrier >= 0 ? nm(sim.ball.carrier) : null;
        say('pbp', [`Touchdown, ${team(e.team ?? sim?.possTeam)}!`, who ? `${who}, touchdown!` : 'Touchdown!', who ? `${who} is in! Touchdown!` : 'He is in! Touchdown!', 'Into the end zone! Touchdown!'], 2);
        break;
      }
      case 'deflection': if (sim && sim.players[e.player]?.team !== sim.possTeam && this.rand() < 0.7) say('pbp', [`Broken up by ${nm(e.player)}`, `${nm(e.player)} knocks it away`, `Good coverage by ${nm(e.player)}`], 1); break;
      case 'drop': say('pbp', [`Dropped by ${nm(e.player)}`, `${nm(e.player)} can't hang on`, 'Right through his hands'], 1); break;
      case 'fingertips': say('pbp', [`Off the fingertips of ${nm(e.player)}`, `Just out of reach for ${nm(e.player)}`], 1); break;
      case 'bigHit': if (this.rand() < 0.6) say('color', ['What a hit!', 'Oh, he got popped!', 'That one you could hear from up here'], 0); break;
      case 'brokenTackle': if (this.rand() < 0.4) say('pbp', [`${nm(e.player)} breaks a tackle`, `Still on his feet, ${nm(e.player)}`], 0); break;
      case 'flag': if (e.live || e.presnap) say('pbp', ['Flag on the play', 'There is a flag down', 'Yellow flag on the field'], 1); break;
      case 'result': this.result(e, m, sim, teams, say); break;
      case 'message': this.message(e, m, teams, say); break;
      case 'playcall': this.between(m, sim, teams, say); break;
      default: break;
    }
    return out;
  }

  /** The play's summary line (play-by-play), unless a big call already covered it. */
  result(e, m, sim, teams, say) {
    const r = e.result;
    if (!r || !sim) return;
    if (e.outcome?.accepted) { say('pbp', [`That one comes back on the penalty`, `The flag wipes it out`], 1); return; }
    const nm = (i) => (i === null || i === undefined ? null : lastName(sim, i));
    const first = !r.kickType && m && m.down === 1 && m.possession === r.offTeam && (r.yards || 0) > 0 && r.touchdown === null;
    const fd = first ? pick(this.rand, [', and that is a first down', ', first down', ', moving the chains']) : '';
    if (this.bigThisPlay && (r.touchdown !== null || r.interception || r.fumbleLost)) return;
    if (r.kickType === 'fg') { say('pbp', r.fgGood ? ['The kick is good!', 'Right down the middle, it is good!', 'And that one is good'] : ['No good!', 'The kick is no good', 'Wide, no good'], 1); return; }
    if (r.kickType === 'punt') { if (this.rand() < 0.5) say('pbp', r.touchback ? ['Into the end zone for a touchback'] : r.reason === 'fairCatch' ? ['Fair catch called'] : ['The punt is fielded and brought down'], 0); return; }
    if (r.kickType === 'kickoff') { if (r.touchback) say('pbp', ['Touchback'], 0); else if (r.kickShort) say('pbp', ['That one comes down short of the landing zone, ball at the forty'], 0); return; }
    if (r.kickType) return;
    const y = r.yards || 0, big = y >= 20;
    if (r.sack) { say('pbp', [`${nm(r.tackler) || 'He'} gets home! Sack!`, `Sacked by ${nm(r.tackler) || 'the defense'}, ${yardsText(y)}`, `${nm(r.passer) || 'The quarterback'} is taken down, ${yardsText(y)}`], 1); return; }
    if (r.interception || r.fumbleLost) { say('pbp', ['Turnover', 'And the defense takes it away'], 1); return; }
    if (r.incomplete) {
      if (this.rand() < 0.75) say('pbp', [r.receiver === null && r.target !== null ? `Incomplete, intended for ${nm(r.target)}` : 'Incomplete', 'Falls incomplete', 'Pass is incomplete', 'Nobody there, incomplete'], 1);
      return;
    }
    if (r.passAttempt && r.complete) {
      const qb = nm(r.passer), rec = nm(r.receiver);
      say('pbp', big
        ? [`${qb} finds ${rec}, big gain! ${yardsText(y)}${fd}`, `${rec} makes the catch and he's got room! ${yardsText(y)}`, `Huge play, ${rec}, ${yardsText(y)}${fd}`]
        : [`${qb} to ${rec}, ${yardsText(y)}${fd}`, `Caught by ${rec} for ${yardsText(y)}${fd}`, `${rec} hauls it in, ${yardsText(y)}${fd}`, `Complete to ${rec}${fd}`], 1);
      return;
    }
    const runner = nm(r.rusher ?? r.carrierId);
    if (runner) {
      const pool = y <= 0
        ? [`${runner} is stopped, ${yardsText(y)}`, `Nothing there for ${runner}`, `${runner} is met in the backfield`]
        : big ? [`${runner} breaks free! ${yardsText(y)}${fd}`, `Look at ${runner} go! ${yardsText(y)}`, `${runner} into the open field, ${yardsText(y)}${fd}`]
          : [`${runner} for ${yardsText(y)}${fd}`, `${runner} picks up ${yardsText(y)}${fd}`, `${runner} up the middle, ${yardsText(y)}${fd}`, `${runner} gets ${yardsText(y)}${fd}`];
      if (r.outOfBounds && y > 0) pool.push(`${runner} gets ${yardsText(y)} and steps out of bounds`);
      say('pbp', pool, 1);
    }
  }

  /** Game messages (two-minute warning, halftime, timeouts, the final). */
  message(e, m, teams, say) {
    const k = e.kind, t = String(e.text || '');
    if (k === 'twoMinute') say('pbp', ["We're at the two-minute warning", 'Two minutes to go'], 1);
    else if (k === 'timeout' && e.team !== undefined) say('pbp', [`Timeout, ${teams?.[e.team]?.name || ''}`, `${teams?.[e.team]?.name || 'They'} use a timeout, ${e.left} left`], 1);
    else if (k === 'half' && /half/i.test(t)) say('color', ["That's the half. Plenty to talk about", "We'll take a breather. What a first half"], 1);
    else if (k === 'final' && m) {
      const w = m.score[0] === m.score[1] ? null : m.score[0] > m.score[1] ? 0 : 1;
      say('pbp', w === null ? ["That's the ballgame, and it ends in a tie"] : [`That's the ballgame! ${teams?.[w]?.name} win it, ${Math.max(...m.score)} to ${Math.min(...m.score)}`, `Final here: ${teams?.[w]?.name} ${Math.max(...m.score)}, ${teams?.[1 - w]?.name} ${Math.min(...m.score)}`], 2);
    }
  }

  /** The analyst between plays: the situation, a player's day, the score. About one play in three. */
  between(m, sim, teams, say) {
    if (!m || m.over) return;
    this.playsSinceColor++;
    const off = m.possession, name = (t) => teams?.[t]?.name || '';
    const lead = m.score[off] - m.score[1 - off];
    const q = m.quarter, clock = m.clock;
    if (m.phase === 'kickoff' || m.phase === 'try') return;
    // Situations that always get a word.
    if (m.down === 4 && this.rand() < 0.8) { say('color', m.yardLine >= 60 ? [`Fourth down. Do ${name(off)} kick it or go for it here?`, 'Big decision on fourth down'] : [`Fourth down for ${name(off)}`, 'Fourth down here', `${name(1 - off)} get a stop on third down`], 1); this.playsSinceColor = 0; return; }
    if (m.down === 3 && m.toGo >= 8 && this.rand() < 0.5) { say('color', [`Third and long. ${name(1 - off)} can bring the heat here`, 'Third and long, a big down for this defense', 'They need a chunk play here on third down'], 1); this.playsSinceColor = 0; return; }
    if (m.down === 3 && m.toGo <= 2 && this.rand() < 0.5) { say('color', ['Third and short. Run it or throw it?', 'Short yardage. This is where you find out about your offensive line'], 1); this.playsSinceColor = 0; return; }
    if (m.yardLine >= 80 && this.rand() < 0.35) { say('color', [`${name(off)} are in the red zone`, 'Inside the twenty. Points are a must here', 'The field gets tight down here'], 1); this.playsSinceColor = 0; return; }
    if (q >= 4 && clock < 300 && Math.abs(lead) <= 8 && this.rand() < 0.45) { say('color', lead < 0 ? [`${name(off)} need a score, and time is running out`, 'The clock is the enemy now'] : lead > 0 ? [`${name(off)} want to burn some clock here`, 'A first down here and they can just about put it away'] : ['Tied game, late. Every snap matters now'], 1); this.playsSinceColor = 0; return; }
    if (this.playsSinceColor < 3 || this.rand() < 0.55) return;
    this.playsSinceColor = 0;
    // A player's day so far.
    const st = Object.values(m.stats.players);
    const roster = (t, rid) => m.teams[t]?.roster?.find((p) => p.id === rid);
    const qb = st.filter((s) => s.team === off && s.passAtt >= 5).sort((a, b) => b.passAtt - a.passAtt)[0];
    const back = st.filter((s) => s.team === off && s.rushAtt >= 5).sort((a, b) => b.rushYds - a.rushYds)[0];
    const wr = st.filter((s) => s.team === off && s.rec >= 3).sort((a, b) => b.recYds - a.recYds)[0];
    const opts = [];
    if (qb) { const p = roster(off, qb.rid); if (p) opts.push(`${p.last} is ${qb.passCmp} of ${qb.passAtt} today for ${Math.round(qb.passYds)} yards`); }
    if (back && back.rushYds >= 40) { const p = roster(off, back.rid); if (p) opts.push(`${p.last} has been running hard, ${Math.round(back.rushYds)} yards on ${back.rushAtt} carries`); }
    if (wr && wr.recYds >= 40) { const p = roster(off, wr.rid); if (p) opts.push(`${p.last} has ${wr.rec} catches for ${Math.round(wr.recYds)} yards. He's their go-to guy today`); }
    if (Math.abs(lead) >= 14) opts.push(lead > 0 ? `${name(off)} are in full control of this one` : `${name(off)} have some work to do`);
    if (lead === 0 && m.score[0] > 0) opts.push('All square in this one');
    opts.push(`${ord(m.down)} and ${m.toGo <= 0.5 ? 'inches' : Math.round(m.toGo)}`);
    say('color', opts, 0);
  }
}
