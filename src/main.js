import { STEP } from './core/constants.js';
import { defaultTeams } from './data/teams.js';
import { generateLeagueRosters } from './data/generator.js';
import { loadLocalLeague } from './data/localLeague.js';
import { deserializeLeague } from './data/league.js';
import { activeSlot, readSave } from './data/storage.js';
import { LeagueUI, attachLogos } from './ui/league.js';
import { rosterScreen } from './ui/rosterEditor.js';
import { teamEditor } from './ui/teamEditor.js';
import { spreadsheetScreen } from './ui/spreadsheets.js';
import { FranchiseUI } from './ui/franchise.js';
import { offseasonScreen } from './ui/offseason.js';
import { unavailableFor, gameConditions } from './franchise/franchise.js';
import { makeConditions, conditionsText } from './game/weather.js';
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
import { statsScreen } from './ui/statsScreen.js';
import { energyOf } from './game/fatigue.js';

// ---- Boot ----
const params = new URLSearchParams(location.search);
const teams = generateLeagueRosters(defaultTeams(), 2027);
const prefs = loadPrefs();
// A saved league (Phase 4) wins; without one, the optional spreadsheets in public/local/ apply.
let saved = null;
try { const slot = activeSlot(); saved = slot ? deserializeLeague(await readSave(slot)) : null; } catch (e) { console.warn('Could not load the saved league', e); }
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
const renderer = new GameRenderer(document.getElementById('game'), teams[prefs.home], teams[prefs.away]);
const nav = new Nav();
const screens = new Screens(document.getElementById('screen'), nav);
const playcall = new PlayCallScreen(document.getElementById('playcall'), new Nav());
hud.prefs = prefs;
const league = new LeagueUI({
  teams, prefs, screens,
  onExit: () => toMenu(),
  onLeagueReplaced: () => {
    prefs.home = Math.min(prefs.home, teams.length - 1);
    if (prefs.away === prefs.home || prefs.away >= teams.length) prefs.away = (prefs.home + 8) % teams.length;
    renderer.setTeams(teams[prefs.home], teams[prefs.away]);
  },
});
if (saved) { league.name = saved.name; league.franchise = saved.franchise; }
const pickTeam = (title, onPick, onBack, focus = prefs.home) => screens.teamPicker(teams, focus, { title, onPick, onBack });
const rosterCtx = { screens, teams, onBack: () => league.menu(0), onChange: () => league.changed(), pickTeam };
const teamCtx = { screens, teams, prefs, pickTeam, onChange: () => { savePrefs(prefs); league.changed(); },
  onBack: () => { renderer.setTeams(teams[prefs.home], teams[prefs.away]); league.onTeams(); } };
league.onTeams = () => pickTeam('Teams & logos: pick a team', (i) => teamEditor(teamCtx, i), () => league.menu(1));
const franchiseUI = new FranchiseUI({
  teams, prefs, screens, league, pickTeam,
  onExit: () => toMenu(),
  playGame: (g) => {
    const f = league.franchise;
    startGame({ home: g.home, away: g.away, side: g.home === f.userTeam ? 'home' : 'away', difficulty: f.settings.difficulty,
      quarterMinutes: f.settings.quarterMinutes }, { franchise: g, unavailable: unavailableFor(teams, g), conditions: gameConditions(f, g) });
  },
  rosterScreen: (ti, back) => rosterScreen({ ...rosterCtx, onBack: back }, ti),
  depthScreen: (ti, back) => depthChartScreen(screens, teams[ti], { onDone: back, onChange: () => league.changed() }),
  offseason: (ui) => offseasonScreen({ screens, teams, league, onExit: () => toMenu() }, ui),

});
league.onSpreadsheets = () => spreadsheetScreen({ screens, teams, prefs, onBack: () => league.menu(3), onChange: () => { savePrefs(prefs); league.changed(); } });
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
  app = 'menu';
  session = null;
  lastSim = null;
  hud.hideAll();
  playcall.hide();
  screens.mainMenu({
    onPlayNow: () => screens.playNow(teams, prefs, { onStart: startGame, onBack: toMenu }),
    onPractice: () => screens.practice(teams, prefs, { onStart: (p, practice) => startGame({ ...p, side: 'home' }, { practice }), onBack: toMenu }),
    onLeague: () => league.menu(),
    onFranchise: () => franchiseUI.open(),
    onControls: () => screens.controls({ onBack: toMenu }),
    onSettings: () => screens.settings(prefs, { onSave: (p) => { Object.assign(prefs, p); savePrefs(prefs); applyCamera(); toMenu(); }, onBack: toMenu }),
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
    settings: { quarterMinutes: cfg.quarterMinutes, accelClock: cfg.accelClock, difficulty: cfg.difficulty, penalties: opts.practice ? false : cfg.penalties, practice: opts.practice || null, sliders: prefs.sliders, unavailable: opts.unavailable || null, weather: conditions },
    humanTeam,
    humanTeams: cfg.side === '2p' ? [0, 1] : null,
    seed,
  });
  session.franchiseGame = opts.franchise || null;
  renderer.setTeams(home, away);
  renderer.setConditions(conditions);
  hud.ticker(conditionsText(conditions));
  screens.clear();
  hud.toggleHelp(false);
  app = 'game';
  snapCam = true;
  lastSim = null;
  speed = opts.speed || 1;
  for (const e of session.events) onSessionEvent(e);
}

function startReplay(auto = false) {
  if (!session?.lastReplay) return;
  const player = new ReplayPlayer(session.lastReplay);
  const dir = player.ghost.dir;
  replay = { player, playing: true, speed: 1, yaw: dir > 0 ? Math.PI - 0.55 : -0.55, pitch: 0.42, dist: 24, fresh: true, auto, endT: 0 };
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

function updateReplay(f, dt) {
  const r = replay;
  // An automatic replay gets out of the way as soon as you press anything (you're picking a play).
  if (f.pressed.B || f.pressed.Menu || (r.auto && (f.pressed.A || f.pressed.X || f.pressed.Y))) { endReplay(); return; }
  if (f.pressed.A) r.playing = !r.playing;
  if (f.pressed.X) r.speed = r.speed < 1 ? 1 : 0.25;
  if (f.pressed.Y) { r.player.seek(0); r.playing = true; }
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

function showFinal() {
  screens.extraButtons = null;
  const g = session.franchiseGame;
  const done = g ? () => { const m = session.match, inj = session.injuries; leaveGame(); franchiseUI.recordPlayed(g, m, inj); } : toMenu;
  screens.gameOver(session, { onDone: done, doneLabel: g ? 'Back to Franchise' : 'Main Menu', onStats: () => statsScreen(screens, session.match, { onBack: showFinal }) });
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
    onQuit: session?.franchiseGame ? () => { leaveGame(); franchiseUI.hub(); } : toMenu,
  });
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
window.__g27 = { get session() { return session; }, get app() { return app; }, get replay() { return replay; }, renderer, input, hud, startGame, startReplay, teams, prefs, toMenu, league, franchiseUI, input2 };

// URL shortcuts: ?auto&speed=6 (CPU vs CPU), ?play (skip menus), ?home=..&away=..
const teamArg = (v) => (/^\d+$/.test(v) ? +v : teams.findIndex((t) => t.abbr.toUpperCase() === v.toUpperCase()));
if (params.has('home')) prefs.home = teamArg(params.get('home'));
if (params.has('away')) prefs.away = teamArg(params.get('away'));
if (params.has('auto')) startGame({ ...prefs, side: 'cpu', quarterMinutes: +(params.get('q') || prefs.quarterMinutes) }, { speed: Math.max(1, +(params.get('speed') || 1)), seed: +(params.get('seed') || 1) });
else if (params.has('play')) startGame({ ...prefs, side: params.get('side') || 'home' }, { seed: +(params.get('seed') || Date.now() % 1e9) });
else screens.title(padName);

function onSessionEvent(e) {
  if (prefs.autoReplay && !session?.practice && session?.humanTeam !== null && ['touchdown', 'interception', 'bigHit', 'onsideRecovered'].includes(e.type)) autoReplayPending = true;
  if (e.type === 'message') hud.message(e, session);
  else if (e.type === 'result') hud.statCard(e.statLines, session.teams);
  else if (e.type === 'audible') hud.ticker(e.play === 'Coverage' ? `Coverage: ${e.label}` : `Audible: ${e.play}`);
  else if (e.type === 'motion') hud.ticker(`Motion: ${e.player || e.slot}`);
  else if (e.type === 'hotRoute') hud.ticker(`Hot route: ${e.player || e.slot} — ${e.route.replace('_', ' ')}`);
  else if (e.type === 'flag' && e.presnap) hud.flag(e.outcome.text);
  else if (e.type === 'gameOver') {
    app = 'over';
    playcall.hide();
    setTimeout(() => { if (app === 'over' && session) { hud.hideAll(); showFinal(); } }, 2500);
  } else if (e.type === 'tackle' && e.power > 0.9) renderer.rig.shake = Math.min(1, e.power * 0.5);
  else if (e.type === 'bigHit') { renderer.rig.shake = 1; input.rumble(0.9, 250); }
  else if (e.type === 'tackle') input.rumble(0.35, 110);
  else if (e.type === 'flag') renderer.showFlag?.(e);
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
  } else if (app === 'menu' || app === 'paused' || (app === 'over' && !screens.root.classList.contains('hidden'))) {
    screens.extraButtons?.(f);
    nav.update(f, dt);
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
    acc += dt * speed;
    let steps = 0;
    while (acc >= STEP && steps < 6 * speed) {
      session.tick(STEP, pcOpen ? null : gameInput);
      for (const e of session.events) onSessionEvent(e);
      if (!pcOpen) { input.consume(); input2.consume(); }
      acc -= STEP;
      steps++;
      if (app !== 'game') break;
    }
    if (steps >= 6 * speed) acc = 0;
    consumed = pcOpen;
  }

  // ---- Render ----
  const sim = session?.sim || null;
  if (app !== 'replay' && sim !== lastSim) { if (sim) renderer.players.setColors(sim, session.teams); lastSim = sim; }
  const alpha = Math.min(1, acc / STEP);
  if (app === 'replay' && replay) {
    renderer.drawSim(replay.player.ghost, replay.alpha ?? 0, time);
    renderer.lines.set(null, null);
    renderer.setAim(null);
    renderer.renderReplay(dt, replay.player.focus(), replay.yaw, replay.pitch, replay.dist, replay.fresh);
    replay.fresh = false;
    hud.replayView({ t: replay.player.t, duration: replay.player.duration, playing: replay.playing, speed: replay.speed, auto: replay.auto });
  } else if (session && app !== 'menu') {
    const m = session.match;
    if (sim) renderer.drawSim(sim, alpha, time); else renderer.hidePlayers();
    const scrim = m.phase === 'scrimmage';
    const losX = sim ? sim.losX : m.xOf(m.possession, m.yardLine);
    renderer.lines.set(scrim ? m.xOf(m.possession, m.yardLine) : null, scrim && m.firstYL < 100 ? m.xOf(m.possession, m.firstYL) : null);
    renderer.setAim(sim);
    const b = renderer.ball.position;
    const live = sim && sim.state !== 'presnap';
    const phase = !live || session.state === 'playcall' ? 'presnap' : sim.ball.state === 'air' || sim.ball.state === 'kick' ? 'air' : sim.state === 'dead' ? 'dead' : 'live';
    let focus;
    if (session.state === 'playcall' || session.state === 'post' || (session.state === 'penalty' && !sim)) focus = { x: m.xOf(m.possession, m.yardLine), z: m.phase === 'scrimmage' ? m.ballZ : 0 };
    else if (!live) focus = { x: losX, z: sim.ballZ };
    else focus = { x: b.x, z: b.z };
    const camDir = m.dirOf(m.possession);
    const excite = sim && sim.state === 'live' ? 0.35 + (sim.ball.state === 'air' ? 0.3 : 0) : hud.bannerT > 0 ? 1 : 0.15;
    renderer.render(dt, focus, camDir, phase, snapCam, excite);
    snapCam = false;
    hud.update(session, renderer, dt, frameMs, playcall.open);
  } else {
    // Menus: slow orbit over the empty stadium.
    renderer.hidePlayers();
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
