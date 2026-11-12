import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const out = (process.env.OUT || '/tmp/g27shots') + '/';
const style = process.env.STYLE || 'chevron';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1100, height: 700 } });
pg.on('pageerror', (e) => console.log('ERR', e.message));
await pg.addInitScript(() => localStorage.setItem('g27.settings', JSON.stringify({ graphics: 'high', intro: false, time: 'day', weather: 'clear', stats: false })));
await pg.goto('http://localhost:5173/'); await pg.waitForTimeout(4000);
await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);
await pg.evaluate((style) => { for (const t of __g27.teams) t.stadium = { endzone: style, ezColor: '#0b1f4d', ezColor2: '#e0a526', ezText: '#ffffff', ezOutline: '#e0a526', ezFont: 'bebas_neue', ezLeft: 'IRONSIDES', ezRight: 'BOSTON', ezLogoLeft: 'team', ezLogoRight: 'league', yardFont: 'graduate' }; }, style);
await pg.evaluate(() => __g27.startGame({ ...__g27.prefs, side: 'cpu', quarterMinutes: 5, time: 'day', weather: 'clear' }, { seed: 7, speed: 4 }));
for (let i = 0; i < 3000; i++) { await pg.waitForTimeout(100); if (await pg.evaluate(() => { const s = __g27.session; return s.match.phase === 'scrimmage' && s.sim?.state === 'presnap' && s.state === 'presnap'; })) break; }
await pg.waitForTimeout(2500);
await pg.evaluate(() => { __g27.speed = 0; const r = __g27.renderer.rig; const p = [-20, 38, 0.1], l = [-42, 0, 0]; r.debug = { p, l }; r.pos.set(...p); r.look.set(...l); });
await pg.waitForTimeout(5000);
await pg.screenshot({ path: out + `ez_${style}.png` });
await b.close();
