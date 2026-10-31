import { el } from './nav.js';
import { logoCanvas } from '../render/logo.js';
import { teamRatings } from '../data/positions.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { KEY_HELP } from '../input/keyboard.js';
import { gameXP, lineText } from '../franchise/career.js';
import { DRILLS, DRILL_IDS, MEDALS, medalFor } from '../game/drills.js';
import { SCENARIOS } from '../game/scenarios.js';

const SETTINGS_KEY = 'g27.settings';
export const DEFAULT_PREFS = { home: 20, away: 28, side: 'home', difficulty: 'pro', quarterMinutes: 5, accelClock: 20, penalties: true, weather: 'random', time: 'random',
  nameTags: true, statCard: true, autoReplay: true, intro: true, careerCam: 'player', camera: 'standard', sliders: null,
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
function featuredCard(teams) {
  const pool = [];
  teams.forEach((t) => t.roster?.forEach((p) => { if (!['K', 'P', 'T', 'G', 'C', 'FB'].includes(p.pos)) pool.push({ p, t }); }));
  pool.sort((a, b) => (b.p.ovr ?? 0) - (a.p.ovr ?? 0));
  const top = pool.slice(0, 40);
  if (!top.length) return el('div.mm-feature');
  // The menu is UI, not the sim: Math.random is fine here (a different star each visit).
  const { p, t } = top[Math.floor(Math.random() * top.length)];
  const c = t.colors;
  const jersey = `<svg viewBox="0 0 200 220" class="mm-jersey"><path d="M58 14 L82 6 Q100 22 118 6 L142 14 L192 44 L172 96 L150 86 L150 214 L50 214 L50 86 L28 96 L8 44 Z" fill="${c.primary}" stroke="${c.secondary}" stroke-width="5"/>
    <path d="M82 6 Q100 22 118 6" fill="none" stroke="${c.secondary}" stroke-width="8"/>
    <text x="100" y="${p.last.length > 9 ? 62 : 64}" text-anchor="middle" font-family="Saira Condensed, sans-serif" font-weight="800" font-size="${p.last.length > 9 ? 17 : 21}" fill="${c.secondary}" letter-spacing="2">${p.last.toUpperCase()}</text>
    <text x="100" y="168" text-anchor="middle" font-family="Saira Condensed, sans-serif" font-weight="900" font-size="96" fill="${c.secondary}" stroke="${c.accent || '#fff'}" stroke-width="2">${p.number}</text></svg>`;
  return el('div.mm-feature', {}, el('div.mm-jersey-wrap', { html: jersey }),
    el('div.mm-player', {}, el('small', { text: `${p.pos} · ${t.city.toUpperCase()} ${t.name.toUpperCase()}` }), el('b', { text: `${p.first} ${p.last}` }),
      el('div.mm-ovr', {}, el('b', { text: String(p.ovr) }), el('small', { text: 'OVR' }))));
}

/** A line-art controller with a label (Team Select / Controller Select). */
function padIcon(label) {
  return el('div.ts-pad', { html: `${ICONS.pad}<small>${label}</small>` });
}

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
    this.frame('mono-main', el('div.mm-stage', {}, featuredCard(info.teams || []),
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
  playNow(teams, prefs, { onStart, onBack }, p = { ...prefs }) {
    const box = (key, label) => {
      const it = el('div.ts-team');
      const draw = () => {
        const t = teams[p[key]];
        const r = teamRatings(t);
        it.innerHTML = '';
        it.append(el('div.ts-side', { text: label }), el('div.ts-logo', {}, logoCanvas(t.logo, 200)),
          el(`div.ts-card.${key}`, {}, el('div.ts-ovr', {}, el('b', { text: String(r.ovr) }), el('small', { text: 'OVR' })),
            el('div.ts-name', {}, el('small', { text: t.city.toUpperCase() }), el('b', { text: t.name.toUpperCase() })),
            el('div.ts-sub', { text: `OFF ${r.off} · DEF ${r.def}` })));
      };
      it.spin = (d) => { p[key] = (p[key] + d + teams.length) % teams.length; if (p.home === p.away) p[key] = (p[key] + d + teams.length) % teams.length; draw(); };
      it.activate = () => this.gameSettings(teams, p, { onStart, onBack: () => this.playNow(teams, prefs, { onStart, onBack }, p) });
      draw();
      return it;
    };
    const away = box('away', 'AWAY'), home = box('home', 'HOME');
    const SIDES = ['away', 'cpu', 'home', '2p'];
    const pads = el('div.ts-pads');
    pads.spin = (d) => { p.side = SIDES[(SIDES.indexOf(p.side) + d + SIDES.length) % SIDES.length]; drawPads(); };
    pads.activate = away.activate;
    const drawPads = () => {
      const col = (n) => el(`div.ts-padcol${n === 1 ? '.mid' : ''}`, {}, ...(
        p.side === '2p' ? (n === 0 ? [padIcon('P2')] : n === 2 ? [padIcon('P1')] : [])
          : (n === SIDES.indexOf(p.side) ? [padIcon('P1')] : [])));
      pads.innerHTML = '';
      pads.append(col(0), col(1), col(2), el('div.ts-padnote', { text: p.side === 'cpu' ? 'Watch: CPU vs CPU' : p.side === '2p' ? 'Two players: P1 home, P2 away' : `You play ${p.side === 'home' ? 'home' : 'away'}` }));
    };
    drawPads();
    this.frame('mono-screen ts-screen', el('h1', { text: 'Team Select' }),
      el('div.ts-row', {}, away, el('div.ts-at', { text: '@' }), home), pads,
      el('div.setup-help', { html: '▲▼ Teams / controllers &nbsp; ◀▶ Change &nbsp; <b class="btn A">A</b> Next: game settings &nbsp; <b class="btn B">B</b> Back' }));
    this.nav.set([away, home, pads], { columns: 1, onBack, index: 2 });
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
    add('Coaching', onDepth, 'depth chart · this game');
    add('Instant Replay', onReplay);
    add('Settings', onSettings);
    add('Controls', onControls);
    add('Controller Select', onController);
    add('Restart', onRestart);
    add(game?.practice ? 'Quit Practice' : 'Quit', onQuit);
    const qb = (q, t, right) => el(`div.pz-qb${right ? '.right' : ''}`, {},
      el('div.pz-head', {}, el('div.pz-name', {}, el('small', { text: q ? `#${q.number}` : '' }), el('b', { html: q ? `${q.first.toUpperCase()}<br>${q.last.toUpperCase()}` : '' })),
        el('div.pz-logo', {}, logoCanvas(t.logo, 110))),
      el('div.pz-stats', {}, el('div.pz-ring', {}, el('b', { text: q ? q.comp : '0.0' }), el('small', { text: 'COMP%' })),
        el('div.pz-nums', {}, el('b', { text: String(q?.yds ?? 0) }), el('small', { text: 'YDS' }), el('b', { text: String(q?.td ?? 0) }), el('small', { text: 'TDS' }))));
    const title = game?.practice ? 'Practice' : game?.mode || 'Play Now';
    this.frame('mono-screen pz-screen', el('h1', { text: title }),
      el('div.pz-main', {}, el('div.pz-list', {}, items),
        game?.home ? el('div.pz-matchup', {}, qb(game.qbs?.[1], game.away, false), qb(game.qbs?.[0], game.home, true)) : el('div')),
      el('div.pz-situation', { text: game ? `${game.practice ? 'Practice' : `${game.quarter} · ${game.clock}`} · ${game.down || ''}` : '' }),
      el('div.setup-help.pz-help', { html: '<b class="btn A">A</b> Select &nbsp; ▲▼ Move &nbsp; <b class="btn B">B</b> Resume' }));
    this.nav.set(items, { columns: 1, onBack: onResume });
  }

  /** Final box score; `halftime: true` makes it the halftime report (no player of the game, Start 2nd Half). */
  gameOver(session, { onDone, onStats, doneLabel = 'Main Menu', halftime = false }) {
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
    // Player of the game: the biggest stat line (same production score as career XP), a winner's player on ties.
    const potg = ps.map((x) => ({ x, v: gameXP(x) + (x.team === m.winner ? 15 : 0) })).sort((p1, p2) => p2.v - p1.v)[0]?.x;
    const potgP = potg && m.teams[potg.team].roster.find((x) => x.id === potg.rid);
    const potgCard = potgP && !halftime ? el('div.potg', { style: { '--tc': m.teams[potg.team].colors.primary } },
      el('small', { text: 'PLAYER OF THE GAME' }), el('b', { text: `#${potgP.number} ${potgP.first} ${potgP.last}` }),
      el('span', { text: `${m.teams[potg.team].abbr} ${potgP.pos} · ${lineText(potg)}` })) : null;
    const done = el('div.start-btn', { text: doneLabel });
    done.activate = onDone;
    const stats = el('div.start-btn.secondary', { text: 'Full Stats' });
    stats.activate = onStats;
    this.frame(halftime ? 'over-screen halftime-screen' : 'over-screen',
      el('h1', { text: halftime ? 'Halftime' : 'Final' }),
      el('div.final-score', {}, logoCanvas(a.logo, 90), el('div.fs', { text: `${a.abbr} ${m.score[1]}  –  ${m.score[0]} ${h.abbr}` }), logoCanvas(h.logo, 90)),
      el('div.final-sub', { text: halftime ? 'First half leaders and team stats' : m.ot ? 'Overtime' : '' }),
      potgCard,
      el('div.final-cols', {}, el('div', { html: table }), el('ul.leaders', {}, lead.map((l) => el('li', { text: l })))),
      el('div.over-buttons', {}, stats, done));
    this.nav.set([stats, done], { columns: 2, onBack: halftime ? () => {} : onDone, index: 1 }); // halftime: only the button starts the 2nd half
  }
}
