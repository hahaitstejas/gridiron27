// Player energy (0..1, 1 = fresh) across a game, and the rotation it drives: tired backs, receivers,
// tight ends, defensive linemen and linebackers come off for a fresher player from the depth chart.
// Pure logic: the session owns the energy maps and passes them to each PlaySim.

/** Energy below which a player at this roster position gets a breather (0 = never rotates). */
export const ROTATE_AT = { HB: 0.78, FB: 0.62, WR: 0.7, TE: 0.66, DT: 0.74, DE: 0.72, OLB: 0.64, MLB: 0.5, CB: 0.45 };

// Energy spent per snap by position (a ~5 s play), before effort bonuses.
const COST = { QB: 0.003, HB: 0.095, FB: 0.06, WR: 0.052, TE: 0.045, T: 0.005, G: 0.005, C: 0.005,
  DE: 0.095, DT: 0.105, OLB: 0.05, MLB: 0.025, CB: 0.014, FS: 0.01, SS: 0.01, K: 0, P: 0 };
const RECOVER_PER_PLAY = 0.05; // on the sideline for one snap

export function newEnergy() { return [new Map(), new Map()]; }

export function energyOf(energy, team, id) { return energy?.[team]?.get(id) ?? 1; }

/** Is this roster player due a rest? `relax` lowers the bar (starters stay in for big moments). */
export function needsRest(energy, team, rp, relax = 0) {
  const th = ROTATE_AT[rp.pos] ?? 0;
  return th > 0 && energyOf(energy, team, rp.id) < th - relax;
}

/** After a play: players who were on the field tire (more for carriers, route runners, rushers), everyone else recovers. */
export function applyPlayFatigue(energy, sim, duration) {
  const scale = Math.min(1.5, Math.max(0.6, duration / 5));
  for (const team of [0, 1]) {
    const onField = new Set();
    for (const p of sim.players) {
      if (p.team !== team) continue;
      onField.add(p.rid);
      let cost = (COST[p.pos] ?? 0.02) * scale;
      const t = p.task?.type;
      if (p.id === sim.result?.carrierId || t === 'carrier') cost += 0.03;
      else if (t === 'route' || t === 'rush' || t === 'blitz' || t === 'pursue') cost += 0.006 * scale;
      energy[team].set(p.rid, Math.max(0, energyOf(energy, team, p.rid) - cost));
    }
    for (const [id, e] of energy[team]) if (!onField.has(id)) energy[team].set(id, Math.min(1, e + RECOVER_PER_PLAY));
  }
}

/** Everyone gets some energy back (timeouts, quarter breaks); amount 1 = fully rested. */
export function restAll(energy, amount) {
  for (const m of energy) for (const [id, e] of m) m.set(id, Math.min(1, e + amount));
}
