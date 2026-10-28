#!/usr/bin/env node
// Browser smoke test (optional, needs Playwright: `npm i -D playwright && npx playwright install chromium`).
// Drives the menus, plays a stretch of a human game, opens the pause menu, and runs a full CPU-vs-CPU
// game with 1-minute quarters. Fails on console errors.
//   node tools/smoke.mjs [baseUrl] [outDir]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('Playwright not installed; skipping smoke test.'); process.exit(0); }

const base = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'test-output';
const fs = await import('fs');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${query}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  await page.goto(base + query);
  await page.waitForTimeout(1500);
  return page;
}
const state = (page) => page.evaluate(() => {
  const s = window.__g27.session;
  if (!s) return { app: window.__g27.app };
  const m = s.match;
  return { app: window.__g27.app, state: s.state, side: s.humanSide, needs: s.needsHumanCall, phase: m.phase, q: m.quarter, clock: Math.round(m.clock), score: m.score.join('-'), plays: s.plays, meter: s.sim?.meter?.phase };
});

// 1) Menus -> Play Now -> a stretch of a human game.
let page = await open('');
await page.keyboard.press('Enter'); await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/menu.png` });
await page.keyboard.press('KeyJ'); await page.waitForTimeout(600); // Play Now
await page.screenshot({ path: `${out}/setup.png` });
await page.keyboard.press('KeyJ'); await page.waitForTimeout(1500); // Start Game
for (let i = 0; i < 40; i++) {
  const s = await state(page);
  if (s.app !== 'game') break;
  if (s.needs) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(400); continue; }
  if (s.state === 'presnap' && s.side === 'offense') {
    await page.keyboard.press('KeyJ'); // snap (or start the kick meter)
    if (s.meter !== undefined) {
      await page.waitForFunction(() => window.__g27.session.sim?.meter?.value > 0.85 || window.__g27.session.state !== 'live', null, { timeout: 20000 }).catch(() => {});
      await page.keyboard.press('KeyJ');
      await page.waitForTimeout(250);
      await page.keyboard.press('KeyJ');
    } else {
      await page.waitForTimeout(1500);
      await page.keyboard.down('KeyK'); await page.waitForTimeout(250); await page.keyboard.up('KeyK'); // throw to B on pass plays
    }
  }
  await page.waitForTimeout(1200);
  if (i === 12) await page.screenshot({ path: `${out}/game.png` });
}
console.log('human game:', JSON.stringify(await state(page)));
// Pause menu.
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
const paused = await state(page);
await page.screenshot({ path: `${out}/pause.png` });
await page.keyboard.press('KeyK');
await page.waitForFunction(() => window.__g27.app !== 'paused', null, { timeout: 5000 }).catch(() => {});
const resumed = await state(page);
console.log('pause:', paused.app, '-> resume:', resumed.app);
if (paused.app !== 'paused' || resumed.app !== 'game') errors.push('pause menu did not open/resume');
await page.close();

// 2) Full CPU-vs-CPU game with 1-minute quarters at 10x.
page = await open('?auto&speed=10&q=1&seed=11');
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(5000);
  const s = await state(page);
  if (s.app === 'over') break;
}
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/final.png` });
console.log('auto game:', JSON.stringify(await state(page)));
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.slice(0, 20).join('\n')); process.exit(1); }
console.log('No console errors.');
