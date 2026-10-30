import { el } from './nav.js';
import { logoCanvas } from '../render/logo.js';
import { teamRatings } from '../data/positions.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { KEY_HELP } from '../input/keyboard.js';

const SETTINGS_KEY = 'g27.settings';
export const DEFAULT_PREFS = { home: 20, away: 28, side: 'home', difficulty: 'pro', quarterMinutes: 5, accelClock: 20, penalties: true, weather: 'random', time: 'random',
  nameTags: true, statCard: true, autoReplay: true, camera: 'standard', sliders: null,
  practiceSide: 'offense', practiceYL: 25, practiceSit: '1-10', practiceAfter: 'reset' };

// Gameplay sliders (0..100, 50 = default); `user` applies to human teams, `cpu` to the CPU's.
export const SLIDER_KEYS = [
  ['qbAccuracy', 'QB accuracy'], ['passBlocking', 'Pass blocking'], ['catching', 'WR catching'], ['runBlocking', 'Run blocking'],
  ['fumbles', 'Fumbles'], ['passCoverage', 'Pass coverage'], ['interceptions', 'Interceptions'], ['passRush', 'Pass rush'],
  ['runDefense', 'Run defense'], ['tackling', 'Tackling'], ['fgPower', 'FG power'], ['fgAccuracy', 'FG accuracy'],
  ['puntPower', 'Punt power'], ['puntAccuracy', 'Punt accuracy'], ['kickoffPower', 'Kickoff power'],
];
export function defaultSliders() {
  const side = () => Object.fromEntries(SLIDER_KEYS.map(([k]) => [k, 50]));
  return { user: side(), cpu: side(), penalties: 50, fatigue: 50, injuries: 50 };
}

const CAMERAS = { standard: 'Standard', wide: 'Wide', tight: 'Tight', high: 'High (sky cam)' };
const FIELD_SPOTS = [[20, 'Own 20'], [25, 'Own 25'], [35, 'Own 35'], [50, 'Midfield'], [65, 'Opponent 35'], [80, 'Red zone (opp 20)'], [90, 'Opp 10'], [97, 'Goal line (opp 3)']];
const SITUATIONS = [['1-10', '1st & 10'], ['2-6', '2nd & 6'], ['3-3', '3rd & 3'], ['3-8', '3rd & 8'], ['3-15', '3rd & 15'], ['4-1', '4th & 1']];

export function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

/** Menu screens rendered into a root element, navigated with Nav. */
// Simple line icons for the hub tiles (original artwork, 24x24 viewBox).
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  ball: svg('<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/><path d="M9 15l6-6M10 11.5l2.5 2.5M11.5 10l2.5 2.5M8.5 13l2.5 2.5"/>'),
  trophy: svg('<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>'),
  cone: svg('<path d="M10 3h4l4.5 15h-13z"/><path d="M8.2 10h7.6M6.7 14.5h10.6M3 21h18"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  board: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M14 7l3 3M17 7l-3 3M9 16c2-3 5-3 7-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  disk: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  pad: svg('<path d="M6 8h12a4 4 0 0 1 3.8 5.2l-1.2 3.6a2.2 2.2 0 0 1-3.9.6L15 15H9l-1.7 2.4a2.2 2.2 0 0 1-3.9-.6l-1.2-3.6A4 4 0 0 1 6 8z"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>'),
};

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

  /**
   * Main menu hub: a featured Play Now tile with tonight's matchup, then tiles for the other modes.
   * info = { home, away (teams), mine (your team), franchise: { team, year } | null, leagueName }.
   */
  mainMenu({ onPlayNow, onPractice, onFranchise, onLeague, onPlaybook, onControls, onSettings, onSaves }, info = {}) {
    const tile = (cls, icon, label, sub, action, extra = null) => {
      const t = el(`div.hub-tile${cls ? '.' + cls : ''}`, {}, el('div.ht-icon', { html: ICONS[icon] || '' }), el('div.ht-text', {}, el('div.ht-label', { text: label }), el('div.ht-sub', { text: sub })), extra);
      t.activate = action;
      return t;
    };
    const matchup = info.home && info.away ? el('div.ht-matchup', {},
      el('div.htm-team', { style: { '--tc': info.away.colors.primary } }, logoCanvas(info.away.logo, 96), el('b', { text: info.away.abbr })),
      el('div.htm-at', { text: '@' }),
      el('div.htm-team', { style: { '--tc': info.home.colors.primary } }, logoCanvas(info.home.logo, 96), el('b', { text: info.home.abbr }))) : null;
    const fr = info.franchise;
    const tiles = [
      tile('feature', 'ball', 'Play Now', info.home ? `${info.away.city} ${info.away.name} at ${info.home.city} ${info.home.name}` : 'Exhibition game', onPlayNow, matchup),
      tile('', 'trophy', 'Franchise', fr ? `Continue: ${fr.team} · ${fr.year}` : 'Seasons, playoffs, the draft', onFranchise),
      tile('', 'cone', 'Practice', 'Any play, any spot, no clock', onPractice),
      tile('', 'shield', 'League', info.leagueName ? `${info.leagueName}: rosters, teams, saves` : 'Rosters, teams, logos, saves', onLeague),
      tile('', 'board', 'Playbook', 'Design your own plays', onPlaybook),
      tile('small', 'gear', 'Settings', 'Camera, sliders, game options', onSettings),
      tile('small', 'pad', 'Controls', 'Controller and keyboard', onControls),
      tile('small', 'disk', 'Saves', 'Save slots, files, start over', onSaves),
    ];
    const mine = info.mine;
    const top = el('div.hub-top', {}, el('div.hub-logo', { html: 'GRIDIRON <span>27</span>' }),
      mine ? el('div.hub-me', { style: { '--tc': mine.colors.primary } }, logoCanvas(mine.logo, 40), el('div', {}, el('small', { text: 'YOUR TEAM' }), el('b', { text: `${mine.city} ${mine.name}` }))) : null);
    this.frame('hub-screen', top, el('div.hub-grid', {}, tiles), el('div.hub-foot', { html: '<b class="btn A">A</b> Select &nbsp;&nbsp; <span class="tiny">An original football game · not affiliated with any league or team</span>' }));
    if (mine) this.root.style.setProperty('--accent', mine.colors.primary);
    this.nav.set(tiles, { spatial: true });
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
    const side = option('You play as', ['home', 'away', '2p', 'cpu'], 'side', (v) => (v === 'cpu' ? 'Watch CPU vs CPU' : v === '2p' ? '2 players (P1 home, P2 away)' : v === 'home' ? 'Home team' : 'Away team'));
    const diff = option('Difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label);
    const qlen = option('Quarter length', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'quarterMinutes', (v) => `${v} min`);
    const accel = option('Accelerated clock', [0, 10, 15, 20, 25], 'accelClock', (v) => (v ? `run to ${v}s` : 'Off'));
    const pens = option('Penalties', [true, false], 'penalties', (v) => (v ? 'On' : 'Off'));
    const cap = (v) => v[0].toUpperCase() + v.slice(1);
    const wx = option('Weather', ['random', 'clear', 'rain', 'snow', 'windy'], 'weather', cap);
    const tod = option('Time of day', ['random', 'day', 'dusk', 'night'], 'time', cap);
    const start = el('div.start-btn', { text: 'Start Game' });
    start.activate = () => onStart(p);
    this.frame('setup-screen',
      el('h1', { text: 'Play Now' }),
      el('div.setup-teams', {}, away, el('div.vs', { text: 'AT' }), home),
      el('div.setup-opts', {}, side, diff, qlen, accel, pens, wx, tod, start),
      el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; ▲▼ move &nbsp; <b class="btn B">B</b> back' }));
    this.nav.set([away, home, side, diff, qlen, accel, pens, wx, tod, start], { columns: 1, onBack, index: 9 });
  }

  practice(teams, prefs, { onStart, onBack }) {
    const p = { ...prefs };
    const option = (label, values, key, fmt = (v) => v) => {
      const row = el('div.opt-row');
      const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ ${fmt(p[key])} ▶` })); };
      row.spin = (dd) => { const i = Math.max(0, values.indexOf(p[key])); p[key] = values[(i + dd + values.length) % values.length]; draw(); };
      row.activate = () => row.spin(1);
      draw();
      return row;
    };
    const teamIdx = teams.map((_, i) => i);
    const tname = (i) => `${teams[i].city} ${teams[i].name}`;
    const rows = [
      option('Your team', teamIdx, 'home', tname),
      option('Opponent', teamIdx, 'away', tname),
      option('Practice', ['offense', 'defense'], 'practiceSide', (v) => (v === 'offense' ? 'Offense' : 'Defense')),
      option('Ball on', FIELD_SPOTS.map((f) => f[0]), 'practiceYL', (v) => FIELD_SPOTS.find((f) => f[0] === v)?.[1] || v),
      option('Situation', SITUATIONS.map((s) => s[0]), 'practiceSit', (v) => SITUATIONS.find((s) => s[0] === v)?.[1] || v),
      option('After each play', ['reset', 'continue'], 'practiceAfter', (v) => (v === 'reset' ? 'Back to the same spot' : 'Keep the drive going')),
      option('Opponent difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label),
    ];
    const start = el('div.start-btn', { text: 'Start Practice' });
    start.activate = () => {
      if (p.home === p.away) p.away = (p.home + 1) % teams.length;
      const [down, toGo] = p.practiceSit.split('-').map(Number);
      onStart(p, { side: p.practiceSide, yardLine: p.practiceYL, down, toGo, after: p.practiceAfter });
    };
    this.frame('setup-screen', el('h1', { text: 'Practice' }), el('div.setup-opts', {}, ...rows, start),
      el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; ▲▼ move &nbsp; <b class="btn B">B</b> back' }));
    this.nav.set([...rows, start], { columns: 1, onBack, index: rows.length });
  }

  /** Gameplay sliders: LB/RB switch User / CPU / League; ◀▶ change by 5. */
  sliders(prefs, { onSave, onBack }, tab = 0, draft = null) {
    const s = draft || JSON.parse(JSON.stringify(prefs.sliders || defaultSliders()));
    const tabs = ['User', 'CPU', 'League'];
    const row = (label, get, set) => {
      const r = el('div.opt-row');
      const draw = () => { const v = get(); r.innerHTML = ''; r.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ <span class="sl-bar"><i style="width:${v}%"></i></span> ${v} ▶` })); };
      r.spin = (d) => { set(Math.max(0, Math.min(100, get() + d * 5))); draw(); };
      r.activate = () => r.spin(1);
      draw();
      return r;
    };
    const rows = tab < 2
      ? SLIDER_KEYS.map(([k, label]) => { const side = tab === 0 ? s.user : s.cpu; return row(label, () => side[k], (v) => { side[k] = v; }); })
      : [row('Penalty frequency', () => s.penalties, (v) => { s.penalties = v; }), row('Fatigue', () => s.fatigue, (v) => { s.fatigue = v; }),
        row('Injuries (0 = off)', () => s.injuries ?? 50, (v) => { s.injuries = v; })];
    const reset = el('div.opt-row.action', {}, el('span.opt-label', { text: 'Reset all to default' }));
    reset.activate = () => this.sliders(prefs, { onSave, onBack }, tab, defaultSliders());
    const save = el('div.start-btn', { text: 'Save' });
    save.activate = () => onSave(s);
    this.frame('depth-screen', el('h1', { text: 'Gameplay Sliders' }),
      el('div.pc-tabs', {}, tabs.map((t, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: t }))),
      el('div.league-status', { text: tab === 0 ? 'Your team (higher = better for you)' : tab === 1 ? 'CPU teams (higher = better for the CPU)' : 'Both teams' }),
      el('div.setup-opts.card-opts', {}, ...rows, reset, save),
      el('div.setup-help', { html: '◀▶ change &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> User / CPU / League &nbsp; <b class="btn B">B</b> back' }));
    this.nav.set([...rows, reset, save], { columns: 1, onBack, onTab: (d) => this.sliders(prefs, { onSave, onBack }, (tab + d + 3) % 3, s) });
  }

  /** Grid of all teams with logos; A picks one. */
  /** Team grid. `extra` = { label, sub, logo, onPick } adds a card in front (e.g. League & Conferences). */
  teamPicker(teams, focus, { title, onPick, onBack, extra = null }) {
    this.extraButtons = null;
    const cards = teams.map((t, i) => {
      const c = el('div.tp-card', { style: { '--tc': t.colors.primary } }, logoCanvas(t.logo, 56), el('div.tp-card-name', { text: `${t.city} ${t.name}` }), el('div.tp-card-abbr', { text: t.abbr }));
      c.activate = () => onPick(i);
      return c;
    });
    if (extra) {
      const c = el('div.tp-card.tp-extra', {}, logoCanvas(extra.logo, 56), el('div.tp-card-name', { text: extra.label }), el('div.tp-card-abbr', { text: extra.sub }));
      c.activate = extra.onPick;
      cards.unshift(c);
      focus = focus < 0 ? 0 : focus + 1;
    }
    this.frame('setup-screen', el('h1', { text: title }), el('div.tp-grid', {}, cards),
      el('div.setup-help', { html: '<b class="btn A">A</b> pick &nbsp; <b class="btn B">B</b> back' }));
    this.nav.set(cards, { columns: 8, onBack, index: Math.max(0, focus) });
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
      option('Camera', Object.keys(CAMERAS), 'camera', (k) => CAMERAS[k]),
      option('Name tags', [true, false], 'nameTags', (v) => (v ? 'On' : 'Off')),
      option('Post-play stat card', [true, false], 'statCard', (v) => (v ? 'On' : 'Off')),
      option('Auto replay big plays', [true, false], 'autoReplay', (v) => (v ? 'On' : 'Off')),
    ];
    const sliders = el('div.opt-row.action', {}, el('span.opt-label', { text: 'Gameplay sliders…' }));
    sliders.activate = () => this.sliders(p, { onSave: (sl) => { p.sliders = sl; this.settings(p, { onSave, onBack }); }, onBack: () => this.settings(p, { onSave, onBack }) });
    const save = el('div.start-btn', { text: 'Save' });
    save.activate = () => onSave(p);
    this.frame('setup-screen', el('h1', { text: 'Settings' }), el('div.setup-opts', {}, ...rows, sliders, save));
    this.nav.set([...rows, sliders, save], { onBack });
  }

  pause({ onResume, onTimeout, timeoutsLeft = 0, onReplay, onStats, onDepth, onControls, onQuit }) {
    const items = [this.menuItem('Resume', '', onResume)];
    if (onTimeout) items.push(this.menuItem(`Call Timeout (${timeoutsLeft} left)`, 'Stops the clock and gives everyone a breather', onTimeout));
    if (onStats) items.push(this.menuItem('Game Stats', 'Every player: passing, rushing, receiving, defense, kicking', onStats));
    if (onDepth) items.push(this.menuItem('Coaching: Depth Chart', 'Change who starts and who rotates in', onDepth));
    if (onReplay) items.push(this.menuItem('Instant Replay', 'Watch the last play again', onReplay));
    items.push(this.menuItem('Controls', '', onControls), this.menuItem('Quit to Main Menu', 'Abandon this game', onQuit));
    this.frame('pause-screen', el('h1', { text: 'Paused' }), el('div.menu-list', {}, items));
    this.nav.set(items, { onBack: onResume });
  }

  gameOver(session, { onDone, onStats, doneLabel = 'Main Menu' }) {
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
      tk && `Defense: ${name(tk.team, tk.rid)} ${tk.tackles} tackles${tk.sacks ? `, ${tk.sacks} sack${tk.sacks > 1 ? 's' : ''}` : ''}`,
    ].filter(Boolean);
    const done = el('div.start-btn', { text: doneLabel });
    done.activate = onDone;
    const stats = el('div.start-btn.secondary', { text: 'Full Stats' });
    stats.activate = onStats;
    this.frame('over-screen',
      el('h1', { text: 'Final' }),
      el('div.final-score', {}, logoCanvas(a.logo, 90), el('div.fs', { text: `${a.abbr} ${m.score[1]}  –  ${m.score[0]} ${h.abbr}` }), logoCanvas(h.logo, 90)),
      el('div.final-sub', { text: m.ot ? 'Overtime' : '' }),
      el('div.final-cols', {}, el('div', { html: table }), el('ul.leaders', {}, lead.map((l) => el('li', { text: l })))),
      el('div.over-buttons', {}, stats, done));
    this.nav.set([stats, done], { columns: 2, onBack: onDone, index: 1 });
  }
}
