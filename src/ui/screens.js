import { injuryLine } from '../franchise/health.js';
import { UNIFORM_NAMES } from '../data/uniforms.js';
import { passerRating } from '../game/boxscore.js';
import { traitsOf, TRAITS } from '../data/traits.js';
import { el } from './nav.js';
import { faceImg } from './faces.js';
import { logoCanvas } from '../render/logo.js';
import { teamRatings } from '../data/positions.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { KEY_HELP } from '../input/keyboard.js';
import { gameXP, lineText } from '../franchise/career.js';
import { DRILLS, DRILL_IDS, MEDALS, medalFor } from '../game/drills.js';
import { SCENARIOS } from '../game/scenarios.js';

const SETTINGS_KEY = 'g27.settings';
export const DEFAULT_PREFS = { home: 20, away: 28, side: 'home', difficulty: 'pro', quarterMinutes: 5, accelClock: 20, penalties: true, weather: 'random', time: 'random',
  nameTags: true, statCard: true, autoReplay: true, intro: true, careerCam: 'player', camera: 'standard', graphics: 'high', sliders: null,
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

export const CAMERAS = { standard: 'Standard', wide: 'Wide', tight: 'Tight', high: 'High (overhead)', all22: 'All-22 (coaches film)', skycam: 'Skycam (behind the play)', endzone: 'End zone', cable: 'Sideline cable cam' };
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
export const ICONS = {
  ball: svg('<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/><path d="M9 15l6-6M10 11.5l2.5 2.5M11.5 10l2.5 2.5M8.5 13l2.5 2.5"/>'),
  trophy: svg('<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>'),
  cone: svg('<path d="M10 3h4l4.5 15h-13z"/><path d="M8.2 10h7.6M6.7 14.5h10.6M3 21h18"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  board: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M14 7l3 3M17 7l-3 3M9 16c2-3 5-3 7-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  disk: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  clock: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
  people: svg('<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-4 3-6 6-6s6 2 6 6M14 15c1-1 2-1.5 3-1.5 2.5 0 5 1.5 5 5"/>'),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 3v4h4"/><path d="M10 9l5 3-5 3z"/>'),
  exit: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h3M14 14h3M7 18h3"/>'),
  list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 5l1 1 2-2M4 11l1 1 2-2M4 17l1 1 2-2"/>'),
  money: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v6M18 9v6"/>'),
  swap: svg('<path d="M4 8h14l-4-4M20 16H6l4 4"/>'),
  medkit: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M12 10v7M8.5 13.5h7"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.6-7 8-7s8 2.5 8 7"/>'),
  news: svg('<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h4"/>'),
  bracket: svg('<path d="M3 5h5v4H3M3 15h5v4H3M8 7h3v10H8M11 12h4M15 9h6v6h-6z"/>'),
  fast: svg('<path d="M3 5l8 7-8 7zM12 5l8 7-8 7z"/>'),
  clipboard: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5"/>'),
  pad: svg('<path d="M6 8h12a4 4 0 0 1 3.8 5.2l-1.2 3.6a2.2 2.2 0 0 1-3.9.6L15 15H9l-1.7 2.4a2.2 2.2 0 0 1-3.9-.6l-1.2-3.6A4 4 0 0 1 6 8z"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>'),
};

/** A random top-rated player for the main menu (from the league's rosters), shown on his jersey. */
function featuredCard(teams, screens) {
  const pool = [];
  teams.forEach((t) => t.roster?.forEach((p) => { if (!['K', 'P', 'T', 'G', 'C', 'FB'].includes(p.pos)) pool.push({ p, t }); }));
  pool.sort((a, b) => (b.p.ovr ?? 0) - (a.p.ovr ?? 0));
  const top = pool.slice(0, 40);
  if (screens) screens.featured = null;
  if (!top.length) return el('div.mm-feature');
  // The menu is UI, not the sim: Math.random is fine here (a different star each visit).
  const { p, t } = top[Math.floor(Math.random() * top.length)];
  // The 3D player (main.js renderShowcase) stands in the hero box: home uniform, his number, face photo, celebrating.
  if (screens) screens.featured = { p, team: t };
  return el('div.mm-feature', {}, el('div.mm-hero'),
    el('div.mm-player', {}, el('small', { text: `${p.pos} · #${p.number} · ${t.city.toUpperCase()} ${t.name.toUpperCase()}` }), el('b', { text: `${p.first} ${p.last}` }),
      el('div.mm-ovr', {}, el('b', { text: String(p.ovr) }), el('small', { text: 'OVR' }))));
}

/** A line-art controller with a label (Team Select / Controller Select). */
/**
 * A ring that fills with a percentage (full circle = 100%, empty = 0%): SVG arc from 12 o'clock, clockwise,
 * the value in the middle. Used for completion % on the pause and post-game screens.
 */
export function statRing(pct, label, sub, size = 140) {
  const r = 44, c = 2 * Math.PI * r, k = Math.max(0, Math.min(100, pct)) / 100;
  const d = el('div.ring', { style: { width: `${size}px`, height: `${size}px` } });
  d.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="6"/>`
    + `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="butt" stroke-dasharray="${(c * k).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 50 50)"/></svg>`
    + `<div class="ring-in"><b>${label}</b><small>${sub}</small></div>`;
  return d;
}

const clockShort = (c) => `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, '0')}`;

/** Team indexes sorted by city + name (every team list in the game uses this order). */
export function alphaOrder(teams) {
  return teams.map((t, i) => i).sort((a, b) => `${teams[a].city} ${teams[a].name}`.localeCompare(`${teams[b].city} ${teams[b].name}`));
}

/** A team's star players: the best few with their traits (the "X-factor" look, our own names). */
/**
 * Team Select: the team's three headline players as cards (name, position and number, face photo or a jersey-number
 * badge, top trait or the overall). Our own layout; picks the best players with the most traits, one per position.
 */
function starCards(t) {
  const seen = new Set();
  // The faces of the team: the QB, then the best playmakers (no kickers / punters), at most one per position.
  const bonus = { QB: 12, WR: 4, HB: 4, TE: 2, DE: 3, OLB: 2, CB: 2, MLB: 1, FS: 1, SS: 1 };
  const stars = [...t.roster].filter((p) => !['K', 'P'].includes(p.pos)).map((p) => ({ p, tr: traitsOf(p) }))
    .sort((a, b) => (b.p.ovr + b.tr.length * 3 + (bonus[b.p.pos] || 0)) - (a.p.ovr + a.tr.length * 3 + (bonus[a.p.pos] || 0)))
    .filter(({ p }) => { const g = ['T', 'G', 'C'].includes(p.pos) ? 'OL' : p.pos; if (seen.has(g)) return false; seen.add(g); return true; }).slice(0, 3);
  return el('div.ts-stars3', {}, ...stars.map(({ p, tr }) => {
    const face = faceImg(p, 'tsc-face');
    const pic = el('div.tsc-pic', {}, face || el('span.tsc-num', { text: String(p.number) }));
    if (face) face.onerror = () => { face.replaceWith(el('span.tsc-num', { text: String(p.number) })); };
    return el('div.tsc', { style: { '--team': t.colors.primary } },
      el('div.tsc-name', { text: `${p.first} ${p.last}`.toUpperCase() }),
      el('div.tsc-body', {}, el('div.tsc-pos', {}, el('b', { text: p.pos }), el('small', { text: face ? `#${p.number}` : `${p.ovr} OVR` })), pic),
      el('div.tsc-foot', { text: tr.length ? `★ ${TRAITS[tr[0]].name.toUpperCase()}` : (p.college || `${p.age} yrs`).toUpperCase() }));
  }));
}

function starPanel(t) {
  const stars = [...t.roster].map((p) => ({ p, tr: traitsOf(p) })).sort((a, b) => (b.tr.length - a.tr.length) || (b.p.ovr - a.p.ovr)).slice(0, 6);
  return el('div.ts-stars', {}, ...stars.map(({ p, tr }) => el('div.ts-star', {}, ...[faceImg(p, 'ts-face')].filter(Boolean), el('b', { text: `${p.pos} ${p.first[0]}. ${p.last}` }), el('span', { text: `${p.ovr} OVR` }),
    el('small', { text: tr.length ? tr.map((id) => TRAITS[id].name).join(', ') : '—' }))));
}

function padIcon(label) {
  return el('div.ts-pad', { html: `${ICONS.pad}<small>${label}</small>` });
}

export class Screens {
  constructor(root, nav) {
    this.root = root;
    this.nav = nav;
  }

  // Reset the class too: a closed screen's class (e.g. pg-screen, which hides the scorebug) must not linger.
  clear() { this.root.innerHTML = ''; this.root.className = 'screen hidden'; this.nav.clear(); }

  frame(cls, ...kids) {
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');
    this.root.className = 'screen ' + cls;
    this.root.append(...kids.filter((k) => k !== null && k !== undefined && k !== false)); // optional pieces may be absent
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
  /**
   * Main menu (the user's layout): a featured player (a random top-rated one, new each visit), the league logo
   * and the title, then a row of tabs. Black / white / gray; only logos and the jersey carry color.
   */
  mainMenu({ onPlayNow, onPractice, onFranchise, onRosters, onLeague, onPlaybook, onControls, onSettings, onSaves }, info = {}) {
    const fr = info.franchise;
    const tabs = [
      ['Quick Play', 'Pick two teams and play', onPlayNow],
      ['Training', 'Practice, skills drills, scenarios', onPractice],
      ['Franchise', fr ? `Continue: ${fr.team} · ${fr.year}` : 'Franchise, season, career, tournament', onFranchise],
      ['Rosters', 'Players, ratings, trades, signings', onRosters],
      ['Edit League', 'Teams, logos, depth charts, saves, spreadsheets', onLeague],
      ['Playbook', 'Design your own plays', onPlaybook],
      ['Settings', 'Camera, sliders, game options', onSettings],
    ].map(([label, sub, action]) => {
      const t = el('div.mm-tab', {}, el('span', { text: label }));
      t.activate = action;
      t.onfocusitem = () => { hint.textContent = sub; };
      return t;
    });
    const hint = el('div.mm-hint');
    this.frame('mono-main', el('div.mm-stage', {}, featuredCard(info.teams || [], this),
      el('div.mm-league', {}, info.leagueLogo ? logoCanvas(info.leagueLogo, 150) : null),
      el('div.mm-title', { text: 'GRIDIRON 27' })),
      el('div.mm-tabs', {}, tabs), hint,
      el('div.setup-help', { html: '<b class="btn A">A</b> Select &nbsp; ◀▶ Move &nbsp; <b class="btn Y">Y</b> Controls &nbsp; <b class="btn X">X</b> Saves &nbsp;&nbsp; <span class="tiny">An original football game · not affiliated with any league or team</span>' }));
    this.nav.set(tabs, { spatial: true, index: info.focus ?? 0 });
    this.extraButtons = (f) => { if (f.pressed.Y) { this.extraButtons = null; onControls(); } else if (f.pressed.X) { this.extraButtons = null; onSaves(); } };
  }

  menuItem(label, sub, action, disabled = false) {
    const it = el(`div.menu-item${disabled ? '.disabled' : ''}`, {}, el('div.mi-label', { text: label }), el('div.mi-sub', { text: sub }));
    it.activate = action || (() => {});
    return it;
  }

  /**
   * Quick Play, step 1 — Team Select: the two teams (◀▶ change the focused one) and the controllers (◀▶ move yours
   * to a side: left = away, middle = watch, right = home, or both for two players). A goes on to Game Settings.
   */
  /**
   * Quick Play, step 1 — Team Select. Every connected controller is an icon under the two teams: ◀▶ moves it to the
   * away side, the middle (watch) or the home side; ▲▼ changes the team on your side (alphabetical), LT picks a random
   * one; A opens your side's menu (Ready, Star Players, Advanced Settings, Uniforms). When everyone on a side is ready
   * the game settings come up. Player 2 joins by pressing A on a second controller. Driven by `this.custom` (main.js
   * hands it both controllers' frames) instead of the usual focus navigation.
   */
  playNow(teams, prefs, { onStart, onBack, p2 = null }, p = { ...prefs }) {
    const order = alphaOrder(teams);
    p.coin ||= 'receive';
    p.styles ||= ['balanced', 'balanced'];
    p.uniforms ||= ['home', 'away'];
    // Controller columns: 0 = away, 1 = middle (watch), 2 = home.
    const st = this._ts || (this._ts = { cols: [p.side === 'away' ? 0 : p.side === 'home' || p.side === '2p' ? 2 : 1, p.side === '2p' ? 0 : 1], ready: [false, false], menu: null, held: [null, null] });
    st.ready = [false, false]; st.menu = null;
    const sideKey = (col) => (col === 0 ? 'away' : 'home');
    const box = (key, label) => {
      const it = el(`div.ts-team.${key}`);
      it.draw = () => {
        const t = teams[p[key]];
        const r = teamRatings(t);
        it.innerHTML = '';
        it.append(el('div.ts-side', { text: label }), el(`div.ts-show.${key}`, {}, starCards(t), el('div.ts-logo.gloss', {}, logoCanvas(t.logo, 200))),
          el(`div.ts-card.${key}`, {}, el('div.ts-ovr', {}, el('b', { text: String(r.ovr) }), el('small', { text: 'OVR' })),
            el('div.ts-name', {}, el('small', { text: t.city.toUpperCase() }), el('b', { text: t.name.toUpperCase() })),
            el('div.ts-sub', { text: `OFF ${r.off} · DEF ${r.def}` })));
      };
      it.draw();
      return it;
    };
    const away = box('away', 'AWAY'), home = box('home', 'HOME');
    const pads = el('div.ts-pads');
    const menuHost = el('div.ts-menuhost');
    const note = el('div.ts-padnote');
    const players = () => [0, ...(p2?.() ? [1] : [])];
    const draw = () => {
      away.draw(); home.draw();
      pads.innerHTML = '';
      for (let c = 0; c < 3; c++) {
        pads.append(el(`div.ts-padcol${c === 1 ? '.mid' : ''}`, {}, ...players().filter((i) => st.cols[i] === c).map((i) => {
          const d = padIcon(`P${i + 1}${c !== 1 && st.ready[i] ? ' ✓' : ''}`);
          if (c !== 1 && st.ready[i]) d.classList.add('ready');
          return d;
        })));
      }
      const onSide = players().filter((i) => st.cols[i] !== 1);
      note.textContent = !onSide.length ? 'Watch: CPU vs CPU' : onSide.length === 2 ? (st.cols[onSide[0]] === st.cols[onSide[1]] ? `Co-op: both players on the ${sideKey(st.cols[onSide[0]])} team (P2 runs a receiver / a defender)` : 'Two players, head to head') : `P${onSide[0] + 1} plays the ${sideKey(st.cols[onSide[0]])} team`;
      pads.append(note);
      menuHost.innerHTML = '';
      if (st.menu) {
        const m = st.menu;
        const items = sideMenu(m.player);
        const panel = el(`div.ts-menu.${sideKey(st.cols[m.player])}`, {}, ...items.map((x, i) => el(`div.ts-mi${i === m.idx ? '.on' : ''}`, { text: x.label })));
        if (m.sub) panel.append(el('div.ts-sub-panel', {}, m.sub));
        menuHost.append(panel);
      }
    };
    const step = (key, d) => {
      const i = order.indexOf(p[key]);
      p[key] = order[(i + d + order.length) % order.length];
      if (p.home === p.away) p[key] = order[(order.indexOf(p[key]) + d + order.length) % order.length];
    };
    const random = (key) => {
      const other = key === 'home' ? p.away : p.home;
      const pool = order.filter((i) => i !== other);
      p[key] = pool[Math.floor(Math.random() * pool.length)];
    };
    const sideIdx = (player) => (st.cols[player] === 2 ? 0 : 1); // team index in the game: 0 home, 1 away
    const STYLES = ['balanced', 'power', 'spread', 'westcoast', 'airraid'];
    const STYLE_NAMES = { balanced: 'Balanced', power: 'Power run', spread: 'Spread', westcoast: 'West Coast', airraid: 'Air Raid' };
    const COIN = { receive: 'Receive', defer: 'Defer (kick, ball 2nd half)', kick: 'Kick' };
    const UNI = UNIFORM_NAMES;
    const sideMenu = (player) => {
      const ti = sideIdx(player), key = sideKey(st.cols[player]);
      return [
        { label: 'READY', go: () => { st.ready[player] = true; st.menu = null; } },
        { label: 'Star Players', go: () => { st.menu.sub = starPanel(teams[p[key]]); } },
        { label: `Playbook: ${STYLE_NAMES[p.styles[ti]]}`, spin: (d) => { p.styles[ti] = STYLES[(STYLES.indexOf(p.styles[ti]) + d + STYLES.length) % STYLES.length]; } },
        { label: `Coin toss: ${COIN[p.coin]}`, spin: (d) => { const k = Object.keys(COIN); p.coin = k[(k.indexOf(p.coin) + d + k.length) % k.length]; } },
        { label: `Uniform: ${UNI[p.uniforms[ti]]}`, spin: (d) => { const k = Object.keys(UNI); p.uniforms[ti] = k[(k.indexOf(p.uniforms[ti]) + d + k.length) % k.length]; } },
      ];
    };
    const finish = () => {
      const on = players().filter((i) => st.cols[i] !== 1);
      // Both controllers on the same side = co-op (one team, two players); on opposite sides = head to head.
      p.side = !on.length ? 'cpu' : on.length === 2 ? (st.cols[on[0]] === st.cols[on[1]] ? 'coop' : '2p') : sideKey(st.cols[on[0]]);
      if (p.side === 'coop') p.coopSide = sideKey(st.cols[on[0]]);
      p.p1Team = st.cols[0] === 2 ? 0 : 1; // 2 players: which game team (0 home / 1 away) player 1 has
      this.custom = null;
      this.gameSettings(teams, p, { onStart, onBack: () => this.playNow(teams, prefs, { onStart, onBack, p2 }, p) });
    };
    const dirOf = (f, i) => {
      let d = null;
      if (f.down.Left || f.lx < -0.6) d = 'l'; else if (f.down.Right || f.lx > 0.6) d = 'r';
      else if (f.down.Up || f.ly < -0.6) d = 'u'; else if (f.down.Down || f.ly > 0.6) d = 'd';
      const fresh = d !== st.held[i];
      st.held[i] = d;
      return fresh ? d : null;
    };
    this.frame('mono-screen ts-screen', el('h1', { text: 'Team Select' }),
      el('div.ts-row', {}, away, el('div.ts-at', { text: '@' }), home), pads, menuHost,
      el('div.setup-help', { html: '<b class="btn LS">◀▶</b> Move your controller &nbsp; <b class="btn LS">▲▼</b> Change team (in the middle: away · LB/RB home) &nbsp; <b class="btn LT">LT</b> Random team &nbsp; <b class="btn A">A</b> Side menu / Ready &nbsp; <b class="btn B">B</b> Back' }));
    this.nav.set([]);
    draw();
    this.custom = (frames) => {
      let changed = false;
      for (const i of players()) {
        const f = frames[i];
        if (!f) continue;
        const d = dirOf(f, i);
        if (st.menu && st.menu.player === i) {
          const items = sideMenu(i);
          if (d === 'u') { st.menu.idx = (st.menu.idx + items.length - 1) % items.length; st.menu.sub = null; changed = true; }
          else if (d === 'd') { st.menu.idx = (st.menu.idx + 1) % items.length; st.menu.sub = null; changed = true; }
          else if ((d === 'l' || d === 'r') && items[st.menu.idx].spin) { items[st.menu.idx].spin(d === 'r' ? 1 : -1); changed = true; }
          else if (f.pressed.A) { const it = items[st.menu.idx]; if (it.go) it.go(); else it.spin(1); changed = true; }
          else if (f.pressed.B) { st.menu = null; changed = true; }
          continue;
        }
        if (d === 'l' || d === 'r') {
          const to = Math.max(0, Math.min(2, st.cols[i] + (d === 'r' ? 1 : -1)));
          // One player per side (head to head); player 2 can't play alone (player 1's controller runs the game).
          const taken = to !== 1 && players().some((j) => j !== i && st.cols[j] === to);
          if (!taken) { st.cols[i] = to; st.ready[i] = false; changed = true; }
        } else if (d === 'u' || d === 'd') {
          step(st.cols[i] === 1 ? 'away' : sideKey(st.cols[i]), d === 'd' ? 1 : -1); st.ready = [false, false]; changed = true;
        }
        if (st.cols[i] === 1 && (f.pressed.LB || f.pressed.RB)) { step('home', f.pressed.RB ? 1 : -1); changed = true; }
        if (f.pressed.LT || (f.lt > 0.6 && !st.ltHeld?.[i])) {
          if (st.cols[i] === 1) { random('away'); random('home'); } else random(sideKey(st.cols[i]));
          st.ready = [false, false]; changed = true;
        }
        (st.ltHeld ||= [false, false])[i] = f.lt > 0.6;
        if (f.pressed.A) {
          if (st.cols[i] === 1) { if (i === 0 && players().every((j) => st.cols[j] === 1 || st.ready[j])) { finish(); return; } }
          else { st.menu = { player: i, idx: 0, sub: null }; changed = true; }
        }
        if (f.pressed.B && i === 0) {
          if (st.ready[0]) { st.ready[0] = false; changed = true; }
          else { this.custom = null; this._ts = null; onBack(); return; }
        }
      }
      // Everyone on a side is ready (player 1 must be on a side or have pressed A in the middle).
      const on = players().filter((i) => st.cols[i] !== 1);
      if (on.length && on.every((i) => st.ready[i]) && !(players().includes(1) && st.cols[1] !== 1 && st.cols[0] === 1)) { finish(); return; }
      if (changed) draw();
    };
  }

  /** Quick Play, step 2 — Game Settings: quarter length, clock, difficulty, stadium, weather, time of day. */
  gameSettings(teams, p, { onStart, onBack }) {
    const option = (label, values, key, fmt = (v) => v) => {
      const row = el('div.opt-row');
      const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ ${fmt(p[key])} ▶` })); };
      row.spin = (d) => { const i = Math.max(0, values.indexOf(p[key])); p[key] = values[(i + d + values.length) % values.length]; draw(); };
      row.activate = () => row.spin(1);
      draw();
      return row;
    };
    const cap = (v) => v[0].toUpperCase() + v.slice(1);
    p.stadium ||= 'home';
    const rows = [
      option('Quarter length', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 'quarterMinutes', (v) => `${v} min`),
      option('Accelerated clock', [0, 10, 15, 20, 25], 'accelClock', (v) => (v ? `Run to ${v}s` : 'Off')),
      option('Difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label),
      option('Stadium', ['home', 'neutral'], 'stadium', (v) => (v === 'home' ? `${teams[p.home].city} (home crowd)` : 'Neutral site')),
      option('Weather', ['random', 'clear', 'rain', 'snow', 'windy'], 'weather', cap),
      option('Time of day', ['random', 'day', 'dusk', 'night'], 'time', cap),
      option('Penalties', [true, false], 'penalties', (v) => (v ? 'On' : 'Off')),
    ];
    const start = el('div.start-btn', { text: 'Start Game' });
    start.activate = () => onStart(p);
    const a = teams[p.away], h = teams[p.home];
    this.frame('mono-screen gs-screen', el('h1', { text: 'Game Settings' }),
      el('div.gs-match', {}, logoCanvas(a.logo, 44), el('span', { text: `${a.city} ${a.name}  @  ${h.city} ${h.name}` }), logoCanvas(h.logo, 44)),
      el('div.gs-box', {}, ...rows), start,
      el('div.setup-help', { html: '▲▼ Move &nbsp; ◀▶ Change &nbsp; <b class="btn A">A</b> Start (on Start Game) &nbsp; <b class="btn B">B</b> Back to team select' }));
    this.nav.set([...rows, start], { columns: 1, onBack, index: rows.length });
  }

  practice(teams, prefs, { onStart, onDrills, onScenarios, onBack }) {
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
    const drills = el('div.start-btn', { text: 'Skills Drills' });
    drills.activate = () => { if (p.home === p.away) p.away = (p.home + 1) % teams.length; onDrills(p); };
    const scen = el('div.start-btn', { text: 'Scenarios' });
    scen.activate = () => { if (p.home === p.away) p.away = (p.home + 1) % teams.length; onScenarios(p); };
    this.frame('setup-screen', el('h1', { text: 'Practice' }), el('div.setup-opts', {}, ...rows, start, drills, scen),
      el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; ▲▼ move &nbsp; <b class="btn B">B</b> back' }));
    this.nav.set([...rows, start, drills, scen], { columns: 1, onBack, index: rows.length });
  }

  /** Skills drills: one tile per drill with your best score and medal. bests = { id: score }. */
  drills(bests, teamName, { onStart, onBack }) {
    const icons = { passing: 'ball', rushing: 'cone', kicking: 'trophy', passRush: 'shield', coverage: 'people' };
    const tiles = DRILL_IDS.map((id, i) => {
      const d = DRILLS[id], best = bests[id];
      const medal = best !== undefined ? medalFor(id, best) : -1;
      const sub = best !== undefined ? `Best ${best}${medal >= 0 ? ` · ${MEDALS[medal]}` : ''}` : `${d.reps} reps · ${d.side === 'offense' ? 'Offense' : 'Defense'}`;
      const t = el(`div.hub-tile${i === 0 ? '.feature' : ''}`, {}, el('div.ht-icon', { html: ICONS[icons[id]] || '' }),
        el('div.ht-text', {}, el('div.ht-label', { text: d.name }), el('div.ht-sub', { text: sub }), i === 0 ? el('div.ht-sub.dr-desc', { text: d.desc }) : null),
        medal >= 0 ? el(`div.dr-medal.m${medal}`, { text: MEDALS[medal][0] }) : null);
      t.activate = () => onStart(id);
      t.onfocusitem = () => { help.innerHTML = `<b>${d.name}</b> — ${d.desc} <small>Medals: ${d.medals.join(' / ')}</small>`; };
      return t;
    });
    const help = el('div.dr-help', {});
    this.frame('drills-screen hub-screen', el('div.hub-top', {}, el('div.hub-logo', { html: 'SKILLS DRILLS' }), el('div.ps-brand', { text: teamName })),
      el('div.hub-grid.drill-grid', {}, tiles), help,
      el('div.hub-foot', { html: '<b class="btn A">A</b> Start drill &nbsp;&nbsp; <b class="btn B">B</b> Back' }));
    this.nav.set(tiles, { spatial: true, onBack });
  }

  /** Scenarios: late-game challenges; done = { id: true } for the ones you've beaten. */
  scenarios(done, matchup, { onStart, onBack }) {
    const goal = { win: 'Win the game', td: 'Score a touchdown', stop: 'Get the stop' };
    const tiles = SCENARIOS.map((sc, i) => {
      const t = el(`div.hub-tile${i === 0 ? '.feature' : ''}`, {}, el('div.ht-icon', { html: ICONS[sc.side === 'you' ? 'ball' : 'shield'] }),
        el('div.ht-text', {}, el('div.ht-label', { text: sc.name }), el('div.ht-sub', { text: `${goal[sc.goal]} · ${sc.score[0]}–${sc.score[1]}, ${Math.floor(sc.clock / 60)}:${String(sc.clock % 60).padStart(2, '0')} Q4` })),
        done[sc.id] ? el('div.dr-medal.m2', { text: '✓' }) : null);
      t.activate = () => onStart(sc.id);
      t.onfocusitem = () => { help.innerHTML = `<b>${sc.name}</b> — ${sc.desc}`; };
      return t;
    });
    const help = el('div.dr-help', {});
    this.frame('drills-screen hub-screen', el('div.hub-top', {}, el('div.hub-logo', { html: 'SCENARIOS' }), el('div.ps-brand', { text: matchup })),
      el('div.hub-grid.scen-grid', {}, tiles), help,
      el('div.hub-foot', { html: `<b class="btn A">A</b> Play &nbsp;&nbsp; <b class="btn B">B</b> Back &nbsp;&nbsp; <span class="tiny">${Object.keys(done).length}/${SCENARIOS.length} beaten</span>` }));
    this.nav.set(tiles, { spatial: true, onBack });
  }

  /** Scenario verdict: beaten or not, the final situation; A tries again. */
  scenarioResult(sc, verdict, { onRetry, onDone }) {
    const retry = el('div.start-btn', { text: 'Try Again' }); retry.activate = onRetry;
    const done = el('div.start-btn', { text: 'Scenarios' }); done.activate = onDone;
    this.frame('drill-result setup-screen', el('h1', { text: sc.name }),
      el('div.dr-score', {}, el(`div.dr-medal.big.${verdict.success ? 'm2' : 'm-1'}`, { text: verdict.success ? 'Challenge complete' : 'Challenge failed' })),
      el('div.dr-sub', { text: verdict.text }), el('div.dr-sub', { text: sc.desc }),
      el('div.dr-btns', {}, retry, done),
      el('div.setup-help', { html: '<b class="btn A">A</b> select &nbsp; <b class="btn B">B</b> scenarios' }));
    this.nav.set([retry, done], { columns: 2, onBack: onDone, index: verdict.success ? 1 : 0 });
  }

  /** Drill results: score, medal, the rep log; A tries again, B back to the drills. */
  drillResult(drill, best, { onRetry, onDone }) {
    const d = DRILLS[drill.id];
    const medal = medalFor(drill.id, drill.score);
    const next = medal < 2 ? d.medals[medal + 1] : null;
    const log = el('div.dr-log', {}, ...drill.log.map((l) => el('div.dr-rep', {}, el('span', { text: `Rep ${l.rep}` }), el('span', { text: l.text }), el('b', { text: `${l.pts > 0 ? '+' : ''}${l.pts}` }))));
    const retry = el('div.start-btn', { text: 'Try Again' }); retry.activate = onRetry;
    const done = el('div.start-btn', { text: 'Drills Menu' }); done.activate = onDone;
    this.frame('drill-result setup-screen', el('h1', { text: d.name }),
      el('div.dr-score', {}, el('div', { text: String(drill.score) }), el(`div.dr-medal.big.m${medal}`, { text: medal >= 0 ? MEDALS[medal] : 'No medal' })),
      el('div.dr-sub', { text: `${drill.score >= best ? 'New best!' : `Best ${best}`}${next ? ` · ${MEDALS[medal + 1]} at ${next}` : ''}` }),
      log, el('div.dr-btns', {}, retry, done),
      el('div.setup-help', { html: '<b class="btn A">A</b> select &nbsp; <b class="btn B">B</b> drills menu' }));
    this.nav.set([retry, done], { columns: 2, onBack: onDone });
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
    // Alphabetical (city + name): easier to find a team than in division order.
    const order = alphaOrder(teams);
    const cards = order.map((i) => {
      const t = teams[i];
      const c = el('div.tp-card', { style: { '--tc': t.colors.primary } }, logoCanvas(t.logo, 56), el('div.tp-card-name', { text: `${t.city} ${t.name}` }), el('div.tp-card-abbr', { text: t.abbr }));
      c.activate = () => onPick(i);
      return c;
    });
    focus = focus >= 0 ? order.indexOf(focus) : focus;
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
      option('Graphics', ['high', 'medium', 'low'], 'graphics', (v) => ({ high: 'High (bloom, grade)', medium: 'Medium (grade)', low: 'Low (fastest)' })[v]),
      option('Name tags', [true, false], 'nameTags', (v) => (v ? 'On' : 'Off')),
      option('Post-play stat card', [true, false], 'statCard', (v) => (v ? 'On' : 'Off')),
      option('Auto replay big plays', [true, false], 'autoReplay', (v) => (v ? 'On' : 'Off')),
      option('Pregame intro', [true, false], 'intro', (v) => (v ? 'On' : 'Off')),
      option('Career camera', ['player', 'broadcast'], 'careerCam', (v) => (v === 'player' ? 'Behind your player' : 'Broadcast')),
    ];
    const sliders = el('div.opt-row.action', {}, el('span.opt-label', { text: 'Gameplay sliders…' }));
    sliders.activate = () => this.sliders(p, { onSave: (sl) => { p.sliders = sl; this.settings(p, { onSave, onBack }); }, onBack: () => this.settings(p, { onSave, onBack }) });
    const save = el('div.start-btn', { text: 'Save' });
    save.activate = () => onSave(p);
    this.frame('setup-screen', el('h1', { text: 'Settings' }), el('div.setup-opts', {}, ...rows, sliders, save));
    this.nav.set([...rows, sliders, save], { onBack });
  }

  /**
   * Pause menu in the hub style: a situation banner (score, clock, down) over icon tiles.
   * game = { home, away, score: [h, a], quarter, clock, down, spot, practice } (optional).
   */
  /**
   * Pause (the user's layout): the menu down the left, the two starting quarterbacks' game so far on the right, and
   * the scorebug left visible along the bottom. Items that don't apply right now are dimmed.
   */
  pause({ onResume, onTimeout, timeoutsLeft = 0, onChallenge, onReplay, onStats, onDepth, onSettings, onControls, onController, onRestart, onQuit, game = null }) {
    const items = [];
    const add = (label, action, note = '') => {
      const it = el(`div.pz-item${action ? '' : '.disabled'}`, {}, el('span', { text: label }), note ? el('small', { text: note }) : null);
      it.activate = action || (() => {});
      items.push(it);
    };
    add('Resume', onResume);
    add('Timeout', onTimeout, `${timeoutsLeft} left`);
    add('Challenge Play', onChallenge, onChallenge ? '' : 'nothing to challenge');
    add('Stats', onStats);
    add('Coaching', onDepth, 'depth chart · injuries');
    add('Instant Replay', onReplay);
    add('Settings', onSettings);
    add('Controls', onControls);
    add('Controller Select', onController);
    add('Restart', onRestart);
    add(game?.practice ? 'Quit Practice' : 'Quit', onQuit);
    const qb = (q, t, right) => el(`div.pz-qb${right ? '.right' : ''}`, {},
      el('div.pz-head', {}, ...[q && faceImg(q, 'pz-face')].filter(Boolean), el('div.pz-name', {}, el('small', { text: q ? `#${q.number}` : '' }), el('b', { html: q ? `${q.first.toUpperCase()}<br>${q.last.toUpperCase()}` : '' })),
        el('div.pz-logo', {}, logoCanvas(t.logo, 110))),
      el('div.pz-stats', {}, statRing(q ? +q.comp : 0, q ? q.comp : '0.0', 'COMP%', 170),
        el('div.pz-nums', {}, ...[['YDS', q?.yds ?? 0], ['TD', q?.td ?? 0], ['INT', q?.int ?? 0], ['RATING', q?.rating ?? '0.0']]
          .map(([k, v]) => el('div.pz-num', {}, el('b', { text: String(v) }), el('small', { text: k }))))),
      el('div.pz-line', { text: q ? `${q.cmp}/${q.att} passing` : '' }));
    const title = game?.practice ? 'Practice' : game?.mode || 'Play Now';
    this.frame('mono-screen pz-screen', el('h1', { text: title }),
      el('div.pz-main', {}, el('div.pz-list', {}, items),
        game?.home ? el('div.pz-matchup', {}, qb(game.qbs?.[1], game.away, false), qb(game.qbs?.[0], game.home, true)) : el('div')),
      el('div.pz-situation', { text: game ? `${game.practice ? 'Practice' : `${game.quarter} · ${game.clock}`} · ${game.down || ''}` : '' }),
      el('div.setup-help.pz-help', { html: '<b class="btn A">A</b> Select &nbsp; ▲▼ Move &nbsp; <b class="btn B">B</b> Resume' }));
    this.nav.set(items, { columns: 1, onBack: onResume });
  }

  /** Final box score; `halftime: true` makes it the halftime report (no player of the game, Start 2nd Half). */
  /**
   * Post-game (and halftime) screen, after the user's mockup: a menu on the left (Finish Game, View Highlights, Player
   * Stats, Team Stats, Score Summary, Restart), the final score with both logos, each team's quarterback with a
   * completion ring, the top rusher / receiver / defender for each side, and the score by quarter. The right-hand
   * panel switches between the quarter chart, team stats and the scoring summary.
   */
  gameOver(session, { onDone, onStats, onHighlights = null, onRestart = null, doneLabel = 'Finish Game', halftime = false }, panel = 'quarters', focus = 0) {
    const m = session.match;
    const [h, a] = m.teams;
    const S = m.stats.team;
    const ps = Object.values(m.stats.players);
    const pl = (team, rid) => m.teams[team].roster.find((x) => x.id === rid);
    const top = (team, k) => ps.filter((x) => x.team === team && x[k] > 0).sort((x, y) => y[k] - x[k])[0];
    const qbOf = (team) => ps.filter((x) => x.team === team && x.passAtt > 0).sort((x, y) => y.passAtt - x.passAtt)[0];
    const qbCard = (team, right) => {
      const st = qbOf(team), p = st && pl(team, st.rid), t = m.teams[team];
      const comp = st?.passAtt ? (100 * st.passCmp) / st.passAtt : 0;
      return el(`div.pg-qb${right ? '.right' : ''}`, {},
        el('div.pg-qbhead', {}, ...[p && faceImg(p, 'pz-face small')].filter(Boolean), el('div.pz-name', {}, el('small', { text: p ? `#${p.number}` : '' }), el('b', { html: p ? `${p.first.toUpperCase()}<br>${p.last.toUpperCase()}` : '—' })),
          el('div.pg-logo.small', {}, logoCanvas(t.logo, 56))),
        el('div.pg-qbstats', {}, statRing(comp, comp.toFixed(1), 'COMP%', 104),
          el('div.pz-nums', {}, ...[['YDS', Math.round(st?.passYds || 0)], ['TD', st?.passTD || 0], ['INT', st?.int || 0], ['RTG', st ? passerRating(st).toFixed(1) : '0.0']]
            .map(([k, v]) => el('div.pz-num', {}, el('b', { text: String(v) }), el('small', { text: k }))))));
    };
    const leaders = (team) => {
      const rows = [['RUSH', top(team, 'rushYds'), (x) => `${x.rushAtt} car · ${Math.round(x.rushYds)} yds${x.rushTD ? ` · ${x.rushTD} TD` : ''}`],
        ['REC', top(team, 'recYds'), (x) => `${x.rec} rec · ${Math.round(x.recYds)} yds${x.recTD ? ` · ${x.recTD} TD` : ''}`],
        ['DEF', ps.filter((x) => x.team === team).sort((x, y) => (y.tackles + y.sacks * 3 + y.defInt * 4) - (x.tackles + x.sacks * 3 + x.defInt * 4))[0], (x) => [x.tackles ? `${x.tackles} tkl` : '', x.sacks ? `${x.sacks} sack` : '', x.defInt ? `${x.defInt} INT` : ''].filter(Boolean).join(' · ') || '—']];
      return el('div.pg-leaders', {}, ...rows.map(([k, x, f]) => { const p = x && pl(team, x.rid); return el('div.pg-lead', {}, el('small', { text: k }), el('b', { text: p ? `${p.first[0]}. ${p.last}` : '—' }), el('span', { text: x ? f(x) : '' })); }));
    };
    // Right panel.
    const quarters = () => {
      const bq = m.byQuarter || [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
      const nq = m.quarter >= 5 || bq[0][4] || bq[1][4] ? 5 : 4;
      const cum = [0, 1].map((t) => { let c = 0; return bq[t].slice(0, nq).map((v) => (c += v)); });
      const max = Math.max(7, ...cum[0], ...cum[1]);
      const W = 300, H = 150, x = (i) => 24 + (i * (W - 40)) / (nq - 1 || 1), y = (v) => H - 18 - (v / max) * (H - 34);
      const line = (t, dash) => `<polyline fill="none" stroke="#fff" stroke-width="${t ? 2 : 3}" ${dash ? 'stroke-dasharray="5 4"' : ''} points="${cum[t].map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`
        + cum[t].map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${t ? '#000' : '#fff'}" stroke="#fff" stroke-width="2"/>`).join('');
      const labels = Array.from({ length: nq }, (_, i) => `<text x="${x(i)}" y="${H - 2}" fill="#999" font-size="11" text-anchor="middle">${i < 4 ? `Q${i + 1}` : 'OT'}</text>`).join('');
      const chart = el('div.pg-chart', { html: `<svg viewBox="0 0 ${W} ${H}">${labels}${line(1, true)}${line(0, false)}</svg>` });
      const tbl = el('table.pg-qtable', { html: `<tr><th></th>${Array.from({ length: nq }, (_, i) => `<th>${i < 4 ? i + 1 : 'OT'}</th>`).join('')}<th>T</th></tr>`
        + [1, 0].map((t) => `<tr><td>${m.teams[t].abbr} ${t ? '- - -' : '———'}</td>${bq[t].slice(0, nq).map((v) => `<td>${v}</td>`).join('')}<td><b>${m.score[t]}</b></td></tr>`).join('') });
      return el('div.pg-panel', {}, el('div.pg-ptitle', { text: 'SCORE BY QUARTER' }), chart, tbl);
    };
    const teamStats = () => {
      const row = (label, f) => `<tr><td>${f(S[1])}</td><th>${label}</th><td>${f(S[0])}</td></tr>`;
      return el('div.pg-panel', {}, el('div.pg-ptitle', { text: 'TEAM STATS' }), el('table.box', { html: `<tr><td><b>${a.abbr}</b></td><th></th><td><b>${h.abbr}</b></td></tr>
        ${row('First downs', (x) => x.firstDowns)}${row('Total yards', (x) => Math.round(x.yards))}${row('Passing', (x) => `${x.passCmp}/${x.passAtt}, ${Math.round(x.passYds)}`)}
        ${row('Rushing', (x) => `${x.rushAtt}-${Math.round(x.rushYds)}`)}${row('3rd down', (x) => `${x.thirdConv}/${x.thirdAtt}`)}${row('Sacks allowed', (x) => x.sacks)}
        ${row('Turnovers', (x) => x.turnovers)}${row('Penalties', (x) => `${x.penalties}-${x.penYds}`)}` }));
    };
    const summary = () => el('div.pg-panel', {}, el('div.pg-ptitle', { text: 'SCORE SUMMARY' }),
      el('div.pg-scoring', {}, ...(m.scoring || []).map((sc) => el('div.pg-sc', {}, el('small', { text: `${sc.q <= 4 ? `Q${sc.q}` : 'OT'} ${clockShort(sc.clock)}` }),
        el('b', { text: m.teams[sc.team].abbr }), el('span', { text: sc.what }), el('em', { text: `${sc.score[1]}-${sc.score[0]}` }))),
        !(m.scoring || []).length ? el('div.st-empty', { text: 'No points scored.' }) : null));
    // Injuries: the diagnosis is known now (during the game it was only "questionable" or "out").
    const injuries = () => el('div.pg-panel', {}, el('div.pg-ptitle', { text: halftime ? 'INJURIES' : 'INJURY REPORT' }),
      el('div.pg-scoring', {}, ...(session.injuries || []).map((i) => el('div.pg-sc', {}, el('small', { text: m.teams[i.team].abbr }), el('b', { text: i.pos }),
        el('span', { text: `${i.name}: ${halftime ? (i.status === 'out' ? 'out' : i.status === 'returned' ? 'returned' : 'questionable') : injuryLine({ name: i.type || i.name, weeks: i.weeks, severe: i.severe })}${i.setback ? ' (aggravated)' : ''}` }), el('em', { text: '' }))),
        !(session.injuries || []).length ? el('div.st-empty', { text: 'No injuries.' }) : null));
    // Win probability: the home team's chance after every play, 50% line, and the biggest swings.
    const winPanel = () => {
      const log = m.wpLog || [];
      const W = 300, H = 150;
      const x = (i) => 6 + (i * (W - 12)) / Math.max(1, log.length - 1), y = (v) => 8 + (1 - v) * (H - 16);
      const pts = log.map((e, i) => `${x(i).toFixed(1)},${y(e.wp).toFixed(1)}`).join(' ');
      const swings = log.slice(1).map((e, i) => ({ e, d: e.wp - log[i].wp })).sort((a2, b2) => Math.abs(b2.d) - Math.abs(a2.d)).slice(0, 3);
      const chart = el('div.pg-chart', { html: `<svg viewBox="0 0 ${W} ${H}"><line x1="0" x2="${W}" y1="${y(0.5)}" y2="${y(0.5)}" stroke="#555" stroke-dasharray="4 4"/>
        <text x="4" y="14" fill="#aaa" font-size="11">${h.abbr}</text><text x="4" y="${H - 4}" fill="#aaa" font-size="11">${a.abbr}</text>
        <polyline fill="none" stroke="#fff" stroke-width="2.5" points="${pts}"/></svg>` });
      const last = log.length ? log[log.length - 1].wp : 0.5;
      return el('div.pg-panel', {}, el('div.pg-ptitle', { text: 'WIN PROBABILITY' }),
        el('div.st-team-filter', { text: `${h.abbr} ${Math.round(last * 100)}% · ${a.abbr} ${Math.round((1 - last) * 100)}%` }), chart,
        el('div.pg-scoring', {}, el('div.pg-sub', { text: 'Biggest swings' }), ...swings.map(({ e, d }) => el('div.pg-sc', {}, el('small', { text: `${e.q <= 4 ? `Q${e.q}` : 'OT'} ${clockShort(e.clock)}` }),
          el('b', { text: `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%` }), el('span', { text: e.text.replace(/^.*?: /, '') }), el('em', { text: d > 0 ? h.abbr : a.abbr }))),
          !swings.length ? el('div.st-empty', { text: 'No plays yet.' }) : null));
    };
    // Right panel: one at a time, LB/RB switches (the menu stays short).
    const PANELS = [['quarters', 'Quarters', quarters], ['wp', 'Win %', winPanel], ['team', 'Team', teamStats], ['summary', 'Scoring', summary], ['injuries', 'Injuries', injuries]];
    const pi = Math.max(0, PANELS.findIndex(([k]) => k === panel));
    const right = el('div.pg-side', {},
      el('div.pg-tabs', {}, el('b.btn.LB', { text: 'LB' }), ...PANELS.map(([k, label], i) => el(`span${i === pi ? '.on' : ''}`, { text: label })), el('b.btn.RB', { text: 'RB' })),
      PANELS[pi][2]());
    const redo = (p, at = 0) => this.gameOver(session, { onDone, onStats, onHighlights, onRestart, doneLabel, halftime }, p, at);
    const item = (label, act) => { const it = el(`div.pz-item${act ? '' : '.disabled'}`, {}, el('span', { text: label })); it.activate = act || (() => {}); return it; };
    const items = [
      item(halftime ? 'Start 2nd Half' : doneLabel.toUpperCase(), onDone),
      halftime ? null : item('View Highlights', onHighlights),
      item('Player Stats', onStats),
      halftime ? null : item('Restart', onRestart),
    ].filter(Boolean);
    const teamHead = (t, right) => el(`div.pg-team${right ? '.right' : ''}`, {}, el('div.pg-logo', {}, logoCanvas(t.logo, 96)),
      el('div.pg-tname', {}, el('small', { text: t.city.toUpperCase() }), el('b', { text: t.name.toUpperCase() })));
    this.frame(`mono-screen pg-screen${halftime ? ' halftime-screen' : ''}`, el('h1', { text: halftime ? 'Halftime' : 'Post Game' }),
      el('div.pg-main', {},
        el('div.pz-list', {}, items),
        el('div.pg-center', {},
          el('div.pg-score', {}, teamHead(a, false),
            el('div.pg-num', {}, el('small', { text: halftime ? 'HALFTIME' : m.ot ? 'FINAL / OT' : 'FINAL' }), el('b', { text: `${m.score[1]} - ${m.score[0]}` })),
            teamHead(h, true)),
          el('div.pg-qbs', {}, qbCard(1, false), qbCard(0, true)),
          el('div.pg-leadrow', {}, leaders(1), leaders(0))),
        right),
      el('div.setup-help.pz-help', { html: '▲▼ Move &nbsp; <b class="btn A">A</b> Select &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> Quarters · Win % · Team · Scoring · Injuries' + (halftime ? '' : ' &nbsp; <b class="btn B">B</b> Finish') }));
    const idx = Math.min(focus, items.length - 1);
    this.nav.set(items, { columns: 1, onBack: halftime ? () => {} : onDone, index: idx,
      onTab: (d) => redo(PANELS[(pi + d + PANELS.length) % PANELS.length][0], this.nav.index) });
  }
}
