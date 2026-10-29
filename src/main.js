import { STEP } from './core/constants.js';
import { defaultTeams } from './data/teams.js';
import { generateLeagueRosters } from './data/generator.js';
import { loadLocalLeague } from './data/localLeague.js';
import { InputManager } from './input/input.js';
import { GameRenderer } from './render/renderer.js';
import { GameSession } from './game/session.js';
import { Hud } from './ui/hud.js';
import { Nav } from './ui/nav.js';
import { Screens, loadPrefs, savePrefs } from './ui/screens.js';
import { PlayCallScreen } from './ui/playcall.js';

// ---- Boot ----
const params = new URLSearchParams(location.search);
const teams = generateLeagueRosters(defaultTeams(), 2027);
const local = await loadLocalLeague(teams);
const prefs = loadPrefs();
if (local?.playAs !== null && local?.playAs !== undefined) prefs.home = local.playAs;
else if (local?.rosterTeams?.length === 1) prefs.home = teams.findIndex((t) => t.abbr === local.rosterTeams[0]);
if (prefs.away === prefs.home) prefs.away = (prefs.home + 8) % 32;

const input = new InputManager();
const hud = new Hud(document.getElementById('hud'));
const renderer = new GameRenderer(document.getElementById('game'), teams[prefs.home], teams[prefs.away]);
const nav = new Nav();
const screens = new Screens(document.getElementById('screen'), nav);
const playcall = new PlayCallScreen(document.getElementById('playcall'), new Nav());

let app = 'title'; // title | menu | game | paused | over
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
    onControls: () => screens.controls({ onBack: toMenu }),
    onSettings: () => screens.settings(prefs, { onSave: (p) => { Object.assign(prefs, p); savePrefs(prefs); toMenu(); }, onBack: toMenu }),
  });
}

function startGame(p, opts = {}) {
  Object.assign(prefs, p);
  savePrefs(prefs);
  const home = teams[prefs.home], away = teams[prefs.away];
  const humanTeam = prefs.side === 'cpu' ? null : prefs.side === 'home' ? 0 : 1;
  session = new GameSession({
    teams: [home, away],
    settings: { quarterMinutes: prefs.quarterMinutes, accelClock: prefs.accelClock, difficulty: prefs.difficulty, penalties: prefs.penalties },
    humanTeam,
    seed: opts.seed ?? (Date.now() % 1e9),
  });
  renderer.setTeams(home, away);
  screens.clear();
  hud.toggleHelp(false);
  app = 'game';
  snapCam = true;
  lastSim = null;
  speed = opts.speed || 1;
  for (const e of session.events) onSessionEvent(e);
}

function pause() {
  app = 'paused';
  screens.pause({
    onResume: () => { screens.clear(); app = 'game'; },
    onControls: () => screens.controls({ onBack: pause }),
    onQuit: toMenu,
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
window.__g27 = { get session() { return session; }, get app() { return app; }, renderer, input, hud, startGame, teams, prefs, toMenu };

// URL shortcuts: ?auto&speed=6 (CPU vs CPU), ?play (skip menus), ?home=..&away=..
const teamArg = (v) => (/^\d+$/.test(v) ? +v : teams.findIndex((t) => t.abbr.toUpperCase() === v.toUpperCase()));
if (params.has('home')) prefs.home = teamArg(params.get('home'));
if (params.has('away')) prefs.away = teamArg(params.get('away'));
if (params.has('auto')) startGame({ ...prefs, side: 'cpu', quarterMinutes: +(params.get('q') || prefs.quarterMinutes) }, { speed: Math.max(1, +(params.get('speed') || 1)), seed: +(params.get('seed') || 1) });
else if (params.has('play')) startGame({ ...prefs, side: params.get('side') || 'home' }, { seed: +(params.get('seed') || Date.now() % 1e9) });
else screens.title(padName);

function onSessionEvent(e) {
  if (e.type === 'message') hud.message(e, session);
  else if (e.type === 'result') hud.statCard(e.statLines, session.teams);
  else if (e.type === 'audible') hud.ticker(`Audible: ${e.play}`);
  else if (e.type === 'hotRoute') hud.ticker(`Hot route: ${e.player || e.slot} — ${e.route.replace('_', ' ')}`);
  else if (e.type === 'flag' && e.presnap) hud.flag(e.outcome.text);
  else if (e.type === 'gameOver') {
    app = 'over';
    playcall.hide();
    setTimeout(() => { if (app === 'over' && session) { hud.hideAll(); screens.gameOver(session, { onDone: toMenu }); } }, 2500);
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
function frame(now) {
  const frameMs = now - last;
  const dt = Math.min(0.1, frameMs / 1000);
  last = now;
  time += dt;
  input.poll(dt);
  const f = input.frame;
  let consumed = false;

  if (app === 'title') {
    if (f.pressed.A || f.pressed.Menu) toMenu();
    consumed = true;
  } else if (app === 'menu' || app === 'paused' || (app === 'over' && !screens.root.classList.contains('hidden'))) {
    nav.update(f, dt);
    consumed = true;
  } else if (app === 'game' && session) {
    if (f.pressed.Menu) { pause(); input.consume(); requestAnimationFrame(frame); return; }
    // Play-call screen.
    if (session.needsHumanCall && !playcall.open) playcall.show(session, (play) => session.humanChoose(play));
    if (playcall.open && !session.needsHumanCall) playcall.hide();
    const pcOpen = playcall.open;
    if (pcOpen) { playcall.update(f, dt); }
    acc += dt * speed;
    let steps = 0;
    while (acc >= STEP && steps < 6 * speed) {
      session.tick(STEP, pcOpen ? null : f);
      for (const e of session.events) onSessionEvent(e);
      if (!pcOpen) input.consume();
      acc -= STEP;
      steps++;
      if (app !== 'game') break;
    }
    if (steps >= 6 * speed) acc = 0;
    consumed = pcOpen;
  }

  // ---- Render ----
  const sim = session?.sim || null;
  if (sim !== lastSim) { if (sim) renderer.players.setColors(sim, session.teams); lastSim = sim; }
  const alpha = Math.min(1, acc / STEP);
  if (session && app !== 'menu') {
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
    if (session.state === 'playcall' || session.state === 'post') focus = { x: m.xOf(m.possession, m.yardLine), z: m.phase === 'scrimmage' ? m.ballZ : 0 };
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
  if (consumed) input.consume();
  renderer.adapt(frameMs);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
