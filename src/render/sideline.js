import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF_WIDTH } from '../core/constants.js';

// Sideline life (render only): team staff standing behind the bench rows, photographers past the 30s and along the end lines,
// benches against the wall and team-color coolers. Cheap stand-ins (three instanced meshes + two merged ones), so the
// sidelines read as busy like a TV broadcast without adding full player bodies. Home (team 0) is on the -z sideline, as the
// reserves in presentation.js.

const STAFF = 32; // per team
const PHOTOGS = 8 * 4 + 10 * 2; // four sideline stretches past the 30s, both end lines

export function buildSideline(group) {
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // cosmetic, not sim randomness

  // One standing figure in three parts sharing a matrix: shirt (torso + arms, instance color), pants, head.
  const torso = new THREE.CylinderGeometry(0.21, 0.17, 0.62, 6, 1).scale(1, 1, 0.62).translate(0, 1.18, 0);
  const arm = (s) => new THREE.CylinderGeometry(0.055, 0.05, 0.6, 4, 1).translate(s * 0.25, 1.15, 0);
  const shirtGeo = mergeGeometries([torso, arm(-1), arm(1)]);
  const leg = (s) => new THREE.CylinderGeometry(0.075, 0.06, 0.86, 5, 1).translate(s * 0.095, 0.43, 0);
  const pantsGeo = mergeGeometries([leg(-1), leg(1)]);
  const headGeo = new THREE.SphereGeometry(0.12, 8, 6).scale(1, 1.15, 1).translate(0, 1.66, 0.01);
  const camGeo = new THREE.BoxGeometry(0.16, 0.14, 0.34).translate(0.05, 1.58, 0.24); // photographers' camera + lens
  const N = STAFF * 2 + PHOTOGS;
  const mk = (geo, color, n = N) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), n);
    m.castShadow = true; m.frustumCulled = false;
    group.add(m);
    return m;
  };
  const shirts = mk(shirtGeo, 0xffffff), pants = mk(pantsGeo, 0xffffff), heads = mk(headGeo, 0xffffff), cams = mk(camGeo, 0x15161a, PHOTOGS);

  const spots = []; // { x, z, yaw, team (-1 = photographer), k }
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    for (let k = 0; k < STAFF; k++) {
      const x = -22 + rnd() * 44, z = s * (HALF_WIDTH + 7.1 + rnd() * 1.4);
      spots.push({ x, z, yaw: Math.atan2(-s, (rnd() - 0.5) * 0.8), team, k });
    }
  }
  for (const sx of [-1, 1]) for (const s of [-1, 1]) for (let k = 0; k < 8; k++) {
    const x = sx * (31 + rnd() * 17), z = s * (HALF_WIDTH + 2.2 + rnd() * 1.2);
    spots.push({ x, z, yaw: Math.atan2(-s, -sx * 0.6), team: -1, k });
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 10; k++) {
    const x = sx * (61.2 + rnd() * 1.6), z = -19 + k * 4.2 + rnd() * 1.5;
    spots.push({ x, z, yaw: Math.atan2(0, -sx), team: -1, k });
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  let ci = 0;
  spots.forEach((p, i) => {
    // Three.js yaw 0 faces +z: turn the figure toward its look direction (yaw = atan2(dz, dx) in field terms).
    q.setFromAxisAngle(up, Math.PI / 2 - p.yaw);
    const h = 0.95 + rnd() * 0.1;
    sc.set(1, h, 1); pos.set(p.x, 0, p.z);
    m.compose(pos, q, sc);
    shirts.setMatrixAt(i, m); pants.setMatrixAt(i, m); heads.setMatrixAt(i, m);
    if (p.team < 0) cams.setMatrixAt(ci++, m);
  });
  cams.count = ci;

  // Benches against the wall and coolers at each end of the team area.
  const benchGeos = [], coolerGeos = [[], []];
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    for (const bx of [-14, 0, 14]) benchGeos.push(new THREE.BoxGeometry(11, 0.48, 0.55).translate(bx, 0.24, s * (HALF_WIDTH + 8.8)));
    for (const cx of [-24, -23.2, 23.2, 24]) coolerGeos[team].push(new THREE.CylinderGeometry(0.3, 0.28, 0.62, 10).translate(cx, 0.31, s * (HALF_WIDTH + 6.4)));
  }
  const benches = new THREE.Mesh(mergeGeometries(benchGeos), new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
  benches.castShadow = true; group.add(benches);
  const coolers = coolerGeos.map((g) => { const c = new THREE.Mesh(mergeGeometries(g), new THREE.MeshLambertMaterial({ color: 0xffffff })); c.castShadow = true; group.add(c); return c; });

  const col = new THREE.Color();
  const SKIN = [0xe8c1a0, 0xc68e6a, 0x8d5a3b, 0x5b3a26, 0xf1d2b6];
  return {
    setTeams(h, a) {
      const teams = [h, a];
      spots.forEach((p, i) => {
        const r = (p.k * 7919 + i * 31) % 100 / 100;
        if (p.team < 0) col.set(r < 0.5 ? 0x1c1d21 : r < 0.8 ? 0x4a4d55 : 0xd8d8d0); // photographers: dark gear, a few in white vests
        else { const t = teams[p.team]; col.set(r < 0.45 ? t.colors.primary : r < 0.7 ? t.colors.secondary : r < 0.85 ? 0xeeeeee : 0x8a8d94); }
        shirts.setColorAt(i, col);
        pants.setColorAt(i, col.set(p.team < 0 || r > 0.2 ? (r > 0.6 ? 0x1e1f24 : 0x3a3c42) : 0x9c8c6c)); // dark, a few in khakis
        heads.setColorAt(i, col.set(SKIN[(p.k + i) % SKIN.length]));
      });
      for (const m2 of [shirts, pants, heads]) m2.instanceColor.needsUpdate = true;
      coolers.forEach((c, k) => c.material.color.set(teams[k].colors.primary));
    },
  };
}
