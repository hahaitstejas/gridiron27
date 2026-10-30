import * as THREE from 'three';

// Low-poly players drawn with one InstancedMesh per body part (about 15 draw calls for all 22
// players). Poses are computed procedurally from the sim's animation state every frame.

const SKIN = ['#f1c9a5', '#e0ac85', '#c68a62', '#a0663f', '#7a4a2c', '#53321e'];
const MAX = 32; // 22 players + 7 officials (+ spare)

// Base proportions for a 6'2" player, in yards.
const B = {
  hipH: 1.0, hipX: 0.11, thigh: 0.48, shin: 0.47,
  torso: 0.66, torsoW: 0.44, torsoD: 0.27, padW: 0.64, padD: 0.36,
  shX: 0.27, upper: 0.34, fore: 0.32,
};

/** Officials' black-and-white vertical stripes, per instance (aStripe = 1), drawn around the body in object space. */
function striped(mat, count, geo) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  geo.setAttribute('aStripe', attr);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aStripe;\nvarying float vStripe;\nvarying vec3 vObjPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripe = aStripe; vObjPos = position;');
    sh.fragmentShader = 'varying float vStripe;\nvarying vec3 vObjPos;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\nif (vStripe > 0.5) { float a = atan(vObjPos.x, vObjPos.z); diffuseColor.rgb *= fract(a * 1.909) < 0.5 ? 1.0 : 0.05; }');
  };
  return attr;
}

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
  g.font = '700 78px "Saira Condensed", "Arial Narrow", sans-serif';
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
  constructor(scene, envMap = null) {
    this.scene = scene;
    // Physically based materials (lit by the scene's environment map): matte jerseys, glossy helmets.
    const mat = (roughness = 0.75, metalness = 0, env = 0.3) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, envMap, envMapIntensity: env });
    const lam = () => mat();
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    // Limbs are capsules (unit length along y, scaled per bone) so arms and legs read as round, not blocky.
    const limbGeo = (r) => { const g = new THREE.CapsuleGeometry(r, 1 - 2 * r, 2, 7); return g; };
    // Torso: a tapered lathe (wide chest, narrower waist) instead of a plain cylinder.
    const torsoGeo = new THREE.LatheGeometry([[0.36, -0.5], [0.4, -0.3], [0.47, 0.05], [0.52, 0.35], [0.5, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)), 10);
    const padGeo = new THREE.CylinderGeometry(0.5, 0.42, 1, 8);
    padGeo.scale(1, 1, 1);
    const helmetGeo = new THREE.SphereGeometry(0.5, 10, 8);
    helmetGeo.scale(0.95, 0.95, 1.08);
    const maskGeo = new THREE.TorusGeometry(0.42, 0.07, 4, 10, Math.PI);
    maskGeo.rotateZ(Math.PI);
    // Facemask bars across the front of the helmet, and rounded shoulder-pad caps.
    const barGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5);
    barGeo.rotateZ(Math.PI / 2);
    const capGeo = new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const numGeo = new THREE.PlaneGeometry(1, 1);
    const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4 * 2), 2);
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

    const torsoMat = mat(0.8), upperMat = mat(0.8);
    const upperGeo = limbGeo(0.07);
    this.stripeAttrs = [striped(torsoMat, MAX, torsoGeo), striped(upperMat, MAX * 2, upperGeo)];
    this.parts = {
      torso: part(torsoGeo, torsoMat, MAX),
      pads: part(padGeo, mat(0.8), MAX),
      pelvis: part(new THREE.CapsuleGeometry(0.15, 0.12, 2, 8).rotateZ(Math.PI / 2).scale(1.05, 1, 0.95), mat(0.7), MAX),
      thigh: part(limbGeo(0.095), mat(0.7), MAX * 2),
      shin: part(limbGeo(0.07), mat(0.8), MAX * 2),
      shoe: part(new THREE.CapsuleGeometry(0.065, 0.17, 2, 6).rotateX(Math.PI / 2).scale(1, 0.75, 1), mat(0.45, 0, 0.8), MAX * 2),
      upper: part(upperGeo, upperMat, MAX * 2),
      fore: part(limbGeo(0.055), mat(0.6, 0, 0.4), MAX * 2),
      hand: part(new THREE.SphereGeometry(0.06, 7, 5).scale(1, 1.1, 0.85), mat(0.6), MAX * 2),
      neck: part(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 6), mat(0.6, 0, 0.4), MAX),
      helmet: part(helmetGeo, mat(0.25, 0.2, 0.7), MAX),
      stripe: part(box(0.06, 0.03, 0.36), lam(), MAX, false),
      mask: part(maskGeo, mat(0.35, 0.6, 1), MAX, false),
      bar: part(barGeo, mat(0.35, 0.6, 1), MAX * 2, false),
      cap: part(capGeo, mat(0.8), MAX * 2),
      num: part(numGeo, numMat, MAX * 4, false),
    };
    this.pairs = new Set([this.parts.thigh, this.parts.shin, this.parts.shoe, this.parts.upper, this.parts.fore, this.parts.hand, this.parts.bar, this.parts.cap]);
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
    // Second ring for player 2 in local 2-player games.
    this.ring2 = this.ring.clone();
    this.ring2.material = this.ring.material.clone();
    scene.add(this.ring2);
    // Pulse ring: flashes under whoever ends up with the ball on a pass (team-colored), so it's clear who caught it.
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.pulse.rotation.x = -Math.PI / 2;
    this.pulse.position.y = 0.035;
    this.pulse.renderOrder = 3;
    scene.add(this.pulse);
    this.pulseT = 0;
    this.pulseId = -1;
    // Pose crossfades (per player index): the pose an animation change starts from, and the last drawn pose.
    this.fromPose = []; this.lastPose = []; this.lastAnim = []; this.fadeT = []; this.poseSim = null;
    this.fall = []; this.fallAnim = [];

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
        P.bar.setColorAt(i * 2 + k, c.set(isDark(helmet) ? '#cfcfcf' : '#333333'));
        P.cap.setColorAt(i * 2 + k, c.set(jersey).offsetHSL(0, 0, -0.04));
        P.num.setColorAt(i * 4 + 2 + k, c.set(numColor));
        this.cellAttr.setXY(i * 4 + 2 + k, p.number % 10, Math.floor(p.number / 10));
      }
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        P.thigh.setColorAt(j, c.set(pants));
        P.shin.setColorAt(j, c.set(u.pants === 'white' ? team.colors.primary : '#f2f2f2'));
        P.shoe.setColorAt(j, c.set(i % 3 ? '#151515' : '#f0f0f0'));
        P.upper.setColorAt(j, c.set(jersey));
        P.fore.setColorAt(j, c.set(skin));
        P.hand.setColorAt(j, c.set(team.colors.secondary).lerp(new THREE.Color('#ffffff'), 0.2));
        P.num.setColorAt(i * 4 + k, c.set(numColor));
        this.cellAttr.setXY(i * 4 + k, p.number % 10, Math.floor(p.number / 10));
      }
    });
    // Officials after the players: striped shirt, black pants, black cap (the referee wears white).
    const [sT, sU] = this.stripeAttrs;
    for (let i = 0; i < MAX; i++) { const ref = i >= sim.players.length && i < sim.players.length + 7; sT.setX(i, ref ? 1 : 0); sU.setX(i * 2, ref ? 1 : 0); sU.setX(i * 2 + 1, ref ? 1 : 0); }
    sT.needsUpdate = sU.needsUpdate = true;
    for (let r = 0; r < 7; r++) {
      const i = sim.players.length + r;
      const cap = r === 0 ? '#f4f4f4' : '#141414';
      P.torso.setColorAt(i, c.set('#f2f2f2')); P.pads.setColorAt(i, c.set('#f2f2f2')); P.pelvis.setColorAt(i, c.set('#1a1a1a'));
      P.neck.setColorAt(i, c.set(SKIN[(r * 2 + 1) % SKIN.length])); P.helmet.setColorAt(i, c.set(cap)); P.stripe.setColorAt(i, c.set(cap)); P.mask.setColorAt(i, c.set(cap));
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        P.thigh.setColorAt(j, c.set('#1a1a1a')); P.shin.setColorAt(j, c.set('#1a1a1a')); P.shoe.setColorAt(j, c.set('#0e0e0e'));
        P.upper.setColorAt(j, c.set('#f2f2f2')); P.fore.setColorAt(j, c.set(SKIN[(r * 2 + 1) % SKIN.length])); P.hand.setColorAt(j, c.set(SKIN[(r * 2 + 1) % SKIN.length]));
        P.bar.setColorAt(j, c.set(cap)); P.cap.setColorAt(j, c.set('#f2f2f2'));
        P.num.setColorAt(i * 4 + k, c.set('#111111')); this.cellAttr.setXY(i * 4 + k, (r * 13 + 7) % 10, ((r * 13 + 7) / 10 | 0) % 10);
        P.num.setColorAt(i * 4 + 2 + k, c.set('#f2f2f2'));
      }
    }
    this.cellAttr.needsUpdate = true;
    for (const m of Object.values(P)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Update all instance matrices. alpha interpolates between the previous and current sim tick. */
  update(sim, alpha, time, controlledId, refs = null) {
    const P = this.parts;
    const n = sim.players.length + (refs ? refs.length : 0);
    for (const m of Object.values(P)) m.count = m === P.num ? n * 4 : this.pairs.has(m) ? n * 2 : n;
    // A new play: poses start fresh (no crossfade from the last play's players).
    if (sim !== this.poseSim) { this.poseSim = sim; this.lastAnim.length = 0; this.fadeT.length = 0; this.fallAnim.length = 0; }
    const dt = Math.min(0.1, Math.max(0, time - (this.lastTime ?? time)));
    this.lastTime = time;
    for (let i = 0; i < sim.players.length; i++) this.drawPlayer(sim, this.display?.[i] || sim.players[i], i, alpha, time, dt);
    if (refs) for (let r = 0; r < refs.length; r++) this.drawPlayer(sim, refs[r], sim.players.length + r, alpha, time, dt, true);
    // Catch / interception pulse under the player with the ball.
    if (this.pulseT > 0) {
      this.pulseT -= dt;
      const cp = sim.players[this.pulseId];
      const k = 1 - Math.max(0, this.pulseT) / 1.1;
      if (cp) { this.pulse.position.x = cp.px + (cp.x - cp.px) * alpha; this.pulse.position.z = cp.pz + (cp.z - cp.pz) * alpha; }
      this.pulse.scale.setScalar(0.8 + k * 1.8);
      this.pulse.material.opacity = Math.max(0, 0.95 * (1 - k));
    } else this.pulse.material.opacity = 0;
    for (const m of Object.values(P)) m.instanceMatrix.needsUpdate = true;
    const ids = Array.isArray(controlledId) ? controlledId : [controlledId];
    [this.ring, this.ring2].forEach((ring, i) => {
      const cp = (ids[i] >= 0 && this.display?.[ids[i]]) || sim.players[ids[i]];
      ring.visible = !!cp;
      if (!cp) return;
      ring.position.x = cp.px + (cp.x - cp.px) * alpha;
      ring.position.z = cp.pz + (cp.z - cp.pz) * alpha;
      ring.material.color.set(cp.team === sim.possTeam ? 0xffe14d : 0x4dd2ff);
    });
  }

  /** Flash a team-colored ring under player `id` (catch = offense color, interception = defense color). */
  flash(id, color) { this.pulseId = id; this.pulseT = 1.1; this.pulse.material.color.set(color); }

  drawPlayer(sim, p, i, alpha, time, dt = 1 / 60, official = false) {
    const P = this.parts;
    const x = p.px + (p.x - p.px) * alpha;
    const z = p.pz + (p.z - p.pz) * alpha;
    let f = p.pfacing + angDiff(p.facing, p.pfacing) * alpha;
    const sc = p.height / 2.06;
    const wide = 1 + p.bulk * 0.28;
    const limb = 0.88 + p.bulk * 0.42; // linemen are thick through the arms and legs, receivers and DBs lean
    // Falls go the way the player is moving at the moment he goes down (forward, sideways, or onto his back on
    // a big hit), measured once in his own frame and kept through the time he lies on the turf.
    const falling = p.anim === 'falling' || p.anim === 'tackle' || p.anim === 'down' || p.anim === 'getup';
    if (falling && this.fallAnim[i] !== true) {
      const sp = Math.hypot(p.vx, p.vz);
      const a = sp > 0.6 ? Math.atan2(p.vz, p.vx) - p.facing : 0;
      (this.fall[i] ||= { fwd: 1, side: 0 });
      this.fall[i].fwd = Math.cos(a); this.fall[i].side = Math.sin(a);
      this.fallAnim[i] = true;
    } else if (!falling) this.fallAnim[i] = false;
    FALL = falling ? this.fall[i] : null;
    const pose = this.blend(i, p.anim, computePose(p, time, sim), dt);
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
    P.torso.setMatrixAt(i, cl(pel).multiply(trans(0, B.torso * 0.45, p.bulk * 0.02)).multiply(scaleM(B.torsoW * wide, B.torso * 0.85, B.torsoD * wide * (1 + p.bulk * 0.25))));
    P.pads.setMatrixAt(i, official ? ZERO : cl(pel).multiply(trans(0, B.torso * 0.86, 0)).multiply(scaleM(B.padW * wide, 0.2, B.padD * wide)));
    P.neck.setMatrixAt(i, cl(pel).multiply(trans(0, B.torso + 0.04, 0.01)));
    const head = cl(pel).multiply(trans(0, B.torso + 0.2, 0.02)).multiply(rotX(pose.head));
    if (official) {
      // Officials: a flat cap with a bill instead of a helmet and facemask.
      P.helmet.setMatrixAt(i, cl(head).multiply(trans(0, 0.06, 0)).multiply(scaleM(0.27, 0.16, 0.27)));
      P.stripe.setMatrixAt(i, cl(head).multiply(trans(0, 0.05, 0.13)).multiply(scaleM(2.6, 0.6, 0.45)));
      P.mask.setMatrixAt(i, ZERO); P.bar.setMatrixAt(i * 2, ZERO); P.bar.setMatrixAt(i * 2 + 1, ZERO);
    } else {
      P.helmet.setMatrixAt(i, cl(head).multiply(scaleM(0.33, 0.33, 0.33)));
      P.stripe.setMatrixAt(i, cl(head).multiply(trans(0, 0.165, -0.01)));
      P.mask.setMatrixAt(i, cl(head).multiply(trans(0, -0.03, 0.16)).multiply(scaleM(0.32, 0.28, 0.3)));
      P.bar.setMatrixAt(i * 2, cl(head).multiply(trans(0, -0.035, 0.205)).multiply(scaleM(0.2, 1, 1)));
      P.bar.setMatrixAt(i * 2 + 1, cl(head).multiply(trans(0, -0.085, 0.195)).multiply(scaleM(0.16, 1, 1)));
    }
    // Numbers front and back.
    P.num.setMatrixAt(i * 4, cl(pel).multiply(trans(0, B.torso * 0.5, -(B.torsoD * wide) / 2 - 0.035)).multiply(rotY(Math.PI)).multiply(scaleM(0.3 * wide, 0.3, 1)));
    P.num.setMatrixAt(i * 4 + 1, cl(pel).multiply(trans(0, B.torso * 0.58, (B.torsoD * wide) / 2 + 0.04)).multiply(rotX(-0.12)).multiply(scaleM(0.2 * wide, 0.2, 1)));

    // Arms.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1; // -1 = left
      const a = pose.arms[s];
      // Shoulder-pad cap with a small number on top (like a real jersey's sleeve numbers).
      const capM = cl(pel).multiply(trans(side * B.shX * wide * 1.02, B.torso * 0.9, 0)).multiply(rotZ(-side * 0.35));
      P.cap.setMatrixAt(i * 2 + s, official ? ZERO : cl(capM).multiply(scaleM(0.2 * wide, 0.16, 0.24 * wide)));
      if (official) P.num.setMatrixAt(i * 4 + 2 + s, ZERO); else P.num.setMatrixAt(i * 4 + 2 + s, cl(capM).multiply(trans(side * 0.005, 0.03, 0)).multiply(rotZ(side * 0.25)).multiply(rotY(side * Math.PI / 2)).multiply(scaleM(0.12, 0.12, 1)));
      const sh = cl(pel).multiply(trans(side * B.shX * wide, B.torso * 0.84, 0)).multiply(rotX(-a.pitch)).multiply(rotZ(side * a.out)).multiply(rotY(side * (a.twist || 0)));
      P.upper.setMatrixAt(i * 2 + s, cl(sh).multiply(trans(0, -B.upper / 2, 0)).multiply(scaleM(limb, B.upper, limb)));
      const el = cl(sh).multiply(trans(0, -B.upper, 0)).multiply(rotX(-a.elbow));
      P.fore.setMatrixAt(i * 2 + s, cl(el).multiply(trans(0, -B.fore / 2, 0)).multiply(scaleM(limb, B.fore, limb)));
      const hand = cl(el).multiply(trans(0, -B.fore - 0.05, 0));
      P.hand.setMatrixAt(i * 2 + s, hand);
      if (s === 1) (this.handPos[i] ||= new THREE.Vector3()).setFromMatrixPosition(hand);
    }
    // Legs.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const l = pose.legs[s];
      const hip = cl(root).multiply(trans(side * B.hipX * wide, B.hipH + pose.crouch, 0)).multiply(rotX(-l.hip)).multiply(rotZ(side * (l.out || 0)));
      P.thigh.setMatrixAt(i * 2 + s, cl(hip).multiply(trans(0, -B.thigh / 2, 0)).multiply(scaleM(limb * 1.05, B.thigh, limb * 1.05)));
      const knee = cl(hip).multiply(trans(0, -B.thigh, 0)).multiply(rotX(l.knee));
      P.shin.setMatrixAt(i * 2 + s, cl(knee).multiply(trans(0, -B.shin / 2, 0)).multiply(scaleM(1, B.shin, 1)));
      const foot = cl(knee).multiply(trans(0, -B.shin - 0.01, 0.06)).multiply(rotX(-l.knee + l.hip * 0.6));
      P.shoe.setMatrixAt(i * 2 + s, foot);
    }
  }

  /**
   * Crossfade between animations: when a player's animation changes, blend from the pose he was in toward
   * the new one over ~0.2 s (falls and dives a bit faster), so moves flow instead of snapping.
   */
  blend(i, anim, target, dt) {
    const last = (this.lastPose[i] ||= new Float32Array(POSE_N));
    if (this.lastAnim[i] === undefined) { this.lastAnim[i] = anim; this.fadeT[i] = 1; packPose(target, last); return target; }
    if (anim !== this.lastAnim[i]) {
      (this.fromPose[i] ||= new Float32Array(POSE_N)).set(last);
      this.lastAnim[i] = anim;
      this.fadeT[i] = 0;
    }
    const dur = FAST_FADE.has(anim) ? 0.12 : 0.22;
    if (this.fadeT[i] < 1) {
      this.fadeT[i] = Math.min(1, this.fadeT[i] + dt / dur);
      const k = this.fadeT[i] * this.fadeT[i] * (3 - 2 * this.fadeT[i]);
      packPose(target, TMP);
      const from = this.fromPose[i];
      for (let j = 0; j < POSE_N; j++) TMP[j] = from[j] + (TMP[j] - from[j]) * k;
      unpackPose(TMP, target);
    }
    packPose(target, last);
    return target;
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

// ---------- Pose packing (for crossfades) ----------
const POSE_KEYS = ['rootY', 'rootPitch', 'rootRoll', 'rootYaw', 'crouch', 'lean', 'twist', 'head'];
const ARM_KEYS = ['pitch', 'out', 'elbow', 'twist'];
const LEG_KEYS = ['hip', 'knee', 'out'];
const POSE_N = POSE_KEYS.length + 2 * ARM_KEYS.length + 2 * LEG_KEYS.length;
const TMP = new Float32Array(POSE_N);
const FAST_FADE = new Set(['tackle', 'falling', 'dive', 'tackle_dive', 'hitstick', 'juke', 'spin', 'catch', 'throw', 'swat']);
function packPose(p, a) {
  let j = 0;
  for (const k of POSE_KEYS) a[j++] = p[k] || 0;
  for (const arm of p.arms) for (const k of ARM_KEYS) a[j++] = arm[k] || 0;
  for (const leg of p.legs) for (const k of LEG_KEYS) a[j++] = leg[k] || 0;
}
function unpackPose(a, p) {
  let j = 0;
  for (const k of POSE_KEYS) p[k] = a[j++];
  for (const arm of p.arms) for (const k of ARM_KEYS) arm[k] = a[j++];
  for (const leg of p.legs) for (const k of LEG_KEYS) leg[k] = a[j++];
}

// ---------- Procedural poses ----------
let FALL = null; // fall direction of the player being posed (set by drawPlayer)
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
    case 'swat':
      if (sp > 1) runLegs(Math.min(0.8, run));
      pose.arms[0].pitch = pose.arms[1].pitch = 2.6; pose.arms[0].elbow = pose.arms[1].elbow = 0.3;
      pose.arms[0].out = pose.arms[1].out = 0.25;
      if (p.anim === 'swat') { pose.rootY = Math.sin(Math.min(1, t / 0.5) * Math.PI) * 0.35; pose.arms[1].pitch = 3.0; }
      pose.head = 0.3;
      break;
    case 'catch': {
      // Hands up to the ball, then pull it into the chest.
      if (sp > 1) runLegs(Math.min(0.8, run));
      const k = Math.min(1, t / 0.3);
      pose.arms[0].pitch = pose.arms[1].pitch = 2.4 - k * 1.3;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.3 + k * 1.5;
      pose.arms[0].out = pose.arms[1].out = 0.2 - k * 0.3;
      pose.head = 0.25 - k * 0.35; pose.lean = 0.15 + k * 0.2;
      break;
    }
    case 'pick': {
      // Interception: a leap for the ball, high-pointing it, then the tuck.
      const k = Math.min(1, t / 0.45);
      pose.rootY = Math.sin(Math.min(1, t / 0.4) * Math.PI) * 0.45;
      pose.arms[0].pitch = pose.arms[1].pitch = 3.0 - k * 1.8;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.15 + k * 1.6;
      pose.legs[0].hip = 0.9 * (1 - k); pose.legs[0].knee = 1.3 * (1 - k); pose.legs[1].knee = 0.4;
      pose.head = 0.4 - k * 0.5;
      break;
    }
    case 'falling': {
      // Ball carrier going down: pitch/roll toward the fall direction; on his back after a big hit.
      const f = FALL || { fwd: 1, side: 0 };
      const k = Math.min(1, t / 0.45), e = k * k * (3 - 2 * k);
      const back = f.fwd < -0.25;
      pose.rootPitch = e * (back ? -1.35 : 1.4 * Math.max(0.3, f.fwd));
      pose.rootRoll = -e * f.side * 1.2;
      pose.rootY = -e * 0.12; pose.lean = back ? -0.2 : 0.3;
      pose.arms[0].pitch = pose.arms[1].pitch = back ? 2.6 : 1.7; pose.arms[0].elbow = pose.arms[1].elbow = 0.5;
      pose.arms[0].out = pose.arms[1].out = 0.35 + e * 0.4;
      pose.legs[0].hip = back ? 1.0 * e : -0.35; pose.legs[1].hip = back ? 0.6 * e : -0.1; pose.legs[0].knee = 0.5; pose.legs[1].knee = 0.3;
      pose.head = back ? 0.5 : -0.2;
      break;
    }
    case 'tackle': {
      // Tackler: drive in with arms wrapped, then go down with the runner.
      const f = FALL || { fwd: 1, side: 0 };
      const k = Math.min(1, t / 0.4), e = k * k * (3 - 2 * k);
      pose.rootPitch = e * 1.35; pose.rootRoll = -e * f.side * 0.6; pose.rootY = -e * 0.15; pose.lean = 0.45;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.6; pose.arms[0].elbow = pose.arms[1].elbow = 1.3;
      pose.arms[0].out = pose.arms[1].out = -0.35; // wrapped around the ball carrier
      pose.legs[0].hip = -0.4; pose.legs[1].hip = 0.2; pose.legs[0].knee = 0.6; pose.legs[1].knee = 0.9;
      pose.head = -0.4;
      break;
    }
    case 'down': {
      const f = FALL || { fwd: 1, side: 0 };
      const back = f.fwd < -0.25;
      pose.rootPitch = back ? -1.45 : 1.5; pose.rootRoll = -f.side * 0.5; pose.rootY = -0.02;
      pose.arms[0].pitch = back ? 2.9 : 2.4; pose.arms[1].pitch = back ? 2.2 : 1.2; pose.arms[0].elbow = 0.6; pose.arms[1].elbow = 1.0;
      pose.arms[0].out = 0.6; pose.arms[1].out = back ? 0.5 : 0.15;
      pose.legs[0].hip = back ? 0.5 : 0.2; pose.legs[0].knee = back ? 1.0 : 0.6; pose.legs[1].knee = 0.1;
      pose.lean = 0;
      break;
    }
    case 'getup': {
      const k = Math.min(1, t / 0.6);
      pose.rootPitch = (FALL && FALL.fwd < -0.25 ? -1.45 : 1.5) * (1 - k); pose.crouch = -0.3 * (1 - k);
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
    // ---- touchdown celebrations (scorer) ----
    case 'cel_spike': {
      // Wind up and spike the ball, then arms out.
      const k = Math.min(1, t / 0.55);
      pose.lean = k < 0.6 ? -0.15 : 0.35 * (1 - (k - 0.6) / 0.4) + 0.05;
      pose.arms[1].pitch = k < 0.6 ? 2.9 : 2.9 - (k - 0.6) / 0.4 * 2.6; pose.arms[1].elbow = 0.3;
      if (t > 0.8) { pose.arms[0].pitch = pose.arms[1].pitch = 2.5; pose.arms[0].out = pose.arms[1].out = 0.7; pose.lean = -0.1; }
      break;
    }
    case 'cel_point':
      // Point to the sky with both hands.
      pose.lean = -0.2; pose.head = 0.45;
      pose.arms[0].pitch = 2.7; pose.arms[1].pitch = 2.95; pose.arms[0].elbow = 0.35; pose.arms[1].elbow = 0.05; pose.arms[0].out = 0.25; pose.arms[1].out = 0.1;
      break;
    case 'cel_flex':
      // Wide stance, both arms flexed.
      pose.crouch = -0.08; pose.legs[0].out = pose.legs[1].out = 0.28; pose.legs[0].knee = pose.legs[1].knee = 0.3;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.5; pose.arms[0].out = pose.arms[1].out = 0.85 + Math.sin(t * 7) * 0.06; pose.arms[0].elbow = pose.arms[1].elbow = 1.75;
      break;
    case 'cel_leap': {
      // Jump with arms up, every 1.1 s.
      const c = (t % 1.1) / 1.1, air = c < 0.5 ? Math.sin(c / 0.5 * Math.PI) : 0;
      pose.rootY = air * 0.7; pose.legs[0].hip = pose.legs[1].hip = air * 0.6; pose.legs[0].knee = pose.legs[1].knee = air * 1.1 + (c > 0.85 ? 0.4 : 0);
      pose.arms[0].pitch = pose.arms[1].pitch = 2.6 + air * 0.4; pose.arms[0].out = pose.arms[1].out = 0.35;
      break;
    }
    case 'huddle':
      // Hands on knees in the huddle, listening for the call.
      pose.crouch = -0.12; pose.lean = 0.55; pose.head = -0.1;
      pose.legs[0].hip = pose.legs[1].hip = 0.45; pose.legs[0].knee = pose.legs[1].knee = 0.55; pose.legs[0].out = pose.legs[1].out = 0.12;
      pose.arms[0].pitch = pose.arms[1].pitch = 0.75; pose.arms[0].elbow = pose.arms[1].elbow = 0.25; pose.arms[0].out = pose.arms[1].out = 0.18;
      break;
    case 'clap':
      // Breaking the huddle.
      pose.lean = 0.25; pose.arms[0].pitch = pose.arms[1].pitch = 1.4 + Math.sin(t * 14) * 0.15; pose.arms[0].elbow = pose.arms[1].elbow = 0.6;
      pose.arms[0].out = pose.arms[1].out = -0.25 + Math.max(0, Math.sin(t * 14)) * 0.2;
      break;
    // ---- officials' signals ----
    case 'sig_td':
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 3.1; pose.arms[0].elbow = pose.arms[1].elbow = 0; pose.arms[0].out = pose.arms[1].out = 0.08;
      break;
    case 'sig_incomplete': {
      // Arms crossing back and forth at waist height.
      const w = Math.sin(t * 9);
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 0.9; pose.arms[0].elbow = pose.arms[1].elbow = 0;
      pose.arms[0].out = pose.arms[1].out = -0.25 + w * 0.7;
      break;
    }
    case 'sig_first':
      // Point downfield with the right arm.
      pose.lean = 0; pose.arms[1].pitch = 1.55; pose.arms[1].elbow = 0; pose.arms[1].out = 0.05;
      break;
    case 'sig_flag':
      // Throwing the flag.
      runLegs(Math.min(0.6, run)); pose.arms[1].pitch = 2.6 - Math.min(1, t / 0.3) * 1.2; pose.arms[1].elbow = 0.3;
      break;
    case 'sig_holding':
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 1.3; pose.arms[0].elbow = 0.9; pose.arms[1].elbow = 0.5;
      pose.arms[0].out = -0.45; pose.arms[1].out = -0.2; // one hand grips the other wrist
      break;
    case 'sig_offside':
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 0.25; pose.arms[0].elbow = pose.arms[1].elbow = 1.7; pose.arms[0].out = pose.arms[1].out = 0.75; // hands on hips
      break;
    case 'sig_pi':
      pose.lean = 0.05; pose.arms[0].pitch = pose.arms[1].pitch = 1.55 + Math.sin(t * 6) * 0.1; pose.arms[0].elbow = pose.arms[1].elbow = 0.1; pose.arms[0].out = pose.arms[1].out = -0.05; // push
      break;
    case 'sig_false_start': {
      const w = Math.sin(t * 10);
      pose.lean = 0; pose.arms[0].pitch = 1.3 + w * 0.3; pose.arms[1].pitch = 1.3 - w * 0.3; pose.arms[0].elbow = pose.arms[1].elbow = 1.6; pose.arms[0].out = pose.arms[1].out = -0.2; // rolling forearms
      break;
    }
    case 'sig_personal':
      pose.lean = 0; pose.arms[0].pitch = 0.9; pose.arms[0].elbow = 1.6; pose.arms[1].pitch = 2.9; pose.arms[1].elbow = 1.4; pose.arms[1].out = 0.3; // chop at the wrist overhead
      break;
    case 'sig_spot':
      // Spotting the ball / waving the play dead.
      pose.lean = 0.1; pose.arms[1].pitch = 2.8; pose.arms[1].elbow = 0.2; pose.arms[1].out = 0.4 + Math.sin(t * 8) * 0.25;
      break;
    default: // run
      runLegs(Math.min(1.05, 0.25 + run * 0.85));
  }
  return pose;
}

// ---------- matrix helpers ----------
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
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
