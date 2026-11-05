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
    this.zoom = 1; // broadcast distance/height scale (settings: wide / tight)
  }

  /**
   * focus: {x, y, z} point to follow (ball). dir: +1/-1 direction the camera faces along x.
   * phase: 'presnap' | 'live' | 'air' | 'dead'. snap = true teleports.
   */
  update(dt, focus, dir, phase, snap = false, extra = {}) {
    const p = this._p, l = this._l;
    const fz = focus.z;
    // A presentation shot (touchdown celebration) overrides the mode: low, in front of the subject.
    const shot = extra.shot;
    if (this.debug) { p.set(...this.debug.p); l.set(...this.debug.l); } // dev screenshots (window.__g27.renderer.rig.debug)
    else if (shot) {
      const fx = Math.cos(shot.facing), fz2 = Math.sin(shot.facing);
      p.set(shot.x + fx * 8 + fz2 * 2.5, 4.2, shot.z + fz2 * 8 - fx * 2.5);
      l.set(shot.x, 1.1, shot.z);
    } else switch (this.mode) {
      case 'endzone':
        p.set(focus.x - dir * 30, 14, fz * 0.3);
        l.set(focus.x + dir * 5, 0, fz * 0.8);
        break;
      case 'all22':
        // Coaches' film: high above the back of the play, wide enough for all 22 (and the deep safeties).
        p.set(focus.x - dir * 26, 30, fz * 0.2);
        l.set(focus.x + dir * (phase === 'air' ? 16 : 10), 0, fz * 0.4);
        break;
      case 'skycam':
        // The cable-suspended camera right behind the offense, a little above helmet height... and following the ball.
        p.set(focus.x - dir * (phase === 'air' ? 11 : 8.5), phase === 'air' ? 9 : 6.2, fz * 0.95);
        l.set(focus.x + dir * 9, 1.2, fz);
        break;
      case 'cable': {
        // Sideline cable cam: low on the near sideline, moving with the ball (classic side-on TV view, pulled in).
        const side = extra.sideline ?? -1;
        p.set(focus.x - dir * 4, 6.5, side * 36);
        l.set(focus.x + dir * 2, 0.5, fz * 0.6);
        break;
      }
      case 'sky':
        p.set(focus.x - dir * 6, 42, fz);
        l.set(focus.x + dir * 3, 0, fz);
        break;
      case 'art':
        // Play art (hold RT at the line): pulled up and back so every route and the whole defense is in view.
        p.set(focus.x - dir * 24, 34, fz * 0.5);
        l.set(focus.x + dir * 11, 0, fz * 0.6);
        break;
      case 'follow':
        p.set(focus.x - dir * 7, 3.2, fz + (extra.side ?? 3));
        l.set(focus.x + dir * 4, 1, fz);
        break;
      default: {
        // Broadcast: high behind the offense, pulling back when the ball is in the air.
        // Low and tight like a TV game: just above helmet height behind the quarterback at the line, easing up and
        // back once the ball is snapped and further when it's thrown deep.
        let back = phase === 'presnap' ? 10.5 : phase === 'kick' ? 34 : phase === 'return' ? 20 : phase === 'air' ? 15 : 12;
        let height = phase === 'presnap' ? 4.6 : phase === 'kick' ? 24 : phase === 'return' ? 11 : phase === 'air' ? 7.2 : 5.6;
        // A human on offense or defense needs the whole formation (backfield included) in frame: further back and higher.
        if (this.wideView && (phase === 'presnap' || phase === 'live')) { back = phase === 'presnap' ? 20 : 17; height = phase === 'presnap' ? 9.5 : 8.5; }
        p.set(focus.x - dir * back * this.zoom, height * this.zoom, fz * 0.85);
        l.set(focus.x + dir * (phase === 'presnap' ? 7 : 6), phase === 'presnap' ? 1.1 : 0.8, fz * 0.95);
      }
    }
    if (snap) {
      this.pos.copy(p);
      this.look.copy(l);
    } else {
      const k = 1 - Math.exp(-dt * (shot ? 2.2 : phase === 'presnap' ? 3 : 4.2));
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
