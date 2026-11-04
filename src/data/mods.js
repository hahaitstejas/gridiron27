// Mod packs (pure logic): a JSON file that adds formations, plays and routes to the playbook, like the stock
// playbooks/*.json (same shapes, see CLAUDE.md). Installed per browser (localStorage `g27.mods`, Playbook → Mod Packs),
// switched on and off there. Plays from an enabled pack are normal plays: they show on the play-call screen in their
// formation's family and the CPU may call them too. Everything is checked on import (formations exist, slots line up,
// routes are known) so a broken pack can't break a game.
//
//   { "name": "Spread Pack", "version": 1,
//     "routes": { "my_out_up": { "pts": [[6, 0], [6, 4], [25, 5]], "end": "continue" } },
//     "formations": { "offense": { "gun_wide": { "name": "Gun Wide", "family": "Shotgun", "players": [ ...11 ] } } },
//     "offense": [ { "id": "wide_verts", "name": "Wide Verticals", "formation": "gun_wide", "type": "pass", ... } ],
//     "defense": [ ... ] }
import { registerPlaybook, getOffFormation, getDefFormation, listOffPlays, listDefPlays } from './playbook.js';
import { ROUTES } from './routes.js';

const NON_ROUTES = new Set(['block', 'stalk']);
const baseRoute = (r) => r.replace(/_(l|r)$/, '');

/** Check a pack. Returns { ok, errors, pack } (pack normalized: ids prefixed with the pack id so nothing collides). */
export function validateMod(json) {
  const errors = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['Not a JSON object'], pack: null };
  const name = String(json.name || 'Mod pack').slice(0, 40);
  const id = `mod_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'pack'}`;
  const routes = {};
  for (const [rid, r] of Object.entries(json.routes || {})) {
    if (!Array.isArray(r?.pts) || !r.pts.length || r.pts.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) { errors.push(`route ${rid}: pts must be [[downfield, outside], ...]`); continue; }
    routes[rid] = { pts: r.pts.map(([d, o]) => [d, o]), end: r.end === 'settle' ? 'settle' : 'continue', mod: id };
  }
  const forms = { offense: {}, defense: {} };
  for (const side of ['offense', 'defense']) {
    for (const [fid, f] of Object.entries(json.formations?.[side] || {})) {
      const players = Array.isArray(f?.players) ? f.players : [];
      if (players.length !== 11) { errors.push(`${side} formation ${fid}: needs 11 players (has ${players.length})`); continue; }
      if (players.some((p) => !p.s || !p.p || !Array.isArray(p.at) || p.at.length !== 2)) { errors.push(`${side} formation ${fid}: every player needs s, p, d and at [downfield, lateral]`); continue; }
      if (side === 'offense' && !players.some((p) => p.s === 'QB')) { errors.push(`offense formation ${fid}: no QB slot`); continue; }
      forms[side][fid] = { name: f.name || fid, family: f.family || name, players: players.map((p) => ({ s: p.s, p: p.p, d: p.d ?? 0, at: [...p.at], ...(p.align ? { align: p.align } : {}) })) };
    }
  }
  const offF = (fid) => forms.offense[fid] || getOffFormation(fid);
  const defF = (fid) => forms.defense[fid] || getDefFormation(fid);
  const known = (r) => NON_ROUTES.has(r) || !!ROUTES[baseRoute(r)] || !!routes[baseRoute(r)];
  const offense = [], defense = [];
  const taken = new Set([...listOffPlays(true), ...listDefPlays(true)].map((p) => p.id));
  for (const p of json.offense || []) {
    const f = offF(p.formation);
    if (!p.id || !f) { errors.push(`offense play ${p.id || '?'}: unknown formation "${p.formation}"`); continue; }
    if (!['pass', 'run'].includes(p.type)) { errors.push(`offense play ${p.id}: type must be pass or run`); continue; }
    const slots = new Set(f.players.map((x) => x.s));
    const badSlot = Object.keys(p.routes || {}).find((s) => !slots.has(s));
    if (badSlot) { errors.push(`offense play ${p.id}: no slot ${badSlot} in ${p.formation}`); continue; }
    const badRoute = Object.values(p.routes || {}).find((r) => !known(r));
    if (badRoute) { errors.push(`offense play ${p.id}: unknown route ${badRoute}`); continue; }
    if (p.type === 'run' && (!p.run || !slots.has(p.run.carrier) || !Array.isArray(p.run.aim))) { errors.push(`offense play ${p.id}: a run needs run.carrier (a slot) and run.aim`); continue; }
    const pid = taken.has(p.id) ? `${id}_${p.id}` : p.id;
    offense.push({ ...JSON.parse(JSON.stringify(p)), id: pid, mod: id, read: (p.read || []).filter((s) => slots.has(s)) });
  }
  for (const p of json.defense || []) {
    const f = defF(p.formation);
    if (!p.id || !f) { errors.push(`defense play ${p.id || '?'}: unknown formation "${p.formation}"`); continue; }
    const pid = taken.has(p.id) ? `${id}_${p.id}` : p.id;
    defense.push({ ...JSON.parse(JSON.stringify(p)), id: pid, mod: id, coverage: p.coverage === 'man' ? 'man' : 'zone', assign: p.assign || {} });
  }
  if (!offense.length && !defense.length && !Object.keys(routes).length) errors.push('The pack has no plays or routes');
  return { ok: !!(offense.length || defense.length || Object.keys(routes).length), errors, pack: { id, name, version: json.version ?? 1, routes, formations: forms, offense, defense } };
}

/** Switch a (validated) pack on: its routes, formations and plays join the playbook. */
export function applyMod(pack) {
  removeMod(pack.id);
  Object.assign(ROUTES, pack.routes);
  registerPlaybook({ formations: pack.formations, offense: pack.offense, defense: pack.defense });
}

/** Switch a pack off (its plays and routes leave; formations stay harmlessly registered). */
export function removeMod(id) {
  for (const list of [listOffPlays(true), listDefPlays(true)]) {
    // listXPlays(true) returns the live arrays: remove in place.
    for (let i = list.length - 1; i >= 0; i--) if (list[i].mod === id) list.splice(i, 1);
  }
  for (const k of Object.keys(ROUTES)) if (ROUTES[k].mod === id) delete ROUTES[k];
}

const KEY = 'g27.mods';
export function loadMods() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function saveMods(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked */ } }
/** At boot: re-check and switch on every enabled pack. */
export function loadEnabledMods() {
  for (const m of loadMods()) if (m.enabled) { const v = validateMod(m.json); if (v.ok) applyMod(v.pack); }
}

/** A small example pack (Playbook → Mod Packs → Download an example). */
export function exampleMod() {
  const ol = [['LT', -2.6], ['LG', -1.3], ['C', 0], ['RG', 1.3], ['RT', 2.6]].map(([s, l]) => ({ s, p: s, d: 0, at: [s === 'C' ? -0.5 : -0.75, l] }));
  return {
    name: 'Example Pack', version: 1,
    routes: { out_and_up: { pts: [[6, 0], [6, 5], [28, 6]], end: 'continue' } },
    formations: { offense: { ex_gun_wide: { name: 'Gun Wide', family: 'Shotgun', players: [...ol,
      { s: 'QB', p: 'QB', d: 0, at: [-5, 0] }, { s: 'RB', p: 'HB', d: 0, at: [-5, 1.6] }, { s: 'X', p: 'WR', d: 0, at: [-0.8, -22] },
      { s: 'H', p: 'WR', d: 2, at: [-1.4, -12] }, { s: 'Y', p: 'TE', d: 0, at: [-0.9, 3.9] }, { s: 'Z', p: 'WR', d: 1, at: [-0.8, 22] }] } } },
    offense: [
      { id: 'ex_wide_out_up', name: 'Wide Out & Up', formation: 'ex_gun_wide', type: 'pass', concept: 'Shot', dropback: 7, routes: { X: 'out_and_up', Z: 'out_and_up', H: 'seam', Y: 'drag', RB: 'block' }, read: ['X', 'Z', 'H', 'Y'] },
      { id: 'ex_wide_draw', name: 'Wide Draw', formation: 'ex_gun_wide', type: 'run', concept: 'Draw', run: { carrier: 'RB', aim: [1, 0.8], mesh: [-4.8, 0.6], scheme: 'zone', side: 1, style: 'draw' }, routes: { X: 'stalk', Z: 'stalk', H: 'stalk', Y: 'block' } },
    ],
  };
}
