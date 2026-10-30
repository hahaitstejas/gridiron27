// In-play fouls, recorded on the PlaySim as they happen (enforced after the whistle).
export function addFoul(sim, type, team, player, extra = {}) {
  sim.fouls ||= [];
  if (sim.fouls.some((f) => f.type === type && f.team === team)) return;
  sim.fouls.push({ type, team, player: player ? { id: player.id, number: player.number, rid: player.rid } : null, t: sim.t, ...extra });
  sim.emit('flag', { foulType: type, team, live: true });
}

export function foulRate(sim) {
  return sim.cfg.penaltyRate ?? 1;
}
