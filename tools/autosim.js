#!/usr/bin/env node
// Headless CPU-vs-CPU runner. Phase 1: runs many single plays with random play calls and
// checks invariants (play terminates, no NaN, valid result). Usage:
//   npm run sim -- --plays 500 --seed 7 [--verbose]
import { RNG } from '../src/core/rng.js';
import { STEP } from '../src/core/constants.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { listOffPlays, listDefPlays } from '../src/data/playbook.js';
import { PlaySim, MAX_PLAY_TIME } from '../src/sim/play.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : null).filter(Boolean));
const N = parseInt(args.plays || '300', 10);
const seed = parseInt(args.seed || '1', 10);
const verbose = !!args.verbose;

const teams = generateLeagueRosters(defaultTeams(), 2027);
const rng = new RNG(seed);
const errors = [];
const stats = {};
const add = (k, v = 1) => (stats[k] = (stats[k] || 0) + v);
const t0 = Date.now();
const byPlay = {};
const yacList = [];
const runList = [];

for (let i = 0; i < N; i++) {
  const op = rng.pick(listOffPlays());
  const dp = rng.pick(listDefPlays());
  const offIdx = rng.int(0, 1);
  const dir = rng.chance(0.5) ? 1 : -1;
  const losX = rng.range(-40, 40);
  const sim = new PlaySim({
    rng, teams: [teams[i % 32], teams[(i * 7 + 3) % 32]], offIdx, dir, losX, ballZ: rng.range(-3, 3),
    offPlay: op, defPlay: dp, humanTeam: null,
  });
  sim.snap();
  let ticks = 0;
  const evCount = {};
  while (!sim.finished && ticks < (MAX_PLAY_TIME + 5) / STEP) {
    sim.tick(STEP, null);
    for (const e of sim.events) {
      evCount[e.type] = (evCount[e.type] || 0) + 1;
      if (e.type === 'throw' && op.type === 'pass') {
        add('pass:tthrow', sim.t); add('pass:thrown');
        const qb = sim.players[e.qb];
        let md = 99;
        for (const d of sim.players) if (d.team !== qb.team && !d.engagement && d.state === 'active') md = Math.min(md, Math.hypot(d.x - qb.x, d.z - qb.z));
        if (md < 3) add('pass:pressured');
      }
    }
    ticks++;
    for (const p of sim.players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { errors.push(`play ${i}: NaN position for ${p.slot}`); break; }
    }
    if (!Number.isFinite(sim.ball.x)) errors.push(`play ${i}: NaN ball`);
    if (errors.length > 20) break;
  }
  const r = sim.result;
  if (!r) { errors.push(`play ${i} (${op.id} vs ${dp.id}) never ended`); continue; }
  if (r.reason === 'timeout') errors.push(`play ${i} (${op.id} vs ${dp.id}) hit the time limit; ball=${sim.ball.state}`);
  if (Math.abs(r.spotX) > 60.01) errors.push(`play ${i}: spot out of range ${r.spotX}`);
  add('plays');
  const pp = (byPlay[op.id] ||= { n: 0, yds: 0, cmp: 0, att: 0, yac: 0, td: 0 });
  pp.n++; pp.yds += r.yards; if (r.passAttempt) pp.att++; if (r.complete) { pp.cmp++; pp.yac += r.spotX * r.dir - r.catchX * r.dir; yacList.push(r.spotX * r.dir - r.catchX * r.dir); } if (r.touchdown === r.offTeam) pp.td++;
  add(`type:${op.type}`);
  add(`reason:${r.reason}`);
  if (op.type === 'pass') {
    if (r.passAttempt) add('pass:att');
    if (r.complete) { add('pass:cmp'); add('pass:yds', r.yards); add('pass:air', (r.catchX - r.losX) * r.dir); }
    if (r.interception) add('pass:int');
    if (r.sack) { add('pass:sack'); add('pass:pressured'); }
  } else {
    add('run:yds', r.yards); runList.push(r.yards);
  }
  if (r.touchdown !== null) add('td');
  if (r.safety) add('safety');
  if (r.turnover) add('turnover');
  add('time', r.duration);
  for (const [k, v] of Object.entries(evCount)) if (['brokenTackle', 'shed', 'deflection', 'drop', 'bigHit', 'move', 'tackle', 'incomplete'].includes(k)) add(`ev:${k}`, v);
  if (verbose) console.log(i, op.id.padEnd(24), dp.id.padEnd(20), r.reason.padEnd(10), r.yards.toFixed(1), r.complete ? 'CMP' : '', r.interception ? 'INT' : '', r.sack ? 'SACK' : '');
}
const passPlays = stats['type:pass'] || 0, runPlays = stats['type:run'] || 0;
console.log(`\nRan ${stats.plays} plays in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Pass: ${stats['pass:cmp'] || 0}/${stats['pass:att'] || 0} (${(100 * (stats['pass:cmp'] || 0) / Math.max(1, stats['pass:att'] || 0)).toFixed(0)}%), ` +
  `${((stats['pass:yds'] || 0) / Math.max(1, stats['pass:cmp'] || 0)).toFixed(1)} yds/cmp, INT ${stats['pass:int'] || 0}, sacks ${stats['pass:sack'] || 0} of ${passPlays} dropbacks`);
console.log(`  time to throw ${((stats['pass:tthrow'] || 0) / Math.max(1, stats['pass:thrown'] || 0)).toFixed(2)}s, pressure ${(100 * (stats['pass:pressured'] || 0) / Math.max(1, passPlays)).toFixed(0)}%, sack ${(100 * (stats['pass:sack'] || 0) / Math.max(1, passPlays)).toFixed(1)}%, INT ${(100 * (stats['pass:int'] || 0) / Math.max(1, stats['pass:att'] || 0)).toFixed(1)}%`);
console.log(`  air yds/cmp ${((stats['pass:air'] || 0) / Math.max(1, stats['pass:cmp'] || 0)).toFixed(1)}`);
console.log(`Run: ${((stats['run:yds'] || 0) / Math.max(1, runPlays)).toFixed(2)} yds/carry over ${runPlays} runs`);
console.log(`TDs ${stats.td || 0}, safeties ${stats.safety || 0}, turnovers ${stats.turnover || 0}, avg play ${(stats.time / stats.plays).toFixed(1)}s`);
console.log('Reasons:', Object.entries(stats).filter(([k]) => k.startsWith('reason:')).map(([k, v]) => `${k.slice(7)}=${v}`).join(' '));
console.log('Events:', Object.entries(stats).filter(([k]) => k.startsWith('ev:')).map(([k, v]) => `${k.slice(3)}=${v}`).join(' '));
const pct = (l, q) => { const a = [...l].sort((x, y) => x - y); return a.length ? a[Math.floor(q * (a.length - 1))].toFixed(1) : '-'; };
console.log(`YAC p25/50/75/90: ${pct(yacList, .25)} ${pct(yacList, .5)} ${pct(yacList, .75)} ${pct(yacList, .9)}   Run p25/50/75/90: ${pct(runList, .25)} ${pct(runList, .5)} ${pct(runList, .75)} ${pct(runList, .9)}`);
for (const [id, v] of Object.entries(byPlay)) console.log(`  ${id.padEnd(26)} n=${v.n} ypp=${(v.yds / v.n).toFixed(1)} ${v.att ? `cmp=${v.cmp}/${v.att} yac=${(v.yac / Math.max(1, v.cmp)).toFixed(1)}` : ''} td=${v.td}`);
if (errors.length) {
  console.log(`\n${errors.length} ERRORS:`);
  for (const e of errors.slice(0, 20)) console.log(' -', e);
  process.exit(1);
} else console.log('\nNo invariant violations.');
