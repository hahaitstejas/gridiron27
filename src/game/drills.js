// Skills drills (pure logic): a short practice session with fixed reps, plays the drill picks, a score per rep and
// bronze / silver / gold medals. The session runs them as practice (`settings.drill = { id }`): `drillPlays()`
// supplies both play calls, `drillControl()` hands the human the right player, `drillScore()` scores each rep.
// Medal lines come from the CPU doing the drill (tools: settings.drillAuto): a CPU-level rep is about silver.
import { listOffPlays, listDefPlays, getOffPlay, getDefPlay } from '../data/playbook.js';

const passPlays = () => listOffPlays().filter((p) => p.type === 'pass' && !p.custom && !/screen/.test(p.id));
const runPlays = () => listOffPlays().filter((p) => p.type === 'run' && !p.custom && (p.run?.carrier || 'RB') !== 'QB');
const zoneDefs = () => listDefPlays().filter((p) => p.coverage === 'zone' && !/blitz|fire|cover0/i.test(p.id));
const manDefs = () => listDefPlays().filter((p) => p.coverage === 'man');
const baseDefs = () => listDefPlays().filter((p) => !/goal|gl_/i.test(p.id));
const pick = (list, i) => list[(i * 7 + 3) % list.length];

export const DRILLS = {
  passing: {
    name: 'Passing Targets', side: 'offense', reps: 10, yardLine: 30,
    desc: 'Ten dropbacks against zone coverage. Completions score by yards; touchdowns and big plays score big, picks cost you.',
    medals: [800, 1300, 1700],
    plays: (i) => ({ off: pick(passPlays(), i), def: pick(zoneDefs(), i + 2) }),
  },
  rushing: {
    name: 'Rushing Gauntlet', side: 'offense', reps: 10, yardLine: 30,
    desc: 'Ten carries into a loaded box. Yards, broken tackles and touchdowns score; lost yards count against you.',
    medals: [500, 900, 1400],
    plays: (i) => ({ off: pick(runPlays(), i), def: pick(baseDefs(), i + 5) }),
  },
  kicking: {
    name: 'Kicking Challenge', side: 'offense', reps: 8,
    distances: [25, 30, 35, 40, 45, 48, 51, 55],
    desc: 'Eight field goals from 25 to 55 yards. Every make scores, the long ones score more.',
    medals: [700, 1100, 1350],
    plays: () => ({ off: getOffPlay('st_fg'), def: getDefPlay('st_fg_block') }),
  },
  passRush: {
    name: 'Pass Rush', side: 'defense', reps: 8, yardLine: 35, control: ['RE', 'LE', 'ROLB', 'LOLB'],
    desc: 'You are the edge rusher on eight passing downs. Sacks score big, pressure and hurried throws score too.',
    medals: [250, 550, 900],
    plays: (i) => ({ off: pick(passPlays(), i + 1), def: pick(zoneDefs(), i) }),
  },
  coverage: {
    name: 'Lockdown Coverage', side: 'defense', reps: 8, yardLine: 35, control: ['LCB', 'RCB', 'CB'],
    desc: 'You are the corner in man coverage. Incompletions and interceptions score; every yard allowed costs you.',
    medals: [300, 650, 1000],
    plays: (i) => ({ off: pick(passPlays(), i + 4), def: pick(manDefs(), i) }),
  },
};

export const DRILL_IDS = Object.keys(DRILLS);
export const MEDALS = ['Bronze', 'Silver', 'Gold'];

export function newDrill(id) {
  if (!DRILLS[id]) throw new Error(`Unknown drill ${id}`);
  return { id, rep: 0, score: 0, log: [], done: false };
}

/** The practice situation for the next rep (kicking moves back each rep). */
export function drillSpot(drill) {
  const d = DRILLS[drill.id];
  if (d.distances) return { yardLine: 117 - d.distances[Math.min(drill.rep, d.distances.length - 1)], down: 4, toGo: 10 };
  return { yardLine: d.yardLine, down: d.side === 'defense' ? 3 : 1, toGo: d.side === 'defense' ? 7 : 10 };
}

export function drillPlays(drill) { return DRILLS[drill.id].plays(drill.rep); }

/** Give the human the drill's player (the edge rusher, the corner). */
export function drillControl(sim, drill) {
  const want = DRILLS[drill.id].control;
  drill.me = -1;
  if (!want) return;
  for (const slot of want) {
    const p = sim.bySlot(sim.defIdx, slot);
    if (p) { drill.me = p.id; if (sim.humanTeam !== null) sim.controlledId = p.id; return; }
  }
}

/** Track what the scoring needs while the rep runs (pressure on the QB, the human's man, broken tackles). */
export function drillWatch(sim, drill, events) {
  const w = (drill.watch ||= { pressure: false, broken: 0 });
  const me = sim.players[drill.me];
  const qb = sim.bySlot(sim.offIdx, 'QB');
  if (drill.id === 'passRush' && me && qb && !sim.passThrown && Math.hypot(me.x - qb.x, me.z - qb.z) < 1.6) w.pressure = true;
  for (const e of events) if (e.type === 'brokenTackle') w.broken++;
}

/** Points for a finished rep: { pts, text }. */
export function drillScore(drill, r, sim) {
  const w = drill.watch || { pressure: false, broken: 0 };
  drill.watch = null;
  const yds = Math.round(r.yards || 0);
  const td = r.touchdown !== null && r.touchdown !== undefined && r.touchdown === r.offTeam;
  let pts = 0, text = '';
  switch (drill.id) {
    case 'passing':
      if (r.interception) { pts = -150; text = 'Intercepted'; }
      else if (r.sack) { pts = -50; text = `Sacked (${yds})`; }
      else if (r.complete) { pts = 50 + Math.max(0, yds) * 5 + (td ? 150 : 0) + (yds >= 20 ? 50 : 0); text = td ? `Touchdown, ${yds} yds` : `Complete, ${yds} yds`; }
      else if (r.passAttempt) { text = 'Incomplete'; }
      else { pts = Math.max(-50, yds * 5); text = `Scramble, ${yds} yds`; }
      break;
    case 'rushing':
      pts = yds * 10 + w.broken * 40 + (td ? 200 : 0) - (r.fumbleLost ? 150 : 0);
      text = `${yds} yds${w.broken ? `, ${w.broken} broken tackle${w.broken > 1 ? 's' : ''}` : ''}${td ? ', touchdown' : ''}${r.fumbleLost ? ', fumble' : ''}`;
      break;
    case 'kicking': {
      const dist = DRILLS.kicking.distances[drill.rep] || 0;
      pts = r.fgGood ? 100 + (dist - 25) * 5 : 0;
      text = `${dist} yds: ${r.fgGood ? 'Good' : 'No good'}`;
      break;
    }
    case 'passRush': {
      const meSack = r.sack && r.tackler === drill.me;
      if (meSack) { pts = 400; text = 'Sack!'; }
      else if (r.sack) { pts = 150; text = 'Team sack'; }
      else if (w.pressure) { pts = r.complete ? 100 : 200; text = r.complete ? 'Pressure' : 'Pressure, incomplete'; }
      else if (r.interception) { pts = 150; text = 'Interception'; }
      else { pts = r.complete ? 0 : 50; text = r.complete ? `Completed, ${yds} yds` : 'Incomplete'; }
      break;
    }
    case 'coverage': {
      const meINT = r.interception && r.intBy === drill.me;
      if (r.interception) { pts = meINT ? 500 : 250; text = meINT ? 'Your interception!' : 'Interception'; }
      else if (r.sack) { pts = 100; text = 'Coverage sack'; }
      else if (r.complete) { pts = -Math.min(200, Math.max(0, yds) * 5); text = `Allowed ${yds} yds`; }
      else { pts = 150; text = 'Incomplete'; }
      break;
    }
  }
  drill.score += pts;
  drill.log.push({ rep: drill.rep + 1, pts, text });
  drill.rep++;
  drill.done = drill.rep >= DRILLS[drill.id].reps;
  return { pts, text };
}

/** Medal index (0 bronze, 1 silver, 2 gold) or -1. */
export function medalFor(id, score) {
  const m = DRILLS[id].medals;
  return score >= m[2] ? 2 : score >= m[1] ? 1 : score >= m[0] ? 0 : -1;
}
