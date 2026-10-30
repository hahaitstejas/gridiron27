import * as THREE from 'three';
import { HALF_WIDTH } from '../core/constants.js';

/** Line of scrimmage (blue) and first-down line (yellow) painted on the field. */
export class FieldLines {
  constructor(scene) {
    const mk = (color) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, HALF_WIDTH * 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.015;
      m.renderOrder = 1;
      scene.add(m);
      return m;
    };
    this.los = mk(0x2a7bff);
    this.first = mk(0xffd400);
    this.chains = makeChains(scene);
  }
  /** down (1-4) shows on the chain crew's down marker; the chains follow the lines on the near-home sideline. */
  set(losX, firstX, down = null) {
    this.los.position.x = losX;
    this.los.visible = losX !== null;
    this.first.visible = firstX !== null && Math.abs(firstX) < 50;
    if (firstX !== null) this.first.position.x = firstX;
    const c = this.chains;
    c.group.visible = losX !== null && firstX !== null && Math.abs(firstX) < 50;
    if (!c.group.visible) return;
    // Ease along like a real crew walking (and never teleport across the field between plays).
    c.lx += (losX - c.lx) * 0.08; c.fx += (firstX - c.fx) * 0.08;
    if (Math.abs(losX - c.lx) > 30) { c.lx = losX; c.fx = firstX; }
    c.back.position.x = c.lx; c.front.position.x = c.fx; c.box.position.x = c.lx;
    c.chain.position.x = (c.lx + c.fx) / 2; c.chain.scale.x = Math.max(0.1, Math.abs(c.fx - c.lx));
    if (down && down !== c.down) { c.down = down; c.paint(down); }
  }
}

const CHAIN_Z = -(HALF_WIDTH + 2.2);

/** The chain crew's gear: two orange poles joined by a chain, and the down marker with its flip card. */
function makeChains(scene) {
  const group = new THREE.Group();
  const orange = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
  const black = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const pole = () => {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), black); stick.position.y = 1.3;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.5), orange); top.position.y = 2.75;
    g.add(stick, top); g.position.z = CHAIN_Z;
    group.add(g);
    return g;
  };
  const back = pole(), front = pole();
  const chain = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.03), black);
  chain.position.set(0, 0.35, CHAIN_Z); group.add(chain);
  // Down marker: a pole with a box carrying the number on both faces.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const paint = (d) => {
    const g = canvas.getContext('2d');
    g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#111'; g.font = '800 52px "Saira Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(d), 32, 35);
    tex.needsUpdate = true;
  };
  const box = new THREE.Group();
  const bstick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), black); bstick.position.y = 1.3;
  // The big faces point along the field (toward both end zones), where the broadcast camera sits.
  const num = new THREE.MeshLambertMaterial({ map: tex });
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), [num, num, orange, orange, orange, orange]);
  card.position.y = 2.75;
  box.add(bstick, card); box.position.z = CHAIN_Z - 1.2;
  group.add(box);
  group.visible = false;
  scene.add(group);
  return { group, back, front, chain, box, paint, down: 0, lx: 0, fx: 10 };
}
