import { el } from './nav.js';
import { logoCanvas } from '../render/logo.js';
import { teamRatings } from '../data/positions.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { KEY_HELP } from '../input/keyboard.js';

const SETTINGS_KEY = 'g27.settings';
export const DEFAULT_PREFS = { home: 20, away: 28, side: 'home', difficulty: 'pro', quarterMinutes: 5, accelClock: 20, penalties: true,
  volMaster: 8, volCrowd: 7, volSfx: 8 };

export function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

const VOL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const volFmt = (v) => (v ? '▮'.repeat(v) + '▯'.repeat(10 - v) : 'Off');

/** Menu screens rendered into a root element, navigated with Nav. */
export class Screens {
  constructor(root, nav) {
    this.root = root;
    this.nav = nav;
  }

  clear() { this.root.innerHTML = ''; this.root.classList.add('hidden'); this.nav.clear(); }

  frame(cls, ...kids) {
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');
    this.root.className = 'screen ' + cls;
    this.root.append(...kids);
  }

  title(padName) {
    this.frame('title-screen',
      el('div.title', { html: 'GRIDIRON <span>27</span>' }),
      el('div.sub', { html: 'Press <b class="btn A">A</b> on your Xbox controller to start' }),
      el('div.sub.small', { html: 'or press <b>Enter</b> to play with the keyboard' }),
      el('div.sub.tiny#padname', { text: padName ? `Connected: ${padName}` : '' }));
    this.nav.clear();
  }

  mainMenu({ onPlayNow, onControls, onSettings }) {
    const items = [
      this.menuItem('Play Now', 'Exhibition game against the CPU', onPlayNow),
      this.menuItem('Controls', 'Xbox controller and keyboard layouts', onControls),
      this.menuItem('Settings', 'Default difficulty, quarter length, clock', onSettings),
      this.menuItem('Practice', 'Coming in Phase 3', null, true),
      this.menuItem('Franchise', 'Coming in Phase 5', null, true),
    ];
    this.frame('menu-screen', el('div.logo-small', { html: 'GRIDIRON <span>27</span>' }), el('div.menu-list', {}, items));
    this.nav.set(items.filter((i) => !i.classList.contains('disabled')));
  }

  menuItem(label, sub, action, disabled = false) {
    const it = el(`div.menu-item${disabled ? '.disabled' : ''}`, {}, el('div.mi-label', { text: label }), el('div.mi-sub', { text: sub }));
    it.activate = action || (() => {});
    return it;
  }

  /** Play Now setup: teams, side, difficulty, quarter length, accelerated clock. */
  playNow(teams, prefs, { onStart, onBack }) {
    const p = { ...prefs };
    const teamPanel = (key, label) => {
      const box = el('div.team-pick');
      const draw = () => {
        const t = teams[p[key]];
        const r = teamRatings(t);
        box.innerHTML = '';
        box.style.setProperty('--tc', t.colors.primary);
        box.append(el('div.tp-label', { text: label }), el('div.tp-arrows', { html: '◀ &nbsp; ▶' }), logoCanvas(t.logo, 120),
          el('div.tp-city', { text: t.city }), el('div.tp-name', { text: t.name }),
          el('div.tp-ratings', { html: `<span>OVR <b>${r.ovr}</b></span><span>OFF <b>${r.off}</b></span><span>DEF <b>${r.def}</b></span>` }));
      };
      box.spin = (d) => { p[key] = (p[key] + d + teams.length) % teams.length; if (p.home === p.away) p[key] = (p[key] + d + teams.length) % teams.length; draw(); };
      box.activate = () => box.spin(1);
      draw();
      return box;
    };
    const option = (label, values, key, fmt = (v) => v) => {
      const row = el('div.opt-row');
      const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ ${fmt(p[key])} ▶` })); };
      row.spin = (d) => { const i = values.indexOf(p[key]); p[key] = values[(i + d + values.length) % values.length]; draw(); };
      row.activate = () => row.spin(1);
      draw();
      return row;
    };
    const home = teamPanel('home', 'HOME');
    const away = teamPanel('away', 'AWAY');
    const side = option('You play as', ['home', 'away', 'cpu'], 'side', (v) => (v === 'cpu' ? 'Watch CPU vs CPU' : v === 'home' ? 'Home team' : 'Away team'));
    const diff = option('Difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label);
    const qlen = option('Quarter length', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'quarterMinutes', (v) => `${v} min`);
    const accel = option('Accelerated clock', [0, 10, 15, 20, 25], 'accelClock', (v) => (v ? `run to ${v}s` : 'Off'));
    const pens = option('Penalties', [true, false], 'penalties', (v) => (v ? 'On' : 'Off'));
    const start = el('div.start-btn', { text: 'Start Game' });
    start.activate = () => onStart(p);
    this.frame('setup-screen',
      el('h1', { text: 'Play Now' }),
      el('div.setup-teams', {}, away, el('div.vs', { text: 'AT' }), home),
      el('div.setup-opts', {}, side, diff, qlen, accel, pens, start),
      el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; ▲▼ move &nbsp; <b class="btn B">B</b> back' }));
    this.nav.set([away, home, side, diff, qlen, accel, pens, start], { columns: 1, onBack, index: 7 });
  }

  controls({ onBack }) {
    const pad = [
      ['Pre-snap (offense)', 'A snap · X audible (Phase 3) · Y hot route (Phase 3) · View timeout'],
      ['Pre-snap (defense)', 'B switch player · View timeout'],
      ['Passing', 'Receiver icons A B X Y RB: tap = lob, hold = bullet · left stick leads the throw · RS click throw away'],
      ['Ball carrier', 'RT sprint · A stiff arm · B spin · X dive / QB slide · Y hurdle · RS ←/→ juke · RS ↑ truck · RB protect ball'],
      ['Defense', 'B switch to player nearest the ball · RT sprint · A swat / jump · X dive tackle · Y strip · RS ↑ hit stick · RS ←/→/↑ rush moves when blocked'],
      ['Kicking', 'A start meter · A set power · A set accuracy at the line · left stick aims'],
      ['Returns', 'Y fair catch (punts) · X kneel in the end zone'],
      ['Play call', 'LB/RB change tab · A select · B back · X flip play · View timeout'],
      ['Menus', 'Left stick / D-pad move · A select · B back · Menu pause'],
    ];
    const back = el('div.start-btn', { text: 'Back' });
    back.activate = onBack;
    this.frame('controls-screen', el('h1', { text: 'Controls' }),
      el('div.ctl-cols', {},
        el('table.ctl', { html: `<tr><th colspan=2>Xbox controller</th></tr>${pad.map(([a, b]) => `<tr><td class="k">${a}</td><td>${b}</td></tr>`).join('')}` }),
        el('table.ctl', { html: `<tr><th colspan=2>Keyboard</th></tr>${KEY_HELP.map(([a, b]) => `<tr><td class="k">${a}</td><td>${b}</td></tr>`).join('')}` })),
      back);
    this.nav.set([back], { onBack });
  }

  settings(prefs, { onSave, onBack }) {
    const p = { ...prefs };
    const option = (label, values, key, fmt = (v) => v) => {
      const row = el('div.opt-row');
      const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ ${fmt(p[key])} ▶` })); };
      row.spin = (dd) => { const i = values.indexOf(p[key]); p[key] = values[(i + dd + values.length) % values.length]; draw(); };
      row.activate = () => row.spin(1);
      draw();
      return row;
    };
    const rows = [
      option('Default difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label),
      option('Quarter length', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'quarterMinutes', (v) => `${v} min`),
      option('Accelerated clock', [0, 10, 15, 20, 25], 'accelClock', (v) => (v ? `run to ${v}s` : 'Off')),
      option('Penalties', [true, false], 'penalties', (v) => (v ? 'On' : 'Off')),
      option('Master volume', VOL, 'volMaster', volFmt),
      option('Crowd volume', VOL, 'volCrowd', volFmt),
      option('Effects volume', VOL, 'volSfx', volFmt),
    ];
    const save = el('div.start-btn', { text: 'Save' });
    save.activate = () => onSave(p);
    this.frame('setup-screen', el('h1', { text: 'Settings' }), el('div.setup-opts', {}, ...rows, save));
    this.nav.set([...rows, save], { onBack });
  }

  pause({ onResume, onReplay, onControls, onQuit }) {
    const items = [this.menuItem('Resume', '', onResume)];
    if (onReplay) items.push(this.menuItem('Instant Replay', 'Watch the last play again', onReplay));
    items.push(this.menuItem('Controls', '', onControls), this.menuItem('Quit to Main Menu', 'Abandon this game', onQuit));
    this.frame('pause-screen', el('h1', { text: 'Paused' }), el('div.menu-list', {}, items));
    this.nav.set(items, { onBack: onResume });
  }

  gameOver(session, { onDone }) {
    const m = session.match;
    const [h, a] = m.teams;
    const S = m.stats.team;
    const row = (label, f) => `<tr><td>${f(S[1])}</td><th>${label}</th><td>${f(S[0])}</td></tr>`;
    const table = `<table class="box">
      <tr><td><b>${a.abbr}</b></td><th></th><td><b>${h.abbr}</b></td></tr>
      ${row('First downs', (s) => s.firstDowns)}
      ${row('Total yards', (s) => Math.round(s.yards))}
      ${row('Passing', (s) => `${s.passCmp}/${s.passAtt}, ${Math.round(s.passYds)}`)}
      ${row('Rushing', (s) => `${s.rushAtt}-${Math.round(s.rushYds)}`)}
      ${row('3rd down', (s) => `${s.thirdConv}/${s.thirdAtt}`)}
      ${row('Sacks allowed', (s) => s.sacks)}
      ${row('Turnovers', (s) => s.turnovers)}
      ${row('Penalties', (s) => `${s.penalties}-${s.penYds}`)}
    </table>`;
    // Top performers.
    const name = (team, rid) => { const p = m.teams[team].roster.find((x) => x.id === rid); return p ? `${p.first[0]}. ${p.last}` : '?'; };
    const ps = Object.values(m.stats.players);
    const best = (k) => ps.filter((x) => x[k] > 0).sort((x, y) => y[k] - x[k])[0];
    const pass = best('passYds'), rush = best('rushYds'), rec = best('recYds'), tk = best('tackles');
    const lead = [
      pass && `Passing: ${name(pass.team, pass.rid)} ${pass.passCmp}/${pass.passAtt}, ${Math.round(pass.passYds)} yds, ${pass.passTD} TD, ${pass.int} INT`,
      rush && `Rushing: ${name(rush.team, rush.rid)} ${rush.rushAtt} car, ${Math.round(rush.rushYds)} yds, ${rush.rushTD} TD`,
      rec && `Receiving: ${name(rec.team, rec.rid)} ${rec.rec} rec, ${Math.round(rec.recYds)} yds, ${rec.recTD} TD`,
      tk && `Defense: ${name(tk.team, tk.rid)} ${tk.tackles} tackles${tk.sacks ? `, ${tk.sacks} sacks` : ''}`,
    ].filter(Boolean);
    const done = el('div.start-btn', { text: 'Main Menu' });
    done.activate = onDone;
    this.frame('over-screen',
      el('h1', { text: 'Final' }),
      el('div.final-score', {}, logoCanvas(a.logo, 90), el('div.fs', { text: `${a.abbr} ${m.score[1]}  –  ${m.score[0]} ${h.abbr}` }), logoCanvas(h.logo, 90)),
      el('div.final-sub', { text: m.ot ? 'Overtime' : '' }),
      el('div.final-cols', {}, el('div', { html: table }), el('ul.leaders', {}, lead.map((l) => el('li', { text: l })))),
      done);
    this.nav.set([done], { onBack: onDone });
  }
}
