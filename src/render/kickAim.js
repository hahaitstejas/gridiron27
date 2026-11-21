import * as THREE from 'three';
import { GOAL_X, HALF_WIDTH } from '../core/constants.js';
import { kickRange, LANDING_ZONE } from '../sim/kicking.js';

// Kick aiming on the field (render only, the user's reference video / picture):
// - field goals / PATs: a tall thin glowing green beam standing at the uprights where the kick is aimed (left stick moves it);
// - kickoffs: the landing zone as a neon green rectangle on the turf (the receiving goal line to the 20, sideline to sideline),
//   plus a target ring where the kick will come down at the current power and aim;
// - punts: just the target ring.
const NEON = 0x46ff78;

export class KickAim {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    // Beam: two crossed planes with a soft vertical / edge fade (additive, unlit, no fog so it reads at 50+ yds).
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(NEON) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uColor; varying vec2 vUv; void main(){
        float edge = 1.0 - abs(vUv.x - 0.5) * 2.0; float core = pow(edge, 6.0);
        float fade = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
        gl_FragColor = vec4(uColor * (0.35 * edge + 1.2 * core), fade * (0.25 * edge + 0.75 * core)); }`,
    });
    const g = new THREE.PlaneGeometry(0.55, 40); g.translate(0, 20, 0);
    const g2 = g.clone().rotateY(Math.PI / 2);
    this.beam = new THREE.Group();
    this.beam.add(new THREE.Mesh(g, beamMat), new THREE.Mesh(g2, beamMat));
    this.group.add(this.beam);
    // Landing zone: a translucent neon fill with solid neon edges (separate bars so they stay bright and even at any distance).
    const neon = new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const fill = new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const flat = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.zone = new THREE.Group();
    this.zoneFill = new THREE.Mesh(flat(), fill);
    this.zoneBars = [0, 1, 2, 3].map(() => new THREE.Mesh(flat(), neon));
    // A low glowing curtain standing on the front edge: a flat band 60+ yds away is a couple of pixels, this reads from the tee.
    const curtain = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(NEON) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.0); gl_FragColor = vec4(uColor * 1.6, a); }',
    });
    const cg = new THREE.PlaneGeometry(1, 1.6); cg.translate(0, 0.8, 0); cg.rotateY(Math.PI / 2);
    this.curtain = new THREE.Mesh(cg, curtain);
    this.zone.add(this.zoneFill, ...this.zoneBars, this.curtain);
    for (const m of [this.zoneFill, ...this.zoneBars]) m.renderOrder = 2;
    this.group.add(this.zone);
    // Target ring with four chevrons pointing in.
    const r = document.createElement('canvas'); r.width = r.height = 128;
    const y = r.getContext('2d');
    y.strokeStyle = '#39ff6a'; y.lineWidth = 7; y.beginPath(); y.arc(64, 64, 40, 0, Math.PI * 2); y.stroke();
    y.fillStyle = '#39ff6a';
    for (let k = 0; k < 4; k++) { y.save(); y.translate(64, 64); y.rotate((k * Math.PI) / 2); y.beginPath(); y.moveTo(0, -46); y.lineTo(-11, -62); y.lineTo(11, -62); y.closePath(); y.fill(); y.restore(); }
    y.beginPath(); y.arc(64, 64, 6, 0, Math.PI * 2); y.fill();
    const rt = new THREE.CanvasTexture(r); rt.colorSpace = THREE.SRGBColorSpace;
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 6.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: rt, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    this.ring.renderOrder = 3;
    this.group.add(this.ring);
  }

  /** Per frame: show / place for the human's kick at the line (sim = null hides it). */
  update(sim, t) {
    const type = sim?.offPlay?.type;
    const fgLook = type === 'fg' || sim?.offPlay?.fake === 'fg';
    const show = sim && ((sim.meter && sim.isKick && !(sim.kick && sim.kick.launched)) || sim.fakeLook);
    this.group.visible = !!show;
    if (!show) return;
    const b = sim.ball, dir = sim.dir, aim = sim.kickAim || 0;
    this.beam.visible = fgLook;
    this.zone.visible = type === 'kickoff' && sim.offPlay.kick !== 'onside';
    this.ring.visible = !fgLook && sim.offPlay.kick !== 'onside';
    if (fgLook) { this.beam.position.set((GOAL_X + 10) * dir, 0, aim * 6); return; }
    if (this.zone.visible) {
      // Receiving goal line to the receiving 20 (LANDING_ZONE), sideline to sideline.
      const x0 = GOAL_X * dir, x1 = (GOAL_X - LANDING_ZONE) * dir, cx = (x0 + x1) / 2, w = Math.abs(x1 - x0), d = HALF_WIDTH * 2, e = 1.1;
      this.zoneFill.position.set(cx, 0.035, 0); this.zoneFill.scale.set(w, 1, d);
      const [f, bk, l, r] = this.zoneBars;
      f.position.set(x1, 0.04, 0); f.scale.set(e, 1, d); // front edge (the 20): the line that reads from the kicker
      this.curtain.position.set(x1, 0, 0); this.curtain.scale.set(1, 1, d);
      bk.position.set(x0, 0.04, 0); bk.scale.set(e, 1, d);
      l.position.set(cx, 0.04, -HALF_WIDTH + e / 2); l.scale.set(w, 1, e);
      r.position.set(cx, 0.04, HALF_WIDTH - e / 2); r.scale.set(w, 1, e);
    }
    // Where it comes down: the power being set (or a full kick before the meter starts), aimed like launchKick.
    const kicker = sim.kick ? sim.players[sim.kick.kickerId] : sim.players.find((p) => p.team === sim.offIdx && (p.slot === 'K' || p.slot === 'P'));
    const kpw = kicker?.r?.kickPower ?? 80; // raw rating (the replay ghost has no R()); close enough for a marker
    const m = sim.meter;
    const power = m ? (m.phase === 'power' ? m.value : m.phase === 'idle' ? 1 : m.power) : 1;
    const kind = type === 'punt' ? 'punt' : sim.offPlay.kick || 'deep';
    const R = kickRange(kind, kpw, Math.max(0.45, power));
    const lx = Math.min(GOAL_X + 9, (b.x * dir) + R) * dir;
    const lz = Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, b.z + aim * (type === 'punt' ? 14 : 18)));
    this.ring.position.set(lx, 0.04, lz);
    const s = 1 + Math.sin(t * 6) * 0.06;
    this.ring.scale.set(s, 1, s);
  }
}
