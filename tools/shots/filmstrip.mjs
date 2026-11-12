// node tools/shots/filmstrip.mjs <event> [frames] [pre] [step] : watch a CPU game until a play has <event> (catch |
// interception | tackle | sack | drop | deflection | fumble), then open that play's instant replay in slow motion and
// photograph `frames` frames from `pre` s before the event, `step` s of game time apart, with a tight camera on the ball.
// Env: OUT (dir), SEED, SPEED (game speed while waiting), ANGLE (replay camera yaw offset), DIST.
import { createRequire } from 'module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const out = (process.env.OUT || '/tmp/g27shots') + '/';
const [type = 'catch', frames = '8', pre = '0.5', step = '0.1'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: +(process.env.W || 800), height: +(process.env.H || 600) } });
pg.on('pageerror', (e) => console.log('PAGEERR', e.message));
await pg.addInitScript(() => localStorage.setItem('g27.settings', JSON.stringify({ graphics: 'low', intro: false, time: 'day', weather: 'clear', stats: false })));
await pg.goto('http://localhost:5173/'); await pg.waitForTimeout(3500);
await pg.keyboard.press('Enter'); await pg.waitForTimeout(600);
await pg.evaluate(([speed, seed]) => {
  window.__ev = [];
  __g27.startGame({ ...__g27.prefs, side: 'cpu', quarterMinutes: 5 }, { seed, speed });
}, [+(process.env.SPEED || 6), +(process.env.SEED || 7)]);
// Hook the sim's emit once a sim exists: every event with its sim time; the snap marks the replay's t = 0.
const found = await pg.evaluate(async (type) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let hooked = false;
  for (let i = 0; i < 6000; i++) {
    const s = __g27.session;
    const sim = s?.sim;
    if (sim && !hooked) {
      const proto = Object.getPrototypeOf(sim);
      const orig = proto.emit;
      proto.emit = function (t, d) { window.__ev.push({ type: t, t: this.t, sim: this, data: d, sack: !!this.result?.sack }); return orig.call(this, t, d); };
      hooked = true;
    }
    if (hooked && sim) {
      const mine = window.__ev.filter((e) => e.sim === sim);
      const snap = mine.find((e) => e.type === 'snap');
      const want = type === 'sack' ? (sim.result?.sack ? mine.filter((e) => e.type === 'tackle').pop() : null) : mine.find((e) => e.type === type);
      if (snap && want && (sim.state === 'dead' || sim.state === 'finished')) {
        const before = s.lastReplay;
        for (let k = 0; k < 400 && s.lastReplay === before; k++) await wait(25);
        if (s.lastReplay !== before) { __g27.speed = 0; return { t: want.t - snap.t, player: want.data?.player ?? want.data?.tackler ?? null }; }
      }
    }
    await wait(25);
  }
  return null;
}, type);
if (!found) { console.log('no', type, 'found'); await b.close(); process.exit(1); }
console.log(type, 'at replay t =', found.t.toFixed(2));
await pg.evaluate(() => __g27.startReplay());
await pg.waitForTimeout(800);
const n = +frames;
for (let k = 0; k < n; k++) {
  const t = Math.max(0, found.t - +pre + k * +step);
  await pg.evaluate(([t, dist, ang]) => {
    const r = __g27.replay; if (!r) return;
    r.playing = false; r.player.seek(t); r.dist = dist; r.pitch = 0.22; r.yaw += ang; r.fresh = true;
  }, [t, +(process.env.DIST || 8), k === 0 ? +(process.env.ANGLE || 0) : 0]);
  // Let the springs / crossfades run a little at this moment: a short slow play-through into the frame time.
  await pg.evaluate(([t, step]) => { const r = __g27.replay; r.player.seek(Math.max(0, t - step)); r.playing = true; r.speed = step / 1.6; }, [t, +step]);
  await pg.waitForTimeout(1600);
  await pg.evaluate(() => { const r = __g27.replay; if (r) r.playing = false; });
  await pg.screenshot({ path: `${out}fs_${type}_${String(k).padStart(2, '0')}.png` });
}
await b.close();
