// Pre-snap audibles and hot routes. Pure logic: the session asks for the options and swaps plays;
// the HUD only draws them.
import { listOffPlays, listDefPlays, mirrorOffPlay } from '../data/playbook.js';
import { playTags } from '../ai/playcaller.js';

const baseId = (id) => id.replace(/__flip$/, '');
const baseFormation = (f) => f.replace(/__flip$/, '');

/** Offensive audibles from the current formation: A quick, B deep, X run left, Y run right, RB flip. */
export function offenseAudibles(play) {
  const flipped = /__flip$/.test(play.id);
  const same = listOffPlays().filter((p) => p.formation === baseFormation(play.formation) && baseId(p.id) !== baseId(play.id));
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

// Hot routes: stick direction relative to the receiver.
export const HOT_ROUTES = { up: 'go', down: 'hitch', in: 'slant', out: 'quick_out', block: 'block' };

/** A copy of `play` with one receiver's route changed (the QB looks there first). */
export function hotRoute(play, slot, route) {
  const routes = { ...play.routes, [slot]: route };
  const read = route === 'block' ? (play.read || []).filter((s) => s !== slot) : [slot, ...(play.read || []).filter((s) => s !== slot)];
  return { ...play, routes, read, hot: { ...(play.hot || {}), [slot]: route } };
}
