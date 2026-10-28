#!/usr/bin/env node
// Browser smoke test (optional, needs Playwright installed: `npm i -D playwright && npx playwright install chromium`).
// Starts from a running dev server (npm run dev) and drives the game, reporting console errors.
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
const state = (page) => page.evaluate(() => { const s = window.__g27.session; return { plays: s.playsRun || 0, state: s.sim.state, side: s.humanSide, controlled: s.sim.controlledId }; });

// 1) CPU vs CPU at high speed.
let page = await open('?auto&speed=6&seed=3');
await page.waitForTimeout(25000);
const autoState = await state(page);
await page.screenshot({ path: `${out}/auto.png` });
console.log('auto mode:', JSON.stringify(autoState));
await page.close();

// 2) Human offense: snap, run a play, throw to each receiver button.
page = await open('?autostart&seed=4');
for (const key of ['KeyK', 'KeyJ', 'KeyU', 'KeyI']) {
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(1600);
  await page.keyboard.down(key); await page.waitForTimeout(250); await page.keyboard.up(key);
  await page.waitForTimeout(4500);
}
console.log('offense:', JSON.stringify(await state(page)));
await page.screenshot({ path: `${out}/offense.png` });
// Run plays: cycle to a run play (X twice) and use moves.
await page.keyboard.press('KeyU'); await page.waitForTimeout(300);
await page.keyboard.press('KeyU'); await page.waitForTimeout(300);
await page.keyboard.press('KeyU'); await page.waitForTimeout(300);
await page.keyboard.press('KeyJ'); await page.waitForTimeout(1200);
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
await page.keyboard.press('KeyK'); await page.waitForTimeout(500);
await page.keyboard.press('KeyJ'); await page.waitForTimeout(1500);
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(3000);
console.log('run:', JSON.stringify(await state(page)));

// 3) Defense: swap sides, switch players, dive.
await page.keyboard.press('KeyQ'); await page.waitForTimeout(3200);
await page.keyboard.press('KeyK'); await page.waitForTimeout(400);
await page.keyboard.down('KeyS'); await page.waitForTimeout(800); await page.keyboard.up('KeyS');
await page.keyboard.press('KeyU'); await page.waitForTimeout(400);
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(4000);
console.log('defense:', JSON.stringify(await state(page)));
await page.screenshot({ path: `${out}/defense.png` });
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.slice(0, 20).join('\n')); process.exit(1); }
console.log('No console errors.');
