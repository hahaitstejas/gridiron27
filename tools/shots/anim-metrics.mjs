// node tools/shots/anim-metrics.mjs [seconds] : watch a CPU-vs-CPU game in the real renderer and measure how well the
// animation holds things together. Prints median / p90 / max (yards) of:
//   carry  - ball to the carrying hand while a runner holds it (by anim)
//   catch  - the ball's last in-air position to the catcher's nearer hand on the frame he secures it (catch / pick)
//   down   - ball to the hand while the carrier is tackled / on the ground
// Env: SPEED (game speed, default 2), SEED.
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const secs = +(process.argv[2] || 120);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 640, height: 360 } });
pg.on('pageerror', (e) => console.log('PAGEERR', e.message));
await pg.addInitScript(() => localStorage.setItem('g27.settings', JSON.stringify({ graphics: 'low', intro: false, time: 'day', weather: 'clear', stats: false, replays: false, autoReplay: false })));
await pg.goto('http://localhost:5173/'); await pg.waitForTimeout(3500);
await pg.keyboard.press('Enter'); await pg.waitForTimeout(600);
await pg.evaluate(([speed, seed]) => {
  const r = __g27.renderer, P = r.players;
  const M = (window.__m = { carry: {}, catch: [], down: [], plays: 0 });
  let prevAir = null, prevState = null, prevCarrier = -1, lastSim = null;
  const orig = r.drawSim.bind(r);
  r.drawSim = (sim, alpha, time, session) => {
    orig(sim, alpha, time, session);
    if (sim !== lastSim) { lastSim = sim; M.plays++; prevAir = null; prevState = null; }
    const bl = sim.ball, bp = r.ball.position;
    if (bl.state === 'held' && bl.carrier >= 0) {
      const c = sim.players[bl.carrier], hs = P.hands[bl.carrier];
      if (hs) {
        const near = Math.min(hs[0].distanceTo(bp), hs[1].distanceTo(bp));
        if (prevState === 'air' && prevAir && prevCarrier !== bl.carrier) {
          M.catch.push(+Math.min(hs[0].distanceTo(prevAir), hs[1].distanceTo(prevAir)).toFixed(3));
        } else if (c.state === 'tackled' || c.state === 'down') M.down.push(+near.toFixed(3));
        else if (c.slot !== undefined && !(c.task?.type === 'qb_pass' && !sim.passThrown)) (M.carry[c.anim] ||= []).push(+near.toFixed(3));
      }
    }
    prevState = bl.state; prevCarrier = bl.carrier;
    prevAir = bl.state === 'air' ? bp.clone() : prevAir;
  };
  __g27.startGame({ ...__g27.prefs, side: 'cpu', quarterMinutes: 5 }, { seed, speed });
}, [+(process.env.SPEED || 2), +(process.env.SEED || 7)]);
await pg.waitForTimeout(secs * 1000);
const m = await pg.evaluate(() => window.__m);
await b.close();
const stat = (a) => { if (!a.length) return 'n=0'; const s = [...a].sort((x, y) => x - y); const q = (k) => s[Math.min(s.length - 1, Math.floor(k * s.length))]; return `n=${s.length} med ${q(0.5).toFixed(3)} p90 ${q(0.9).toFixed(3)} max ${s[s.length - 1].toFixed(3)}`; };
console.log(`plays seen: ${m.plays}`);
const all = Object.values(m.carry).flat();
console.log(`carry (all)  ${stat(all)}`);
for (const [k, v] of Object.entries(m.carry).sort((a, b) => b[1].length - a[1].length)) console.log(`  carry ${k.padEnd(10)} ${stat(v)}`);
console.log(`catch        ${stat(m.catch)}`);
console.log(`down         ${stat(m.down)}`);
