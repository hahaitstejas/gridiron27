import * as THREE from 'three';

// Rain and snow: one draw call each. Particles live in a box that follows the camera's focus; the vertex
// shader moves them (fall + wind drift, wrapped inside the box), so there's no per-frame CPU work.
const BOX = { x: 70, y: 30, z: 50 };

const VERT = `
uniform float uTime; uniform vec3 uCenter; uniform vec2 uWind; uniform float uFall; uniform float uSize; uniform float uStreak;
attribute float aEnd; attribute float aSeed;
varying float vA; varying float vS;
void main() {
  vec3 p = position;
  // Fall and drift, wrapped into the box around the center.
  float t = uTime * (0.8 + 0.4 * aSeed);
  p.y = mod(p.y - t * uFall, ${BOX.y.toFixed(1)});
  p.x = mod(p.x + t * uWind.x + sin(t * 1.3 + aSeed * 40.0) * uSize * 2.0 - uCenter.x + ${(BOX.x / 2).toFixed(1)}, ${BOX.x.toFixed(1)}) - ${(BOX.x / 2).toFixed(1)} + uCenter.x;
  p.z = mod(p.z + t * uWind.y + cos(t * 1.1 + aSeed * 30.0) * uSize * 2.0 - uCenter.z + ${(BOX.z / 2).toFixed(1)}, ${BOX.z.toFixed(1)}) - ${(BOX.z / 2).toFixed(1)} + uCenter.z;
  // Rain streaks: the second vertex of each segment trails along the velocity.
  p += aEnd * uStreak * normalize(vec3(uWind.x, -uFall, uWind.y));
  vA = 1.0 - aEnd * 0.7;
  vS = aSeed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * 300.0 / -mv.z;
}`;

const FRAG_RAIN = `uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, 0.35 * vA); }`;
// Autumn leaves (Thanksgiving games): flat, tumbling flecks in orange / red / brown / gold.
const FRAG_LEAF = `varying float vS; void main() { vec2 c = gl_PointCoord - 0.5; c = vec2(c.x * 1.8, c.y); float d = dot(c, c); if (d > 0.25) discard;
  vec3 col = vS < 0.3 ? vec3(0.85, 0.36, 0.08) : vS < 0.55 ? vec3(0.72, 0.16, 0.08) : vS < 0.8 ? vec3(0.5, 0.3, 0.12) : vec3(0.9, 0.66, 0.16);
  gl_FragColor = vec4(col, 0.95); }`;
const FRAG_SNOW = `uniform vec3 uColor; void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(uColor, 0.9 * (1.0 - d * 4.0)); }`;

function particles(count, segments, seed) {
  // Deterministic layout (cosmetic, but keeps screenshots stable).
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const per = segments ? 2 : 1;
  const pos = new Float32Array(count * per * 3), end = new Float32Array(count * per), sd = new Float32Array(count * per);
  for (let i = 0; i < count; i++) {
    const x = (rnd() - 0.5) * BOX.x, y = rnd() * BOX.y, z = (rnd() - 0.5) * BOX.z, r = rnd();
    for (let k = 0; k < per; k++) {
      const j = i * per + k;
      pos.set([x, y, z], j * 3);
      end[j] = k;
      sd[j] = r;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); // moved in the shader: never cull
  return g;
}

export class Precipitation {
  constructor(scene) {
    const uniforms = () => ({
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() },
      uFall: { value: 20 }, uSize: { value: 0.05 }, uStreak: { value: 0.9 }, uColor: { value: new THREE.Color(0xaabbcc) },
    });
    this.rain = new THREE.LineSegments(particles(5000, true, 7), new THREE.ShaderMaterial({ uniforms: uniforms(), vertexShader: VERT, fragmentShader: FRAG_RAIN, transparent: true, depthWrite: false }));
    const su = uniforms();
    su.uFall.value = 2.2; su.uSize.value = 0.16; su.uStreak.value = 0; su.uColor.value.set(0xffffff);
    this.snow = new THREE.Points(particles(5000, false, 11), new THREE.ShaderMaterial({ uniforms: su, vertexShader: VERT, fragmentShader: FRAG_SNOW, transparent: true, depthWrite: false }));
    const lu = uniforms();
    lu.uFall.value = 1.3; lu.uSize.value = 0.34; lu.uStreak.value = 0;
    this.leaves = new THREE.Points(particles(900, false, 17), new THREE.ShaderMaterial({ uniforms: lu, vertexShader: VERT, fragmentShader: FRAG_LEAF, transparent: true, depthWrite: false }));
    this.rain.visible = this.snow.visible = this.leaves.visible = false;
    this.rain.frustumCulled = this.snow.frustumCulled = this.leaves.frustumCulled = false;
    scene.add(this.rain, this.snow, this.leaves);
    this.time = 0;
  }

  set(type, wind, holiday = null) {
    this.rain.visible = type === 'rain';
    // Christmas games get a few flurries even on a clear night; Thanksgiving gets falling leaves.
    this.snow.visible = type === 'snow' || holiday === 'christmas';
    this.snow.geometry.setDrawRange(0, type === 'snow' ? Infinity : 900);
    this.leaves.visible = holiday === 'thanksgiving' && type !== 'snow';
    for (const m of [this.rain, this.snow, this.leaves]) m.material.uniforms.uWind.value.set(wind?.x || 0, wind?.z || 0).multiplyScalar(m === this.rain ? 0.4 : 0.6);
  }

  update(dt, center) {
    this.time += dt;
    for (const m of [this.rain, this.snow, this.leaves]) {
      if (!m.visible) continue;
      m.material.uniforms.uTime.value = this.time;
      m.material.uniforms.uCenter.value.set(center.x, 0, center.z);
      m.position.set(0, 0, 0);
    }
  }
}
