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
  }
  set(losX, firstX) {
    this.los.position.x = losX;
    this.los.visible = losX !== null;
    this.first.visible = firstX !== null && Math.abs(firstX) < 50;
    if (firstX !== null) this.first.position.x = firstX;
  }
}
