import { KEY_HELP } from '../input/keyboard.js';
import { logoDataURL } from '../render/logo.js';
import { getOffFormation } from '../data/playbook.js';

const ICON_COLORS = { A: '#3fbf3f', B: '#e0403a', X: '#3a7be0', Y: '#e8c32c', RB: '#9aa0a8' };
const ORD = ['', '1st', '2nd', '3rd', '4th'];

/** DOM overlays: connect screen, mini score bug, receiver icons, banners, help, FPS. */
export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="connect" class="screen">
        <div class="title">GRIDIRON <span>27</span></div>
        <div class="sub">Press <b class="btn A">A</b> on your Xbox controller to connect</div>
        <div class="sub small">or press <b>Enter</b> to play with the keyboard</div>
        <div class="sub tiny" id="padname"></div>
      </div>
      <div id="bug" class="hidden">
        <div class="team" id="bug-off"></div>
        <div class="dd" id="bug-dd"></div>
        <div class="spot" id="bug-spot"></div>
      </div>
      <div id="playname" class="hidden"></div>
      <div id="hint" class="hidden"></div>
      <div id="icons"></div>
      <div id="banner" class="hidden"><div class="big"></div><div class="small"></div></div>
      <div id="help" class="hidden"></div>
      <div id="fps"></div>
      <div id="toast" class="hidden"></div>`;
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
  }

  buildHelp() {
    const pad = [
      ['Pre-snap', 'A snap · X change play · LB swap offense/defense'],
      ['Passing', 'Receiver icons A B X Y RB · tap = lob, hold = bullet · left stick leads · RS click throw away'],
      ['Ball carrier', 'RT sprint · A stiff arm · B spin · X dive/slide · Y hurdle · RS ←/→ juke · RS ↑ truck · RB protect'],
      ['Defense', 'B switch player · RT sprint · A swat · X dive tackle · Y strip · RS ↑ hit stick · RS ←→↑ rush moves when blocked'],
    ];
    this.$('help').innerHTML = `<h2>Controls</h2>
      <table>${pad.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <h3>Keyboard</h3><table>${KEY_HELP.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <p class="tiny">H toggles this panel · \` toggles FPS</p>`;
  }

  toggleHelp(force) { this.$('help').classList.toggle('hidden', force === undefined ? undefined : !force); }
  showConnect(show) { this.$('connect').classList.toggle('hidden', !show); }
  setPadName(name) { this.$('padname').textContent = name ? `Connected: ${name}` : ''; }

  toast(text, ms = 1800) {
    const t = this.$('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), ms);
  }

  update(session, renderer, dt, frameMs) {
    const sim = session.sim;
    const off = session.teams[session.offIdx];
    this.$('bug').classList.remove('hidden');
    this.$('bug-off').innerHTML = `<img src="${this.logoFor(off)}"/>${off.abbr} ball`;
    this.$('bug-dd').textContent = `${ORD[session.down]} & ${session.toGoText()}`;
    this.$('bug-spot').textContent = `Ball on ${session.yardLineText()}`;
    const pre = sim.state === 'presnap';
    const pn = this.$('playname');
    pn.classList.toggle('hidden', !pre);
    if (pre) {
      const human = session.humanSide;
      pn.innerHTML = human === 'offense'
        ? `<small>${sim.offPlay.concept || ''}</small>${formationName(sim.offPlay)} · <b>${sim.offPlay.name}</b>`
        : `<small>Defense</small><b>${sim.defPlay.name}</b>`;
    }
    const hint = this.$('hint');
    hint.classList.toggle('hidden', !pre);
    if (pre) hint.innerHTML = session.humanSide === 'offense'
      ? `<b class="btn A">A</b> Snap &nbsp; <b class="btn X">X</b> Next play &nbsp; <b class="btn LB">LB</b> Play defense &nbsp; <b>H</b> Help`
      : `<b class="btn X">X</b> Next play &nbsp; <b class="btn LB">LB</b> Play offense &nbsp; <b class="btn B">B</b> Switch player (before and during the play)`;

    // Receiver icons over heads while the QB can still throw.
    const showIcons = sim.humanTeam === sim.offIdx && sim.offPlay.type === 'pass' && !sim.passThrown && !sim.qbCrossed && sim.state !== 'dead';
    for (const [btn, el] of Object.entries(this.icons)) {
      const id = sim.icons?.[btn];
      if (!showIcons || id === undefined) { el.style.display = 'none'; continue; }
      const p = sim.players[id];
      const s = renderer.project(p.x, p.height + 0.25, p.z);
      el.style.display = s.visible ? 'flex' : 'none';
      el.style.transform = `translate(${s.x - 14}px, ${s.y - 30}px)`;
    }
    // Result banner.
    const b = this.$('banner');
    if (session.message) {
      b.classList.remove('hidden');
      b.querySelector('.big').textContent = session.message.big;
      b.querySelector('.small').textContent = session.message.small;
    } else b.classList.add('hidden');
    // FPS
    this.fpsAcc += frameMs; this.fpsN++;
    if (this.fpsAcc > 500) {
      const fps = 1000 / (this.fpsAcc / this.fpsN);
      this.$('fps').textContent = this.fpsShow ? `${fps.toFixed(0)} fps · ${renderer.renderer.info.render.calls} draws · px ${renderer.pixelRatio.toFixed(2)}` : '';
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }

  logoFor(team) {
    this._logos ||= new Map();
    if (!this._logos.has(team.id)) this._logos.set(team.id, logoDataURL(team.logo, 64));
    return this._logos.get(team.id);
  }
}

function formationName(play) {
  return getOffFormation(play.formation)?.name || play.formation;
}
