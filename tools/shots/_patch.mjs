import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const out = (process.env.OUT || '/tmp/g27shots') + '/';
const view = process.env.VIEW || 'front';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1000, height: 800 } });
pg.on('pageerror', (e) => console.log('ERR', e.message));
pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await pg.addInitScript(() => localStorage.setItem('g27.settings', JSON.stringify({ graphics: 'high', intro: false, time: 'day', weather: 'clear', stats: false })));
await pg.goto('http://localhost:5173/'); await pg.waitForTimeout(4000);
await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);
await pg.evaluate(() => {
  const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="16" fill="#c8102e"/><text x="50" y="66" font-size="48" font-weight="bold" text-anchor="middle" fill="#fff" font-family="sans-serif">75</text></svg>');
  for (const t of __g27.teams) t.uniforms = { home: { numberFont: 'graduate', nameFont: 'bebas_neue', patchFont: 'oswald', patches: { left_chest: { shape: 'circle', text: 'C', bg: '#ffd100', fg: '#111111', border: '#111111' }, right_chest: { shape: 'shield', text: '9', bg: '#ffffff', fg: '#111111', border: '#111111' }, left_sleeve: { shape: 'star', text: '', bg: '#ffd100', border: '#111111' }, right_sleeve: { image: svg } } },
    away: { numberFont: 'anton', nameFont: 'teko', patchFont: 'oswald', patches: { left_chest: { shape: 'circle', text: 'C', bg: '#ffd100', fg: '#111111', border: '#111111' }, right_chest: { shape: 'shield', text: '9', bg: '#ffffff', fg: '#111111', border: '#111111' }, left_sleeve: { shape: 'star', text: '', bg: '#ffd100', border: '#111111' }, right_sleeve: { image: svg }, collar: { logo: 'team_logo' } } } };
  window.__svg = svg;
});
await pg.evaluate(() => __g27.startGame({ ...__g27.prefs, side: 'cpu', quarterMinutes: 5, time: 'day', weather: 'clear' }, { seed: 7, speed: 4 }));
for (let i = 0; i < 3000; i++) { await pg.waitForTimeout(100); if (await pg.evaluate(() => { const s = __g27.session; return s.match.phase === 'scrimmage' && s.sim?.state === 'presnap' && s.state === 'presnap'; })) break; }
await pg.waitForTimeout(1500);
await pg.evaluate((view) => {
  __g27.speed = 0; const sim = __g27.session.sim;
  const qb = sim.players.find((p) => p.team === sim.offIdx && p.slot === 'QB');
  sim.players.forEach((p) => { if (p !== qb) { p.x = p.px = -45; p.z = p.pz = -20; } });
  qb.x = qb.px = 0; qb.z = qb.pz = 20; qb.vx = qb.vz = 0; qb.facing = qb.pfacing = 0; qb.anim = 'idle'; qb.animT = 0.25; qb.state = 'active'; qb.task = null;
  sim.ball.x = 70;
  const r = __g27.renderer.rig;
  const cams = { front: [[2.6, 1.45, 20], [0, 1.4, 20]], back: [[-2.6, 1.45, 20], [0, 1.4, 20]], left: [[0, 1.45, 22.6], [0, 1.4, 20]], right: [[0, 1.45, 17.4], [0, 1.4, 20]] };
  const [p, l] = cams[view]; r.debug = { p, l }; r.pos.set(...p); r.look.set(...l);
}, view);
await pg.waitForTimeout(6000);
await pg.screenshot({ path: out + `patch_${view}.png` });
await b.close();
