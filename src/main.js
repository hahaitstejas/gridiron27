import { STEP } from './core/constants.js';
import { defaultTeams } from './data/teams.js';
import { generateLeagueRosters } from './data/generator.js';
import { loadLocalRoster } from './data/localRoster.js';
import { InputManager } from './input/input.js';
import { GameRenderer } from './render/renderer.js';
import { DriveSession } from './game/drive.js';
import { Hud } from './ui/hud.js';

// ---- Boot ----
const params = new URLSearchParams(location.search);
const teams = generateLeagueRosters(defaultTeams(), 2027);
const localRoster = await loadLocalRoster(teams);
const localHome = localRoster?.teams?.length ? teams.findIndex((t) => t.abbr === localRoster.teams[0]) : -1;
const home = teams[params.has('home') ? +params.get('home') : localHome >= 0 ? localHome : 9];
const away = teams[params.has('away') ? +params.get('away') : 28];
const matchTeams = [home, away];

const input = new InputManager();
const hud = new Hud(document.getElementById('hud'));
const renderer = new GameRenderer(document.getElementById('game'), home, away);
const auto = params.has('auto');
const speed = Math.max(1, +(params.get('speed') || 1));
let session = new DriveSession({ teams: matchTeams, seed: +(params.get('seed') || Date.now() % 100000), auto });
let started = params.has('autostart') || auto;
let snapCam = true;
let lastSimRef = null;
hud.showConnect(!started);
if (localRoster) hud.toast(`Loaded local roster: ${localRoster.imported} players (${localRoster.teams.join(', ')})`, 3500);

input.onConnect = (id) => {
  hud.setPadName(id);
  hud.toast('Controller connected');
  start();
};
function start() {
  if (started) return;
  started = true;
  hud.showConnect(false);
}
window.addEventListener('keydown', (e) => {
  if (!started && (e.code === 'Enter' || e.code === 'Space')) { input.keyboard.tapped.delete(e.code); input.keyboard.keys.delete(e.code); start(); return; }
  if (e.code === 'KeyH') hud.toggleHelp();
  if (e.code === 'Backquote') hud.fpsShow = !hud.fpsShow;
});

// Debug hooks for automated testing.
window.__g27 = { get session() { return session; }, renderer, input, hud };

// ---- Main loop: fixed 60 Hz simulation, render every animation frame ----
let acc = 0;
let last = performance.now();
let time = 0;
function frame(now) {
  const frameMs = now - last;
  const dt = Math.min(0.1, frameMs / 1000);
  last = now;
  time += dt;
  input.poll(dt);
  if (started) {
    if (input.frame.pressed.Menu && session.sim.state === 'presnap') hud.toggleHelp();
    acc += dt * speed;
    let steps = 0;
    while (acc >= STEP && steps < 6 * speed) {
      session.tick(STEP, input.frame);
      input.consume();
      acc -= STEP;
      steps++;
      for (const e of session.events) onEvent(e);
    }
    if (steps >= 6 * speed) acc = 0;
  }
  const sim = session.sim;
  if (sim !== lastSimRef) { renderer.players.setColors(sim, session.teams); lastSimRef = sim; }
  const alpha = started ? acc / STEP : 1;
  renderer.drawSim(sim, alpha, time);
  renderer.lines.set(sim.losX, sim.firstDownX);
  const b = renderer.ball.position;
  const phase = sim.state === 'presnap' ? 'presnap' : sim.ball.state === 'air' ? 'air' : sim.state === 'dead' ? 'dead' : 'live';
  const focus = sim.state === 'presnap' ? { x: sim.losX, z: sim.ballZ } : { x: b.x, z: b.z };
  const excite = sim.state === 'live' ? 0.35 + (sim.ball.state === 'air' ? 0.3 : 0) : session.message?.big?.includes('TOUCH') ? 1 : 0.15;
  renderer.render(dt, focus, sim.camDir, phase, snapCam, excite);
  snapCam = false;
  hud.update(session, renderer, dt, frameMs);
  renderer.adapt(frameMs);
  requestAnimationFrame(frame);
}

function onEvent(e) {
  if (e.type === 'tackle' && e.power > 0.9) renderer.rig.shake = Math.min(1, e.power * 0.5);
  if (e.type === 'bigHit') { renderer.rig.shake = 1; input.rumble(0.9, 250); }
  if (e.type === 'tackle') input.rumble(0.4, 120);
  if (e.type === 'firstDown') hud.toast('First down!');
}

requestAnimationFrame(frame);
