import { wrapAngle } from '../core/math.js';
import { PLAYER_RADIUS } from '../core/constants.js';

/**
 * Accelerate player p toward the desired velocity (p.desired), respecting acceleration and agility,
 * then integrate position. Engaged/down players are moved elsewhere.
 */
export function integrate(p, dt) {
  const dx = p.desired.x - p.vx;
  const dz = p.desired.z - p.vz;
  const sp = Math.hypot(p.vx, p.vz);
  let ax = dx, az = dz;
  const dl = Math.hypot(dx, dz);
  if (dl > 1e-6) {
    // Split into along-velocity and lateral parts: lateral change (cutting) scales with agility.
    let limAlong = p.accel, limLat = p.accel * p.agil;
    if (sp > 0.3) {
      const ux = p.vx / sp, uz = p.vz / sp;
      const along = dx * ux + dz * uz;
      const latx = dx - along * ux, latz = dz - along * uz;
      const brake = along < 0 ? 1.6 : 1;
      const aAlong = Math.max(-limAlong * brake * dt, Math.min(limAlong * dt, along));
      const ll = Math.hypot(latx, latz);
      const latMax = limLat * dt * (1 + 0.6 * Math.max(0, 1 - sp / 6));
      const s = ll > latMax ? latMax / ll : 1;
      ax = aAlong * ux + latx * s;
      az = aAlong * uz + latz * s;
    } else {
      const m = limAlong * dt;
      if (dl > m) { ax = (dx / dl) * m; az = (dz / dl) * m; }
    }
  }
  p.vx += ax;
  p.vz += az;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
}

/** Set desired velocity toward a point, slowing to arrive. */
export function seek(p, tx, tz, speedFrac = 1, arrive = 1.5) {
  const dx = tx - p.x, dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  const max = p.maxSpeed * speedFrac * p.speedCap;
  if (d < 0.05) { p.desired.x = 0; p.desired.z = 0; return d; }
  const s = d < arrive ? max * (d / arrive) : max;
  p.desired.x = (dx / d) * s;
  p.desired.z = (dz / d) * s;
  return d;
}

export function moveDir(p, dx, dz, speedFrac = 1) {
  const l = Math.hypot(dx, dz);
  const max = p.maxSpeed * speedFrac * p.speedCap;
  if (l < 1e-6) { p.desired.x = 0; p.desired.z = 0; return; }
  p.desired.x = (dx / l) * max;
  p.desired.z = (dz / l) * max;
}

export function stop(p) { p.desired.x = 0; p.desired.z = 0; }

/** Push overlapping players apart. Heavier/stronger players move less. */
export function resolveCollisions(players) {
  const minD = PLAYER_RADIUS * 2;
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (a.state === 'down') continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (b.state === 'down') continue;
      if (a.engagement && a.engagement === b.engagement) continue;
      // A sneaking QB goes over the top of his own linemen.
      if (a.team === b.team && (a.task?.sneak || b.task?.sneak)) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const overlap = minD - d;
      const ma = 1 + a.bulk + a.r.strength / 100;
      const mb = 1 + b.bulk + b.r.strength / 100;
      const fa = a.engagement ? 0.15 : mb / (ma + mb);
      const fb = b.engagement ? 0.15 : ma / (ma + mb);
      const nx = dx / d, nz = dz / d;
      a.x -= nx * overlap * fa; a.z -= nz * overlap * fa;
      b.x += nx * overlap * fb; b.z += nz * overlap * fb;
    }
  }
}

export function faceToward(p, tx, tz, rate, dt) {
  const target = Math.atan2(tz - p.z, tx - p.x);
  turnTo(p, target, rate, dt);
}

export function turnTo(p, target, rate, dt) {
  const d = wrapAngle(target - p.facing);
  const m = rate * dt;
  p.facing += Math.abs(d) <= m ? d : Math.sign(d) * m;
}
