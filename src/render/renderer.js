import * as THREE from 'three';
import { buildStadium } from './stadium.js';
import { PlayerRenderer } from './players.js';
import { CameraRig } from './camera.js';
import { FieldLines } from './lines.js';

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
    scene.fog = new THREE.Fog(0x0b1020, 160, 420);
    this.scene = scene;

    // Night game lighting: cool sky fill + strong key light from the stadium lights.
    scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x203018, 1.1));
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

    this.stadium = buildStadium(r, home, away);
    scene.add(this.stadium.group);
    this.players = new PlayerRenderer(scene);
    this.lines = new FieldLines(scene);

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

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.rig.resize(w / h);
  }

  setTeams(home, away) { this.stadium.setTeams(home, away); }

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
  drawSim(sim, alpha, time) {
    const players = this.players;
    this._lastSim = sim;
    this.ball.visible = true;
    players.update(sim, alpha, time, sim.humanTeam !== null ? sim.controlledId : -1);
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
    this.stadium.update(dt, 0.2);
    const cam = this.rig.camera;
    cam.position.set(Math.cos(t) * 70, 28, Math.sin(t) * 45);
    cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, cam);
  }

  render(dt, focus, dir, phase, snap, excitement = 0.2) {
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
