import * as THREE from 'three';

// Camera rig with smoothed follow. Modes: broadcast (behind the offense), endzone, sky, follow.
export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.3, 2500);
    this.mode = 'broadcast';
    this.pos = new THREE.Vector3(-40, 9, 0);
    this.look = new THREE.Vector3(-25, 0, 0);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this.shake = 0;
  }

  /**
   * focus: {x, y, z} point to follow (ball). dir: +1/-1 direction the camera faces along x.
   * phase: 'presnap' | 'live' | 'air' | 'dead'. snap = true teleports.
   */
  update(dt, focus, dir, phase, snap = false, extra = {}) {
    const p = this._p, l = this._l;
    const fz = focus.z;
    switch (this.mode) {
      case 'endzone':
        p.set(focus.x - dir * 30, 14, fz * 0.3);
        l.set(focus.x + dir * 5, 0, fz * 0.8);
        break;
      case 'sky':
        p.set(focus.x - dir * 6, 42, fz);
        l.set(focus.x + dir * 3, 0, fz);
        break;
      case 'follow':
        p.set(focus.x - dir * 7, 3.2, fz + (extra.side ?? 3));
        l.set(focus.x + dir * 4, 1, fz);
        break;
      default: {
        // Broadcast: high behind the offense, pulling back when the ball is in the air.
        const back = phase === 'presnap' ? 15 : phase === 'air' ? 18 : 15;
        const height = phase === 'presnap' ? 7.2 : phase === 'air' ? 9.5 : 7.8;
        p.set(focus.x - dir * back, height, fz * 0.85);
        l.set(focus.x + dir * (phase === 'presnap' ? 8 : 6), 0.5, fz * 0.95);
      }
    }
    if (snap) {
      this.pos.copy(p);
      this.look.copy(l);
    } else {
      const k = 1 - Math.exp(-dt * (phase === 'presnap' ? 3 : 4.2));
      const kl = 1 - Math.exp(-dt * 6);
      this.pos.lerp(p, k);
      this.look.lerp(l, kl);
    }
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.look);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
