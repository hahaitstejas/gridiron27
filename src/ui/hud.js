import { KEY_HELP } from '../input/keyboard.js';
import { logoDataURL } from '../render/logo.js';
import { downText, yardLineText, clockText } from '../game/match.js';
import { METER } from '../sim/kicking.js';

const ICON_COLORS = { A: '#3fbf3f', B: '#e0403a', X: '#3a7be0', Y: '#e8c32c', RB: '#9aa0a8' };
const Q = ['', '1st', '2nd', '3rd', '4th', 'OT'];

/** In-game overlays: score bug, banners, penalty flags, ticker, receiver icons, kick meter, help, FPS. */
export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="scorebug" class="hidden"></div>
      <div id="playname" class="hidden"></div>
      <div id="hint" class="hidden"></div>
      <div id="icons"></div>
      <div id="tags"><div class="tag me"></div><div class="tag other"></div></div>
      <div id="banner" class="hidden"><div class="big"></div><div class="small"></div></div>
      <div id="intro" class="hidden"></div><div id="halfcard" class="hidden"></div><div id="pbp" class="hidden"><span class="pb-tag"></span><span class="pb-text"></span></div><div id="flagbox" class="hidden"><div class="fb-head"><span class="fb-chip">FLAG</span><span class="fb-ref">REFEREE ANNOUNCEMENT</span></div><div class="fb-foul"></div><div class="flagtext"></div></div>
      <div id="ticker"></div>
      <div id="callout"></div>
      <div id="statcard" class="hidden"></div>
      <div id="audible" class="hidden"></div>
      <div id="penaltybox" class="hidden"></div>
      <div id="replay" class="hidden"><div class="rp-badge">REPLAY</div><div class="rp-bar"><div class="rp-fill"></div></div><div class="rp-help"></div></div>
      <div id="kickmeter" class="hidden"><div class="km-bar"><div class="km-fill"></div><div class="km-zone"></div><div class="km-needle"></div></div><div class="km-label">KICK</div></div>
      <div id="help" class="hidden"></div>
      <div id="fps"></div>
      <div id="playcall" class="hidden"></div>`;
    this.$ = (id) => root.querySelector('#' + id);
    this.icons = {};
    for (const b of Object.keys(ICON_COLORS)) {
      const d = document.createElement('div');
      d.className = 'icon';
      d.textContent = b;
      d.style.background = ICON_COLORS[b];
      this.$('icons').appendChild(d);
      this.icons[b] = d;
    }
    this.buildHelp();
    this.fpsAcc = 0; this.fpsN = 0; this.fpsShow = false;
    this.bannerT = 0; this.flagT = 0; this.statT = 0;
    this._logos = new Map();
  }

  buildHelp() {
    const pad = [
      ['Pre-snap', 'A snap · X audible · Y hot route (receiver button, then stick) · RB motion (receiver button, then stick) · View timeout · (defense) B switch player, X audible, LB coverage (press / off / shade)'],
      ['Play call', 'LB/RB tabs · A select · B back · X flip play · View timeout'],
      ['Passing', 'Receiver icons A B X Y RB · tap = lob, hold = bullet · hold LB high / LT low · left stick leads · LS click pump fake · RS click throw away'],
      ['Pass rush (engaged with a blocker)', 'A bull rush (strength) · X swim · Y spin · RS↓ rip (finesse: pass rush, agility) · hold the stick toward the ball for leverage'],
      ['Ball carrier', 'RT sprint · A stiff arm · B spin · X dive/slide · Y hurdle · RS ←/→ juke · RS ↑ truck · RB protect · LB pitch (speed option) · hold LT at the mesh to keep (zone read)'],
      ['At the line (offense)', 'A snap · X audible · Y hot route · RB motion · LT hard count (may draw the defense offside: a free play) · B spike'],
      ['Catching (ball in the air)', 'Y aggressive catch (wins in traffic, no run after) · X run after catch (turns upfield, riskier) · B possession (sure hands, feet in at the sideline)'],
      ['Defense', 'B switch player · RT sprint · A swat · Y with the ball in the air: go for the pick · X dive tackle · Y strip · RS ↑ hit stick · RS ←→↑ rush moves when blocked'],
      ['Kicking', 'A start meter · A set power · A set accuracy (near the line) · left stick aims'],
      ['Returns', 'Y fair catch (punts) · X kneel in the end zone'],
      ['Instant replay', 'RS click between plays (or pause menu) · A play/pause · X slow-mo · left stick scrub · right stick camera · LT/RT zoom · B exit'],
    ];
    this.$('help').innerHTML = `<h2>Controls</h2>
      <table>${pad.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <h3>Keyboard</h3><table>${KEY_HELP.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <p class="tiny">H toggles this panel · \` toggles FPS</p>`;
  }

  /** Halftime: the two teams side by side (yards, passing, rushing, first downs, third downs, turnovers, possession). */
  halfCard(session) {
    const m = session.match, [h, a] = m.teams, S = m.stats.team;
    const top = (t) => clockText(S[t].top || 0);
    const rows = [['Total yards', (s) => Math.round(s.yards)], ['Passing', (s) => `${s.passCmp}/${s.passAtt}, ${Math.round(s.passYds)}`], ['Rushing', (s) => `${s.rushAtt}-${Math.round(s.rushYds)}`],
      ['First downs', (s) => s.firstDowns], ['Third downs', (s) => `${s.thirdConv}/${s.thirdAtt}`], ['Turnovers', (s) => s.turnovers], ['Penalties', (s) => `${s.penalties}-${s.penYds}`]];
    const el = this.$('halfcard');
    el.innerHTML = `<div class="hc-head"><span style="--tc:${a.colors.primary}"><img src="${this.logoFor(a)}">${a.abbr} <b>${m.score[1]}</b></span><em>HALFTIME</em><span style="--tc:${h.colors.primary}"><b>${m.score[0]}</b> ${h.abbr}<img src="${this.logoFor(h)}"></span></div>` +
      rows.map(([l, f]) => `<div class="hc-row"><b>${f(S[1])}</b><span>${l}</span><b>${f(S[0])}</b></div>`).join('') +
      (S[0].top !== undefined ? `<div class="hc-row"><b>${top(1)}</b><span>Possession</span><b>${top(0)}</b></div>` : '');
    el.classList.remove('hidden');
    this.halfT = 7;
  }

  /** Play-by-play strip above the scorebug (tag: PLAY / DRIVE). A drive summary isn't replaced by the next play line. */
  pbp(tag, text, secs = 4, drive = false) {
    if (!drive && this.pbpDrive > 0) return;
    const el = this.$('pbp');
    el.querySelector('.pb-tag').textContent = tag;
    el.querySelector('.pb-text').textContent = text;
    el.classList.toggle('drive', drive);
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    this.pbpT = secs;
    this.pbpDrive = drive ? secs : 0;
  }

  /** Pregame lower-third: matchup, records, league, conditions (null hides it). */
  intro(info) {
    const el = this.$('intro');
    if (!info) { el.classList.add('hidden'); return; }
    const team = (t, rec) => `<div class="in-team" style="--tc:${t.colors.primary}"><img src="${this.logoFor(t)}"><div><small>${t.city}</small><b>${t.name}</b>${rec ? `<i>${rec}</i>` : ''}</div></div>`;
    el.innerHTML = `<div class="in-top">${info.title}</div><div class="in-row">${team(info.away, info.recs?.[1])}<div class="in-at">AT</div>${team(info.home, info.recs?.[0])}</div>
      <div class="in-sub">${info.sub}</div><div class="in-skip"><b class="btn A">A</b> Skip</div>`;
    el.classList.remove('hidden');
  }

  toggleHelp(force) { this.$('help').classList.toggle('hidden', force === undefined ? undefined : !force); }
  hideAll() { for (const id of ['scorebug', 'playname', 'hint', 'banner', 'flagbox', 'intro', 'pbp', 'halfcard', 'kickmeter', 'statcard', 'audible', 'penaltybox']) this.$(id).classList.add('hidden'); for (const i of Object.values(this.icons)) i.style.display = 'none'; for (const t of this.root.querySelectorAll('.tag')) t.style.display = 'none'; this.$('ticker').innerHTML = ''; }

  logoFor(team) {
    const l = team.logo;
    const key = [team.id, l.shape, l.text, l.bg, l.fg, l.border, l._img ? l._img.src.length + l._img.src.slice(-16) : ''].join('|');
    if (!this._logos.has(key)) this._logos.set(key, logoDataURL(team.logo, 64));
    return this._logos.get(key);
  }

  /** Show a match/session message as banner, flag, or ticker line. */
  message(msg, session) {
    const k = msg.kind;
    if (k === 'score') {
      const what = session.match.lastScore?.what || 'Score';
      const big = /touchdown|pick six/i.test(what) ? (/pick six/i.test(what) ? 'PICK SIX!' : 'TOUCHDOWN!') : /field goal/i.test(what) ? 'FIELD GOAL' : /safety/i.test(what) ? 'SAFETY' : /PAT/.test(what) ? 'EXTRA POINT' : /2-point/.test(what) ? 'TWO-POINT CONVERSION' : what.toUpperCase();
      this.banner(big, msg.text.replace(/^[^!]*!\s*/, ''), 2.6, 'score');
    } else if (k === 'turnover') this.banner(/Intercept/.test(msg.text) ? 'INTERCEPTED!' : /downs/.test(msg.text) ? 'TURNOVER ON DOWNS' : 'FUMBLE!', msg.text, 2.4, 'turnover');
    else if (k === 'penalty') this.flag(msg.text);
    else if (k === 'miss') this.banner('NO GOOD', msg.text, 2, 'miss');
    else if (k === 'drive') this.pbp('DRIVE', msg.text.replace(/^\w+ drive: /, `${msg.text.split(' ')[0]} · `), 5, true);
    else if (k === 'injury') this.banner('INJURY', msg.text.replace(/^Injury: /, ''), 2.6, 'miss');
    else if (k === 'final') this.banner('FINAL', msg.text, 99, 'final');
    else if (k === 'half' || k === 'twoMinute') {
      if (k === 'half' && /half/i.test(msg.text) && !session.practice) { this.halfCard(session); return; } // the card has its own header
      this.banner(k === 'half' ? msg.text.split('!')[0].toUpperCase() : 'TWO-MINUTE WARNING', k === 'half' ? msg.text : '', 2.4, 'info');
    } else this.ticker(msg.text);
  }

  banner(big, small, secs = 2.2, cls = '') {
    const b = this.$('banner');
    b.className = cls;
    b.querySelector('.big').textContent = big;
    b.querySelector('.small').textContent = small || '';
    b.classList.remove('hidden');
    this.bannerT = secs;
  }

  flag(text) {
    // "Holding, offense, #72. 10 yard penalty, repeat 3rd down" → foul name / who + enforcement, read out like the referee.
    const f = this.$('flagbox');
    const [first, ...rest] = text.split('. ');
    const [foul, ...who] = first.split(', ');
    f.querySelector('.fb-foul').textContent = foul;
    f.querySelector('.flagtext').textContent = [who.join(' '), rest.join('. ')].filter(Boolean).join(' · ');
    f.classList.toggle('declined', /declined/.test(text));
    f.classList.remove('hidden');
    f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
    this.flagT = 4.2;
  }

  placeTag(el, p, renderer, session) {
    if (!p) { el.style.display = 'none'; return; }
    const s = renderer.project(p.x, 0, p.z);
    if (!s.visible) { el.style.display = 'none'; return; }
    const text = `#${p.number} ${p.name}`;
    if (el.textContent !== text) el.textContent = text;
    el.style.borderColor = session.teams[p.team].colors.primary;
    el.style.display = 'block';
    // Never under the score bug at the bottom of the screen.
    const bugTop = this.$('scorebug').getBoundingClientRect().top || innerHeight;
    const y = Math.min(s.y + 10, bugTop - 30);
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(y)}px) translateX(-50%)`;
  }

  /** Instant replay overlay (null hides it). */
  replayView(r) {
    const el = this.$('replay');
    if (!r) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.rp-fill').style.width = `${(100 * r.t) / Math.max(0.01, r.duration)}%`;
    const help = r.auto ? `<b class="btn A">A</b> / <b class="btn B">B</b> Skip replay` : `<b class="btn A">A</b> ${r.playing ? 'Pause' : 'Play'} &nbsp; <b class="btn X">X</b> ${r.speed < 1 ? 'Normal speed' : 'Slow-mo'} &nbsp; <b class="btn Y">Y</b> Restart &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> Angle: ${r.angle || 'Broadcast'} &nbsp; Left stick ◀▶ scrub &nbsp; Right stick camera &nbsp; LT/RT zoom &nbsp; <b class="btn B">B</b> Exit`;
    const h = el.querySelector('.rp-help');
    if (h.dataset.v !== help) { h.dataset.v = help; h.innerHTML = help; }
  }

  /** Post-play card: the players who made the play and their totals this game. */
  statCard(lines, teams) {
    const el = this.$('statcard');
    if (!lines?.length || this.prefs?.statCard === false) { el.classList.add('hidden'); return; }
    el.innerHTML = '';
    for (const l of lines) {
      const t = teams[l.team];
      const row = document.createElement('div');
      row.className = 'sc-row';
      row.style.borderLeftColor = t.colors.primary;
      const who = document.createElement('div');
      who.className = 'sc-who';
      who.innerHTML = `<b></b><span></span>`;
      who.querySelector('b').textContent = `#${l.number} ${l.name}`;
      who.querySelector('span').textContent = `${t.abbr} ${l.pos}`;
      const line = document.createElement('div');
      line.className = 'sc-line';
      line.textContent = l.line;
      row.append(who, line);
      el.appendChild(row);
    }
    el.classList.remove('hidden');
    this.statT = 4;
  }

  /** Big quick call-out of what just happened to a pass (CAUGHT / INTERCEPTED / DROPPED / INCOMPLETE ...). */
  callout(word, sub, color = '#ffffff', ms = 1600) {
    const c = this.$('callout');
    c.innerHTML = `<div class="co-word" style="--cc:${color}">${word}</div>${sub ? `<div class="co-sub">${sub}</div>` : ''}`;
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    clearTimeout(this._coT);
    this._coT = setTimeout(() => c.classList.remove('show'), ms);
    this.calloutAt = performance.now();
  }

  ticker(text) {
    const t = this.$('ticker');
    const d = document.createElement('div');
    d.className = 'tick';
    d.textContent = text;
    t.prepend(d);
    setTimeout(() => d.remove(), 3500);
    while (t.children.length > 3) t.lastChild.remove();
  }

  /** Update everything that depends on the game state. */
  update(session, renderer, dt, frameMs, playcallOpen) {
    const m = session.match;
    const sim = session.sim;
    this.renderBug(session);
    if ((this.bannerT -= dt) <= 0) this.$('banner').classList.add('hidden');
    if ((this.flagT -= dt) <= 0) this.$('flagbox').classList.add('hidden');
    this.pbpDrive = Math.max(0, (this.pbpDrive || 0) - dt);
    if (this.halfT > 0 && (this.halfT -= dt) <= 0) this.$('halfcard').classList.add('hidden');
    if (this.pbpT > 0 && (this.pbpT -= dt) <= 0) this.$('pbp').classList.add('hidden');
    // Hide the stat card once the next play is snapped (or after a few seconds).
    if ((this.statT -= dt) <= 0 || (sim && sim.state === 'live' && session.state === 'live')) this.$('statcard').classList.add('hidden');

    const pre = session.state === 'presnap' && sim && sim.state === 'presnap' && !playcallOpen;
    const pn = this.$('playname');
    pn.classList.toggle('hidden', !pre || session.humanTeam === null);
    if (pre && session.humanTeam !== null) {
      const human = session.humanSide;
      const play = human === 'offense' ? sim.offPlay : sim.defPlay;
      const hot = play.hot ? Object.entries(play.hot).map(([s, r]) => `${s} ${r.replace('_', ' ')}`).join(', ') : '';
      pn.innerHTML = `<small>${human === 'offense' ? play.concept || 'Offense' : 'Defense'}</small><b>${play.name}</b>${hot ? `<em>Hot: ${hot}</em>` : ''}`;
    }
    const hint = this.$('hint');
    let h = '';
    const career = session.lock !== null && session.lock !== undefined && sim && sim.lockId >= 0 && !session.watching;
    if (pre && career && !session.calls(session.humanSide === 'offense' ? session.offTeam : session.defTeam)) {
      const me = sim.players[sim.lockId];
      h = `Career: you're <b>#${me.number} ${me.name || ''}</b> (${me.slot}) &nbsp; the CPU calls and snaps &nbsp; <b class="btn view">View</b> Timeout`;
    } else if (pre && session.humanSide === 'offense') {
      h = sim.isKick ? `<b class="btn A">A</b> Start kick meter &nbsp; Left stick: aim &nbsp; <b class="btn view">View</b> Timeout${windTag(sim)}`
        : `<b class="btn A">A</b> Snap &nbsp; <b class="btn B">B</b> Spike &nbsp; <b class="btn X">X</b> Audible &nbsp; <b class="btn Y">Y</b> Hot route &nbsp; ${sim.motion ? '' : '<b class="btn RB">RB</b> Motion &nbsp; '}${session.hardCounted || session.match.phase !== 'scrimmage' ? '' : '<b class="btn LT">LT</b> Hard count &nbsp; '}<b class="btn view">View</b> Timeout`;
    } else if (pre && session.humanSide === 'defense') h = `<b class="btn B">B</b> Switch player &nbsp; ${sim.isKick ? '' : '<b class="btn X">X</b> Audible &nbsp; <b class="btn Y">Y</b> Hot route &nbsp; <b class="btn LB">LB</b> Coverage &nbsp; '}<b class="btn view">View</b> Timeout${coverageTag(session.defAdj)}`;
    else if (sim && sim.state === 'live' && sim.kick && session.humanSide === 'defense' && sim.ball.state === 'kick') h = sim.kick.type === 'punt' ? `<b class="btn Y">Y</b> Fair catch &nbsp; <b class="btn X">X</b> Kneel in end zone` : `<b class="btn X">X</b> Kneel in end zone (touchback)`;
    else if (sim && sim.state === 'live' && session.humanSide === 'defense' && sim.players[sim.controlledId]?.engagement?.d === sim.players[sim.controlledId]) h = '<b class="btn A">A</b> Bull rush &nbsp; <b class="btn X">X</b> Swim &nbsp; <b class="btn Y">Y</b> Spin &nbsp; RS ↓ Rip';
    else if (sim && sim.state === 'live' && sim.ball.state === 'air' && !sim.kick && session.humanSide === 'offense' && sim.ball.intended === sim.controlledId) {
      const ct = sim.ball.catchType;
      const o = (btn, k, label) => `<b class="btn ${btn}">${btn}</b> ${ct === k ? `<u>${label}</u>` : label}`;
      h = `${o('Y', 'aggressive', 'Aggressive catch')} &nbsp; ${o('X', 'rac', 'Run after catch')} &nbsp; ${o('B', 'possession', 'Possession')}`;
    } else if (sim && sim.state === 'live' && sim.ball.state === 'air' && !sim.kick && session.humanSide === 'defense') h = '<b class="btn Y">Y</b> Go for the pick &nbsp; <b class="btn A">A</b> Swat';
    else if (sim && sim.meter && sim.state === 'live' && !sim.kick?.launched) h = sim.meter.phase === 'power' ? '<b class="btn A">A</b> Set power' : sim.meter.phase === 'accuracy' ? '<b class="btn A">A</b> Set accuracy — stop at the line!' : '';
    // Audible / hot route menus replace the hint.
    const au = this.$('audible');
    const a = pre ? session.audible : null;
    au.classList.toggle('hidden', !a);
    if (a) {
      const key = a.mode === 'menu' ? 'm' + a.options.map((o) => o.play.id).join() : a.mode + (a.slot || '');
      if (au.dataset.key !== key) {
        au.dataset.key = key;
        if (a.mode === 'menu') {
          au.innerHTML = `<div class="au-title">${session.humanSide === 'offense' ? 'Audible' : 'Defensive audible'}</div>` +
            a.options.map((o) => `<div class="au-row"><b class="btn ${o.btn}">${o.btn}</b><span>${o.label}</span><small>${o.play.name}</small></div>`).join('') +
            `<div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (a.mode === 'dhot') {
          au.innerHTML = `<div class="au-title">Hot route: ${a.name} (${a.slot})</div>` +
            a.options.map((o) => `<div class="au-row"><b class="btn ${o.btn}">${o.btn}</b><span>${o.label}</span></div>`).join('') +
            `<div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (a.mode === 'adjust') {
          au.innerHTML = `<div class="au-title">Coverage</div>` +
            a.options.map((o) => `<div class="au-row"><b class="btn ${o.btn}">${o.btn}</b><span>${o.label}</span></div>`).join('') +
            `<div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (a.mode === 'motion' && !a.slot) {
          au.innerHTML = `<div class="au-title">Motion</div><div class="au-row"><span>Press a receiver's button</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (a.mode === 'motion') {
          au.innerHTML = `<div class="au-title">Motion: ${a.slot}</div><div class="au-row"><b class="key">◀▶</b><span>Toward the ball: across · away: wider</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (!a.slot) {
          au.innerHTML = `<div class="au-title">Hot route</div><div class="au-row"><span>Press a receiver's button</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else {
          au.innerHTML = `<div class="au-title">Hot route: ${a.slot}</div>` +
            [['▲', 'Go'], ['▼', 'Hitch'], ['◀▶ in', 'Slant'], ['◀▶ out', 'Quick out']].map(([k, v]) => `<div class="au-row"><b class="key">${k}</b><span>${v}</span></div>`).join('') +
            `<div class="au-row"><b class="btn A">A</b><span>Block</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        }
      }
      h = '';
    } else au.dataset.key = '';
    hint.innerHTML = h;
    hint.classList.toggle('hidden', !h || playcallOpen);
    this.$('pbp').style.visibility = playcallOpen ? 'hidden' : '';

    // Accept / decline a penalty against the CPU.
    const pb = this.$('penaltybox');
    const pen = session.state === 'penalty' ? session.pendingPenalty : null;
    pb.classList.toggle('hidden', !pen);
    if (pen && pb.dataset.key !== pen.choice.name + pen.choice.accept) {
      pb.dataset.key = pen.choice.name + pen.choice.accept;
      const c = pen.choice;
      const me = session.teams[session.humanTeam];
      pb.innerHTML = `<div class="pb-head"><span>${c.name}</span><b>${c.yards} YDS</b></div>
        <div class="pb-opt"><b class="btn A">A</b><div><div class="pb-label">Accept${pen.recommend ? ' <small>recommended</small>' : ''}</div><div class="pb-sub">${c.accept}</div></div></div>
        <div class="pb-opt"><b class="btn X">X</b><div><div class="pb-label">Decline${pen.recommend ? '' : ' <small>recommended</small>'}</div><div class="pb-sub">${c.decline}</div></div></div>
        <div class="pb-foot"><span>Choose</span><img src="${this.logoFor(me)}" alt=""/></div>`;
    } else if (!pen) pb.dataset.key = '';

    // Name tags under the player you control and, if it's someone else, the ball carrier.
    const [tagMe, tagOther] = this.root.querySelectorAll('.tag');
    const showTags = sim && this.prefs?.nameTags !== false && session.humanTeam !== null && !playcallOpen && session.state !== 'playcall';
    const me = showTags ? sim.players[sim.controlledId] : null;
    const carrier = showTags && sim.state !== 'presnap' ? sim.carrier() : null;
    this.placeTag(tagMe, me && me.team === session.humanTeam ? me : null, renderer, session);
    this.placeTag(tagOther, carrier && carrier !== me ? carrier : null, renderer, session);

    // Receiver icons while the human QB can still throw.
    const showIcons = sim && !playcallOpen && sim.humanTeam === sim.offIdx && sim.offPlay.type === 'pass' && !sim.passThrown && !sim.qbCrossed && sim.state !== 'dead';
    for (const [btn, elx] of Object.entries(this.icons)) {
      const id = sim?.icons?.[btn];
      if (!showIcons || id === undefined) { elx.style.display = 'none'; continue; }
      const p = sim.players[id];
      const s = renderer.project(p.x, p.height + 0.25, p.z);
      elx.style.display = s.visible ? 'flex' : 'none';
      elx.style.transform = `translate(${s.x - 14}px, ${s.y - 30}px)`;
    }
    // Kick meter.
    const km = this.$('kickmeter');
    const meter = sim?.meter;
    const showMeter = meter && sim.isKick && (sim.state === 'presnap' || !sim.kick?.launched) && !playcallOpen;
    km.classList.toggle('hidden', !showMeter);
    if (showMeter) {
      const fill = meter.phase === 'power' ? meter.value : meter.power;
      km.querySelector('.km-fill').style.height = `${fill * 100}%`;
      const needle = meter.phase === 'accuracy' ? meter.needle : meter.phase === 'done' ? meter.accuracy + METER.accLine : -1;
      const nd = km.querySelector('.km-needle');
      nd.style.display = needle > -0.5 ? 'block' : 'none';
      nd.style.bottom = `${((needle - METER.floor) / (1 - METER.floor)) * 100}%`;
      km.querySelector('.km-zone').style.bottom = `${((METER.accLine - METER.floor) / (1 - METER.floor)) * 100}%`;
      km.querySelector('.km-bar').style.setProperty('--zero', `${((0 - METER.floor) / (1 - METER.floor)) * 100}%`);
      km.querySelector('.km-label').textContent = sim.offPlay.type === 'fg' ? `FG ${Math.round(Math.abs(60 * sim.dir - sim.losX)) + 7} yd` : sim.offPlay.name.toUpperCase();
    }
    // FPS
    this.fpsAcc += frameMs; this.fpsN++;
    if (this.fpsAcc > 500) {
      const fps = 1000 / (this.fpsAcc / this.fpsN);
      this.$('fps').textContent = this.fpsShow ? `${fps.toFixed(0)} fps · ${renderer.renderer.info.render.calls} draws · px ${renderer.pixelRatio.toFixed(2)}` : '';
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }

  renderBug(session) {
    const m = session.match;
    const bug = this.$('scorebug');
    bug.classList.remove('hidden');
    // A foul on the field shows right away (free play!); the call is explained after the whistle.
    const sim = session.sim;
    const flag = !m.over && (session.state === 'penalty' || ((session.state === 'live') && sim?.fouls?.length > 0));
    const recs = session.records || ['0-0', '0-0'];
    const key = [m.score, m.quarter, Math.ceil(m.clock), Math.ceil(m.playClock), m.down, Math.round(m.toGo), Math.round(m.yardLine), m.timeouts, m.possession, m.phase, m.over, m.kicker, flag, recs].join('|');
    if (key === this._bugKey) return;
    this._bugKey = key;
    // Full-width bar: brand | away logo | (rec) AWY • 0 × 0 HOM (rec) | home logo | quarter, clock, play clock | down & distance.
    const hasBall = (i) => (m.phase === 'kickoff' ? m.kicker !== i : m.possession === i) && !m.over;
    const logo = (i) => `<div class="sb3-logo" style="--tc:${m.teams[i].colors.primary};--tc2:${m.teams[i].colors.secondary}"><img src="${this.logoFor(m.teams[i])}" alt=""/></div>`;
    const name = (i, side) => {
      const bars = [0, 1, 2].map((k) => `<i class="${k < m.timeouts[i] ? 'on' : ''}"></i>`).join('');
      const rec = `<small>(${recs[i]})</small>`;
      const ab = `<span class="sb3-ab">${m.teams[i].abbr}<span class="sb3-to">${bars}</span></span>`;
      const dot = `<span class="sb3-dot${hasBall(i) ? ' on' : ''}">•</span>`;
      return side === 'away' ? `${rec}${ab}${dot}` : `${dot}${ab}${rec}`;
    };
    const ord = (q) => (q > 4 ? 'OT' : `${q}<sup>${['', 'st', 'nd', 'rd', 'th'][q]}</sup>`);
    const dd = m.over ? 'FINAL' : m.phase === 'scrimmage' ? downText(m).toUpperCase().replace(/(\d)(ST|ND|RD|TH)/, '$1<sup>$2</sup>') : downText(m).toUpperCase();
    const pc = m.over || m.phase !== 'scrimmage' ? '' : `<span class="sb3-pc${m.playClock <= 10 ? ' low' : ''}">:${String(Math.ceil(m.playClock)).padStart(2, '0')}</span>`;
    bug.innerHTML = `<div class="sb3">
      <div class="sb3-brand">GRIDIRON 27</div>
      ${logo(1)}
      <div class="sb3-mid">${name(1, 'away')}<b class="sb3-sc">${m.score[1]}</b><span class="sb3-x">×</span><b class="sb3-sc">${m.score[0]}</b>${name(0, 'home')}</div>
      ${logo(0)}
      <div class="sb3-clock">${m.over ? '' : `<span class="sb3-q">${ord(m.quarter)}</span><b>${clockText(m.clock)}</b>`}${pc}</div>
      <div class="sb3-dd${flag ? ' flag' : ''}">${flag ? 'FLAG' : dd}</div>
    </div>`;
  }
}

/** Small note of the defense's current coverage call, e.g. " · Press, inside". */
function coverageTag(adj) {
  if (!adj) return '';
  const parts = [adj.cover === 'press' ? 'Press' : adj.cover === 'off' ? 'Off' : '', adj.shade === 'in' ? 'inside' : adj.shade === 'out' ? 'outside' : ''].filter(Boolean);
  return parts.length ? ` &nbsp; <small>${parts.join(', ')}</small>` : '';
}

/** Wind for the kicker: speed and an arrow as seen from the camera. */
function windTag(sim) {
  const w = sim.wind;
  const mph = Math.round(Math.hypot(w.x, w.z) * 2.045);
  if (mph < 3) return '';
  const right = w.z * sim.camDir, up = w.x * sim.camDir;
  const arrows = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  const a = arrows[(Math.round(Math.atan2(up, right) / (Math.PI / 4)) + 8) % 8];
  return ` &nbsp; <b class="key">${a}</b> Wind ${mph} mph`;
}
