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
import { ReplayPlayer } from './replay/replay.js';
import { GameAudio } from './audio/audio.js';

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
const audio = new GameAudio();
const applyVolumes = () => audio.setLevels({ master: prefs.volMaster / 10, crowd: prefs.volCrowd / 10, sfx: prefs.volSfx / 10 });
applyVolumes();
Nav.onSound = (k) => audio.ui(k);
// Browsers only allow sound after a user gesture.
for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => { audio.ensure(); applyVolumes(); });

let app = 'title'; // title | menu | game | paused | over | replay
let replay = null; // instant replay viewer state
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
    onSettings: () => screens.settings(prefs, { onSave: (p) => { Object.assign(prefs, p); savePrefs(prefs); applyVolumes(); toMenu(); }, onBack: toMenu }),
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

function startReplay() {
  if (!session?.lastReplay) return;
  const player = new ReplayPlayer(session.lastReplay);
  const dir = player.ghost.dir;
  replay = { player, playing: true, speed: 1, yaw: dir > 0 ? Math.PI - 0.55 : -0.55, pitch: 0.42, dist: 24, fresh: true };
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
  if (f.pressed.B || f.pressed.Menu) { endReplay(); return; }
  if (f.pressed.A) r.playing = !r.playing;
  if (f.pressed.X) r.speed = r.speed < 1 ? 1 : 0.25;
  if (f.pressed.Y) { r.player.seek(0); r.playing = true; }
  let t = r.player.t;
  if (Math.abs(f.lx) > 0.2) { t += f.lx * dt * 3; r.playing = false; }
  else if (r.playing) t += dt * r.speed;
  if (t >= r.player.duration) { t = r.player.duration; r.playing = false; }
  r.alpha = r.player.seek(t);
  r.yaw += (f.rx || 0) * dt * 2;
  r.pitch = Math.min(1.35, Math.max(0.08, r.pitch - (f.ry || 0) * dt * 1.5));
  r.dist = Math.min(60, Math.max(6, r.dist + ((f.lt || 0) - (f.rt || 0)) * dt * 25));
}

function pause() {
  app = 'paused';
  screens.pause({
    onResume: () => { screens.clear(); app = 'game'; },
    onReplay: session?.lastReplay ? startReplay : null,
    onControls: () => screens.controls({ onBack: pause }),
    onQuit: toMenu,
  });
}

input.onConnect = (id) => {
  padName = id;
  audio.ensure();
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

// Crowd reactions from the home team's point of view (teams[0] is the home team).
const homeSign = (team) => (team === 0 ? 1 : -1);
function playSounds(e) {
  const sim = session?.sim;
  const teamOf = (id) => sim?.players[id]?.team;
  switch (e.type) {
    case 'snap': if (!sim?.isKick) audio.hut(); break;
    case 'whistle': audio.whistle(); break;
    case 'tackle': audio.hit(e.power ?? 0.5); break;
    case 'bigHit': audio.hit(1.3); audio.react(0.35); break;
    case 'catch': audio.catchBall(); audio.react(homeSign(teamOf(e.player)) * 0.15); break;
    case 'kick': audio.kick(); break;
    case 'interception': audio.react(homeSign(teamOf(e.player)) * 0.8); break;
    case 'fumble': audio.react(0.3); break;
    case 'message':
      if (e.kind === 'score') {
        const t = session.match.lastScore?.team;
        if (t === 0) audio.horn();
        audio.react(homeSign(t) * (/touchdown|pick six/i.test(e.text) ? 1 : 0.6));
      } else if (e.kind === 'miss') audio.react(homeSign(session.match.possession) * -0.5);
      break;
  }
}

function onSessionEvent(e) {
  playSounds(e);
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
  } else if (app === 'replay' && replay) {
    updateReplay(f, dt);
    consumed = true;
  } else if (app === 'game' && session) {
    if (f.pressed.Menu) { pause(); input.consume(); requestAnimationFrame(frame); return; }
    // RS click between plays: instant replay of the last play.
    if (f.pressed.RS && session.lastReplay && (playcall.open || session.state === 'playcall' || (session.state === 'presnap' && session.sim?.state === 'presnap'))) {
      startReplay(); input.consume(); requestAnimationFrame(frame); return;
    }
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
  if (app !== 'replay' && sim !== lastSim) { if (sim) renderer.players.setColors(sim, session.teams); lastSim = sim; }
  const alpha = Math.min(1, acc / STEP);
  if (app === 'replay' && replay) {
    renderer.drawSim(replay.player.ghost, replay.alpha ?? 0, time);
    renderer.lines.set(null, null);
    renderer.setAim(null);
    renderer.renderReplay(dt, replay.player.focus(), replay.yaw, replay.pitch, replay.dist, replay.fresh);
    replay.fresh = false;
    audio.setExcitement(0.25);
    hud.replayView({ t: replay.player.t, duration: replay.player.duration, playing: replay.playing, speed: replay.speed });
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
    if (session.state === 'playcall' || session.state === 'post') focus = { x: m.xOf(m.possession, m.yardLine), z: m.phase === 'scrimmage' ? m.ballZ : 0 };
    else if (!live) focus = { x: losX, z: sim.ballZ };
    else focus = { x: b.x, z: b.z };
    const camDir = m.dirOf(m.possession);
    const excite = sim && sim.state === 'live' ? 0.35 + (sim.ball.state === 'air' ? 0.3 : 0) : hud.bannerT > 0 ? 1 : 0.15;
    renderer.render(dt, focus, camDir, phase, snapCam, excite);
    audio.setExcitement(app === 'paused' ? 0.1 : excite);
    snapCam = false;
    hud.update(session, renderer, dt, frameMs, playcall.open);
  } else {
    // Menus: slow orbit over the empty stadium.
    renderer.hidePlayers();
    renderer.lines.set(null, null);
    attract += dt * 0.05;
    renderer.renderOrbit(dt, attract);
    audio.setExcitement(0.08);
  }
  if (consumed) input.consume();
  renderer.adapt(frameMs);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
