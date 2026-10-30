import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF_WIDTH } from '../core/constants.js';
import { makeFieldCanvas, FX, FZ } from './fieldTexture.js';
import { drawLogo } from './logo.js';

const WALL_Z = 36; // stands start this far from the center line (sidelines)
const WALL_X = 72; // and this far behind each end line
const ROWS = 34;
const ROW_DEPTH = 0.95;
const ROW_RISE = 0.55;
const WALL_H = 2.6;

/** Builds the static stadium. Returns { group, update(dt, excitement), setTeams(home, away) }. */
/** 256 px tile of grass blades for the field's detail layer (grey: multiplies the painted turf). */
function grassDetailCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * 256, y = rnd() * 256, l = 2 + rnd() * 5, a = rnd() * Math.PI * 2;
    const v = Math.floor(70 + rnd() * 120);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 0.6 + rnd() * 0.8;
    // Blades that cross an edge are drawn again on the other side, so the tile repeats seamlessly.
    for (const ox of x > 248 ? [0, -256] : [0]) for (const oy of y > 248 ? [0, -256] : [0]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
    }
  }
  return c;
}

export function buildStadium(renderer, home, away) {
  const group = new THREE.Group();

  // Sky dome: a three-stop gradient (colors set by time of day / weather, see GameRenderer.setConditions).
  const skyUniforms = {
    uTop: { value: new THREE.Color(0.015, 0.03, 0.08) },
    uMid: { value: new THREE.Color(0.06, 0.09, 0.2) },
    uHor: { value: new THREE.Color(0.22, 0.2, 0.3) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; varying vec3 vP; void main(){
        float h = normalize(vP).y;
        vec3 top = uTop, mid = uMid, hor = uHor;
        vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(hor, mid, smoothstep(-0.05, 0.08, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  );
  group.add(sky);

  // Ground outside the field.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), new THREE.MeshLambertMaterial({ color: 0x1d3d1a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  group.add(ground);

  // The field. A tiled blade-detail texture adds grain up close, and the mowing stripes catch the light
  // depending on which way you look along the field (cut grass leans one way per stripe).
  const fieldMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const detail = new THREE.CanvasTexture(grassDetailCanvas());
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = renderer.capabilities.getMaxAnisotropy();
  fieldMat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: detail };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nuniform sampler2D tDetail;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dGrain = texture2D(tDetail, vGW.xz * 0.45).r * 0.6 + texture2D(tDetail, vGW.xz * 0.11 + 0.37).r * 0.4;
        float onGrass = step(abs(vGW.z), 26.6) * step(abs(vGW.x), 49.9);
        // Mowing sheen: 5-yard bands, brighter when you look along the cut, darker against it.
        float band = mod(floor((vGW.x + 50.0) / 5.0), 2.0) * 2.0 - 1.0;
        float look = clamp((cameraPosition.x - vGW.x) / 25.0, -1.0, 1.0);
        float sheen = 1.0 + band * look * 0.1 * onGrass;
        float grainK = mix(0.35, 1.0, step(0.32, diffuseColor.g - max(diffuseColor.r, diffuseColor.b) * 0.8)); // less on paint
        diffuseColor.rgb *= sheen * mix(1.0, 0.76 + dGrain * 0.44, grainK);`);
  };
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FX * 2, FZ * 2), fieldMat);
  field.rotation.x = -Math.PI / 2;
  field.receiveShadow = true;
  group.add(field);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const setTeams = (h, a, opts = {}) => {
    if (fieldMat.map) fieldMat.map.dispose();
    const tex = new THREE.CanvasTexture(makeFieldCanvas(h, a, opts));
    tex.anisotropy = maxAniso;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    fieldMat.map = tex;
    fieldMat.needsUpdate = true;
    updateBoards(h, a);
    paintWalls(h, a);
  };

  // Field-level wall with team-colored padding.
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const wallGeo = [];
  const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  wallGeo.push(box(WALL_X * 2, WALL_H, 0.6, 0, WALL_H / 2, WALL_Z));
  wallGeo.push(box(WALL_X * 2, WALL_H, 0.6, 0, WALL_H / 2, -WALL_Z));
  wallGeo.push(box(0.6, WALL_H, WALL_Z * 2, WALL_X, WALL_H / 2, 0));
  wallGeo.push(box(0.6, WALL_H, WALL_Z * 2, -WALL_X, WALL_H / 2, 0));
  const walls = new THREE.Mesh(mergeGeometries(wallGeo), wallMat);
  group.add(walls);
  const paintWalls = (h) => wallMat.color.set(h.colors.primary).multiplyScalar(0.8);

  // Stands: stepped rows on all four sides plus corner fills.
  const standGeos = [];
  const seatPositions = [];
  for (let r = 0; r < ROWS; r++) {
    const y = WALL_H + r * ROW_RISE;
    const off = r * ROW_DEPTH;
    const lenX = (WALL_X + off) * 2;
    const lenZ = (WALL_Z + off) * 2;
    standGeos.push(box(lenX, ROW_RISE, ROW_DEPTH, 0, y - ROW_RISE / 2 + 0.01, WALL_Z + off + ROW_DEPTH / 2));
    standGeos.push(box(lenX, ROW_RISE, ROW_DEPTH, 0, y - ROW_RISE / 2 + 0.01, -(WALL_Z + off + ROW_DEPTH / 2)));
    standGeos.push(box(ROW_DEPTH, ROW_RISE, lenZ, WALL_X + off + ROW_DEPTH / 2, y - ROW_RISE / 2 + 0.01, 0));
    standGeos.push(box(ROW_DEPTH, ROW_RISE, lenZ, -(WALL_X + off + ROW_DEPTH / 2), y - ROW_RISE / 2 + 0.01, 0));
    // Spectator spots along each row (1 per ~0.95 yards), skipping aisles.
    for (let x = -WALL_X - off + 1; x < WALL_X + off - 1; x += 0.95) {
      if (Math.abs((x % 18 + 18) % 18) < 1.2) continue;
      seatPositions.push([x, y, WALL_Z + off + 0.45, 0]);
      seatPositions.push([x, y, -(WALL_Z + off + 0.45), Math.PI]);
    }
    for (let z = -WALL_Z - off + 1; z < WALL_Z + off - 1; z += 0.95) {
      if (Math.abs((z % 18 + 18) % 18) < 1.2) continue;
      seatPositions.push([WALL_X + off + 0.45, y, z, Math.PI / 2]);
      seatPositions.push([-(WALL_X + off + 0.45), y, z, -Math.PI / 2]);
    }
  }
  // Back wall / rim of the bowl.
  const topY = WALL_H + ROWS * ROW_RISE;
  const backOff = ROWS * ROW_DEPTH;
  standGeos.push(box((WALL_X + backOff) * 2 + 2, 6, 1, 0, topY + 3 - 1, WALL_Z + backOff + 0.5));
  standGeos.push(box((WALL_X + backOff) * 2 + 2, 6, 1, 0, topY + 3 - 1, -(WALL_Z + backOff + 0.5)));
  standGeos.push(box(1, 6, (WALL_Z + backOff) * 2 + 2, WALL_X + backOff + 0.5, topY + 3 - 1, 0));
  standGeos.push(box(1, 6, (WALL_Z + backOff) * 2 + 2, -(WALL_X + backOff + 0.5), topY + 3 - 1, 0));
  const stands = new THREE.Mesh(mergeGeometries(standGeos), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
  group.add(stands);

  // Crowd: one instanced mesh, bobbing in the vertex shader. Excitement drives the motion.
  const crowdGeo = new THREE.BoxGeometry(0.5, 0.75, 0.35);
  crowdGeo.translate(0, 0.4, 0);
  const crowdMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
  crowdMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = crowdUniforms.uTime;
    shader.uniforms.uExcite = crowdUniforms.uExcite;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uExcite;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = float(gl_InstanceID) * 12.9898;
        float h = fract(sin(ph) * 43758.5453);
        float bob = max(0.0, sin(uTime * (5.0 + h * 4.0) + h * 30.0));
        transformed.y += bob * (0.05 + uExcite * 0.55) * step(0.35, h + uExcite * 0.6);`);
  };
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, seatPositions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fillCrowdColors = (h, a) => {
    const palette = [h.colors.primary, h.colors.primary, h.colors.secondary, h.colors.primary, a.colors.primary, '#e8e8e8', '#202020', '#7a5c3a'];
    for (let i = 0; i < seatPositions.length; i++) {
      // Leave some seats empty-looking (dark), keep a mostly-home crowd.
      const c = rnd();
      col.set(palette[Math.floor(c * palette.length)]);
      col.offsetHSL(0, 0, (rnd() - 0.5) * 0.15);
      crowd.setColorAt(i, col);
    }
    crowd.instanceColor.needsUpdate = true;
  };
  for (let i = 0; i < seatPositions.length; i++) {
    const [x, y, z, ry] = seatPositions[i];
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const s = 0.85 + rnd() * 0.3;
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
    crowd.setMatrixAt(i, m);
    crowd.setColorAt(i, col.set(0x888888));
  }
  crowd.frustumCulled = false;
  group.add(crowd);

  // Light towers on the rim with emissive banks.
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x555b66 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6dd });
  const towerGeos = [], lampGeos = [];
  const tx = WALL_X + backOff - 6, tz = WALL_Z + backOff - 2;
  for (const sx of [-1, -0.33, 0.33, 1]) for (const sz of [-1, 1]) {
    const x = sx * tx, z = sz * tz;
    towerGeos.push(box(0.8, 30, 0.8, x, topY + 15, z));
    const panel = box(9, 3.2, 0.6, x, topY + 31, z);
    panel.rotateY(0);
    lampGeos.push(panel);
  }
  group.add(new THREE.Mesh(mergeGeometries(towerGeos), towerMat));
  group.add(new THREE.Mesh(mergeGeometries(lampGeos), lampMat));

  // Goalposts (gooseneck) at both end lines.
  const postMat = new THREE.MeshLambertMaterial({ color: 0xf5d000, emissive: 0x332a00 });
  const postGeos = [];
  for (const s of [-1, 1]) {
    const ex = s * 60;
    const cyl = (r, h, x, y, z, rx = 0, rz = 0) => {
      const g = new THREE.CylinderGeometry(r, r, h, 8);
      if (rx) g.rotateX(rx);
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z);
      return g;
    };
    postGeos.push(cyl(0.12, 3.0, ex + s * 2, 1.5, 0)); // base pole behind end line
    postGeos.push(cyl(0.1, 2, ex + s * 1, 3.1, 0, 0, Math.PI / 2)); // gooseneck arm
    postGeos.push(cyl(0.07, 6.17, ex, 3.33, 0, Math.PI / 2)); // crossbar along z
    for (const zz of [-3.08, 3.08]) postGeos.push(cyl(0.06, 11.7, ex, 3.33 + 5.85, zz)); // uprights
    postGeos.push(cyl(0.12, 0.25, ex, 3.2, 0)); // joint
  }
  const posts = new THREE.Mesh(mergeGeometries(postGeos), postMat);
  posts.castShadow = true;
  group.add(posts);

  // Pylons at the end-zone corners.
  const pyl = [];
  for (const sx of [-60, -50, 50, 60]) for (const sz of [-1, 1]) pyl.push(box(0.12, 0.6, 0.12, sx, 0.3, sz * (HALF_WIDTH + 0.06)));
  group.add(new THREE.Mesh(mergeGeometries(pyl), new THREE.MeshLambertMaterial({ color: 0xff6a00, emissive: 0x401800 })));

  // Video boards above each end.
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 1024; boardCanvas.height = 384;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex });
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(36, 13.5), boardMat);
    b.position.set(s * (WALL_X + backOff + 2), topY + 14, 0);
    b.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(b);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 15, 38), towerMat);
    frame.position.set(s * (WALL_X + backOff + 2.6), topY + 14, 0);
    group.add(frame);
  }
  function updateBoards(h, a, line = 'GRIDIRON 27') {
    const g = boardCanvas.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 384);
    grd.addColorStop(0, '#0a0f1e'); grd.addColorStop(1, '#151d38');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 384);
    drawLogo(g, h.logo, 170, 175, 120);
    drawLogo(g, a.logo, 854, 175, 120);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = '800 68px "Saira Condensed", "Arial Narrow", sans-serif';
    g.fillText('VS', 512, 200);
    g.font = '700 42px "Saira Condensed", "Arial Narrow", sans-serif';
    g.fillStyle = '#ffd34d';
    g.fillText(line, 512, 340);
    boardTex.needsUpdate = true;
  }
  const setBoardText = (h, a, text) => updateBoards(h, a, text);

  setTeams(home, away);
  fillCrowdColors(home, away);

  let time = 0;
  // Snow cover: a white, slightly patchy layer over the field (shown in snow games).
  const snowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(150,170,190,${(Math.random() * 0.25).toFixed(2)})`; // cosmetic only, not sim randomness
      const r = 2 + Math.random() * 10;
      g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(12, 5);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const snow = new THREE.Mesh(new THREE.PlaneGeometry(FX * 2, FZ * 2), new THREE.MeshLambertMaterial({ map: snowTex, transparent: true, opacity: 0.32, depthWrite: false }));
  snow.rotation.x = -Math.PI / 2;
  snow.position.y = 0.006; // under the line-of-scrimmage / first-down lines
  snow.receiveShadow = true;
  snow.visible = false;
  group.add(snow);

  return {
    group,
    sky: skyUniforms,
    lampMat,
    snow,
    setTeams: (h, a, opts) => { setTeams(h, a, opts); fillCrowdColors(h, a); },
    setBoardText,
    update(dt, excitement) {
      time += dt;
      crowdUniforms.uTime.value = time;
      crowdUniforms.uExcite.value += (excitement - crowdUniforms.uExcite.value) * Math.min(1, dt * 3);
    },
  };
}
