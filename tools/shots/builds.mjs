// node builds.mjs <prefix> : four builds (X, QB, MLB, LT) lined up at midfield in idle, front / 3-4 / side / back views, in-game renderer.
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const out = (process.env.OUT || '/tmp/g27shots') + '/';
const prefix = process.argv[2] || 'B';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 800, height: 600 } });
pg.on('pageerror', (e) => console.log('ERR', e.message));
await pg.addInitScript(() => localStorage.setItem('g27.settings', JSON.stringify({ graphics: 'high', intro: false, time: 'day', weather: 'clear' })));
await pg.goto('http://localhost:5173/'); await pg.waitForTimeout(4000);
await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);
await pg.evaluate(() => __g27.startGame({ ...__g27.prefs, side: 'cpu', quarterMinutes: 5, time: 'day', weather: 'clear' }, { seed: 7, speed: 4 }));
for (let i = 0; i < 3000; i++) {
  await pg.waitForTimeout(100);
  if (await pg.evaluate(() => { const s = __g27.session; return s.match.phase === 'scrimmage' && s.sim?.state === 'presnap' && s.state === 'presnap'; })) break;
}
await pg.waitForTimeout(1500);
await pg.evaluate(() => {
  __g27.speed = 0; const sim = __g27.session.sim;
  const want = ['X', 'QB', 'MLB', 'LT'];
  const off = sim.players.filter((p) => p.team === sim.offIdx), def = sim.players.filter((p) => p.team !== sim.offIdx);
  sim.ball.x = 70; sim.ball.z = 22.4; sim.ball.state = 'held';
  const pick = (s) => off.find((p) => p.slot === s) || def.find((p) => p.slot === s) || sim.players[0];
  const lat = [-2.4, -0.8, 0.8, 2.4];
  want.forEach((s, k) => { const p = pick(s); p.x = p.px = 0; p.z = p.pz = lat[k] + 20; p.vx = p.vz = 0; p.facing = p.pfacing = 0; p.face = null; p.anim = s === 'QB' ? 'idle' : 'idle'; p.animT = 0.3; p.state = 'active'; p.task = null; console.log(s, p.name, p.bulk, p.weight); });
  // everyone else far away
  sim.players.forEach((p) => { if (!want.some((s) => pick(s) === p)) { p.x = p.px = -45; p.z = p.pz = -20; } });
});
const views = { side: [[0.01, 1.85, 24.6], [0, 1.82, 22.4]], front: [[2.2, 1.85, 22.4], [0, 1.82, 22.4]], top: [[0.4, 2.75, 22.4], [0, 1.9, 22.4]] };
for (const [name, [p, l]] of Object.entries(views)) {
  await pg.evaluate(([p, l]) => { const r = __g27.renderer.rig; r.debug = { p, l }; r.pos.set(...p); r.look.set(...l); }, [p, l]);
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: `${out}${prefix}_${name}.png` });
}
await b.close();
