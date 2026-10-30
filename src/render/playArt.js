import * as THREE from 'three';

/**
 * Play art painted on the turf (game/playArt.js shapes): flat ribbons with arrowheads and translucent zone
 * ellipses, all in one mesh with RGBA vertex colors (one draw call). Rebuilt a few times a second while shown,
 * so receivers in motion drag their routes along.
 */
export class PlayArtOverlay {
  constructor(scene) {
    this.geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.position.y = 0.03;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.t = 0;
    this.fade = 0;
  }

  /** art = playArt() shapes or null to hide. Fades in/out. */
  update(art, dt) {
    this.fade = Math.max(0, Math.min(1, this.fade + (art ? dt : -dt) * 6));
    this.mesh.visible = this.fade > 0.01;
    this.mesh.material.opacity = this.fade;
    if (!art) return;
    this.t -= dt;
    if (this.t > 0 && this.built) return;
    this.t = 0.12;
    this.build(art);
  }

  build(art) {
    const pos = [], col = [];
    const c = new THREE.Color();
    const tri = (a, b, d, color, alpha) => {
      for (const p of [a, b, d]) { pos.push(p.x, 0, p.z); col.push(color.r, color.g, color.b, alpha); }
    };
    const quad = (a, b, d, e, color, alpha) => { tri(a, b, d, color, alpha); tri(a, d, e, color, alpha); };
    const seg = (p, q, w, color, alpha) => {
      const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * w * 0.5, nz = (dx / l) * w * 0.5;
      quad({ x: p.x + nx, z: p.z + nz }, { x: q.x + nx, z: q.z + nz }, { x: q.x - nx, z: q.z - nz }, { x: p.x - nx, z: p.z - nz }, color, alpha);
    };
    for (const z of art.zones) {
      c.set(z.color);
      const N = 28;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
        const p0 = { x: z.x + Math.cos(a0) * z.rx, z: z.z + Math.sin(a0) * z.rz };
        const p1 = { x: z.x + Math.cos(a1) * z.rx, z: z.z + Math.sin(a1) * z.rz };
        tri({ x: z.x, z: z.z }, p0, p1, c, 0.22);
        seg(p0, p1, 0.14, c, 0.75);
      }
    }
    for (const L of art.lines) {
      c.set(L.color);
      const w = L.width || 0.25;
      const pts = L.pts;
      // Leave room for the arrowhead at the end.
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const hl = L.head ? Math.min(w * 3.2, Math.hypot(last.x - prev.x, last.z - prev.z) * 0.8) : 0;
      for (let i = 1; i < pts.length; i++) {
        let p = pts[i - 1], q = pts[i];
        if (i === pts.length - 1 && hl) {
          const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
          q = { x: q.x - (dx / l) * hl, z: q.z - (dz / l) * hl };
        }
        if (L.dashed) {
          const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz);
          for (let s = 0; s < l; s += 1.4) {
            const e = Math.min(l, s + 0.8);
            seg({ x: p.x + (dx / l) * s, z: p.z + (dz / l) * s }, { x: p.x + (dx / l) * e, z: p.z + (dz / l) * e }, w, c, 0.9);
          }
        } else {
          seg(p, q, w, c, 0.9);
          // Round-ish joints: a small square at each bend so ribbons don't show gaps.
          if (i < pts.length - 1) seg({ x: q.x - w * 0.25, z: q.z }, { x: q.x + w * 0.25, z: q.z }, w, c, 0.9);
        }
      }
      if (L.head) {
        const dx = last.x - prev.x, dz = last.z - prev.z, l = Math.hypot(dx, dz) || 1;
        const ux = dx / l, uz = dz / l, hw = w * 1.6;
        const base = { x: last.x - ux * hl, z: last.z - uz * hl };
        tri(last, { x: base.x - uz * hw, z: base.z + ux * hw }, { x: base.x + uz * hw, z: base.z - ux * hw }, c, 0.95);
      }
    }
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    this.geo.computeBoundingSphere();
    this.built = true;
  }
}
