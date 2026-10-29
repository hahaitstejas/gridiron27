// Rating keys. Short codes are used by the CSV format (see CLAUDE.md).
export const RATINGS = [
  ['speed', 'SPD'], ['acceleration', 'ACC'], ['agility', 'AGI'], ['strength', 'STR'], ['awareness', 'AWR'],
  ['catching', 'CTH'], ['carrying', 'CAR'], ['breakTackle', 'BTK'], ['throwPower', 'THP'], ['throwAccuracy', 'THA'],
  ['runBlock', 'RBK'], ['passBlock', 'PBK'], ['passRush', 'PRS'], ['blockShed', 'BSH'], ['tackling', 'TAK'],
  ['hitPower', 'POW'], ['coverage', 'COV'], ['routeRunning', 'RTE'], ['kickPower', 'KPW'], ['kickAccuracy', 'KAC'],
];
export const RATING_KEYS = RATINGS.map((r) => r[0]);

export const POSITIONS = ['QB', 'HB', 'FB', 'WR', 'TE', 'T', 'G', 'C', 'DE', 'DT', 'OLB', 'MLB', 'CB', 'FS', 'SS', 'K', 'P'];
export const OFFENSE_POS = ['QB', 'HB', 'FB', 'WR', 'TE', 'T', 'G', 'C'];
export const DEFENSE_POS = ['DE', 'DT', 'OLB', 'MLB', 'CB', 'FS', 'SS'];

// Roster composition for a 53-man roster.
export const ROSTER_COUNTS = {
  QB: 3, HB: 4, FB: 1, WR: 6, TE: 3, T: 4, G: 4, C: 2,
  DE: 4, DT: 4, OLB: 4, MLB: 3, CB: 5, FS: 2, SS: 2, K: 1, P: 1,
};

// Typical rating means for an average starter at each position. Unlisted keys default low.
const T = (o) => o;
export const POSITION_TEMPLATES = {
  QB: T({ speed: 70, acceleration: 74, agility: 72, strength: 55, awareness: 72, catching: 40, carrying: 62, breakTackle: 50, throwPower: 86, throwAccuracy: 80 }),
  HB: T({ speed: 88, acceleration: 89, agility: 86, strength: 64, awareness: 66, catching: 66, carrying: 82, breakTackle: 78, routeRunning: 55, passBlock: 45, runBlock: 40 }),
  FB: T({ speed: 74, acceleration: 76, agility: 70, strength: 76, awareness: 64, catching: 60, carrying: 72, breakTackle: 74, runBlock: 70, passBlock: 64 }),
  WR: T({ speed: 90, acceleration: 89, agility: 88, strength: 55, awareness: 66, catching: 82, carrying: 64, breakTackle: 58, routeRunning: 80, runBlock: 40 }),
  TE: T({ speed: 80, acceleration: 80, agility: 74, strength: 72, awareness: 66, catching: 75, carrying: 66, breakTackle: 68, routeRunning: 64, runBlock: 66, passBlock: 60 }),
  T: T({ speed: 58, acceleration: 66, agility: 56, strength: 86, awareness: 70, runBlock: 78, passBlock: 80 }),
  G: T({ speed: 56, acceleration: 64, agility: 54, strength: 88, awareness: 68, runBlock: 80, passBlock: 76 }),
  C: T({ speed: 55, acceleration: 64, agility: 55, strength: 86, awareness: 72, runBlock: 78, passBlock: 76 }),
  DE: T({ speed: 77, acceleration: 80, agility: 70, strength: 80, awareness: 66, passRush: 78, blockShed: 74, tackling: 72, hitPower: 72 }),
  DT: T({ speed: 64, acceleration: 72, agility: 58, strength: 90, awareness: 66, passRush: 70, blockShed: 78, tackling: 72, hitPower: 74 }),
  OLB: T({ speed: 80, acceleration: 82, agility: 74, strength: 72, awareness: 68, passRush: 64, blockShed: 66, tackling: 76, hitPower: 74, coverage: 60, catching: 45 }),
  MLB: T({ speed: 77, acceleration: 80, agility: 72, strength: 74, awareness: 72, passRush: 55, blockShed: 70, tackling: 80, hitPower: 76, coverage: 60, catching: 45 }),
  CB: T({ speed: 90, acceleration: 89, agility: 88, strength: 52, awareness: 68, coverage: 80, tackling: 60, hitPower: 52, catching: 60, blockShed: 40 }),
  FS: T({ speed: 87, acceleration: 86, agility: 82, strength: 58, awareness: 72, coverage: 74, tackling: 68, hitPower: 64, catching: 60, blockShed: 46 }),
  SS: T({ speed: 85, acceleration: 85, agility: 78, strength: 64, awareness: 70, coverage: 68, tackling: 76, hitPower: 76, catching: 55, blockShed: 54 }),
  K: T({ speed: 55, acceleration: 55, agility: 55, strength: 45, awareness: 60, kickPower: 85, kickAccuracy: 80 }),
  P: T({ speed: 55, acceleration: 55, agility: 55, strength: 45, awareness: 60, kickPower: 84, kickAccuracy: 76 }),
};

// Overall rating weights per position (normalized at use).
export const OVERALL_WEIGHTS = {
  QB: { throwAccuracy: 4, throwPower: 2.5, awareness: 3, speed: 0.6, agility: 0.4 },
  HB: { speed: 2.5, acceleration: 1.5, agility: 2, breakTackle: 2, carrying: 1.5, catching: 0.8, awareness: 0.8 },
  FB: { runBlock: 2.5, passBlock: 1.2, strength: 1.5, breakTackle: 1, carrying: 1, catching: 0.6, speed: 0.6 },
  WR: { speed: 2.5, catching: 2.5, routeRunning: 2.2, agility: 1, acceleration: 1, awareness: 0.8 },
  TE: { catching: 2, routeRunning: 1.2, runBlock: 1.5, passBlock: 0.8, speed: 1.2, strength: 0.8, breakTackle: 0.6 },
  T: { passBlock: 3, runBlock: 2.5, strength: 2, awareness: 1, agility: 0.4 },
  G: { runBlock: 3, passBlock: 2.5, strength: 2.2, awareness: 1 },
  C: { runBlock: 2.6, passBlock: 2.6, strength: 2, awareness: 1.4 },
  DE: { passRush: 3, blockShed: 2, speed: 1.4, strength: 1.4, tackling: 1.2, acceleration: 1 },
  DT: { blockShed: 3, strength: 2.5, passRush: 2, tackling: 1.4, awareness: 0.8 },
  OLB: { tackling: 2, speed: 1.6, passRush: 1.2, coverage: 1.2, blockShed: 1.2, awareness: 1.2, hitPower: 0.8 },
  MLB: { tackling: 2.5, awareness: 2, blockShed: 1.5, coverage: 1, speed: 1.2, hitPower: 1 },
  CB: { coverage: 3, speed: 2.5, agility: 1.2, acceleration: 1.2, awareness: 1, catching: 0.5, tackling: 0.5 },
  FS: { coverage: 2.5, speed: 2, awareness: 1.6, tackling: 1, catching: 0.6, hitPower: 0.4 },
  SS: { coverage: 1.8, tackling: 1.8, speed: 1.6, awareness: 1.4, hitPower: 1, blockShed: 0.5 },
  K: { kickPower: 3, kickAccuracy: 3 },
  P: { kickPower: 3, kickAccuracy: 2.4 },
};

export function overall(player) {
  const w = OVERALL_WEIGHTS[player.pos];
  if (!w) return 50;
  let s = 0, t = 0;
  for (const k in w) { s += (player.ratings[k] ?? 40) * w[k]; t += w[k]; }
  // The weighted average of the position's key ratings (no stretching, so real-style ratings give
  // real-style overalls). ovrAdj (from an OVR column in roster.csv) pins the displayed number to a
  // source's overall while rating edits still move it.
  return Math.max(25, Math.min(99, Math.round(s / t + (player.ovrAdj || 0))));
}

export const JERSEY_RANGES = {
  QB: [[1, 19]], HB: [[20, 49], [1, 9]], FB: [[30, 49]], WR: [[10, 19], [80, 89], [1, 9]], TE: [[80, 89], [40, 49]],
  T: [[60, 79]], G: [[60, 79]], C: [[50, 79]], DE: [[90, 99], [50, 59]], DT: [[90, 99], [60, 79]],
  OLB: [[40, 59], [90, 99]], MLB: [[40, 59]], CB: [[20, 39], [1, 9]], FS: [[20, 49]], SS: [[20, 49]], K: [[1, 19]], P: [[1, 19]],
};

// Physical profile by position: [height inches, weight lbs]
export const BODY = {
  QB: [75, 220], HB: [70, 212], FB: [72, 245], WR: [73, 200], TE: [77, 252], T: [78, 315], G: [76, 315], C: [75, 305],
  DE: [76, 270], DT: [75, 310], OLB: [74, 242], MLB: [73, 240], CB: [71, 192], FS: [72, 205], SS: [72, 210], K: [72, 195], P: [74, 210],
};

/** Team overall ratings from starters (simple weighted averages of player overalls). */
export function teamRatings(team) {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const ovrAt = (slot, n = 1) => (team.depth[slot] || []).slice(0, n).map((id) => byId.get(id)?.ovr ?? 50);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 50);
  const off = avg([...ovrAt('QB', 1), ...ovrAt('QB', 1), ...ovrAt('HB', 1), ...ovrAt('WR', 3), ...ovrAt('TE', 1), ...ovrAt('LT'), ...ovrAt('LG'), ...ovrAt('C'), ...ovrAt('RG'), ...ovrAt('RT')]);
  const def = avg([...ovrAt('LE'), ...ovrAt('RE'), ...ovrAt('DT', 2), ...ovrAt('LOLB'), ...ovrAt('MLB'), ...ovrAt('ROLB'), ...ovrAt('CB', 3), ...ovrAt('FS'), ...ovrAt('SS')]);
  const st = avg([...ovrAt('K'), ...ovrAt('P')]);
  return { ovr: Math.round(off * 0.46 + def * 0.46 + st * 0.08), off: Math.round(off), def: Math.round(def) };
}
