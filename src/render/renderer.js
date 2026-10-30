import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildStadium } from './stadium.js';
import { PlayerRenderer } from './players.js';
import { CameraRig } from './camera.js';
import { FieldLines } from './lines.js';
import { Precipitation } from './weather.js';
import { Presentation } from './presentation.js';

// Lighting and sky by time of day (sky colors are linear RGB top / middle / horizon).
const TIME_LOOKS = {
  day: { hemi: [0xdfeaff, 0x3a4a2a, 1.5], key: [0xfff2dc, 3.0], rim: [0xffffff, 0.4], fog: [0xa9c4e0, 220, 640], sky: [[0.18, 0.38, 0.78], [0.42, 0.62, 0.9], [0.78, 0.84, 0.9]], lamps: 0x9a9a9a, exposure: 0.95, grey: 1 },
  dusk: { hemi: [0xffc9a8, 0x2a2a20, 1.2], key: [0xffb070, 2.6], rim: [0x8899ff, 0.6], fog: [0x4a3a50, 170, 460], sky: [[0.08, 0.1, 0.28], [0.45, 0.28, 0.4], [0.98, 0.55, 0.3]], lamps: 0xfff6dd, exposure: 1.05, grey: 0.5 },
  night: { hemi: [0xb8c8ff, 0x203018, 1.1], key: [0xfff4e0, 2.4], rim: [0xaabbff, 0.6], fog: [0x0b1020, 160, 420], sky: [[0.015, 0.03, 0.08], [0.06, 0.09, 0.2], [0.22, 0.2, 0.3]], lamps: 0xfff6dd, exposure: 1.05, grey: 0.15 },
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
    r.shadowMap.type = THREE.PCFShadowMap;
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
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 10; sc.far = 140;
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

    this.rig = new CameraRig(container.clientWidth / container.clientHeight);
    this.container = container;
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
    this.stadium.snow.visible = c.type === 'snow';
    this.renderer.toneMappingExposure = look.exposure;
    this.precip.set(c.type, c.wind);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.rig.resize(w / h);
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
    players.update(sim, alpha, time, sim.humanTeams?.length ? sim.humanTeams.map((t) => sim.controlled[t] ?? -1) : sim.humanTeam !== null ? sim.controlledId : -1, pr?.refs || null);
    // Ball
    const b = sim.ball;
    const bm = this.ball;
    if ((b.state === 'held' || b.state === 'presnap') && b.carrier >= 0) {
      const cp = sim.players[b.carrier];
      if (b.state === 'presnap') bm.position.set(b.x, 0.12, b.z);
      // Going down: draw the ball exactly where the sim spots it.
      else if (cp.state === 'tackled' || cp.state === 'down') bm.position.set(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, b.pz + (b.z - b.pz) * alpha);
      else players.carryPoint(sim, b.carrier, alpha, bm.position);
      const c = sim.players[b.carrier];
      bm.rotation.set(0, Math.PI / 2 - c.facing + Math.PI / 2, b.state === 'presnap' ? 0 : 0.5);
    } else {
      bm.position.set(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, b.pz + (b.z - b.pz) * alpha);
      if (b.state === 'air' || b.state === 'snap') {
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
    // Shadow camera follows the action.
    this.key.position.set(bm.position.x - 25, 60, bm.position.z + 30);
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
    this.renderer.render(this.scene, cam);
  }

  /** Slow orbit over the empty stadium for menus. */
  renderOrbit(dt, t) {
    this.precip.update(dt, this.rig.camera.position);
    this.stadium.update(dt, 0.2);
    const cam = this.rig.camera;
    cam.position.set(Math.cos(t) * 70, 28, Math.sin(t) * 45);
    cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, cam);
  }

  render(dt, focus, dir, phase, snap, excitement = 0.2) {
    this.precip.update(dt, this.rig.camera.position);
    if (this.flagT > 0 && (this.flagT -= dt) <= 0) this.flag.visible = false;
    this.stadium.update(dt, excitement);
    this.rig.update(dt, focus, dir, phase, snap);
    this.renderer.render(this.scene, this.rig.camera);
  }

  /** Project a world point to screen pixels (for DOM overlays like receiver icons). */
  project(x, y, z) {
    const v = this._v.set(x, y, z).project(this.rig.camera);
    return { x: (v.x * 0.5 + 0.5) * this.container.clientWidth, y: (-v.y * 0.5 + 0.5) * this.container.clientHeight, visible: v.z < 1 };
  }
}
