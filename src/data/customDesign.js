// Play designer extras (pure logic, stored per browser like "My Plays"):
//  - custom routes drawn on a grid (Playbook → Route Drawer): registered into ROUTES as `cr_*`, so any play can use them;
//  - custom defensive plays (Playbook → Defensive Plays): formation + one assignment per slot, shown in the play-call
//    screen's "My Plays" tab on defense (the CPU never calls them);
//  - share codes: one line of text that carries a play (and the custom routes it uses) between browsers.
import { ROUTES } from './routes.js';
import { listDefPlays, getDefFormation, setCustomDefPlays } from './playbook.js';
import { ZONES } from '../ai/zones.js';

// ---------- custom routes ----------
/** Register the user's routes: ROUTES[id] = { pts: [[downfield, outside], ...], end, custom, name }. */
export function registerCustomRoutes(list) {
  for (const k of Object.keys(ROUTES)) if (ROUTES[k].custom) delete ROUTES[k];
  for (const r of list || []) if (r?.id && Array.isArray(r.pts) && r.pts.length) ROUTES[r.id] = { pts: r.pts.map(([d, o]) => [+d, +o]), end: r.end === 'settle' ? 'settle' : 'continue', custom: true, name: r.name || r.id };
}
const RKEY = 'g27.routes';
export function loadRoutes() { try { return JSON.parse(localStorage.getItem(RKEY) || '[]'); } catch { return []; } }
export function saveRoutes(list) { try { localStorage.setItem(RKEY, JSON.stringify(list)); } catch { /* storage blocked */ } }

// ---------- custom defensive plays ----------
export const DEF_MAN = ['man:L1', 'man:L2', 'man:L3', 'man:R1', 'man:R2', 'man:R3', 'man:RB', 'man:TE'];
export const DEF_ASSIGN_CHOICES = () => ['rush', 'blitz', 'spy', ...Object.keys(ZONES).map((z) => `zone:${z}`), ...DEF_MAN];

/** Defensive formations a custom play can use (the stock ones). */
export function defFormations() {
  return [...new Set(listDefPlays().filter((p) => !p.custom).map((p) => p.formation))];
}

/** A new defensive spec: assignments copied from the formation's first stock play. */
export function newDefSpec(id, formation = defFormations()[0]) {
  const base = listDefPlays().find((p) => p.formation === formation && !p.custom);
  const f = getDefFormation(formation);
  const assign = {};
  for (const p of f.players) assign[p.s] = base?.assign?.[p.s] || 'zone:hook_middle';
  return { id, name: 'My Defense', formation, assign };
}

export function changeDefFormation(spec, formation) {
  const fresh = newDefSpec(spec.id, formation);
  for (const s of Object.keys(fresh.assign)) if (spec.assign[s]) fresh.assign[s] = spec.assign[s];
  return { ...spec, formation, assign: fresh.assign };
}

/** A playable defense (same shape as defense.json): coverage = man when most of the coverage players play man. */
export function buildDefPlay(spec) {
  const valid = new Set(DEF_ASSIGN_CHOICES());
  const assign = {};
  for (const [s, a] of Object.entries(spec.assign)) assign[s] = valid.has(a) ? a : 'zone:hook_middle';
  const cover = Object.values(assign).filter((a) => a.startsWith('man:') || a.startsWith('zone:'));
  const man = cover.filter((a) => a.startsWith('man:')).length;
  return { id: spec.id, name: spec.name || 'My Defense', formation: spec.formation, coverage: man * 2 > cover.length ? 'man' : 'zone', assign, custom: true, rev: spec.rev || 0 };
}

export function registerCustomDefPlays(specs) { setCustomDefPlays((specs || []).map(buildDefPlay)); }
const DKEY = 'g27.defbook';
export function loadDefSpecs() { try { return JSON.parse(localStorage.getItem(DKEY) || '[]'); } catch { return []; } }
export function saveDefSpecs(specs) { try { localStorage.setItem(DKEY, JSON.stringify(specs)); } catch { /* storage blocked */ } }

// ---------- share codes ----------
// "G27-" + base64url(JSON { kind: 'off' | 'def' | 'route', spec, routes: [custom routes the play uses] }).
const b64 = (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return typeof atob === 'function' ? decodeURIComponent(escape(atob(t))) : Buffer.from(t, 'base64').toString('utf8'); };

export function shareCode(kind, spec, customRoutes = []) {
  const used = kind === 'off' ? customRoutes.filter((r) => Object.values(spec.routes || {}).some((v) => v === r.id || v === `${r.id}_l` || v === `${r.id}_r`)) : kind === 'route' ? [spec] : [];
  return `G27-${b64(JSON.stringify({ v: 1, kind, spec, routes: used }))}`;
}

/** Decode a share code: { kind, spec, routes } (throws on a bad code). */
export function readShareCode(code) {
  const m = /G27-([A-Za-z0-9_-]+)/.exec(code || '');
  if (!m) throw new Error('Not a Gridiron 27 share code');
  const o = JSON.parse(unb64(m[1]));
  if (!o || !['off', 'def', 'route'].includes(o.kind) || !o.spec) throw new Error('Unknown share code');
  return o;
}
