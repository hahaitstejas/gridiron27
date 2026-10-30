// Bundled font (offline): Saira Condensed for every menu, HUD and canvas text.
import { downText, yardLineText, clockText } from './game/match.js';
import '@fontsource/saira-condensed/400.css';
import '@fontsource/saira-condensed/500.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/700.css';
import '@fontsource/saira-condensed/800.css';
import { STEP } from './core/constants.js';
import { defaultTeams } from './data/teams.js';
import { generateLeagueRosters } from './data/generator.js';
import { loadLocalLeague } from './data/localLeague.js';
import { deserializeLeague } from './data/league.js';
import { activeSlot, readSave, setActiveSlot } from './data/storage.js';
import { LeagueUI, attachLogos, baseLeagueSlot } from './ui/league.js';
import { rosterScreen } from './ui/rosterEditor.js';
import { teamEditor, leagueEditor } from './ui/teamEditor.js';
import { LEAGUE } from './data/leagueInfo.js';
import { spreadsheetScreen } from './ui/spreadsheets.js';
import { TournamentUI } from './ui/tournament.js';
import { FranchiseUI } from './ui/franchise.js';
import { offseasonScreen } from './ui/offseason.js';
import { unavailableFor, gameConditions, recordOf } from './franchise/franchise.js';
import { PLAYOFF_ROUND_NAMES } from './franchise/season.js';
import { makeConditions, conditionsText } from './game/weather.js';
import { introShot, INTRO_T } from './render/intro.js';
import { TRAITS } from './data/traits.js';
import { RNG } from './core/rng.js';
import { InputManager } from './input/input.js';
import { GameRenderer } from './render/renderer.js';
import { GameSession } from './game/session.js';
import { Hud } from './ui/hud.js';
import { Nav, el } from './ui/nav.js';
import { Screens, loadPrefs, savePrefs } from './ui/screens.js';
import { PlayCallScreen } from './ui/playcall.js';
import { ReplayPlayer } from './replay/replay.js';
import { depthChartScreen } from './ui/depthEditor.js';
import { playbookScreen } from './ui/playbookEditor.js';
import { registerCustomPlays, loadSpecs } from './data/customPlays.js';
import { statsScreen } from './ui/statsScreen.js';
import { energyOf } from './game/fatigue.js';
import { playArt } from './game/playArt.js';
import { scenarioById, scenarioFinal } from './game/scenarios.js';
import { crowdNoise } from './game/penalties.js';
const SPECIAL_ART = new Set(['kickoff', 'punt', 'fg', 'kneel', 'spike']);

// ---- Boot ----
const params = new URLSearchParams(location.search);
const teams = generateLeagueRosters(defaultTeams(), 2027);
const prefs = loadPrefs();
// A saved league (Phase 4) wins; without one, the optional spreadsheets in public/local/ apply.
let saved = null;
try {
  let slot = activeSlot();
  saved = slot ? deserializeLeague(await readSave(slot)) : null;
  // A franchise is fictional: start up on the league it came from, never on its rosters (it loads from the Franchise menu).
  if (saved?.franchise) {
    slot = await baseLeagueSlot(saved.franchise.baseSlot);
    setActiveSlot(slot);
    saved = slot ? deserializeLeague(await readSave(slot)) : null;
    if (saved?.franchise) saved = null;
  }
} catch (e) { console.warn('Could not load the saved league', e); }
let local = null;
if (saved) {
  teams.splice(0, teams.length, ...saved.teams);
  await attachLogos(teams);
  if (saved.playAs !== null) prefs.home = saved.playAs;
} else local = await loadLocalLeague(teams);
if (local?.playAs !== null && local?.playAs !== undefined) prefs.home = local.playAs;
else if (local?.rosterTeams?.length === 1) prefs.home = teams.findIndex((t) => t.abbr === local.rosterTeams[0]);
if (prefs.away === prefs.home) prefs.away = (prefs.home + 8) % 32;

let input2 = null;
const input = new InputManager({ other: () => input2?.padIndex ?? -1 });
input2 = new InputManager({ keyboard: false, other: () => input.padIndex }); // player 2 (local 2-player)
let p2Wait = null; // start callback waiting for player 2's controller
const hud = new Hud(document.getElementById('hud'));
// Canvas text (field numbers, end zones, jerseys, logos, video boards) is painted once: wait for the font first.
try { await Promise.all(['500', '700', '800'].map((w) => document.fonts.load(`${w} 40px "Saira Condensed"`))); } catch { /* fall back */ }
const renderer = new GameRenderer(document.getElementById('game'), teams[prefs.home], teams[prefs.away]);
const nav = new Nav();
const screens = new Screens(document.getElementById('screen'), nav);
const playcall = new PlayCallScreen(document.getElementById('playcall'), new Nav());
hud.prefs = prefs;
const league = new LeagueUI({
  teams, prefs, screens,
  onExit: () => toMenu(),
  // The default league plus any public/local spreadsheets (what a fresh start loads).
  loadDefault: async () => {
    const t = generateLeagueRosters(defaultTeams(), 2027);
    await loadLocalLeague(t);
    return { teams: t, name: 'My League' };
  },
  onLeagueReplaced: () => {
    prefs.home = Math.min(prefs.home, teams.length - 1);
    if (prefs.away === prefs.home || prefs.away >= teams.length) prefs.away = (prefs.home + 8) % teams.length;
    renderer.setTeams(teams[prefs.home], teams[prefs.away]);
  },
});
if (saved) { league.name = saved.name; league.franchise = saved.franchise; }
// The user's own plays (League → Playbook) live in this browser, outside league saves.
try { registerCustomPlays(loadSpecs()); } catch (e) { console.warn('Could not load custom plays', e); }
const pickTeam = (title, onPick, onBack, focus = prefs.home) => screens.teamPicker(teams, focus, { title, onPick, onBack });
const rosterCtx = { screens, teams, onBack: () => league.menu(0), onChange: () => league.changed(), pickTeam };
const teamCtx = { screens, teams, prefs, pickTeam, onChange: () => { savePrefs(prefs); league.changed(); },
  onBack: () => { renderer.setTeams(teams[prefs.home], teams[prefs.away]); league.onTeams(); } };
league.onTeams = (focus = prefs.home) => screens.teamPicker(teams, focus, {
  title: 'Teams & logos: pick a team', onPick: (i) => teamEditor(teamCtx, i), onBack: () => league.menu(1),
  extra: { label: 'League & Conferences', sub: `${LEAGUE.name} · logo, names`, logo: LEAGUE.logo,
    onPick: () => leagueEditor({ ...teamCtx, onBack: () => league.onTeams(-1) }) },
});
const tournamentUI = new TournamentUI({
  teams, prefs, screens, onExit: () => toMenu(),
  playGame: (t, g) => startGame({ home: g.home, away: g.away, side: g.home === t.userTeam ? 'home' : 'away', difficulty: t.difficulty, quarterMinutes: t.quarterMinutes },
    { tournament: g, noTies: true, neutral: true }),
});
const franchiseUI = new FranchiseUI({
  teams, prefs, screens, league, pickTeam, tournament: () => tournamentUI.open(),
  onExit: () => toMenu(),
  playGame: (g) => {
    const f = league.franchise;
    startGame({ home: g.home, away: g.away, side: g.home === f.userTeam ? 'home' : 'away', difficulty: f.settings.difficulty,
      quarterMinutes: f.settings.quarterMinutes }, { franchise: g, noTies: f.phase === 'playoffs', unavailable: unavailableFor(teams, g), conditions: gameConditions(f, g), lockPlayer: f.career?.rid ?? null });
  },
  rosterScreen: (ti, back) => rosterScreen({ ...rosterCtx, onBack: back }, ti),
  depthScreen: (ti, back) => depthChartScreen(screens, teams[ti], { onDone: back, onChange: () => league.changed() }),
  offseason: (ui) => offseasonScreen({ screens, teams, league, onExit: () => toMenu() }, ui),

});
league.onPlaybook = () => playbookScreen({ screens, teams, onBack: () => league.menu(3) });
league.onSpreadsheets = () => spreadsheetScreen({ screens, teams, prefs, onBack: () => league.menu(4), onChange: () => { savePrefs(prefs); league.changed(); } });
league.onRosters = () => pickTeam('Rosters: pick a team', (i) => rosterScreen(rosterCtx, i), () => league.menu(0));
league.onDepth = () => {
  // Pick a team, then edit its depth chart.
  const pick = (i) => depthChartScreen(screens, teams[i], { onDone: () => league.menu(2), onChange: () => league.changed() });
  screens.teamPicker(teams, prefs.home, { title: 'Depth chart: pick a team', onPick: pick, onBack: () => league.menu(2) });
};
const applyCamera = () => {
  renderer.rig.mode = prefs.camera === 'high' ? 'sky' : 'broadcast';
  renderer.rig.zoom = { wide: 1.3, tight: 0.8 }[prefs.camera] || 1;
};
applyCamera();

let app = 'title'; // title | menu | game | paused | over | replay
let replay = null; // instant replay viewer state
let autoReplayPending = false; // a big play just happened: show it once the play is over
let session = null;
let speed = 1;
let snapCam = true;
let lastSim = null;
let padName = '';

function toMenu() {
  // Leaving a franchise: its trades and signings stay in its save; the menus get the real league back.
  if (league.franchise) { league.leaveFranchise().then(toMenu, (e) => { console.warn(e); league.franchise = null; toMenu(); }); return; }
  app = 'menu';
  session = null;
  lastSim = null;
  hud.hideAll();
  playcall.hide();
  screens.mainMenu({
    onPlayNow: () => screens.playNow(teams, prefs, { onStart: startGame, onBack: toMenu }),
    onPractice: showPractice,
    onLeague: () => league.menu(),
    onFranchise: () => franchiseUI.open(),
    onControls: () => screens.controls({ onBack: toMenu }),
    onSettings: () => screens.settings(prefs, { onSave: (p) => { Object.assign(prefs, p); savePrefs(prefs); applyCamera(); toMenu(); }, onBack: toMenu }),
    onPlaybook: () => playbookScreen({ screens, teams, onBack: toMenu }),
    onSaves: () => league.saves(0, toMenu),
  }, {
    home: teams[prefs.home], away: teams[prefs.away], mine: teams[prefs.home], leagueName: league.slot ? league.name : null,
    franchise: league.franchise ? { team: teams[league.franchise.userTeam]?.name, year: league.franchise.year } : null,
  });
}

function startGame(p, opts = {}) {
  autoReplayPending = false;
  // Franchise games don't touch the Play Now preferences.
  const cfg = opts.franchise ? { ...prefs, ...p } : Object.assign(prefs, p);
  if (!opts.franchise) savePrefs(prefs);
  const home = teams[cfg.home], away = teams[cfg.away];
  // Local 2-player needs a second controller: ask player 2 to press A first.
  if (cfg.side === '2p' && !input2.connected) {
    input2.claiming = true;
    screens.frame('menu-screen', el('div.logo-small', { html: '2 PLAYERS' }),
      el('div.league-status', { text: 'Player 2: press A on the second controller (player 1 is home, player 2 is away)' }));
    screens.nav.set([], { onBack: () => { p2Wait = null; toMenu(); } });
    p2Wait = () => startGame(p, opts);
    return;
  }
  const humanTeam = cfg.side === 'cpu' || cfg.side === '2p' ? null : cfg.side === 'home' ? 0 : 1;
  const seed = opts.seed ?? (Date.now() % 1e9);
  const conditions = opts.conditions || makeConditions(new RNG(seed + 77), cfg.weather || 'random', cfg.time || 'random');
  session = new GameSession({
    teams: [home, away],
    settings: { quarterMinutes: cfg.quarterMinutes, accelClock: cfg.accelClock, difficulty: cfg.difficulty, penalties: opts.practice ? false : cfg.penalties, practice: opts.practice || null, drill: opts.drill || null, scenario: opts.scenario || null, noTies: !!opts.noTies, neutral: !!opts.neutral, sliders: prefs.sliders, unavailable: opts.unavailable || null, weather: conditions, lockPlayer: opts.lockPlayer ?? null, playerCam: prefs.careerCam !== 'broadcast' },
    humanTeam,
    humanTeams: cfg.side === '2p' ? [0, 1] : null,
    seed,
  });
  session.franchiseGame = opts.franchise || null;
  session.drillPrefs = opts.drillPrefs || null;
  session.tournamentGame = opts.tournament || null;
  session.scenarioPrefs = opts.scenarioPrefs || null;
  // Season records on the scorebug (franchise games; exhibitions show 0-0).
  if (opts.franchise && league.franchise) session.records = [home, away].map((t) => { const r = recordOf(league.franchise, teams, teams.indexOf(t)); return `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`; });
  // The championship game: league logo at midfield.
  const f = league.franchise;
  const championship = !!(opts.franchise && f?.phase === 'playoffs' && f.playoffs.rounds.length >= PLAYOFF_ROUND_NAMES.length);
  renderer.setTeams(home, away, { championship });
  renderer.setConditions(conditions);
  hud.ticker(conditionsText(conditions));
  screens.clear();
  hud.toggleHelp(false);
  app = 'game';
  snapCam = true;
  lastSim = null;
  speed = opts.speed || 1;
  for (const e of session.events) onSessionEvent(e);
  // Pregame intro (not in practice, fast CPU games or when turned off in Settings).
  if (prefs.intro !== false && !opts.practice && speed <= 1 && !opts.noIntro) {
    app = 'intro';
    intro = { t: 0 };
    hud.hideAll();
    const lg = championship ? `${LEAGUE.championship}` : opts.franchise && league.franchise ? `${LEAGUE.name} · ${league.franchise.year} season` : LEAGUE.name;
    hud.intro({ title: lg.toUpperCase(), home, away, recs: session.records, sub: conditionsText(conditions) });
  }
}

let intro = null;
function updateIntro(f, dt) {
  intro.t += dt;
  if (intro.t >= INTRO_T || f.pressed.A || f.pressed.B || f.pressed.Menu || f.pressed.X) endIntro();
}
function endIntro() {
  intro = null;
  hud.intro(null);
  app = 'game';
  snapCam = false; // the game camera eases in from the last intro shot
}

function startReplay(auto = false) {
  if (!session?.lastReplay) return;
  const player = new ReplayPlayer(session.lastReplay);
  const dir = player.ghost.dir;
  replay = { player, playing: true, speed: 1, yaw: dir > 0 ? Math.PI - 0.55 : -0.55, pitch: 0.42, dist: 24, fresh: true, auto, endT: 0, dir, angle: 0 };
  app = 'replay';
  screens.clear();
  playcall.hide();
  hud.hideAll();
  renderer.players.setColors(player.ghost, session.teams);
  lastSim = null;
}

function endReplay() {
  replay = null;
  hud.replayView(null);
  app = 'game';
  snapCam = true;
}

// Replay camera presets: yaw relative to the view from behind the offense.
const REPLAY_ANGLES = [
  { name: 'Broadcast', yaw: -0.55, pitch: 0.42, dist: 24 },
  { name: 'End zone', yaw: 0, pitch: 0.22, dist: 26 },
  { name: 'Sideline', yaw: -Math.PI / 2, pitch: 0.3, dist: 26 },
  { name: 'Reverse', yaw: Math.PI, pitch: 0.28, dist: 24 },
  { name: 'Sky cam', yaw: -0.2, pitch: 1.25, dist: 30 },
  { name: 'Tight', yaw: -0.9, pitch: 0.16, dist: 9 },
];

function updateReplay(f, dt) {
  const r = replay;
  // An automatic replay gets out of the way as soon as you press anything (you're picking a play).
  if (f.pressed.B || f.pressed.Menu || (r.auto && (f.pressed.A || f.pressed.X || f.pressed.Y))) { endReplay(); return; }
  if (f.pressed.A) r.playing = !r.playing;
  if (f.pressed.X) r.speed = r.speed < 1 ? 1 : 0.25;
  if (f.pressed.Y) { r.player.seek(0); r.playing = true; }
  // LB / RB: preset camera angles (the right stick still orbits from there).
  if (f.pressed.LB || f.pressed.RB) {
    r.angle = (r.angle + (f.pressed.RB ? 1 : -1) + REPLAY_ANGLES.length) % REPLAY_ANGLES.length;
    const a = REPLAY_ANGLES[r.angle], behind = r.dir > 0 ? Math.PI : 0;
    r.yaw = behind + a.yaw * (r.dir > 0 ? 1 : -1); r.pitch = a.pitch; r.dist = a.dist;
  }
  let t = r.player.t;
  if (Math.abs(f.lx) > 0.2) { t += f.lx * dt * 3; r.playing = false; }
  else if (r.playing) t += dt * r.speed;
  if (t >= r.player.duration) { t = r.player.duration; r.playing = false; }
  // An automatic replay closes itself shortly after the end.
  if (r.auto && t >= r.player.duration && (r.endT += dt) > 1) { endReplay(); return; }
  r.alpha = r.player.seek(t);
  r.yaw += (f.rx || 0) * dt * 2;
  r.pitch = Math.min(1.35, Math.max(0.08, r.pitch - (f.ry || 0) * dt * 1.5));
  r.dist = Math.min(60, Math.max(6, r.dist + ((f.lt || 0) - (f.rt || 0)) * dt * 25));
}

/** Halftime: the game stops on a full-screen report until the player starts the second half. */
function showHalftime() {
  app = 'halftime';
  hud.hideAll();
  playcall.hide();
  screens.gameOver(session, { halftime: true, doneLabel: 'Start 2nd Half',
    onDone: () => { screens.clear(); app = 'game'; snapCam = true; },
    onStats: () => statsScreen(screens, session.match, { onBack: showHalftime }) });
}

function showPractice() {
  screens.practice(teams, prefs, { onStart: (p, practice) => startGame({ ...p, side: 'home' }, { practice }), onDrills: showDrills, onScenarios: showScenarios, onBack: toMenu });
}

// Skills drills: best scores per browser (localStorage g27.drills).
const drillBests = () => { try { return JSON.parse(localStorage.getItem('g27.drills') || '{}'); } catch { return {}; } };
function showDrills(p) {
  app = 'menu';
  const t = teams[p.home];
  screens.drills(drillBests(), `${t.city} ${t.name}`, { onStart: (id) => startGame({ ...p, side: 'home' }, { practice: { drill: true }, drill: { id }, drillPrefs: p }), onBack: showPractice });
}
function showDrillResult() {
  const drill = session.drill, p = session.drillPrefs;
  const bests = drillBests();
  const best = Math.max(bests[drill.id] ?? -Infinity, drill.score);
  const prev = bests[drill.id];
  bests[drill.id] = best;
  try { localStorage.setItem('g27.drills', JSON.stringify(bests)); } catch { /* private mode: no bests */ }
  leaveGame();
  screens.drillResult(drill, prev ?? drill.score, { onRetry: () => startGame({ ...p, side: 'home' }, { practice: { drill: true }, drill: { id: drill.id }, drillPrefs: p }), onDone: () => showDrills(p) });
}

// Scenarios: beaten ones per browser (localStorage g27.scenarios).
const scenariosDone = () => { try { return JSON.parse(localStorage.getItem('g27.scenarios') || '{}'); } catch { return {}; } };
function showScenarios(p) {
  app = 'menu';
  const startScenario = (id) => startGame({ ...p, side: 'home', quarterMinutes: 15 }, { scenario: { id }, scenarioPrefs: p, noIntro: true });
  screens.scenarios(scenariosDone(), `${teams[p.home].abbr} vs ${teams[p.away].abbr}`, { onStart: startScenario, onBack: showPractice });
}
function showScenarioResult() {
  const sc = scenarioById(session.scenario.id), p = session.scenarioPrefs;
  const verdict = session.scenario.result || scenarioFinal(session.match);
  if (verdict.success) { const d = scenariosDone(); d[sc.id] = true; try { localStorage.setItem('g27.scenarios', JSON.stringify(d)); } catch { /* no storage */ } }
  leaveGame();
  screens.scenarioResult(sc, verdict, { onRetry: () => startGame({ ...p, side: 'home', quarterMinutes: 15 }, { scenario: { id: sc.id }, scenarioPrefs: p, noIntro: true }), onDone: () => showScenarios(p) });
}

function showFinal() {
  screens.extraButtons = null;
  const g = session.franchiseGame, tg = session.tournamentGame;
  const done = g ? () => { const m = session.match, inj = session.injuries; leaveGame(); franchiseUI.recordPlayed(g, m, inj); }
    : tg ? () => { const m = session.match; leaveGame(); tournamentUI.recordPlayed(tg, m); } : toMenu;
  screens.gameOver(session, { onDone: done, doneLabel: g ? 'Back to Franchise' : tg ? 'Back to the Bracket' : 'Main Menu', onStats: () => statsScreen(screens, session.match, { onBack: showFinal }) });
}

/** Back to the menus from a game (no main menu: the caller shows the next screen). */
function leaveGame() {
  app = 'menu';
  session = null;
  lastSim = null;
  hud.hideAll();
  playcall.hide();
}

function pause() {
  app = 'paused';
  screens.pause({
    onResume: () => { screens.clear(); app = 'game'; },
    // Timeouts can be called between plays (play call or at the line before the snap), not in practice.
    onTimeout: session && session.humanTeam !== null && !session.practice && session.match.timeouts[session.humanTeam] > 0
      && (session.state === 'playcall' || (session.state === 'presnap' && session.sim?.state === 'presnap'))
      ? () => { session.callTimeout(session.humanTeam); for (const e of session.events.splice(0)) onSessionEvent(e); screens.clear(); app = 'game'; } : null,
    timeoutsLeft: session?.match.timeouts[session?.humanTeam] ?? 0,
    onStats: session ? () => statsScreen(screens, session.match, { onBack: () => { screens.extraButtons = null; pause(); } }) : null,
    onDepth: session && session.humanTeam !== null ? () => depthChartScreen(screens, session.teams[session.humanTeam], {
      energy: (id) => energyOf(session.energy, session.humanTeam, id), onDone: pause, onChange: () => league.changed() }) : null,
    onControls: () => screens.controls({ onBack: pause }),
    // Quitting a franchise game goes back to the hub (the game isn't recorded: play or sim it again).
    onQuit: session?.franchiseGame ? () => { leaveGame(); franchiseUI.hub(); } : session?.tournamentGame ? () => { leaveGame(); tournamentUI.open(); } : toMenu,
    game: session ? pauseInfo(session) : null,
  });
}

/** The stadium video boards: the live score, or a flash after a score or a takeaway. */
let boardFlash = null;
function boardFrame(m, dt) {
  if (boardFlash && (boardFlash.t -= dt) <= 0) boardFlash = null;
  const ord = (q) => (q > 4 ? 'OT' : ['1ST', '2ND', '3RD', '4TH'][q - 1]);
  renderer.stadium.setBoardGame(m.teams[0], m.teams[1], { score: m.score, q: m.over ? 'FINAL' : ord(m.quarter), clock: m.over ? '' : clockText(m.clock),
    down: m.phase === 'scrimmage' && !m.over ? downText(m).toUpperCase() : '', flash: boardFlash });
}
function flashBoard(text, team) { boardFlash = { text, color: session?.teams[team]?.colors.primary || '#c8102e', t: 4 }; }

function pauseInfo(s) {
  const m = s.match, [home, away] = m.teams;
  const ord = (q) => q > 4 ? 'OT' : ['1st', '2nd', '3rd', '4th'][q - 1];
  const down = m.phase === 'scrimmage' ? `${downText(m)} · ${m.teams[m.possession].abbr} ball on the ${yardLineText(m)}` : m.phase === 'try' ? 'Extra point try' : 'Kickoff';
  const mine = s.humanTeam !== null ? m.teams[s.humanTeam] : home;
  return { home, away, score: m.score, quarter: ord(m.quarter), clock: clockText(m.clock), down, practice: !!s.practice, accent: mine.colors.primary };
}

input.onConnect = (id) => {
  padName = id;
  hud.ticker('Controller connected');
  if (app === 'title') toMenu();
};
window.addEventListener('keydown', (e) => {
  if (app === 'title' && (e.code === 'Enter' || e.code === 'Space')) { input.keyboard.tapped.delete(e.code); input.keyboard.keys.delete(e.code); toMenu(); return; }
  if (e.code === 'KeyH' && app === 'game') hud.toggleHelp();
  if (e.code === 'Backquote') hud.fpsShow = !hud.fpsShow;
});

// Debug hooks for automated testing.
window.__g27 = { get session() { return session; }, get app() { return app; }, get replay() { return replay; }, renderer, input, hud, startGame, startReplay, teams, prefs, toMenu, league, franchiseUI, input2, showDrills, showScenarios };

// URL shortcuts: ?auto&speed=6 (CPU vs CPU), ?play (skip menus), ?home=..&away=..
const teamArg = (v) => (/^\d+$/.test(v) ? +v : teams.findIndex((t) => t.abbr.toUpperCase() === v.toUpperCase()));
if (params.has('home')) prefs.home = teamArg(params.get('home'));
if (params.has('away')) prefs.away = teamArg(params.get('away'));
if (params.has('auto')) startGame({ ...prefs, side: 'cpu', quarterMinutes: +(params.get('q') || prefs.quarterMinutes) }, { speed: Math.max(1, +(params.get('speed') || 1)), seed: +(params.get('seed') || 1) });
else if (params.has('play')) startGame({ ...prefs, side: params.get('side') || 'home' }, { seed: +(params.get('seed') || Date.now() % 1e9) });
else screens.title(padName);

/** Make it obvious who ended up with a pass: a call-out with the player and a ring flash in his team's color. */
function passCallout(e) {
  const sim = session?.sim;
  if (!sim || sim.isKick) return;
  const p = sim.players[e.player];
  const who = p ? `#${p.number} ${p.name || ''}`.trim() : '';
  const col = (pl) => { const c = session.teams[pl.team].colors; return pl.team === 1 && isDarkHex(c.primary) ? '#ffffff' : c.primary; };
  const recent = hud.calloutAt && performance.now() - hud.calloutAt < 900;
  if (e.type === 'catch') { hud.callout('CAUGHT', who, '#3ddc84'); renderer.players.flash(e.player, col(p)); }
  else if (e.type === 'interception') { hud.callout('INTERCEPTED', who, '#ff4d4d', 2200); renderer.players.flash(e.player, '#ff4d4d'); }
  else if (e.type === 'drop') hud.callout('DROPPED', who, '#ffb84d');
  else if (e.type === 'oobCatch') hud.callout('OUT OF BOUNDS', who, '#ffb84d');
  else if (e.type === 'deflection' && p && p.team !== sim.possTeam && !recent) hud.callout('BROKEN UP', who, '#7fc4ff');
  else if (e.type === 'incomplete' && e.why !== 'spike' && !recent) hud.callout('INCOMPLETE', '', '#d0d6e0');
}
const isDarkHex = (h) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 90; };

function onSessionEvent(e) {
  renderer.presentation.onEvent(e, session);
  if (prefs.autoReplay && !session?.practice && session?.humanTeam !== null && ['touchdown', 'interception', 'bigHit', 'onsideRecovered'].includes(e.type)) autoReplayPending = true;
  if (e.type === 'message') {
    hud.message(e, session);
    if (e.kind === 'half' && /half/i.test(e.text) && session.humanTeam !== null && !session.practice && speed <= 1) showHalftime();
    if (e.kind === 'score') { const w = session.match.lastScore?.what || ''; flashBoard(/touchdown|pick six/i.test(w) ? 'TOUCHDOWN!' : /field goal/i.test(w) ? 'FIELD GOAL' : /safety/i.test(w) ? 'SAFETY' : '', session.match.lastScore?.team ?? 0); if (!boardFlash.text) boardFlash = null; }
    else if (e.kind === 'turnover') flashBoard(/Intercept/.test(e.text) ? 'INTERCEPTION!' : /downs/.test(e.text) ? 'STOPPED!' : 'TAKEAWAY!', session.match.possession);
  }
  else if (e.type === 'result') { hud.statCard(e.statLines, session.teams); if (session.match.lastPlayText && !session.practice) hud.pbp('PLAY', session.match.lastPlayText); }
  else if (e.type === 'audible') hud.ticker(['Coverage', 'Protection', 'Front'].includes(e.play) ? `${e.play}: ${e.label}` : e.play === 'Hot route' ? `Hot route: ${e.label}` : `Audible: ${e.play}`);
  else if (e.type === 'review' && e.phase === 'review') hud.ticker(e.booth ? 'The booth is reviewing the play' : `${session.teams[e.by].abbr} challenges the ruling`);
  else if (e.type === 'reviewDone') hud.banner(e.reversed ? 'REVERSED' : 'CALL STANDS', e.text.replace(/^After review, /, ''), 2.6, e.reversed ? 'score' : 'miss');
  else if (e.type === 'motion') hud.ticker(`Motion: ${e.player || e.slot}`);
  else if (e.type === 'hotRoute') hud.ticker(`Hot route: ${e.player || e.slot} — ${e.route.replace('_', ' ')}`);
  else if (e.type === 'flag' && e.presnap) hud.flag(e.outcome.text);
  else if (e.type === 'catch' || e.type === 'interception' || e.type === 'drop' || e.type === 'oobCatch' || e.type === 'incomplete' || e.type === 'deflection') passCallout(e);
  else if (e.type === 'scenarioDone') hud.banner(e.success ? 'CHALLENGE COMPLETE' : 'CHALLENGE FAILED', e.text, 2.4, e.success ? 'score' : 'miss');
  else if (e.type === 'iced') hud.banner('TIMEOUT', `${session.teams[e.team].name} ice the kicker`, 2, 'miss');
  else if (e.type === 'drillRep') hud.banner(`${e.pts > 0 ? '+' : ''}${e.pts}`, e.text, 1.6, e.pts > 0 ? 'score' : 'miss');
  else if (e.type === 'kickBlocked') hud.banner('BLOCKED!', e.kind === 'punt' ? 'Punt blocked' : 'Kick blocked', 2.4, 'turnover');
  else if (e.type === 'gameOver') {
    app = 'over';
    playcall.hide();
    setTimeout(() => { if (app === 'over' && session) { hud.hideAll(); if (session.drill) showDrillResult(); else if (session.scenario) showScenarioResult(); else showFinal(); } }, session.drill ? 1500 : 2500);
  } else if (e.type === 'tackle' && e.power > 0.9) renderer.rig.shake = Math.min(1, e.power * 0.5);
  else if (e.type === 'bigHit') { renderer.rig.shake = 1; input.rumble(0.9, 250); }
  else if (e.type === 'tackle') input.rumble(0.35, 110);
  else if (e.type === 'flag') renderer.showFlag?.(e);
  else if (e.type === 'trait') { const p = session?.sim?.players[e.player]; if (p) hud.ticker(`★ ${TRAITS[e.trait]?.name || e.trait}: ${p.name}`); }
  else if (e.type === 'hardCount') hud.ticker(e.result === 'jump' ? 'Hard count: the defense jumped! Free play' : e.result === 'flinch' ? 'Hard count: your line flinched' : 'Hard count: nobody bit');
  else if (e.type === 'watching') hud.ticker('On the sideline: fast-forwarding to your next snap');
}

// ---- Main loop: fixed 60 Hz simulation, render every animation frame ----
let acc = 0;
let last = performance.now();
let time = 0;
let attract = 0;
function frameBody(now) {
  const frameMs = now - last;
  const dt = Math.min(0.1, frameMs / 1000);
  last = now;
  time += dt;
  input.poll(dt);
  input2.poll(dt);
  if (p2Wait && input2.connected) { const go = p2Wait; p2Wait = null; input2.consume(); go(); }
  const f = input.frame;
  let consumed = false;

  if (app === 'title') {
    if (f.pressed.A || f.pressed.Menu) toMenu();
    consumed = true;
  } else if (app === 'menu' || app === 'paused' || app === 'halftime' || (app === 'over' && !screens.root.classList.contains('hidden'))) {
    screens.extraButtons?.(f);
    nav.update(f, dt);
    consumed = true;
  } else if (app === 'intro' && intro) {
    updateIntro(f, dt);
    consumed = true;
  } else if (app === 'replay' && replay) {
    updateReplay(f, dt);
    consumed = true;
  } else if (app === 'game' && session) {
    const two = session.twoPlayer;
    if (f.pressed.Menu || (two && input2.frame.pressed.Menu)) { pause(); input.consume(); input2.consume(); requestAnimationFrame(frame); return; }
    // Automatic replay of a big play once the play-call screen is up.
    if (autoReplayPending && session.state === 'playcall' && session.lastReplay) {
      autoReplayPending = false;
      startReplay(true); input.consume(); requestAnimationFrame(frame); return;
    }
    // RS click between plays: instant replay of the last play.
    if (f.pressed.RS && session.lastReplay && (playcall.open || session.state === 'playcall' || (session.state === 'presnap' && session.sim?.state === 'presnap'))) {
      startReplay(); input.consume(); requestAnimationFrame(frame); return;
    }
    // Play-call screen.
    if (session.needsHumanCall && !playcall.open) playcall.show(session, (play) => session.humanChoose(play));
    if (playcall.open && !session.needsHumanCall) playcall.hide();
    const pcOpen = playcall.open;
    // 2-player: the play-call screen listens to whoever is calling; the session gets both controllers.
    if (pcOpen) { playcall.update(two && session.humanTeam === 1 ? input2.frame : f, dt); }
    const gameInput = two ? { perTeam: true, 0: f, 1: input2.frame } : f;
    // Career: snaps your player sits out run at 4x (the next one he's in comes up quickly).
    const sp = session.watching && session.state !== 'playcall' ? Math.max(speed, 4) : speed;
    acc += dt * sp;
    let steps = 0;
    while (acc >= STEP && steps < 6 * sp) {
      session.tick(STEP, pcOpen ? null : gameInput);
      for (const e of session.events) onSessionEvent(e);
      if (!pcOpen) { input.consume(); input2.consume(); }
      acc -= STEP;
      steps++;
      if (app !== 'game') break;
    }
    if (steps >= 6 * sp) acc = 0;
    consumed = pcOpen;
  }

  // ---- Render ----
  const sim = session?.sim || null;
  if (app !== 'replay' && sim !== lastSim) { if (sim) renderer.players.setColors(sim, session.teams); lastSim = sim; }
  const alpha = Math.min(1, acc / STEP);
  if (app === 'intro' && intro && session) {
    const m = session.match;
    if (sim) renderer.drawSim(sim, alpha, time, session); else renderer.hidePlayers();
    renderer.lines.set(null, null);
    renderer.setAim(null);
    const sh = introShot(intro.t, sim ? sim.losX : m.xOf(m.possession, 35), m.dirOf(m.possession));
    renderer.renderShot(dt, sh.pos, sh.look, 0.6);
  } else if (app === 'replay' && replay) {
    renderer.drawSim(replay.player.ghost, replay.alpha ?? 0, time);
    renderer.lines.set(null, null);
    renderer.setAim(null);
    renderer.playArt.update(null, 1);
    renderer.renderReplay(dt, replay.player.focus(), replay.yaw, replay.pitch, replay.dist, replay.fresh);
    replay.fresh = false;
    hud.replayView({ t: replay.player.t, duration: replay.player.duration, playing: replay.playing, speed: replay.speed, auto: replay.auto, angle: REPLAY_ANGLES[replay.angle].name });
  } else if (session && app !== 'menu') {
    const m = session.match;
    if (sim) renderer.drawSim(sim, alpha, time, session); else renderer.hidePlayers();
    const scrim = m.phase === 'scrimmage';
    const losX = sim ? sim.losX : m.xOf(m.possession, m.yardLine);
    renderer.lines.set(scrim ? m.xOf(m.possession, m.yardLine) : null, scrim && m.firstYL < 100 ? m.xOf(m.possession, m.firstYL) : null, scrim ? m.down : null);
    renderer.setAim(sim);
    // One player: hold RT at the line to see your play drawn on the field.
    const showArt = sim && !session.twoPlayer && !session.watching && !playcall.open && session.state === 'presnap' && sim.state === 'presnap'
      && session.humanTeam !== null && session.humanTeam !== undefined && (input.frame.rt || 0) > 0.5 && !SPECIAL_ART.has(sim.offPlay.type);
    renderer.playArt.update(showArt ? playArt(sim, session.humanTeam) : null, dt);
    const b = renderer.ball.position;
    const live = sim && sim.state !== 'presnap';
    const phase = !live || session.state === 'playcall' ? 'presnap' : sim.ball.state === 'air' || sim.ball.state === 'kick' ? 'air' : sim.state === 'dead' ? 'dead' : 'live';
    let focus;
    if (session.state === 'playcall' || session.state === 'post' || (session.state === 'penalty' && !sim)) focus = { x: m.xOf(m.possession, m.yardLine), z: m.phase === 'scrimmage' ? m.ballZ : 0 };
    else if (!live) focus = { x: losX, z: sim.ballZ };
    else focus = { x: b.x, z: b.z };
    // Career: keep your player in the shot until the ball comes to him (QBs already are).
    const me = live && sim.lockId >= 0 && !session.watching ? sim.players[sim.lockId] : null;
    // Career camera: behind your player during live snaps (Settings → Career camera), or the broadcast view kept
    // between him and the ball. QBs always get the broadcast view.
    // A defender's stick is flipped for this camera (session.lockOn), so he gets it before the snap too.
    const lockedD = sim && !session.watching && sim.lockId >= 0 && sim.state === 'presnap' && sim.players[sim.lockId]?.team !== sim.offIdx ? sim.players[sim.lockId] : null;
    const pc = me || lockedD;
    const playerCam = pc && pc.slot !== 'QB' && (sim.state === 'live' || lockedD) && prefs.careerCam !== 'broadcast';
    if (playerCam) focus = { x: pc.x, z: pc.z };
    else if (me && me.slot !== 'QB' && sim.ball.carrier !== me.id && sim.state === 'live') focus = { x: (focus.x + me.x) / 2, z: (focus.z + me.z) / 2 };
    renderer.rig.mode = playerCam ? 'follow' : prefs.camera === 'high' ? 'sky' : 'broadcast';
    const camDir = playerCam ? (pc.team === sim.offIdx ? sim.dir : -sim.dir) : m.dirOf(m.possession);
    // The home crowd gets on its feet when the visitors are at the line on a big down (penalties.js crowdNoise).
    const noise = !live && !session.practice ? crowdNoise(m) : 0;
    const excite = sim && sim.state === 'live' ? 0.35 + (sim.ball.state === 'air' ? 0.3 : 0) : hud.bannerT > 0 ? 1 : 0.15 + noise * 0.7;
    boardFrame(m, dt);
    renderer.render(dt, focus, camDir, phase, snapCam, excite);
    snapCam = false;
    hud.update(session, renderer, dt, frameMs, playcall.open);
  } else {
    // Menus: slow orbit over the empty stadium.
    renderer.hidePlayers();
    renderer.playArt.update(null, 1);
    renderer.lines.set(null, null);
    attract += dt * 0.05;
    renderer.renderOrbit(dt, attract);
  }
  if (consumed) { input.consume(); input2.consume(); }
  renderer.adapt(frameMs);
  requestAnimationFrame(frame);
}

// A crash inside the loop used to stop the game silently ("frozen"). Keep running and show what broke so it
// can be reported: the box lists the error and where the game was.
let crashShown = new Set();
function reportCrash(err) {
  console.error(err);
  const msg = `${err?.message || err}`;
  if (crashShown.has(msg)) return;
  crashShown.add(msg);
  let box = document.getElementById('crashbox');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'crashbox';
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;max-width:70vw;max-height:40vh;overflow:auto;z-index:99;background:#300;color:#fdd;border:2px solid #f55;border-radius:6px;padding:10px;font:12px/1.4 monospace;white-space:pre-wrap;user-select:text;';
    document.body.appendChild(box);
  }
  const where = session ? `app=${app} state=${session.state} phase=${session.match.phase} q=${session.match.quarter} clock=${Math.round(session.match.clock)} plays=${session.plays} sim=${session.sim?.state}` : `app=${app}`;
  box.textContent += `Gridiron 27 error (please send a screenshot): ${msg}\n${where}\n${(err?.stack || '').split('\n').slice(0, 6).join('\n')}\n\n`;
}
window.addEventListener('error', (e) => reportCrash(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportCrash(e.reason));

function frame(now) {
  try {
    frameBody(now);
  } catch (err) {
    reportCrash(err);
    last = now;
    requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);
