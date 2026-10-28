import { clamp } from '../core/math.js';

/** Create the per-play simulation entity for a roster player. */
export function makeSimPlayer(idx, rp, team, side, slot) {
  const r = rp.ratings;
  return {
    id: idx,
    rid: rp.id,
    team,
    side, // 'O' or 'D'
    slot,
    pos: rp.pos,
    number: rp.number,
    name: `${rp.first[0]}. ${rp.last}`,
    r,
    height: (rp.height || 74) / 36, // inches -> yards
    bulk: clamp(((rp.weight || 220) - 180) / 140, 0, 1), // 0 slim .. 1 lineman
    skin: rp.skin ?? 2,
    x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0,
    facing: 0, pfacing: 0,
    maxSpeed: 5.6 + r.speed * 0.047,
    accel: 5 + r.acceleration * 0.09,
    agil: 0.7 + r.agility * 0.006,
    state: 'stance', // stance | active | engaged | down | tackled | stumble
    task: null,
    anim: 'stance',
    animT: 0,
    cycle: idx * 0.83,
    move: null, // {type, t, dur, dir}
    downT: 0,
    stumbleT: 0,
    tackleCd: 0,
    engagement: null,
    noEngageT: 0,
    desired: { x: 0, z: 0 },
    face: null, // explicit facing target {x,z} or null
    speedCap: 1,
    perceived: null, // defender's perceived velocity of man target
    reactT: 0,
    wantsBall: false,
    controlled: false,
    alignX: 0, alignZ: 0,
  };
}
