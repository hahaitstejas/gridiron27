// Custom offensive plays ("My Plays", built in the playbook editor). Pure logic: a small spec the editor edits,
// turned into a normal play object (same shape as offense.json) and registered with the playbook.
import { getOffFormation, listOffPlays, setCustomPlays } from './playbook.js';
import { ROUTES } from './routes.js';

const OL = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
export const ROUTE_CHOICES = ['block', ...Object.keys(ROUTES)];
export const RUN_GAPS = { inside: [1, 1.2], 'off tackle': [1, 3], outside: [0.5, 5.5] };

/** Offensive formations a custom play can use (no special teams, no flipped copies). */
export function customFormations() {
  return [...new Set(listOffPlays().filter((p) => !p.custom).map((p) => p.formation))].filter((id) => !id.endsWith('__flip'));
}

/** Formation slots that can run a route or carry (everyone but the line and the QB). */
export function eligibleSlots(formationId) {
  const f = getOffFormation(formationId);
  return f ? f.players.filter((p) => !OL.has(p.s) && p.s !== 'QB').map((p) => ({ slot: p.s, pos: p.p, at: p.at })) : [];
}

/** A new spec in a formation: routes copied from the formation's first pass play. */
export function newSpec(id, formation = customFormations()[0]) {
  const base = listOffPlays().find((p) => p.formation === formation && p.type === 'pass' && !p.custom);
  const routes = {};
  for (const e of eligibleSlots(formation)) routes[e.slot] = base?.routes?.[e.slot] || (e.pos === 'WR' ? 'go' : 'block');
  const first = eligibleSlots(formation).find((e) => routes[e.slot] !== 'block');
  return {
    id, name: 'My Play', formation, type: 'pass', routes, primary: first?.slot || null, dropback: 5, pa: false, boot: 0,
    run: { carrier: eligibleSlots(formation).find((e) => e.pos === 'HB' || e.pos === 'FB')?.slot || 'QB', side: 1, gap: 'inside', scheme: 'zone' },
  };
}

/** Keep a spec valid after its formation changes (routes for the new slots, carrier still in the formation). */
export function changeFormation(spec, formation) {
  const fresh = newSpec(spec.id, formation);
  const slots = new Set(eligibleSlots(formation).map((e) => e.slot));
  for (const s of slots) if (spec.routes[s]) fresh.routes[s] = spec.routes[s];
  return { ...spec, formation, routes: fresh.routes, primary: slots.has(spec.primary) ? spec.primary : fresh.primary,
    run: { ...spec.run, carrier: slots.has(spec.run.carrier) || spec.run.carrier === 'QB' ? spec.run.carrier : fresh.run.carrier } };
}

/** Turn a spec into a playable play (same shape as offense.json entries). */
export function buildPlay(spec) {
  const f = getOffFormation(spec.formation);
  const play = { id: spec.id, name: spec.name || 'My Play', formation: spec.formation, custom: true, rev: spec.rev || 0, concept: 'My Play' };
  const elig = eligibleSlots(spec.formation);
  if (spec.type === 'run') {
    const side = spec.run.side >= 0 ? 1 : -1;
    const [d, lat] = RUN_GAPS[spec.run.gap] || RUN_GAPS.inside;
    const carrier = spec.run.carrier;
    const c = f.players.find((p) => p.s === carrier);
    // Mesh point: take the formation's own if a stock run play has one, else meet a yard in front of the back.
    const stock = listOffPlays().find((p) => p.formation === spec.formation && p.type === 'run' && p.run?.carrier === carrier && p.run.mesh && !p.custom);
    const mesh = carrier === 'QB' ? undefined : stock ? [stock.run.mesh[0], Math.abs(stock.run.mesh[1]) * side] : [c.at[0] + 0.8, c.at[1] * 0.5 + 0.5 * side];
    Object.assign(play, { type: 'run', concept: spec.run.gap === 'outside' ? 'Outside run' : spec.run.scheme === 'gap' ? 'Power' : 'Inside run',
      run: { carrier, aim: [d, lat * side], ...(mesh ? { mesh } : {}), scheme: spec.run.scheme === 'gap' ? 'gap' : 'zone', side } });
    play.routes = {};
    for (const e of elig) if (e.slot !== carrier) play.routes[e.slot] = e.pos === 'WR' ? 'stalk' : 'block';
    return play;
  }
  play.type = 'pass';
  play.dropback = spec.dropback || 5;
  play.routes = {};
  for (const e of elig) play.routes[e.slot] = ROUTE_CHOICES.includes(spec.routes[e.slot]) ? spec.routes[e.slot] : 'block';
  const runners = elig.map((e) => e.slot).filter((s) => play.routes[s] !== 'block');
  // Read order: the primary first, then deeper routes before checkdowns.
  const depth = (s) => Math.max(...(ROUTES[play.routes[s]]?.pts || [[0, 0]]).map((p) => p[0]));
  play.read = [...runners].sort((a, b) => (a === spec.primary ? -1 : b === spec.primary ? 1 : depth(b) - depth(a)));
  if (spec.pa) play.pa = true;
  if (spec.boot) play.boot = spec.boot > 0 ? 1 : -1;
  return play;
}

/** Register the user's plays (replacing earlier custom plays). */
export function registerCustomPlays(specs) {
  setCustomPlays(specs.map(buildPlay));
}

// Stored per browser: "My Plays" carry across leagues and franchises.
const KEY = 'g27.playbook';
export function loadSpecs() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function saveSpecs(specs) {
  try { localStorage.setItem(KEY, JSON.stringify(specs)); } catch { /* storage full or blocked */ }
}
