// Pre-snap read (offense, hold RT at the line with the play art): what the QB thinks the defense is in, from how it
// lines up, with a confidence that depends on his awareness. Disguised coverages show the wrong shell; a smart QB
// sometimes sees through it. Pure logic; deterministic per snap (no sim RNG used).
import { shellOf } from '../ai/defense.js';


const CB = /^(LCB|RCB|NB|DB)$/;

function hash(s) { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return x / 4294967296; }

/** { shell: 0|1|2, man: bool, blitz: bool, confidence: 0..1, text } for the offense's QB. */
export function coverageRead(sim) {
  const qb = sim.bySlot(sim.offIdx, 'QB');
  const aw = qb ? sim.R(qb, 'awareness') : 70;
  const d = sim.defense();
  const loc = (p) => sim.toLocal(p.x, p.z);
  // What it looks like: deep defenders, corners pressed / over receivers, defenders walked up to the line.
  const deep = d.filter((p) => loc(p).down > 10).length;
  const shown = Math.min(2, deep);
  const rec = sim.offense().filter((p) => p.task?.type !== 'pass_block' && !/^(LT|LG|C|RG|RT|QB)$/.test(p.slot));
  const tight = d.filter((p) => CB.test(p.slot) && rec.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 2.6)).length;
  const box = d.filter((p) => loc(p).down < 2.2 && Math.abs(loc(p).lat) < 8).length;
  const lookMan = tight >= 2;
  const lookBlitz = box >= 6;
  // The truth.
  const realShell = Math.min(2, shellOf(sim.defPlay));
  const realMan = sim.defPlay.coverage === 'man';
  const realBlitz = Object.values(sim.defPlay.assign || {}).filter((a) => a === 'blitz').length > 0;
  const r = hash(`${sim.defPlay.id}|${Math.round(sim.losX)}|${sim.offPlay.id}`);
  const r2 = hash(`${sim.defPlay.id}|${sim.ballZ.toFixed(1)}`);
  const sees = (aw - 45) / 60; // chance he reads through a disguise / a deceptive alignment
  const shell = sim.disguise || shown !== realShell ? (r < sees ? realShell : shown) : shown;
  const man = lookMan === realMan || r2 < sees ? realMan : lookMan;
  const blitz = lookBlitz || (realBlitz && r2 < sees * 0.6);
  const right = (shell === realShell) + (man === realMan) + (blitz === realBlitz);
  const confidence = Math.max(0.25, Math.min(0.95, 0.35 + (aw - 50) * 0.008 + (right - 1.5) * 0.12));
  const name = shell === 0 ? 'Cover 0' : shell === 1 ? (man ? 'Cover 1' : 'Cover 3') : man ? '2-Man' : 'Cover 2 / 4';
  const text = `${name} · ${shell === 0 ? 'no deep safety' : shell === 1 ? 'one high' : 'two high'} · ${man ? 'man' : 'zone'}${blitz ? ' · pressure coming' : ''}`;
  return { shell, man, blitz, confidence, text };
}
