// Pre-snap audibles and hot routes. Pure logic: the session asks for the options and swaps plays;
// the HUD only draws them.
import { listOffPlays, listDefPlays, mirrorOffPlay, getOffFormation } from '../data/playbook.js';
import { playTags } from '../ai/playcaller.js';

const baseId = (id) => id.replace(/__flip$/, '');
const baseFormation = (f) => f.replace(/__flip$/, '');

/** Offensive audibles from the current formation: A quick, B deep, X run left, Y run right, RB flip. */
export function offenseAudibles(play) {
  const flipped = /__flip$/.test(play.id);
  const same = listOffPlays().filter((p) => !p.custom && p.formation === baseFormation(play.formation) && baseId(p.id) !== baseId(play.id));
  const view = (p) => (flipped ? mirrorOffPlay(p) : p);
  const passes = same.filter((p) => p.type === 'pass');
  const runs = same.filter((p) => p.type === 'run').map(view);
  const pick = (list, ok) => list.find(ok) || list[0] || null;
  const taken = new Set();
  const take = (p) => { if (p) taken.add(p.id); return p; };
  const quick = take(pick(passes, (p) => playTags(p).quick));
  const deep = take(pick(passes.filter((p) => !taken.has(p.id)), (p) => playTags(p).deep || p.pa) || pick(passes.filter((p) => !taken.has(p.id)), () => true));
  const runL = take(pick(runs, (p) => p.run.side < 0));
  const runR = take(pick(runs.filter((p) => !taken.has(p.id)), (p) => p.run.side > 0));
  const out = [
    { btn: 'A', label: 'Quick pass', play: quick && view(quick) },
    { btn: 'B', label: 'Deep shot', play: deep && view(deep) },
    { btn: 'X', label: 'Run left', play: runL },
    { btn: 'Y', label: 'Run right', play: runR },
    { btn: 'RB', label: 'Flip play', play: flipped ? listOffPlays().find((p) => p.id === baseId(play.id)) : mirrorOffPlay(play) },
  ];
  return out.filter((o) => o.play);
}

/** Defensive audibles from the current formation: A zone, B man, X blitz, Y deep shell. */
export function defenseAudibles(play) {
  const same = listDefPlays().filter((p) => p.formation === play.formation && p.id !== play.id);
  const blitz = (p) => /blitz|fire|cover0|double_a/i.test(p.id);
  const deep = (p) => /cover4|quarters|cover6|prevent|tampa|cover2(?!_man)/i.test(p.id);
  const taken = new Set();
  const take = (list) => { const p = list.find((x) => !taken.has(x.id)); if (p) taken.add(p.id); return p; };
  const out = [
    { btn: 'A', label: 'Zone', play: take(same.filter((p) => p.coverage === 'zone' && !blitz(p) && !deep(p))) },
    { btn: 'B', label: 'Man', play: take(same.filter((p) => p.coverage === 'man' && !blitz(p))) },
    { btn: 'X', label: 'Blitz', play: take(same.filter(blitz)) },
    { btn: 'Y', label: 'Deep shell', play: take(same.filter(deep)) },
  ];
  return out.filter((o) => o.play);
}

// Pass protection calls (LB at the line on offense): slide the line, keep the backs and tight ends in, or send
// everyone out. `play.prot` = 'left' | 'right' (blocking.js / offense.js assignProtection reads it).
export const PROTECTION_CALLS = [
  { btn: 'A', key: 'left', label: 'Slide left' },
  { btn: 'B', key: 'right', label: 'Slide right' },
  { btn: 'X', key: 'max', label: 'Max protect (backs and TEs stay in)' },
  { btn: 'Y', key: 'out', label: 'Everyone out (backs and TEs release)' },
  { btn: 'LT', key: 'reset', label: 'Reset' },
];

/** A copy of the pass play with a protection call applied (reset returns the play as called). */
export function protectCall(play, key) {
  const base = play.protFrom || play;
  if (key === 'reset' || play.type !== 'pass') return base;
  const out = { ...play, protFrom: base };
  if (key === 'left' || key === 'right') { out.prot = key; return out; }
  const f = getOffFormation(play.formation) || getOffFormation(play.formation.replace(/__flip$/, ''));
  const helpers = (f?.players || []).filter((p) => ['HB', 'FB', 'TE'].includes(p.p));
  const routes = { ...play.routes };
  let read = [...(play.read || [])];
  for (const h of helpers) {
    const r = routes[h.s];
    if (key === 'max' && r && r !== 'block' && read.filter((s) => s !== h.s).length) { routes[h.s] = 'block'; read = read.filter((s) => s !== h.s); }
    if (key === 'out' && (!r || r === 'block' || r === 'stalk')) {
      routes[h.s] = h.p === 'TE' ? 'flat' : 'swing';
      read.push(h.s);
    }
  }
  return { ...out, routes, read, protKey: key };
}

// Hot routes: stick direction relative to the receiver.
export const HOT_ROUTES = { up: 'go', down: 'hitch', in: 'slant', out: 'quick_out', block: 'block' };

/** A copy of `play` with one receiver's route changed (the QB looks there first). */
export function hotRoute(play, slot, route) {
  const routes = { ...play.routes, [slot]: route };
  const read = route === 'block' ? (play.read || []).filter((s) => s !== slot) : [slot, ...(play.read || []).filter((s) => s !== slot)];
  return { ...play, routes, read, hot: { ...(play.hot || {}), [slot]: route } };
}

// Defensive coverage adjustments (LB at the line): corners press or play off, leverage inside or outside.
export const COVERAGE_CALLS = [
  { btn: 'A', key: 'press', label: 'Press', set: { cover: 'press' } },
  { btn: 'B', key: 'off', label: 'Play off', set: { cover: 'off' } },
  { btn: 'X', key: 'in', label: 'Shade inside', set: { shade: 'in' } },
  { btn: 'Y', key: 'out', label: 'Shade outside', set: { shade: 'out' } },
  { btn: 'RB', key: 'disguise', label: 'Disguise the shell', set: { disguise: true } },
  { btn: 'LT', key: 'reset', label: 'Reset', set: null },
];

export const DISGUISE_RATE = 0.25;

/** The CPU defense's coverage call for a play: man coverage presses more often than zone. */
export function cpuCoverageCall(defPlay, rng) {
  if (!defPlay || /^st_/.test(defPlay.id)) return null;
  const r = rng.next();
  const call = defPlay.coverage === 'man' ? (r < 0.3 ? { cover: 'press' } : r < 0.42 ? { cover: 'off' } : null)
    : (r < 0.12 ? { cover: 'press' } : r < 0.27 ? { cover: 'off' } : null);
  // About a quarter of snaps the CPU disguises its safety shell.
  if (rng.next() < DISGUISE_RATE) return { ...call, disguise: true };
  return call;
}

// Defensive hot routes (Y at the line, on the defender you control): a new assignment for that one player.
export const DEF_HOT = [
  { btn: 'A', key: 'blitz', label: 'Blitz' },
  { btn: 'X', key: 'spy', label: 'QB spy' },
  { btn: 'Y', key: 'hook', label: 'Hook zone' },
  { btn: 'B', key: 'deep', label: 'Deep zone' },
  { btn: 'RB', key: 'flat', label: 'Flat zone' },
];

/** A copy of the defensive play with `slot` reassigned; `lat` (offense frame) picks the side for flat/hook zones. */
export function defHotRoute(play, slot, key, lat = 0) {
  const side = lat < 0 ? 'l' : 'r';
  const assign = key === 'blitz' ? 'blitz' : key === 'spy' ? 'spy' : key === 'deep' ? 'zone:deep_middle'
    : key === 'flat' ? `zone:flat_${side}` : Math.abs(lat) > 3 ? `zone:hook_${side}` : 'zone:hook_middle';
  return { ...play, assign: { ...play.assign, [slot]: assign }, dhot: { ...(play.dhot || {}), [slot]: assign } };
}
