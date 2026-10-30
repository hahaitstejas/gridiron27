// Player traits: original star abilities that come from ratings (no extra save data). A player earns a trait
// by reaching its thresholds at an eligible position, so editing ratings or training a career player unlocks
// them. Each trait is checked at one moment in the sim (see `has()` uses) and the sim emits a `trait` event
// when it decided the play, so the HUD can call it out.
export const TRAITS = {
  sureHands: { name: 'Sure Hands', desc: 'Catches through contact', pos: ['WR', 'TE', 'HB'], need: { catching: 88 } },
  routeTech: { name: 'Route Technician', desc: 'Sharper breaks: defenders play the ball less', pos: ['WR', 'TE'], need: { routeRunning: 88 } },
  bruiser: { name: 'Bruiser', desc: 'Breaks more tackles', pos: ['HB', 'FB', 'TE'], need: { breakTackle: 88 } },
  pocketPoise: { name: 'Pocket Poise', desc: 'Accurate under pressure', pos: ['QB'], need: { awareness: 86, throwAccuracy: 86 } },
  cannon: { name: 'Cannon', desc: 'Deep balls stay on target', pos: ['QB'], need: { throwPower: 92 } },
  edgeBender: { name: 'Edge Bender', desc: 'Wins with pass-rush moves', pos: ['DE', 'OLB', 'DT'], need: { passRush: 88 } },
  brickWall: { name: 'Brick Wall', desc: 'Rushers rarely beat him', pos: ['T', 'G', 'C'], need: { passBlock: 88 } },
  lockdown: { name: 'Lockdown', desc: 'Contests every catch', pos: ['CB', 'FS', 'SS'], need: { coverage: 88 } },
  ballhawk: { name: 'Ballhawk', desc: 'Turns breakups into picks', pos: ['CB', 'FS', 'SS', 'OLB', 'MLB'], need: { catching: 74, awareness: 84 } },
  enforcer: { name: 'Enforcer', desc: 'Wraps up and lays the big hit', pos: ['MLB', 'OLB', 'SS', 'FS', 'DE', 'DT'], need: { tackling: 88, hitPower: 84 } },
  bigLeg: { name: 'Big Leg', desc: 'Long kicks hold their line', pos: ['K', 'P'], need: { kickPower: 92 } },
};

/** Trait ids for a roster player (pos + ratings). */
export function traitsOf(p) {
  const out = [];
  for (const [id, t] of Object.entries(TRAITS)) {
    if (!t.pos.includes(p.pos)) continue;
    if (Object.entries(t.need).every(([k, v]) => (p.ratings?.[k] ?? 0) >= v)) out.push(id);
  }
  return out;
}

/** Does a sim player have this trait? */
export const has = (p, id) => !!p?.traits && p.traits.includes(id);
