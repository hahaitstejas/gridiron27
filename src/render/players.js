import * as THREE from 'three';

// Low-poly players drawn with one InstancedMesh per body part (about 15 draw calls for all 22
// players). Poses are computed procedurally from the sim's animation state every frame.

const SKIN = ['#f1c9a5', '#e0ac85', '#c68a62', '#a0663f', '#7a4a2c', '#53321e'];
const MAX = 24;

// Base proportions for a 6'2" player, in yards.
const B = {
  hipH: 1.0, hipX: 0.11, thigh: 0.48, shin: 0.47,
  torso: 0.66, torsoW: 0.44, torsoD: 0.27, padW: 0.64, padD: 0.36,
  shX: 0.27, upper: 0.34, fore: 0.32,
};

function part(geo, mat, count, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = shadow;
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

function numberAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 74px "Arial Narrow", Arial, sans-serif';
  for (let n = 0; n < 100; n++) {
    const cx = (n % 10) * 102.4 + 51.2, cy = Math.floor(n / 10) * 102.4 + 54;
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(0,0,0,1)';
    g.fillStyle = '#ffffff';
    g.strokeText(String(n), cx, cy);
    g.fillText(String(n), cx, cy);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class PlayerRenderer {
  constructor(scene) {
    this.scene = scene;
    const lam = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const torsoGeo = new THREE.CylinderGeometry(0.5, 0.4, 1, 8);
    const padGeo = new THREE.CylinderGeometry(0.5, 0.42, 1, 8);
    padGeo.scale(1, 1, 1);
    const helmetGeo = new THREE.SphereGeometry(0.5, 10, 8);
    helmetGeo.scale(0.95, 0.95, 1.08);
    const maskGeo = new THREE.TorusGeometry(0.42, 0.07, 4, 10, Math.PI);
    maskGeo.rotateZ(Math.PI);
    const numGeo = new THREE.PlaneGeometry(1, 1);
    const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2 * 2), 2);
    cellAttr.setUsage(THREE.DynamicDrawUsage);
    numGeo.setAttribute('aCell', cellAttr);
    this.cellAttr = cellAttr;
    const numMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: numberAtlas() } },
      transparent: true,
      depthWrite: true,
      vertexShader: `attribute vec2 aCell; varying vec2 vUv; varying vec3 vCol;
        void main(){
          vUv = (uv + aCell) / 10.0;
          vUv.y = 1.0 - ((1.0 - uv.y) + aCell.y) / 10.0;
          #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
          #else
          vCol = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; varying vec3 vCol;
        void main(){
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.4) discard;
          // White atlas pixels take the number color; the dark outline stays dark.
          vec3 c = mix(vCol * 0.15, vCol, t.r);
          gl_FragColor = vec4(c * 0.92, 1.0);
          #include <colorspace_fragment>
        }`,
    });

    this.parts = {
      torso: part(torsoGeo, lam(), MAX),
      pads: part(padGeo, lam(), MAX),
      pelvis: part(box(0.4, 0.22, 0.26), lam(), MAX),
      thigh: part(box(0.17, 1, 0.19), lam(), MAX * 2),
      shin: part(box(0.13, 1, 0.14), lam(), MAX * 2),
      shoe: part(box(0.13, 0.08, 0.3), lam(), MAX * 2),
      upper: part(box(0.13, 1, 0.13), lam(), MAX * 2),
      fore: part(box(0.1, 1, 0.1), lam(), MAX * 2),
      hand: part(box(0.1, 0.11, 0.08), lam(), MAX * 2),
      neck: part(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 6), lam(), MAX),
      helmet: part(helmetGeo, new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 90, specular: 0x666666 }), MAX),
      stripe: part(box(0.06, 0.03, 0.36), lam(), MAX, false),
      mask: part(maskGeo, lam(), MAX, false),
      num: part(numGeo, numMat, MAX * 2, false),
    };
    for (const p of Object.values(this.parts)) scene.add(p);

    // Ring under the user-controlled player.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.renderOrder = 2;
    this.ring.visible = false;
    scene.add(this.ring);

    this._m = new THREE.Matrix4();
    this._t = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
    this._col = new THREE.Color();
    this.colorsKey = '';
    this.handPos = [];
  }

  /** Assign per-instance colors from team uniforms (once per play setup). */
  setColors(sim, teams) {
    const key = sim.players.map((p) => `${p.team}:${p.number}:${p.skin}`).join(',') + teams.map((t) => t.colors.primary + t.colors.secondary + t.uniform.pants).join();
    if (key === this.colorsKey) return;
    this.colorsKey = key;
    const P = this.parts;
    const c = this._col;
    const pick = (team, which) => (which === 'white' ? '#f4f4f4' : which === 'secondary' ? team.colors.secondary : which === 'accent' ? team.colors.accent : team.colors.primary);
    sim.players.forEach((p, i) => {
      const team = teams[p.team];
      const u = team.uniform;
      // The away team wears white jerseys, like on TV.
      const jersey = p.team === 1 ? '#f4f4f4' : pick(team, u.jersey);
      const helmet = pick(team, u.helmet);
      const pants = pick(team, u.pants);
      const numColor = !isDark(jersey) && p.team === 1 ? team.colors.primary : isDark(jersey) ? (isDark(team.colors.secondary) ? '#ffffff' : team.colors.secondary) : (isDark(team.colors.primary) ? team.colors.primary : '#111111');
      const skin = SKIN[p.skin % SKIN.length];
      P.torso.setColorAt(i, c.set(jersey));
      P.pads.setColorAt(i, c.set(jersey).offsetHSL(0, 0, -0.03));
      P.pelvis.setColorAt(i, c.set(pants));
      P.neck.setColorAt(i, c.set(skin));
      P.helmet.setColorAt(i, c.set(helmet));
      P.stripe.setColorAt(i, c.set(u.helmetStripe ? team.colors.secondary : helmet));
      P.mask.setColorAt(i, c.set(isDark(helmet) ? '#cfcfcf' : '#333333'));
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        P.thigh.setColorAt(j, c.set(pants));
        P.shin.setColorAt(j, c.set(u.pants === 'white' ? team.colors.primary : '#f2f2f2'));
        P.shoe.setColorAt(j, c.set(i % 3 ? '#151515' : '#f0f0f0'));
        P.upper.setColorAt(j, c.set(jersey));
        P.fore.setColorAt(j, c.set(skin));
        P.hand.setColorAt(j, c.set(team.colors.secondary).lerp(new THREE.Color('#ffffff'), 0.2));
        P.num.setColorAt(j, c.set(numColor));
        this.cellAttr.setXY(j, p.number % 10, Math.floor(p.number / 10));
      }
    });
    this.cellAttr.needsUpdate = true;
    for (const m of Object.values(P)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Update all instance matrices. alpha interpolates between the previous and current sim tick. */
  update(sim, alpha, time, controlledId) {
    const P = this.parts;
    const n = sim.players.length;
    for (const m of Object.values(P)) m.count = m === P.thigh || m === P.shin || m === P.shoe || m === P.upper || m === P.fore || m === P.hand || m === P.num ? n * 2 : n;
    for (let i = 0; i < n; i++) this.drawPlayer(sim, sim.players[i], i, alpha, time);
    for (const m of Object.values(P)) m.instanceMatrix.needsUpdate = true;
    const cp = sim.players[controlledId];
    if (cp) {
      this.ring.visible = true;
      this.ring.position.x = cp.px + (cp.x - cp.px) * alpha;
      this.ring.position.z = cp.pz + (cp.z - cp.pz) * alpha;
      this.ring.material.color.set(cp.team === sim.possTeam ? 0xffe14d : 0x4dd2ff);
    } else this.ring.visible = false;
  }

  drawPlayer(sim, p, i, alpha, time) {
    const P = this.parts;
    const x = p.px + (p.x - p.px) * alpha;
    const z = p.pz + (p.z - p.pz) * alpha;
    let f = p.pfacing + angDiff(p.facing, p.pfacing) * alpha;
    const sc = p.height / 2.06;
    const wide = 1 + p.bulk * 0.28;
    const pose = computePose(p, time, sim);
    const yaw = Math.PI / 2 - f;

    poolI = 0;
    const root = M().makeRotationY(yaw);
    root.setPosition(x, pose.rootY * sc, z);
    if (pose.rootPitch) root.multiply(rotX(pose.rootPitch));
    if (pose.rootRoll) root.multiply(rotZ(pose.rootRoll));
    if (pose.rootYaw) root.multiply(rotY(pose.rootYaw));
    root.multiply(scaleM(sc, sc, sc));

    // Pelvis/upper body frame.
    const pel = cl(root).multiply(trans(0, B.hipH + pose.crouch, 0)).multiply(rotX(pose.lean)).multiply(rotY(pose.twist));
    P.pelvis.setMatrixAt(i, cl(pel).multiply(scaleM(wide, 1, wide)));
    P.torso.setMatrixAt(i, cl(pel).multiply(trans(0, B.torso * 0.45, 0)).multiply(scaleM(B.torsoW * wide, B.torso * 0.85, B.torsoD * wide)));
    P.pads.setMatrixAt(i, cl(pel).multiply(trans(0, B.torso * 0.86, 0)).multiply(scaleM(B.padW * wide, 0.2, B.padD * wide)));
    P.neck.setMatrixAt(i, cl(pel).multiply(trans(0, B.torso + 0.04, 0.01)));
    const head = cl(pel).multiply(trans(0, B.torso + 0.2, 0.02)).multiply(rotX(pose.head));
    P.helmet.setMatrixAt(i, cl(head).multiply(scaleM(0.33, 0.33, 0.33)));
    P.stripe.setMatrixAt(i, cl(head).multiply(trans(0, 0.165, -0.01)));
    P.mask.setMatrixAt(i, cl(head).multiply(trans(0, -0.03, 0.16)).multiply(scaleM(0.32, 0.28, 0.3)));
    // Numbers front and back.
    P.num.setMatrixAt(i * 2, cl(pel).multiply(trans(0, B.torso * 0.5, -(B.torsoD * wide) / 2 - 0.035)).multiply(rotY(Math.PI)).multiply(scaleM(0.3 * wide, 0.3, 1)));
    P.num.setMatrixAt(i * 2 + 1, cl(pel).multiply(trans(0, B.torso * 0.58, (B.torsoD * wide) / 2 + 0.04)).multiply(rotX(-0.12)).multiply(scaleM(0.2 * wide, 0.2, 1)));

    // Arms.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1; // -1 = left
      const a = pose.arms[s];
      const sh = cl(pel).multiply(trans(side * B.shX * wide, B.torso * 0.84, 0)).multiply(rotX(-a.pitch)).multiply(rotZ(side * a.out)).multiply(rotY(side * (a.twist || 0)));
      P.upper.setMatrixAt(i * 2 + s, cl(sh).multiply(trans(0, -B.upper / 2, 0)).multiply(scaleM(wide, B.upper, wide)));
      const el = cl(sh).multiply(trans(0, -B.upper, 0)).multiply(rotX(-a.elbow));
      P.fore.setMatrixAt(i * 2 + s, cl(el).multiply(trans(0, -B.fore / 2, 0)).multiply(scaleM(wide, B.fore, wide)));
      const hand = cl(el).multiply(trans(0, -B.fore - 0.05, 0));
      P.hand.setMatrixAt(i * 2 + s, hand);
      if (s === 1) (this.handPos[i] ||= new THREE.Vector3()).setFromMatrixPosition(hand);
    }
    // Legs.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const l = pose.legs[s];
      const hip = cl(root).multiply(trans(side * B.hipX * wide, B.hipH + pose.crouch, 0)).multiply(rotX(-l.hip)).multiply(rotZ(side * (l.out || 0)));
      P.thigh.setMatrixAt(i * 2 + s, cl(hip).multiply(trans(0, -B.thigh / 2, 0)).multiply(scaleM(wide, B.thigh, wide)));
      const knee = cl(hip).multiply(trans(0, -B.thigh, 0)).multiply(rotX(l.knee));
      P.shin.setMatrixAt(i * 2 + s, cl(knee).multiply(trans(0, -B.shin / 2, 0)).multiply(scaleM(1, B.shin, 1)));
      const foot = cl(knee).multiply(trans(0, -B.shin - 0.01, 0.06)).multiply(rotX(-l.knee + l.hip * 0.6));
      P.shoe.setMatrixAt(i * 2 + s, foot);
    }
  }

  /** World position for the ball when it's carried by player i. */
  carryPoint(sim, i, alpha, out) {
    const p = sim.players[i];
    const x = p.px + (p.x - p.px) * alpha, z = p.pz + (p.z - p.pz) * alpha;
    const f = p.facing;
    const sc = p.height / 2.06;
    if (p.anim === 'throw' || p.anim === 'stance_qb' || p.anim === 'passset' || p.anim === 'reach' || p.anim === 'catch') {
      const h = this.handPos[i];
      if (h) return out.copy(h);
    }
    if (p.state === 'down' || p.state === 'tackled') return out.set(x + Math.cos(f) * 0.3, 0.25, z + Math.sin(f) * 0.3);
    // Tucked under the right arm.
    const rx = -Math.sin(f), rz = Math.cos(f); // right-hand side vector
    return out.set(x + Math.cos(f) * 0.12 + rx * 0.2 * sc, 1.25 * sc, z + Math.sin(f) * 0.12 + rz * 0.2 * sc);
  }
}

// ---------- Procedural poses ----------
function computePose(p, time, sim) {
  const sp = Math.hypot(p.vx, p.vz);
  const run = Math.min(1, sp / 8);
  const cyc = p.cycle;
  const sw = Math.sin(cyc);
  const pose = {
    rootY: 0, rootPitch: 0, rootRoll: 0, rootYaw: 0, crouch: 0, lean: 0.08 + run * 0.3, twist: 0, head: 0,
    arms: [{ pitch: 0, out: 0.15, elbow: 0.4 }, { pitch: 0, out: 0.15, elbow: 0.4 }],
    legs: [{ hip: 0, knee: 0.05 }, { hip: 0, knee: 0.05 }],
  };
  const t = p.animT;
  const runLegs = (amp) => {
    pose.legs[0].hip = sw * amp; pose.legs[1].hip = -sw * amp;
    pose.legs[0].knee = 0.25 + Math.max(0, -Math.cos(cyc)) * amp * 1.6;
    pose.legs[1].knee = 0.25 + Math.max(0, Math.cos(cyc)) * amp * 1.6;
    pose.arms[0].pitch = -sw * amp * 1.1; pose.arms[1].pitch = sw * amp * 1.1;
    pose.arms[0].elbow = pose.arms[1].elbow = 1.3;
    pose.rootY = Math.abs(Math.cos(cyc)) * 0.05 * amp;
    pose.crouch = -0.06 * amp;
  };
  switch (p.anim) {
    case 'stance3':
      pose.crouch = -0.38; pose.lean = 1.15; pose.head = -0.9;
      pose.legs[0].hip = 1.0; pose.legs[0].knee = 1.6; pose.legs[1].hip = 0.7; pose.legs[1].knee = 1.4;
      pose.arms[1].pitch = 1.25; pose.arms[1].elbow = 0.1; pose.arms[0].pitch = 0.6; pose.arms[0].elbow = 1.0;
      pose.legs[0].out = 0.15; pose.legs[1].out = 0.15;
      break;
    case 'stance2':
      pose.crouch = -0.2; pose.lean = 0.5; pose.head = -0.35;
      pose.legs[0].hip = 0.6; pose.legs[0].knee = 0.9; pose.legs[1].hip = 0.15; pose.legs[1].knee = 0.6;
      pose.arms[0].pitch = 0.5; pose.arms[1].pitch = 0.5; pose.arms[0].elbow = pose.arms[1].elbow = 1.0;
      break;
    case 'stance_qb': {
      const gun = sim && sim.toLocal(p.x, p.z).down < -2;
      pose.crouch = gun ? -0.12 : -0.2; pose.lean = gun ? 0.35 : 0.55;
      pose.legs[0].hip = 0.35; pose.legs[0].knee = 0.6; pose.legs[1].hip = 0.35; pose.legs[1].knee = 0.6;
      pose.legs[0].out = pose.legs[1].out = 0.15;
      pose.arms[0].pitch = pose.arms[1].pitch = gun ? 0.6 : 1.1; pose.arms[0].elbow = pose.arms[1].elbow = gun ? 1.2 : 0.5;
      pose.arms[0].out = pose.arms[1].out = -0.1;
      break;
    }
    case 'idle':
      pose.lean = 0.12;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.3;
      pose.rootY = Math.sin(time * 2 + p.id) * 0.005;
      break;
    case 'passset':
    case 'block':
      runLegs(Math.min(0.5, run * 0.6));
      pose.crouch = -0.22; pose.lean = 0.55;
      pose.legs[0].out = pose.legs[1].out = 0.25;
      pose.legs[0].knee += 0.5; pose.legs[1].knee += 0.5;
      pose.legs[0].hip += 0.35; pose.legs[1].hip += 0.35;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.35 + Math.sin(time * 9 + p.id) * 0.1;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.6;
      pose.arms[0].out = pose.arms[1].out = -0.05;
      break;
    case 'backpedal':
      runLegs(0.55 * Math.min(1, sp / 5));
      pose.lean = 0.35; pose.crouch = -0.15;
      pose.legs[0].hip *= -0.7; pose.legs[1].hip *= -0.7;
      break;
    case 'shuffle':
      pose.crouch = -0.15; pose.lean = 0.3;
      pose.legs[0].out = 0.2 + Math.max(0, sw) * 0.35; pose.legs[1].out = 0.2 + Math.max(0, -sw) * 0.35;
      pose.legs[0].knee = pose.legs[1].knee = 0.6; pose.legs[0].hip = pose.legs[1].hip = 0.25;
      pose.arms[0].pitch = pose.arms[1].pitch = 0.6; pose.arms[0].elbow = pose.arms[1].elbow = 1.2;
      break;
    case 'throw': {
      // Wind back then whip forward with the right arm.
      const k = Math.min(1, t / 0.32);
      pose.twist = k < 0.6 ? -0.6 * (k / 0.6) : -0.6 + 1.3 * ((k - 0.6) / 0.4);
      pose.arms[1].pitch = k < 0.6 ? 2.2 + k * 0.8 : 2.7 - 2.2 * ((k - 0.6) / 0.4);
      pose.arms[1].out = 0.7; pose.arms[1].elbow = k < 0.6 ? 1.6 : 0.3;
      pose.arms[0].pitch = 1.0; pose.arms[0].elbow = 1.2; pose.arms[0].out = 0.2;
      pose.legs[0].hip = 0.35; pose.legs[1].hip = -0.2; pose.legs[0].knee = 0.3; pose.legs[1].knee = 0.3;
      pose.lean = 0.1 + k * 0.25;
      break;
    }
    case 'reach':
    case 'catch':
    case 'swat':
      if (sp > 1) runLegs(Math.min(0.8, run));
      pose.arms[0].pitch = pose.arms[1].pitch = 2.6; pose.arms[0].elbow = pose.arms[1].elbow = 0.3;
      pose.arms[0].out = pose.arms[1].out = 0.25;
      if (p.anim === 'swat') pose.rootY = Math.sin(Math.min(1, t / 0.5) * Math.PI) * 0.35;
      pose.head = 0.3;
      break;
    case 'falling':
    case 'tackle': {
      const k = Math.min(1, t / 0.45);
      pose.rootPitch = k * 1.45; pose.rootY = -k * 0.15; pose.lean = 0.3;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.8; pose.arms[0].elbow = pose.arms[1].elbow = 0.6;
      pose.legs[0].hip = -0.3; pose.legs[1].hip = -0.1; pose.legs[0].knee = 0.5; pose.legs[1].knee = 0.3;
      break;
    }
    case 'down':
      pose.rootPitch = 1.5; pose.rootY = -0.02;
      pose.arms[0].pitch = 2.4; pose.arms[1].pitch = 1.2; pose.arms[0].elbow = 0.6; pose.arms[1].elbow = 1.0;
      pose.arms[0].out = 0.6;
      pose.legs[0].hip = 0.2; pose.legs[0].knee = 0.6; pose.legs[1].knee = 0.1;
      pose.lean = 0;
      break;
    case 'getup': {
      const k = Math.min(1, t / 0.6);
      pose.rootPitch = 1.5 * (1 - k); pose.crouch = -0.3 * (1 - k);
      pose.legs[0].hip = pose.legs[1].hip = 1.2 * (1 - k); pose.legs[0].knee = pose.legs[1].knee = 1.6 * (1 - k);
      break;
    }
    case 'stumble':
      runLegs(0.5);
      pose.lean = 0.7; pose.arms[0].out = pose.arms[1].out = 0.9; pose.rootRoll = Math.sin(t * 12) * 0.15;
      break;
    case 'juke':
      runLegs(0.6);
      pose.rootRoll = (p.move?.dir || 1) * -0.35 * Math.sin(Math.min(1, t / 0.45) * Math.PI);
      pose.crouch = -0.12;
      break;
    case 'spin':
      runLegs(0.5);
      pose.arms[0].out = pose.arms[1].out = 0.5; pose.crouch = -0.1;
      break;
    case 'stiffarm':
      runLegs(Math.min(1, run));
      pose.arms[0].pitch = 1.55; pose.arms[0].elbow = 0; pose.arms[0].out = 0.15;
      break;
    case 'truck':
      runLegs(Math.min(1, run));
      pose.lean = 0.75; pose.crouch = -0.15; pose.head = -0.3;
      pose.arms[0].pitch = 0.9; pose.arms[0].elbow = 1.4;
      break;
    case 'hurdle': {
      const k = Math.min(1, t / 0.6);
      pose.rootY = Math.sin(k * Math.PI) * 0.75;
      pose.legs[0].hip = 1.3; pose.legs[0].knee = 0.2; pose.legs[1].hip = -0.6; pose.legs[1].knee = 1.4;
      pose.arms[0].pitch = 1.2; pose.arms[1].pitch = -0.5;
      break;
    }
    case 'dive':
    case 'tackle_dive':
    case 'hitstick': {
      const k = Math.min(1, t / 0.35);
      pose.rootPitch = (p.anim === 'hitstick' ? 0.6 : 1.4) * k; pose.rootY = (p.anim === 'hitstick' ? 0 : Math.sin(k * Math.PI) * 0.25) - k * 0.2;
      pose.arms[0].pitch = pose.arms[1].pitch = 2.0; pose.arms[0].elbow = pose.arms[1].elbow = 0.3;
      pose.legs[0].hip = -0.5; pose.legs[1].hip = -0.3;
      break;
    }
    case 'slide':
      pose.rootPitch = -1.0 * Math.min(1, t / 0.3); pose.legs[0].hip = 1.4; pose.legs[1].hip = 1.2;
      break;
    case 'strip':
      runLegs(Math.min(1, run));
      pose.arms[1].pitch = 2.2; pose.arms[1].elbow = 0.2;
      break;
    case 'celebrate':
      pose.arms[0].pitch = pose.arms[1].pitch = 2.9 + Math.sin(time * 8) * 0.2; pose.arms[0].elbow = pose.arms[1].elbow = 0.2;
      pose.rootY = Math.abs(Math.sin(time * 6)) * 0.2;
      break;
    default: // run
      runLegs(Math.min(1.05, 0.25 + run * 0.85));
  }
  return pose;
}

// ---------- matrix helpers ----------
// Preallocated pool so per-frame posing allocates nothing (no GC hitches).
const POOL = Array.from({ length: 200 }, () => new THREE.Matrix4());
let poolI = 0;
const M = () => POOL[poolI++];
const cl = (m) => M().copy(m);
function rotX(a) { return M().makeRotationX(a); }
function rotY(a) { return M().makeRotationY(a); }
function rotZ(a) { return M().makeRotationZ(a); }
function trans(x, y, z) { return M().makeTranslation(x, y, z); }
function scaleM(x, y, z) { return M().makeScale(x, y, z); }

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function isDark(hex) {
  const c = new THREE.Color(hex);
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114 < 0.45;
}
