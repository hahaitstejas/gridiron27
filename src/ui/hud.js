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
      <div id="flagbox" class="hidden"><div class="flagtitle">FLAG</div><div class="flagtext"></div></div>
      <div id="ticker"></div>
      <div id="statcard" class="hidden"></div>
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
      ['Pre-snap', 'A snap · View timeout · (defense) B switch player'],
      ['Play call', 'LB/RB tabs · A select · B back · X flip play · View timeout'],
      ['Passing', 'Receiver icons A B X Y RB · tap = lob, hold = bullet · left stick leads · RS click throw away'],
      ['Ball carrier', 'RT sprint · A stiff arm · B spin · X dive/slide · Y hurdle · RS ←/→ juke · RS ↑ truck · RB protect'],
      ['Defense', 'B switch player · RT sprint · A swat · X dive tackle · Y strip · RS ↑ hit stick · RS ←→↑ rush moves when blocked'],
      ['Kicking', 'A start meter · A set power · A set accuracy (near the line) · left stick aims'],
      ['Returns', 'Y fair catch (punts) · X kneel in the end zone'],
    ];
    this.$('help').innerHTML = `<h2>Controls</h2>
      <table>${pad.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <h3>Keyboard</h3><table>${KEY_HELP.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <p class="tiny">H toggles this panel · \` toggles FPS</p>`;
  }

  toggleHelp(force) { this.$('help').classList.toggle('hidden', force === undefined ? undefined : !force); }
  hideAll() { for (const id of ['scorebug', 'playname', 'hint', 'banner', 'flagbox', 'kickmeter', 'statcard']) this.$(id).classList.add('hidden'); for (const i of Object.values(this.icons)) i.style.display = 'none'; for (const t of this.root.querySelectorAll('.tag')) t.style.display = 'none'; this.$('ticker').innerHTML = ''; }

  logoFor(team) {
    const key = team.id + team.logo.shape + team.logo.text + team.colors.primary;
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
    else if (k === 'final') this.banner('FINAL', msg.text, 99, 'final');
    else if (k === 'half' || k === 'twoMinute') this.banner(k === 'half' ? msg.text.split('!')[0].toUpperCase() : 'TWO-MINUTE WARNING', k === 'half' ? msg.text : '', 2.4, 'info');
    else this.ticker(msg.text);
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
    const f = this.$('flagbox');
    f.querySelector('.flagtext').textContent = text;
    f.classList.remove('hidden');
    this.flagT = 3.2;
  }

  placeTag(el, p, renderer, session) {
    if (!p) { el.style.display = 'none'; return; }
    const s = renderer.project(p.x, 0, p.z);
    if (!s.visible) { el.style.display = 'none'; return; }
    const text = `#${p.number} ${p.name}`;
    if (el.textContent !== text) el.textContent = text;
    el.style.borderColor = session.teams[p.team].colors.primary;
    el.style.display = 'block';
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y + 10)}px) translateX(-50%)`;
  }

  /** Post-play card: the players who made the play and their totals this game. */
  statCard(lines, teams) {
    const el = this.$('statcard');
    if (!lines?.length) { el.classList.add('hidden'); return; }
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
    // Hide the stat card once the next play is snapped (or after a few seconds).
    if ((this.statT -= dt) <= 0 || (sim && sim.state === 'live' && session.state === 'live')) this.$('statcard').classList.add('hidden');

    const pre = session.state === 'presnap' && sim && sim.state === 'presnap' && !playcallOpen;
    const pn = this.$('playname');
    pn.classList.toggle('hidden', !pre || session.humanTeam === null);
    if (pre && session.humanTeam !== null) {
      const human = session.humanSide;
      const play = human === 'offense' ? sim.offPlay : sim.defPlay;
      pn.innerHTML = `<small>${human === 'offense' ? play.concept || 'Offense' : 'Defense'}</small><b>${play.name}</b>`;
    }
    const hint = this.$('hint');
    let h = '';
    if (pre && session.humanSide === 'offense') {
      h = sim.isKick ? `<b class="btn A">A</b> Start kick meter &nbsp; Left stick: aim &nbsp; <b class="btn view">View</b> Timeout` : `<b class="btn A">A</b> Snap &nbsp; <b class="btn view">View</b> Timeout`;
    } else if (pre && session.humanSide === 'defense') h = `<b class="btn B">B</b> Switch player &nbsp; <b class="btn view">View</b> Timeout`;
    else if (sim && sim.state === 'live' && sim.kick && session.humanSide === 'defense' && sim.ball.state === 'kick') h = sim.kick.type === 'punt' ? `<b class="btn Y">Y</b> Fair catch &nbsp; <b class="btn X">X</b> Kneel in end zone` : `<b class="btn X">X</b> Kneel in end zone (touchback)`;
    else if (sim && sim.meter && sim.state === 'live' && !sim.kick?.launched) h = sim.meter.phase === 'power' ? '<b class="btn A">A</b> Set power' : sim.meter.phase === 'accuracy' ? '<b class="btn A">A</b> Set accuracy — stop at the line!' : '';
    hint.innerHTML = h;
    hint.classList.toggle('hidden', !h || playcallOpen);

    // Name tags under the player you control and, if it's someone else, the ball carrier.
    const [tagMe, tagOther] = this.root.querySelectorAll('.tag');
    const showTags = sim && session.humanTeam !== null && !playcallOpen && session.state !== 'playcall';
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
    const team = (i) => {
      const t = m.teams[i];
      const dots = [0, 1, 2].map((k) => `<i class="${k < m.timeouts[i] ? 'on' : ''}"></i>`).join('');
      const poss = m.possession === i && m.phase !== 'kickoff' ? '<span class="poss">●</span>' : m.phase === 'kickoff' && m.kicker !== i ? '<span class="poss">●</span>' : '';
      return `<div class="sb-team" style="--tc:${t.colors.primary}"><img src="${this.logoFor(t)}"/><span class="ab">${t.abbr}</span>${poss}<span class="sc">${m.score[i]}</span><div class="to">${dots}</div></div>`;
    };
    const dd = m.over ? 'FINAL' : m.phase === 'scrimmage' ? `${downText(m)} <small>· ${yardLineText(m)}</small>` : downText(m);
    const key = [m.score, m.quarter, Math.ceil(m.clock), Math.ceil(m.playClock), m.down, Math.round(m.toGo), Math.round(m.yardLine), m.timeouts, m.possession, m.phase, m.over].join('|');
    if (key === this._bugKey) return;
    this._bugKey = key;
    bug.innerHTML = `${team(1)}${team(0)}<div class="sb-time"><span>${m.over ? 'FINAL' : Q[Math.min(5, m.quarter)]}</span><b>${clockText(m.clock)}</b></div><div class="sb-dd">${dd}</div><div class="sb-pc ${m.playClock <= 10 ? 'low' : ''}">${Math.ceil(m.playClock)}</div>`;
  }
}
