import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const out = (process.env.OUT || '/tmp/g27shots') + '/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
pg.on('pageerror', (e) => console.log('ERR', e.message));
await pg.addInitScript(() => localStorage.setItem('g27.settings', JSON.stringify({ graphics: 'high', intro: false, time: 'day', weather: 'clear', stats: false })));
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
  const qb = sim.players.find((p) => p.team === sim.offIdx && p.slot === 'QB');
  sim.players.forEach((p) => { if (p !== qb) { p.x = p.px = -45; p.z = p.pz = -20; } });
  qb.x = qb.px = 0; qb.z = qb.pz = 20; qb.vx = qb.vz = 0; qb.facing = qb.pfacing = 0.5; qb.anim = 'catch'; qb.animT = 0.25; qb.state = 'active'; qb.task = null;
  window.__qb = qb;
  __g27.renderer.rig.debug = { p: [2.6, 1.55, 21.6], l: [0, 1.3, 20] };
});
await pg.waitForTimeout(9000);
await pg.screenshot({ path: out + 'SNAP3.png' });
await b.close();
