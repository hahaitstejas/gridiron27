// CPU difficulty tiers. Boosts are added to every rating via PlaySim.R(); the other fields are read
// by the sim (reaction delays, QB accuracy, tackling, fumbles) and the play caller (blitz rate).
export const DIFFICULTY = {
  rookie: { label: 'Rookie', cpuBoost: -7, humanBoost: 4, cpuReact: 1.3, cpuAccuracy: 1.4, cpuTackle: -0.07, humanTackle: -0.05, cpuFumble: 1.5, humanFumble: 0.5, blitz: 0.1, smart: 0.6 },
  pro: { label: 'Pro', cpuBoost: 0, humanBoost: 0, cpuReact: 1, cpuAccuracy: 1, cpuTackle: 0, humanTackle: 0, cpuFumble: 1, humanFumble: 1, blitz: 0.2, smart: 0.85 },
  allpro: { label: 'All-Pro', cpuBoost: 5, humanBoost: -2, cpuReact: 0.85, cpuAccuracy: 0.8, cpuTackle: 0.04, humanTackle: 0.03, cpuFumble: 0.8, humanFumble: 1.2, blitz: 0.25, smart: 0.95 },
  legend: { label: 'Legend', cpuBoost: 10, humanBoost: -5, cpuReact: 0.7, cpuAccuracy: 0.65, cpuTackle: 0.08, humanTackle: 0.06, cpuFumble: 0.6, humanFumble: 1.4, blitz: 0.3, smart: 1 },
};
export const DIFFICULTY_KEYS = Object.keys(DIFFICULTY);

/** PlaySim config fields for a difficulty, given which team (if any) is human. */
export function difficultyConfig(key, humanTeam) {
  const d = DIFFICULTY[key] || DIFFICULTY.pro;
  if (humanTeam === null || humanTeam === undefined) return { difficulty: null, boost: [0, 0] };
  const boost = [0, 0];
  boost[humanTeam] = d.humanBoost;
  boost[1 - humanTeam] = d.cpuBoost;
  return { difficulty: d, boost };
}
