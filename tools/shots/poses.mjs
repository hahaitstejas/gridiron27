// node poses.mjs <prefix> anim[:t] ... : freeze a game at the line, put one lineman / receiver into each pose, photograph it from the side.
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const out = (process.env.OUT || '/tmp/g27shots') + '/';
const prefix = process.argv[2] || 'K';
const list = process.argv.slice(3);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 520, height: 520 } });
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
await pg.evaluate(() => { __g27.speed = 0; });
for (const item of list) {
  const [anim, t, slot = 'X', view = 'side'] = item.split(':');
  // Put the man alone on an open spot (the other players moved away) so nothing hides him.
  await pg.evaluate(([anim, t, slot, view]) => {
    const sim = __g27.session.sim; const p = sim.players.find((q) => q.slot === slot) || sim.players[0];
    p.x = p.px = 0; p.z = p.pz = 20; p.vx = p.vz = 0; p.facing = p.pfacing = 0;
    p.anim = anim; p.animT = +t || 0; p.state = anim === 'down' ? 'down' : 'active';
    window.__poseP = p;
    const r = __g27.renderer.rig;
    r.debug = view === 'front' ? { p: [4.5, 1.1, 20.01], l: [0, 0.95, 20] } : view === 'back' ? { p: [-4.5, 1.1, 20.01], l: [0, 0.95, 20] } : { p: [0.01, 1.1, 24.5], l: [0, 0.95, 20] };
  }, [anim, t, slot, view]);
  await pg.waitForTimeout(900);
  await pg.evaluate(([anim, t]) => { const p = window.__poseP; p.anim = anim; p.animT = +t || 0; }, [anim, t]);
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${out}${prefix}_${anim}_${t || 0}_${slot}_${view}.png` });
  await pg.evaluate(() => { const p = window.__poseP; p.x = p.px = -40; p.z = p.pz = -20; });
}
await b.close();
