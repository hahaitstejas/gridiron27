import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { PlayArtOverlay } from './playArt.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import envUrl from '../assets/env/hochsal_field_1k.hdr?url'; // CC0, Poly Haven (see src/assets/CREDITS.md)
import { buildStadium } from './stadium.js';
import { PlayerRenderer } from './players.js';
import { CameraRig } from './camera.js';
import { FieldLines } from './lines.js';
import { Precipitation } from './weather.js';
import { Presentation } from './presentation.js';

// Lighting and sky by time of day (sky colors are linear RGB top / middle / horizon).
const TIME_LOOKS = {
  day: { hemi: [0xdfeaff, 0x3a4a2a, 0.72], key: [0xfff2dc, 3.9], rim: [0xffffff, 0.6], fog: [0xa9c4e0, 220, 640], sky: [[0.18, 0.38, 0.78], [0.42, 0.62, 0.9], [0.78, 0.84, 0.9]], lamps: 0x9a9a9a, exposure: 0.95, grey: 1 },
  dusk: { hemi: [0xffc9a8, 0x2a2a20, 0.7], key: [0xffb070, 3.0], rim: [0x8899ff, 0.6], fog: [0x4a3a50, 170, 460], sky: [[0.08, 0.1, 0.28], [0.45, 0.28, 0.4], [0.98, 0.55, 0.3]], lamps: 0xfff6dd, exposure: 1.05, grey: 0.5 },
  night: { hemi: [0xb8c8ff, 0x203018, 0.62], key: [0xfff4e0, 3.0], rim: [0xaabbff, 0.6], fog: [0x0b1020, 160, 420], sky: [[0.015, 0.03, 0.08], [0.06, 0.09, 0.2], [0.22, 0.2, 0.3]], lamps: 0xfff6dd, exposure: 1.05, grey: 0.15 },
};

/** Owns the WebGL renderer, scene, lights and all visual sub-systems. */
export class GameRenderer {
  constructor(container, home, away) {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.maxPixelRatio;
    r.setPixelRatio(this.pixelRatio);
    r.setSize(container.clientWidth, container.clientHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap; // (PCFSoft was removed from three; PCF + the 2048 map is soft enough)
    container.appendChild(r.domElement);
    this.renderer = r;

    const scene = new THREE.Scene();
    // A soft studio environment map for the PBR player materials (helmet shine, fabric sheen). Built once.
    const pmrem = new THREE.PMREMGenerator(r);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.fog = new THREE.Fog(0x0b1020, 160, 420);
    this.scene = scene;

    // Night game lighting: cool sky fill + strong key light from the stadium lights.
    this.hemi = new THREE.HemisphereLight(0xb8c8ff, 0x203018, 1.1);
    scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff4e0, 2.4);
    key.position.set(-25, 60, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 10; sc.far = 140; // follows the ball: tighter = crisper player shadows
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    this.key = key;
    const rim = new THREE.DirectionalLight(0xaabbff, 0.6);
    rim.position.set(40, 40, -30);
    scene.add(rim);
    this.rim = rim;

    this.stadium = buildStadium(r, home, away);
    scene.add(this.stadium.group);
    this.players = new PlayerRenderer(scene, envMap);
    // Image-based light for the players: a real outdoor sky / grass / sun environment (CC0 HDRI) replaces the studio room once
    // it loads, so uniforms, skin and helmets pick up believable sky fill, green bounce from the turf and sun reflections.
    new HDRLoader().load(envUrl, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(r);
      const env = pm.fromEquirectangular(tex).texture;
      pm.dispose(); tex.dispose();
      this.players.setEnvMap(env);
    }, undefined, () => { /* keep the studio room if the file is missing */ });
    this.presentation = new Presentation(); // only the players use it (scene.environment would light the whole stadium)
    this.lines = new FieldLines(scene);
    this.precip = new Precipitation(scene);

    const ballGeo = new THREE.SphereGeometry(1, 12, 8);
    ballGeo.scale(0.17, 0.105, 0.105);
    this.ball = new THREE.Mesh(ballGeo, new THREE.MeshPhongMaterial({ color: 0x6b3a1c, shininess: 30 }));
    this.ball.castShadow = true;
    scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.02;
    scene.add(this.ballShadow);

    // Kick aim arrow and penalty flag.
    const aimGeo = new THREE.ConeGeometry(0.5, 1.6, 3);
    aimGeo.rotateZ(-Math.PI / 2);
    this.aim = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.25), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.85, depthWrite: false }));
    shaft.rotation.x = -Math.PI / 2; shaft.position.x = 3;
    const tip = new THREE.Mesh(aimGeo, new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    tip.position.set(6.6, 0.05, 0); tip.scale.y = 0.2;
    this.aim.add(shaft, tip);
    this.aim.position.y = 0.04;
    this.aim.visible = false;
    scene.add(this.aim);
    this.flag = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.35), new THREE.MeshLambertMaterial({ color: 0xffd400, emissive: 0x332a00 }));
    this.flag.visible = false;
    scene.add(this.flag);
    this.playArt = new PlayArtOverlay(scene);

    this.rig = new CameraRig(container.clientWidth / container.clientHeight);
    this.container = container;
    this.setupPost();
    window.addEventListener('resize', () => this.resize());
    this.frameTimes = [];
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  /** Time of day and weather for this game ({ type, wind, time } from game/weather.js). */
  setConditions(c = {}) {
    const look = TIME_LOOKS[c.time] || TIME_LOOKS.night;
    const wet = c.type === 'rain' || c.type === 'snow';
    const grey = new THREE.Color().setRGB(0.36, 0.38, 0.42).multiplyScalar(look.grey);
    this.hemi.color.set(look.hemi[0]); this.hemi.groundColor.set(look.hemi[1]); this.hemi.intensity = look.hemi[2] * (wet ? 0.9 : 1);
    this.key.color.set(look.key[0]); this.key.intensity = look.key[1] * (wet ? 0.55 : 1);
    this.rim.color.set(look.rim[0]); this.rim.intensity = look.rim[1];
    const fog = new THREE.Color(look.fog[0]);
    if (wet) fog.lerp(grey, 0.6);
    this.scene.fog.color.copy(fog);
    this.scene.fog.near = wet ? look.fog[1] * 0.45 : look.fog[1];
    this.scene.fog.far = wet ? look.fog[2] * 0.6 : look.fog[2];
    const sky = this.stadium.sky;
    [sky.uTop, sky.uMid, sky.uHor].forEach((u, i) => { u.value.setRGB(...look.sky[i]); if (wet) u.value.lerp(grey, 0.75); });
    this.stadium.lampMat.color.set(look.lamps);
    this.stadium.glow.material.opacity = c.time === 'night' ? 0.9 : c.time === 'dusk' ? 0.55 : 0;
    this.stadium.snow.visible = c.type === 'snow';
    this.renderer.toneMappingExposure = look.exposure;
    this.precip.set(c.type, c.wind, c.holiday || null);
    this.baseExposure = look.exposure;
    this.cond = c;
  }

  /** Touchdown light show: the stadium lights pulse for a couple of seconds. */
  lightShow(secs = 2.4) { this.flashT = secs; }

  /** Dynamic lighting each frame: the light show, and a dusk game slowly getting darker as it goes on (k = 0..1). */
  updateLighting(dt, progress = null) {
    let exp = this.baseExposure ?? this.renderer.toneMappingExposure;
    if (progress !== null && this.cond?.time === 'dusk') {
      exp *= 1 - Math.min(1, progress) * 0.18;
      this.stadium.glow.material.opacity = 0.55 + Math.min(1, progress) * 0.35;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      exp *= 1 + 0.28 * Math.max(0, Math.sin(this.flashT * 22)) * Math.min(1, this.flashT);
    }
    this.renderer.toneMappingExposure = exp;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    if (this.composer) { this.composer.setPixelRatio(this.pixelRatio); this.composer.setSize(w, h); }
    this.rig.resize(w / h);
  }

  /**
   * Broadcast look (Settings → Graphics): an HDR render target with MSAA, a soft bloom on the stadium lights, glossy
   * helmets and white paint, then tone mapping and a grade (a little contrast and saturation, a gentle vignette).
   * 'low' skips all of it and draws straight to the screen.
   */
  setupPost() {
    const r = this.renderer, w = this.container.clientWidth, h = this.container.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w * this.pixelRatio, h * this.pixelRatio, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(r, rt);
    c.setPixelRatio(this.pixelRatio);
    c.setSize(w, h);
    this.renderPass = new RenderPass(this.scene, this.rig.camera);
    c.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.5, 1.6);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uSat: { value: 1.08 }, uCon: { value: 1.06 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uCon; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uSat);
          c = (c - 0.5) * uCon + 0.5;
          vec2 d = vUv - 0.5;
          c *= 1.0 - uVig * smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0)));
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    });
    c.addPass(this.grade);
    this.composer = c;
  }

  /** Graphics quality: 'high' (post + bloom), 'medium' (post, no bloom), 'low' (no post, lower pixel ratio cap). */
  setQuality(q) {
    this.quality = q;
    this.bloom.enabled = q === 'high';
    if (q === 'low' && this.pixelRatio > 1) { this.pixelRatio = 1; this.renderer.setPixelRatio(1); this.resize(); }
  }

  /** Draw the scene through the post chain (or straight to the screen on low). */
  draw(cam) {
    if (this.quality === 'low' || !this.composer) { this.renderer.render(this.scene, cam); return; }
    this.renderPass.camera = cam;
    this.composer.render();
  }

  setTeams(home, away, opts) { this.stadium.setTeams(home, away, opts); }

  /** Lower the pixel ratio if frames run long (keeps 60fps on integrated GPUs). */
  adapt(frameMs) {
    const ft = this.frameTimes;
    ft.push(frameMs);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (avg > 18.5 && this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    } else if (avg < 13 && this.pixelRatio < this.maxPixelRatio && this.quality !== 'low') {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  /** Draw a frame of a play simulation. */
  /** Draw a play. With `session` (live games, not replays) the between-play presentation and officials run too. */
  drawSim(sim, alpha, time, session = null) {
    const players = this.players;
    this._lastSim = sim;
    this.ball.visible = true;
    const dt = Math.min(0.1, Math.max(0, time - (this._presT ?? time)));
    this._presT = time;
    const pr = session ? this.presentation.frame(session, sim, dt) : null;
    players.display = pr?.display || null;
    // The sidelines appear on the first presented frame: color them once.
    if (pr?.bench && players.extra !== pr.bench) { players.extra = pr.bench; players.colorsKey = null; players.setColors(sim, session.teams); }
    players.update(sim, alpha, time, sim.coopTeam != null ? [sim.controlled[sim.coopTeam] ?? -1, sim.coopId ?? -1] : sim.humanTeams?.length ? sim.humanTeams.map((t) => sim.controlled[t] ?? -1) : sim.humanTeam !== null ? sim.controlledId : -1, pr?.refs || null);
    // Ball
    const b = sim.ball;
    const bm = this.ball;
    if ((b.state === 'held' || b.state === 'presnap') && b.carrier >= 0) {
      const cp = sim.players[b.carrier];
      if (b.state === 'presnap') { bm.position.set(b.x, 0.12, b.z); bm.rotation.set(0, Math.PI - cp.facing, 0); }
      else {
        // In the posed arm (cradled along the forearm, or in the hands), also going down and on the ground: not at the sim's
        // spotting point, which runs ahead of a sideways or backward fall and made every tackle look like a fumble.
        // Where the posed body holds it, blended in the carrier's own frame: a catch tucks the ball from the hands to the
        // cradle (and a caught pass starts from where the ball was in the air) without lagging behind a running player.
        const prev = this._held ||= { id: -1, rel: new THREE.Vector3(), root: new THREE.Vector3(), from: new THREE.Vector3() };
        const rx = cp.px + (cp.x - cp.px) * alpha, rz = cp.pz + (cp.z - cp.pz) * alpha;
        const was = bm.position.clone();
        players.carryPoint(sim, b.carrier, alpha, bm.position, bm.quaternion);
        const rel = new THREE.Vector3(bm.position.x - rx, bm.position.y, bm.position.z - rz);
        if (prev.id !== b.carrier) prev.rel.set(was.x - rx, was.y, was.z - rz); // from wherever the ball was a frame ago
        if (prev.rel.distanceTo(rel) > 3) prev.rel.copy(rel); // a new play / a snap: no blend across the field
        // Follow the hands exactly while they move smoothly (a fast fall turns the body quickly); blend only a real jump
        // (a catch tucking to the cradle, a handoff, the QB's hands to the throwing hand).
        if (prev.rel.distanceTo(rel) < 0.12) prev.rel.copy(rel); else prev.rel.lerp(rel, 1 - Math.exp(-dt * 16));
        prev.id = b.carrier;
        bm.position.set(rx + prev.rel.x, Math.max(0.1, prev.rel.y), rz + prev.rel.z);
      }
    } else {
      if (this._held) this._held.id = -1;
      bm.position.set(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, b.pz + (b.z - b.pz) * alpha);
      // A pass on its way in: over the last 0.3 s it eases into the hands of whoever is reaching for it nearest its target
      // (the sim resolves the catch at the target spot, up to ~1.25 yd from the catcher, which made the ball jump to him).
      // After the resolution (a drop or a tip) the offset fades out instead of snapping back.
      const off = (this._ballOff ||= new THREE.Vector3());
      if (b.state === 'air' && b.target && !b.resolved && b.T - b.t < 0.3) {
        let best = -1, bd = 2.6;
        for (const p of sim.players) {
          if (!(p.anim === 'reach' || p.anim === 'swat' || p.anim === 'pick' || p.anim === 'catch')) continue;
          const d = Math.hypot(p.x - b.target.x, p.z - b.target.z) - (p.id === b.intended ? 0.4 : 0);
          if (d < bd && players.hands[p.id]) { bd = d; best = p.id; }
        }
        if (best >= 0) {
          const hs = players.hands[best];
          const k = 1 - Math.max(0, b.T - b.t) / 0.3, e = k * k * (3 - 2 * k);
          off.copy(hs[0]).add(hs[1]).multiplyScalar(0.5).sub(bm.position).multiplyScalar(e);
          if (off.length() > 2) off.setLength(2);
        } else off.multiplyScalar(Math.exp(-dt * 12));
      } else off.multiplyScalar(Math.exp(-dt * 12));
      if (b.state === 'air' || b.state === 'loose') bm.position.add(off); else off.set(0, 0, 0);
      if (b.state === 'loose') bm.rotation.set(b.tumble || 0, Math.atan2(-b.vz, b.vx), (b.tumble || 0) * 0.6, 'YZX'); // end over end
      else if (b.state === 'air' || b.state === 'snap') {
        // Point along the velocity with a spiral.
        const yaw = Math.atan2(-(b.vz), b.vx);
        const pitch = Math.atan2(b.vy, Math.hypot(b.vx, b.vz));
        bm.rotation.set(b.spin || 0, yaw, pitch, 'YZX');
      }
    }
    if (pr?.ballAt) bm.position.set(pr.ballAt.x, 0.12, pr.ballAt.z); // spotted for the next play
    this.ballShadow.position.x = bm.position.x;
    this.ballShadow.position.z = bm.position.z;
    this.ballShadow.visible = bm.position.y > 0.3;
    // Shadow camera follows the action. The key light comes from above and a little to one side of the camera (as a TV
    // broadcast lights the field), so the faces of the players the camera sees are lit and shaped instead of backlit.
    const cp = this.rig.camera.position, kx = cp.x - bm.position.x, kz = cp.z - bm.position.z, kd = Math.hypot(kx, kz) || 1;
    const ux = kx / kd, uz = kz / kd, ang = 0.6, ca = Math.cos(ang), sa = Math.sin(ang);
    this.key.position.set(bm.position.x + (ux * ca - uz * sa) * 38, 58, bm.position.z + (ux * sa + uz * ca) * 38);
    this.key.target.position.set(bm.position.x, 0, bm.position.z);
  }

  hidePlayers() {
    for (const m of Object.values(this.players.parts)) m.count = 0;
    this.players.ring.visible = false;
    this.players.ring2.visible = false;
    this.ball.visible = false;
    this.ballShadow.visible = false;
    this.aim.visible = false;
  }

  /** Aim arrow while the human sets up a kick. */
  setAim(sim) {
    const show = sim && sim.meter && sim.isKick && !(sim.kick && sim.kick.launched);
    this.aim.visible = !!show;
    if (!show) return;
    const b = sim.ball;
    let yaw;
    if (sim.offPlay.type === 'fg') yaw = Math.atan2((sim.kickAim || 0) * 6 - b.z, 60 * sim.dir - b.x);
    else yaw = Math.atan2((sim.kickAim || 0) * (sim.offPlay.type === 'punt' ? 14 : 18), sim.dir * 40);
    this.aim.position.set(b.x, 0.04, b.z);
    this.aim.rotation.y = -yaw;
  }

  showFlag(e) {
    if (!e || e.presnap) return;
    const sim = this._lastSim;
    const p = sim?.players.find((q) => q.team === e.team) || null;
    this.flag.position.set((p?.x ?? 0) + (Math.random() - 0.5) * 2, 0.03, (p?.z ?? 0) + (Math.random() - 0.5) * 2);
    this.flag.visible = true;
    this.flagT = 6;
  }

  /** Replay camera: orbit (yaw/pitch/dist) around a focus point that it eases toward. */
  renderReplay(dt, focus, yaw, pitch, dist, snap = false) {
    this.precip.update(dt, this.rig.camera.position);
    this.stadium.update(dt, 0.4);
    const cam = this.rig.camera;
    const f = this._replayFocus || (this._replayFocus = { x: focus.x, y: focus.y, z: focus.z });
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    f.x += (focus.x - f.x) * k; f.y += (focus.y - f.y) * k; f.z += (focus.z - f.z) * k;
    cam.position.set(f.x + Math.cos(yaw) * Math.cos(pitch) * dist, f.y + Math.sin(pitch) * dist, f.z + Math.sin(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(f.x, f.y, f.z);
    this.draw(cam);
  }

  /** A scripted camera shot (pregame intro): pos/look arrays. Also parks the game camera there for a smooth hand-off. */
  renderShot(dt, pos, look, excitement = 0.5) {
    this.precip.update(dt, this.rig.camera.position);
    this.stadium.update(dt, excitement);
    const cam = this.rig.camera;
    cam.position.set(...pos);
    cam.lookAt(...look);
    this.rig.pos.copy(cam.position);
    this.rig.look.set(...look);
    this.draw(cam);
  }

  /** Slow orbit over the empty stadium for menus. */
  renderOrbit(dt, t) {
    this.precip.update(dt, this.rig.camera.position);
    this.stadium.update(dt, 0.2);
    const cam = this.rig.camera;
    cam.position.set(Math.cos(t) * 70, 28, Math.sin(t) * 45);
    cam.lookAt(0, 0, 0);
    this.draw(cam);
  }

  render(dt, focus, dir, phase, snap, excitement = 0.2) {
    this.precip.update(dt, this.rig.camera.position);
    if (this.flagT > 0 && (this.flagT -= dt) <= 0) this.flag.visible = false;
    this.stadium.update(dt, excitement);
    this.rig.update(dt, focus, dir, phase, snap, { shot: this.presentation.celebration() });
    this.draw(this.rig.camera);
  }

  /** Project a world point to screen pixels (for DOM overlays like receiver icons). */
  project(x, y, z) {
    const v = this._v.set(x, y, z).project(this.rig.camera);
    return { x: (v.x * 0.5 + 0.5) * this.container.clientWidth, y: (-v.y * 0.5 + 0.5) * this.container.clientHeight, visible: v.z < 1 };
  }
}
