import * as THREE from 'three';
import { GOAL_X, HALF_WIDTH } from '../core/constants.js';
import { kickRange, LANDING_ZONE } from '../sim/kicking.js';

// Kick aiming on the field (render only, the user's reference video / picture):
// - field goals / PATs: a tall thin glowing green beam standing at the uprights where the kick is aimed (left stick moves it);
// - kickoffs: the landing zone as a neon green rectangle on the turf (the receiving goal line to the 20, sideline to sideline),
//   plus a target ring where the kick will come down at the current power and aim;
// - punts: just the target ring.
const NEON = 0x12f04a;

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
    // Landing zone (the user's landingzone.jpeg): a neon band with "LANDING ZONE" in black block letters across each end of the zone
    // (at the goal line and at the 20), thin neon lines up the sidelines, no fill. The text reads from the receiving end zone.
    const neon = new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const c = document.createElement('canvas'); c.width = 2048; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#12f04a'; x.fillRect(0, 0, 2048, 96);
    x.fillStyle = '#04140a'; x.font = '900 70px "Oswald", "Saira Condensed", "Arial Black", sans-serif'; x.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) { x.save(); x.translate(k * 683 + 340, 52); x.scale(1.25, 1); x.textAlign = 'center'; x.fillText('LANDING ZONE', 0, 0); x.restore(); }
    const bt = new THREE.CanvasTexture(c); bt.colorSpace = THREE.SRGBColorSpace; bt.anisotropy = 8;
    const bandMat = new THREE.MeshBasicMaterial({ map: bt, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const band = () => { const g = new THREE.PlaneGeometry(HALF_WIDTH * 2, 2.6); g.rotateX(-Math.PI / 2); return new THREE.Mesh(g, bandMat); };
    const flat = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.zone = new THREE.Group();
    this.bands = [band(), band()];
    this.sides = [new THREE.Mesh(flat(), neon), new THREE.Mesh(flat(), neon)];
    this.zone.add(...this.bands, ...this.sides);
    for (const m of [...this.bands, ...this.sides]) m.renderOrder = 2;
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

  /** Per frame (sim = null hides it). The aim marks are for the human kicker before the kick; the landing zone shows on every
   *  kickoff in a game with a human (kicking or returning) until the ball comes down. */
  update(sim, t) {
    const type = sim?.offPlay?.type;
    const fgLook = type === 'fg' || sim?.offPlay?.fake === 'fg';
    const aiming = !!sim && ((sim.meter && sim.isKick && !(sim.kick && sim.kick.launched)) || !!sim.fakeLook);
    const zoneOn = !!sim && type === 'kickoff' && sim.offPlay.kick !== 'onside' && (sim.humanTeams?.length || sim.humanTeam != null)
      && sim.state !== 'dead' && sim.state !== 'finished' && (!sim.kick?.launched || sim.ball.state === 'kick');
    this.group.visible = aiming || zoneOn;
    if (!this.group.visible) return;
    const b = sim.ball, dir = sim.dir, aim = sim.kickAim || 0;
    this.beam.visible = aiming && fgLook;
    this.zone.visible = zoneOn;
    this.ring.visible = aiming && !fgLook && sim.offPlay.kick !== 'onside';
    if (this.beam.visible) { this.beam.position.set((GOAL_X + 10) * dir, 0, aim * 6); return; }
    if (zoneOn) {
      // Receiving goal line to the receiving 20 (LANDING_ZONE): a band inside each end, sideline lines between them.
      const x0 = GOAL_X * dir, x1 = (GOAL_X - LANDING_ZONE) * dir, cx = (x0 + x1) / 2, w = Math.abs(x1 - x0), e = 0.45;
      const [near, far] = this.bands;
      near.position.set(x0 - dir * 1.3, 0.04, 0); far.position.set(x1 + dir * 1.3, 0.04, 0);
      // Text reads from the receiving end zone looking upfield (toward the kicker).
      for (const m of this.bands) m.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      const [l, r] = this.sides;
      l.position.set(cx, 0.04, -HALF_WIDTH + e / 2); l.scale.set(w, 1, e);
      r.position.set(cx, 0.04, HALF_WIDTH - e / 2); r.scale.set(w, 1, e);
    }
    if (!this.ring.visible) return;
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
