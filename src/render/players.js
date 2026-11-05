import { uniformFor } from '../data/uniforms.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drawLogo } from './logo.js';
import { Gait, setClips } from './gait.js';
import { faceImage, skinToneFromImage, nearestSkin, SKIN_TONES } from '../ui/faces.js';
import { buildBodyGeometry, bodyMaterial, bodyDepthMaterial, fabricNormal, BODY_UNIFORMS, BONE, BONES, bindOrigin, TEX_W, COL_PARAMS, COL_COLORS, COL_NUMBER, COL_NUMCOL, COL_FLAGS, REGION, BIND, applySkeleton, buildHumanGeometry } from './body.js';

// Low-poly players drawn with one InstancedMesh per body part (about 15 draw calls for all 22
// players). Poses are computed procedurally from the sim's animation state every frame.

const SKIN = SKIN_TONES;
const WHITE = new THREE.Color('#ffffff');
const MUD = new THREE.Color('#4a3a28'); // muddy / grass-stained uniforms (setColors, this.dirt)
const MAX = 56; // 22 players + 7 officials + 22 on the sidelines (+ spare)

// Proportions for a 6'2" player, in yards: the body's skeleton (render/body.js BIND, set from the MakeHuman asset at boot).
const B = BIND;

/** Officials' black-and-white vertical stripes, per instance (aStripe = 1), drawn around the body in object space. */
function striped(mat, count, geo) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  geo.setAttribute('aStripe', attr);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aStripe;\nvarying float vStripe;\nvarying vec3 vObjPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripe = aStripe; vObjPos = position;');
    sh.fragmentShader = 'varying float vStripe;\nvarying vec3 vObjPos;\n' + sh.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\nif (vStripe > 0.5) { float a = atan(vObjPos.x, vObjPos.z); diffuseColor.rgb *= fract(a * 1.909) < 0.5 ? 1.0 : 0.05; }');
  };
  return attr;
}

function part(geo, mat, count, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = shadow;
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

function numberAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 78px "Saira Condensed", "Arial Narrow", sans-serif';
  for (let n = 0; n < 100; n++) {
    const cx = (n % 10) * 102.4 + 51.2, cy = Math.floor(n / 10) * 102.4 + 54;
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(0,0,0,1)';
    g.fillStyle = '#ffffff';
    g.strokeText(String(n), cx, cy);
    g.fillText(String(n), cx, cy);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class PlayerRenderer {
  constructor(scene, envMap = null) {
    this.scene = scene;
    // Physically based materials (lit by the scene's environment map): matte jerseys, glossy helmets.
    const mat = (roughness = 0.75, metalness = 0, env = 0.3) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, envMap, envMapIntensity: env });
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const numAtlas = numberAtlas();

    // Helmet decals: a patch bent onto the helmet shell (same local space as helmetGeo), the team's logo from a
    // two-cell atlas (home | away) picked per instance; aDecal = (cell, flip) so both sides read the right way.
    const decalGeo = new THREE.PlaneGeometry(0.46, 0.46, 6, 6);
    {
      const pos = decalGeo.attributes.position, R = 0.505;
      for (let k = 0; k < pos.count; k++) {
        const u = pos.getX(k), v = pos.getY(k);
        pos.setXYZ(k, Math.sqrt(Math.max(0.0001, R * R - u * u - v * v)) * 0.95, v * 0.95, u * 1.08);
      }
      decalGeo.computeVertexNormals();
    }
    const decalAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2 * 2), 2);
    decalGeo.setAttribute('aDecal', decalAttr);
    this.decalAttr = decalAttr;
    this.logoCanvas = document.createElement('canvas');
    this.logoCanvas.width = 512; this.logoCanvas.height = 256;
    this.logoTex = new THREE.CanvasTexture(this.logoCanvas);
    this.logoTex.colorSpace = THREE.SRGBColorSpace;
    this.logoTex.anisotropy = 4;
    const decalMat = new THREE.MeshStandardMaterial({ map: this.logoTex, transparent: true, alphaTest: 0.35, roughness: 0.3, metalness: 0.1, envMap, envMapIntensity: 0.6,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    decalMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec2 aDecal;\n' + sh.vertexShader.replace('#include <uv_vertex>',
        '#include <uv_vertex>\nvMapUv.x = (aDecal.y > 0.5 ? 1.0 - vMapUv.x : vMapUv.x) * 0.5 + aDecal.x * 0.5;');
    };

    // Names on the back: one atlas row per instance (repainted with the roster each play setup).
    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 512; this.nameCanvas.height = MAX * 32;
    this.nameTex = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTex.colorSpace = THREE.SRGBColorSpace; this.nameTex.anisotropy = 4;
    // The body: one skinned, instanced mesh (render/body.js); bones, colors and numbers live in boneTex.
    this.boneData = new Float32Array(TEX_W * MAX * 4);
    this.boneTex = new THREE.DataTexture(this.boneData, TEX_W, MAX, THREE.RGBAFormat, THREE.FloatType);
    this.boneTex.needsUpdate = true;
    BODY_UNIFORMS.boneTex.value = this.boneTex;
    BODY_UNIFORMS.numTex.value = numAtlas;
    BODY_UNIFORMS.nameTex.value = this.nameTex;
    BODY_UNIFORMS.nameRows.value = MAX;
    this.body = part(buildBodyGeometry(), bodyMaterial(envMap, fabricNormal()), MAX);
    this.body.customDepthMaterial = bodyDepthMaterial();
    this.body.receiveShadow = true;
    const helmetMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.22, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, envMap, envMapIntensity: 0.9 });
    this.parts = {
      body: this.body,
      shoe: part(cleatGeometry(), mat(0.45, 0, 0.8), MAX * 2),
      helmet: part(helmetGeometry(), helmetMat, MAX),
      face: part(new THREE.SphereGeometry(0.085, 18, 14).scale(0.95, 1.15, 1), this.faceMaterial(mat(0.55)), MAX, false),
      stripe: part(helmetStripeGeometry(), Object.assign(mat(0.25, 0.1, 0.8), { side: THREE.DoubleSide }), MAX, false),
      mask: part(facemaskGeometry(), mat(0.35, 0.6, 1), MAX, false),
      decal: part(decalGeo, decalMat, MAX * 2, false),
      // Gear: a tinted visor on some helmets, a towel tucked in the front of some skill players' pants.
      visor: part(new THREE.SphereGeometry(0.52, 10, 4, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.4, Math.PI * 0.16), mat(0.1, 0.3, 1.2), MAX, false),
      towel: part(new THREE.BoxGeometry(0.11, 0.24, 0.015).translate(0, -0.12, 0), mat(0.9), MAX, false),
    };
    this.parts.face.geometry.setAttribute('aFace', this.faceAttr);
    this.pairs = new Set([this.parts.decal, this.parts.shoe]);
    for (const p of Object.values(this.parts)) scene.add(p);

    // Contact shadows: a soft dark patch under every figure (grounds the feet; the sun shadow alone reads as floating).
    {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      this.contact = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), MAX);
      this.contact.frustumCulled = false; this.contact.renderOrder = 1; this.contact.count = 0;
      scene.add(this.contact);
    }
    // Ring under the user-controlled player.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.renderOrder = 2;
    this.ring.visible = false;
    scene.add(this.ring);
    // Second ring for player 2 in local 2-player games.
    this.ring2 = this.ring.clone();
    this.ring2.material = this.ring.material.clone();
    scene.add(this.ring2);
    // Pulse ring: flashes under whoever ends up with the ball on a pass (team-colored), so it's clear who caught it.
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.pulse.rotation.x = -Math.PI / 2;
    this.pulse.position.y = 0.035;
    this.pulse.renderOrder = 3;
    scene.add(this.pulse);
    this.pulseT = 0;
    this.pulseId = -1;
    // Pose crossfades (per player index): the pose an animation change starts from, and the last drawn pose.
    this.fromPose = []; this.lastPose = []; this.lastAnim = []; this.fadeT = []; this.poseSim = null;
    this.fall = []; this.fallAnim = [];

    this._m = new THREE.Matrix4();
    this._t = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
    this._col = new THREE.Color();
    this._v = new THREE.Vector3();
    this.gait = new Gait();
    this.colorsKey = '';
    this.handPos = [];
  }

  /**
   * The face inside the helmet: skin colored (instance color), or the player's photo (ui/faces.js) from an 8 × 8 atlas
   * (cell = instance), projected onto the front and faded into the skin tone toward the edges so the background of
   * the picture never shows.
   */
  faceMaterial(m) {
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = this.faceCanvas.height = 1024;
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    BODY_UNIFORMS.faceTex.value = this.faceTex; // the body shader paints photos on the MakeHuman face from the same atlas
    this.faceAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.faceRev = 0; this.faceCells = [];
    const tex = this.faceTex;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tFace = { value: tex };
      sh.vertexShader = 'attribute float aFace;\nvarying float vFace;\nvarying vec3 vObj;\nflat varying float vCell;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = aFace; vObj = position; vCell = float(gl_InstanceID);');
      sh.fragmentShader = 'uniform sampler2D tFace;\nvarying float vFace;\nvarying vec3 vObj;\nflat varying float vCell;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
        if (vFace > 0.5 && vObj.z > 0.0) {
          vec2 q = vObj.xy / vec2(0.0808, 0.0978);
          vec2 cell = vec2(mod(vCell, 8.0), floor(vCell / 8.0));
          vec2 st = q * 0.42 + 0.5;
          vec3 photo = texture2D(tFace, vec2((cell.x + st.x) / 8.0, 1.0 - (cell.y + 1.0 - st.y) / 8.0)).rgb;
          float k = smoothstep(1.0, 0.55, length(q)) * smoothstep(0.0, 0.035, vObj.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, photo, k);
        }`);
    };
    return m;
  }

  /** Paint player i's photo into his atlas cell (square crop from the top-middle, like the menus). */
  paintFace(i, img) {
    const g = this.faceCanvas.getContext('2d');
    const x = (i % 8) * 128, y = Math.floor(i / 8) * 128, s = Math.min(img.width, img.height);
    g.drawImage(img, (img.width - s) / 2, Math.max(0, (img.height - s) * 0.2), s, s, x, y, 128, 128);
  }

  /**
   * Switch to the MakeHuman body (src/assets/human.json, CC0; built by tools/buildhuman.mjs): its skeleton becomes BIND
   * (so posing, the gait's IK and the bone texture all follow), its mesh replaces the procedural one. Called at boot;
   * until it resolves (or if it fails) the procedural body draws.
   */
  async loadHuman() {
    try {
      const h = (await import('../assets/human.json')).default;
      applySkeleton({ ...h.skeleton, torso: h.skeleton.headY - 0.2, helmY: 0.072, helmZ: 0.028 });
      const old = this.body.geometry;
      this.body.geometry = buildHumanGeometry(h);
      old.dispose();
      this.human = true;
      this.colorsKey = '';
      setClips((await import('../assets/clips.json')).default); // CMU motion capture (tools/mocap.mjs)
    } catch (e) { console.warn('[Gridiron 27] human body not loaded, using the procedural one', e); }
  }

  /** Sweat sheen on skin and jerseys, 0..1 (main.js: game progress, rain). */
  setSweat(k) { BODY_UNIFORMS.sweat.value = k; }

  /** Body texel helpers: region color, number, flags (row i of the bone texture). */
  texel(i, col, x, y, z, w) { const o = (i * TEX_W + col) * 4, d = this.boneData; d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = w; }
  region(i, r, color) { const c = this._col.set(color); this.texel(i, COL_COLORS + r, c.r, c.g, c.b, 1); }
  regionC(i, r, c) { this.texel(i, COL_COLORS + r, c.r, c.g, c.b, 1); }
  number(i, n, color, nameRow = -1) {
    const show = n !== null && n !== undefined && n >= 0;
    this.texel(i, COL_NUMBER, show ? n % 10 : 0, show ? Math.floor(n / 10) : 0, nameRow, show ? 1 : 0);
    const c = this._col.set(color || '#ffffff'); this.texel(i, COL_NUMCOL, c.r, c.g, c.b, 1);
  }

  /** Assign per-instance colors from team uniforms (once per play setup). */
  setColors(sim, teams) {
    const wear = this.wear || ['home', 'away'];
    const unis = teams.map((t, k) => uniformFor(t, wear[k]));
    const key = sim.players.map((p) => `${p.team}:${p.number}:${p.skin}:${p.skinColor || ''}:${p.photo ? p.photo.length + p.photo.slice(-24) : ''}:${p.look?.sleeves || ''}`).join(',') + ':f' + this.faceRev + JSON.stringify(unis) + ':' + (this.extra?.length || 0) + ':' + Math.round((this.dirt || 0) * 10);
    if (key === this.colorsKey) return;
    this.colorsKey = key;
    const P = this.parts;
    const c = this._col;
    // Logo atlas: home in the left half, away in the right.
    const lg = this.logoCanvas.getContext('2d');
    lg.clearRect(0, 0, 512, 256);
    teams.forEach((t, k) => drawLogo(lg, t.logo, 128 + k * 256, 128, 118));
    this.logoTex.needsUpdate = true;
    const ng = this.nameCanvas.getContext('2d');
    ng.clearRect(0, 0, 512, MAX * 32);
    ng.font = '700 26px "Saira Condensed", "Arial Narrow", sans-serif'; ng.textAlign = 'center'; ng.textBaseline = 'middle'; ng.fillStyle = '#fff';
    const paintName = (i, name) => {
      if (i >= MAX || !name) return false;
      const last = name.replace(/^\S+\.\s*/, '').toUpperCase();
      // The name patch is ~4.5:1 but a row is 16:1, so stretch the text across (less for long names, to fit).
      const sx = Math.min(16 / 4.5, 496 / Math.max(1, ng.measureText(last).width));
      ng.save(); ng.translate(256, i * 32 + 17); ng.scale(sx, 1); ng.fillText(last, 0, 0); ng.restore();
      return true;
    };
    const named = sim.players.map((p, i) => paintName(i, p.name));
    this.nameTex.needsUpdate = true;
    const pick = (team, which) => (which === 'white' ? '#f4f4f4' : which === 'secondary' ? team.colors.secondary : which === 'accent' ? team.colors.accent : team.colors.primary);
    // Flags: officials' stripes, lineman build (MakeHuman bulk delta), shoulder pads, face photo.
    const flags = (i, stripes, bulk = 0, pads = 1, photo = 0) => this.texel(i, COL_FLAGS, stripes ? 1 : 0, bulk, pads, photo);
    sim.players.forEach((p, i) => {
      const team = teams[p.team];
      const u = team.uniform;
      // Home / away (white, like on TV) / alternate sets from data/uniforms.js (editable per team).
      const uni = unis[p.team];
      const jersey = uni.jersey;
      const helmet = uni.helmet || pick(team, u.helmet);
      const pants = uni.pants;
      // A face photo: on the 3D face, and (once) the source of his skin tone (kept on the roster player too).
      const img = p.photo ? faceImage({ face: p.photo }, () => { this.faceRev++; }) : null;
      if (img && !p.skinColor) {
        const tone = skinToneFromImage(img);
        const rp = tone && teams[p.team]?.roster?.find((q) => q.id === p.rid);
        if (tone) { p.skinColor = tone; if (rp && !rp.skinManual && !rp.skinColor) { rp.skinColor = tone; rp.skin = nearestSkin(tone); } }
      }
      this.faceAttr.setX(i, img ? 1 : 0);
      if (img) this.paintFace(i, img);
      const skin = p.skinColor || SKIN[p.skin % SKIN.length];
      // Mud / grass stains build up over the game (this.dirt 0..1, set from the weather and the clock).
      const dirt = (this.dirt || 0) * (p.id % 3 === 0 ? 0.42 : 0.28);
      const mud = (col, k = 1) => c.set(col).lerp(MUD, dirt * k);
      this.regionC(i, REGION.jersey, mud(jersey));
      this.regionC(i, REGION.sleeve, mud(uni.sleeves || uni.shoulders || jersey));
      this.regionC(i, REGION.pants, mud(pants, 1.4));
      const stripe = uni.stripe === 'none' ? pants : (uni.stripe || (isDark(pants) ? team.colors.secondary : team.colors.primary));
      this.regionC(i, REGION.stripe, mud(stripe, 1.2));
      this.region(i, REGION.socks, uni.socks || (!isDark(pants) ? team.colors.primary : '#f2f2f2'));
      this.region(i, REGION.skin, skin);
      // Arm sleeves (roster editor): white / black / team color, else bare forearms.
      const sl = p.look?.sleeves;
      this.region(i, REGION.forearm, sl === 'white' ? '#f2f2f2' : sl === 'black' ? '#141414' : sl === 'team' ? team.colors.primary : skin);
      this.regionC(i, REGION.gloves, uni.gloves ? c.set(uni.gloves) : c.set(team.colors.secondary).lerp(WHITE, 0.2));
      this.number(i, p.number, uni.number, named[i] ? i : -1);
      flags(i, false, Math.min(0.6, p.bulk * 0.75), 1, img ? 1 : 0); // linemen: up to 60% of the heavy shape (powerful, not obese)
      this.region(i, REGION.shoe, uni.cleats || (i % 3 ? '#151515' : '#f0f0f0'));
      P.face.setColorAt(i, c.set(skin));
      P.helmet.setColorAt(i, c.set(helmet));
      const hstripe = uni.stripe === 'none' ? helmet : uni.stripe || (u.helmetStripe ? team.colors.secondary : helmet);
      const facemask = uni.facemask || (isDark(helmet) ? '#cfcfcf' : '#333333');
      P.stripe.setColorAt(i, c.set(hstripe));
      P.mask.setColorAt(i, c.set(facemask));
      const vl = p.look?.visor;
      P.visor.setColorAt(i, c.set(VISOR_COLORS[vl] || (p.number % 3 ? VISOR_COLORS.dark : VISOR_COLORS.gold)));
      P.towel.setColorAt(i, c.set('#f4f4f4'));
      for (let k = 0; k < 2; k++) {
        this.decalAttr.setXY(i * 2 + k, p.team, k);
        P.shoe.setColorAt(i * 2 + k, c.set(uni.cleats || (i % 3 ? '#151515' : '#f0f0f0')));
      }
    });
    // Officials after the players: striped shirt, black pants, black cap (the referee wears white).
    for (let r = 0; r < 7; r++) {
      const i = sim.players.length + r;
      if (i >= MAX) break;
      const cap = r === 0 ? '#f4f4f4' : '#141414', skin = SKIN[(r * 2 + 1) % SKIN.length];
      this.region(i, REGION.jersey, '#f2f2f2'); this.region(i, REGION.sleeve, '#f2f2f2');
      for (const g of [REGION.pants, REGION.stripe, REGION.socks]) this.region(i, g, '#1a1a1a');
      this.region(i, REGION.skin, skin); this.region(i, REGION.forearm, skin); this.region(i, REGION.gloves, skin);
      this.number(i, (r * 13 + 7) % 100, '#111111');
      flags(i, true, 0.15, 0);
      this.region(i, REGION.shoe, '#0e0e0e');
      P.face.setColorAt(i, c.set(skin)); P.helmet.setColorAt(i, c.set(skin)); P.towel.setColorAt(i, c.set(cap)); P.stripe.setColorAt(i, c.set(cap)); P.mask.setColorAt(i, c.set(cap));
      for (let k = 0; k < 2; k++) P.shoe.setColorAt(i * 2 + k, c.set('#0e0e0e'));
    }
    // Sideline players and coaches (Presentation.bench) after the officials.
    const base = sim.players.length + 7;
    (this.extra || []).forEach((b, k) => {
      const i = base + k, team = teams[b.team];
      if (!team || i >= MAX) return;
      const u = team.uniform;
      const jersey = b.team === 1 ? '#f4f4f4' : pick(team, u.jersey), helmet = pick(team, u.helmet), pants = pick(team, u.pants);
      const skin = SKIN[b.skin % SKIN.length];
      const top = b.coach ? team.colors.primary : jersey, bottom = b.coach ? '#b9a77c' : pants;
      const numColor = isDark(top) ? (isDark(team.colors.secondary) ? '#ffffff' : team.colors.secondary) : (isDark(team.colors.primary) ? team.colors.primary : '#111111');
      this.region(i, REGION.jersey, top); this.region(i, REGION.sleeve, top); this.region(i, REGION.pants, bottom); this.region(i, REGION.stripe, bottom);
      this.region(i, REGION.socks, b.coach ? '#b9a77c' : u.pants === 'white' ? team.colors.primary : '#f2f2f2');
      this.region(i, REGION.skin, skin); this.region(i, REGION.forearm, skin); this.region(i, REGION.gloves, b.coach ? skin : team.colors.secondary);
      this.number(i, b.coach ? -1 : b.number, numColor);
      flags(i, false, b.coach ? 0.35 : 0.3, b.coach ? 0 : 1);
      this.region(i, REGION.shoe, '#151515');
      P.face.setColorAt(i, c.set(skin));
      P.helmet.setColorAt(i, c.set(b.coach ? skin : helmet)); P.stripe.setColorAt(i, c.set(b.coach ? team.colors.primary : u.helmetStripe ? team.colors.secondary : helmet));
      P.towel.setColorAt(i, c.set(b.coach ? team.colors.primary : '#f4f4f4')); P.visor.setColorAt(i, c.set('#1a1f2a'));
      P.mask.setColorAt(i, c.set(isDark(helmet) ? '#cfcfcf' : '#333333'));
      for (let s2 = 0; s2 < 2; s2++) { this.decalAttr.setXY(i * 2 + s2, b.team, s2); P.shoe.setColorAt(i * 2 + s2, c.set('#151515')); }
    });
    for (let i = sim.players.length; i < MAX; i++) this.faceAttr.setX(i, 0);
    this.faceAttr.needsUpdate = true;
    this.faceTex.needsUpdate = true;
    this.decalAttr.needsUpdate = true;
    this.boneTex.needsUpdate = true;
    for (const m of Object.values(P)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Update all instance matrices. alpha interpolates between the previous and current sim tick. */
  update(sim, alpha, time, controlledId, refs = null) {
    const P = this.parts;
    const n = Math.min(MAX, sim.players.length + (refs ? refs.length : 0));
    for (const m of Object.values(P)) m.count = this.pairs.has(m) ? n * 2 : n;
    // A new play: poses start fresh (no crossfade from the last play's players).
    if (sim !== this.poseSim) { this.poseSim = sim; this.lastAnim.length = 0; this.fadeT.length = 0; this.fallAnim.length = 0; }
    const dt = Math.min(0.1, Math.max(0, time - (this.lastTime ?? time)));
    this.lastTime = time;
    for (let i = 0; i < sim.players.length; i++) this.drawPlayer(sim, this.display?.[i] || sim.players[i], i, alpha, time, dt);
    if (refs) for (let r = 0; r < refs.length && sim.players.length + r < MAX; r++) this.drawPlayer(sim, refs[r], sim.players.length + r, alpha, time, dt, r < 7 || !!refs[r].coach);
    // Catch / interception pulse under the player with the ball.
    if (this.pulseT > 0) {
      this.pulseT -= dt;
      const cp = sim.players[this.pulseId];
      const k = 1 - Math.max(0, this.pulseT) / 1.1;
      if (cp) { this.pulse.position.x = cp.px + (cp.x - cp.px) * alpha; this.pulse.position.z = cp.pz + (cp.z - cp.pz) * alpha; }
      this.pulse.scale.setScalar(0.8 + k * 1.8);
      this.pulse.material.opacity = Math.max(0, 0.95 * (1 - k));
    } else this.pulse.material.opacity = 0;
    for (const m of Object.values(P)) m.instanceMatrix.needsUpdate = true;
    this.contact.count = n; this.contact.instanceMatrix.needsUpdate = true;
    this.boneTex.needsUpdate = true;
    const ids = Array.isArray(controlledId) ? controlledId : [controlledId];
    [this.ring, this.ring2].forEach((ring, i) => {
      const cp = (ids[i] >= 0 && this.display?.[ids[i]]) || sim.players[ids[i]];
      ring.visible = !!cp;
      if (!cp) return;
      ring.position.x = cp.px + (cp.x - cp.px) * alpha;
      ring.position.z = cp.pz + (cp.z - cp.pz) * alpha;
      ring.material.color.set(cp.team === sim.possTeam ? 0xffe14d : 0x4dd2ff);
    });
  }

  /** Flash a team-colored ring under player `id` (catch = offense color, interception = defense color). */
  flash(id, color) { this.pulseId = id; this.pulseT = 1.1; this.pulse.material.color.set(color); }

  drawPlayer(sim, p, i, alpha, time, dt = 1 / 60, official = false) {
    const P = this.parts;
    const x = p.px + (p.x - p.px) * alpha;
    const z = p.pz + (p.z - p.pz) * alpha;
    let f = p.pfacing + angDiff(p.facing, p.pfacing) * alpha;
    const sc = p.height / 2.06;
    const wide = 1 + p.bulk * 0.28;
    const limb = 0.88 + p.bulk * 0.42; // linemen are thick through the arms and legs, receivers and DBs lean
    // Falls go the way the player is moving at the moment he goes down (forward, sideways, or onto his back on
    // a big hit), measured once in his own frame and kept through the time he lies on the turf.
    const falling = p.anim === 'falling' || p.anim === 'tackle' || p.anim === 'down' || p.anim === 'getup';
    if (falling && this.fallAnim[i] !== true) {
      // His momentum plus the shove from whoever hit him: a runner hit head-on goes over backward, one wrapped
      // from the side falls away from the tackler, one dragged down from behind falls forward.
      let vx = p.vx, vz = p.vz;
      const tk = p.anim === 'falling' && sim?.stats?.tackler !== null && sim?.stats?.tackler !== undefined ? sim.players[sim.stats.tackler] : null;
      if (tk && tk !== p) {
        const dx = p.x - tk.x, dz = p.z - tk.z, d = Math.hypot(dx, dz) || 1;
        const hit = Math.max(2, Math.hypot(tk.vx, tk.vz) * 0.6);
        vx += (dx / d) * hit; vz += (dz / d) * hit;
      }
      const sp = Math.hypot(vx, vz);
      const a = sp > 0.6 ? Math.atan2(vz, vx) - p.facing : 0;
      (this.fall[i] ||= { fwd: 1, side: 0 });
      this.fall[i].fwd = Math.cos(a); this.fall[i].side = Math.sin(a);
      this.fallAnim[i] = true;
    } else if (!falling) this.fallAnim[i] = false;
    FALL = falling ? this.fall[i] : null;
    const pose = this.blend(i, p.anim, computePose(p, time, sim), dt);
    // Planted feet, lean into cuts and a head that follows the ball (render/gait.js).
    const b = sim?.ball;
    const look = b && b.state !== 'presnap' && !(b.state === 'held' && b.carrier === p.id) ? b : null;
    this.gait.apply(p, i, pose, x, z, f, sc, official ? 1 : wide, dt, look);
    if (b && REACH_ANIMS.has(p.anim) && (b.state === 'air' || b.state === 'kick')) reachForBall(pose, p, b, x, z, f, sc, wide, alpha);
    const yaw = Math.PI / 2 - f;

    poolI = 0;
    const root = M().makeRotationY(yaw);
    root.setPosition(x, pose.rootY * sc, z);
    if (pose.rootPitch) root.multiply(rotX(pose.rootPitch));
    if (pose.rootRoll) root.multiply(rotZ(pose.rootRoll));
    if (pose.rootYaw) root.multiply(rotY(pose.rootYaw));
    root.multiply(scaleM(sc, sc, sc));
    // Contact shadow: centered between the feet, smaller and darker when he's up on his toes, wider when he's down.
    const lying = p.anim === 'down' || p.anim === 'falling' || p.anim === 'tackle';
    const cs = (lying ? 1.9 : 0.95 + 0.25 * (official ? 0 : p.bulk)) * sc * Math.max(0.55, 1 - pose.rootY * 1.5);
    this.contact.setMatrixAt(i, this._m.makeScale(cs, 1, lying ? cs * 0.7 : cs).setPosition(x, 0.012, z));

    // Bones (render/body.js): hips (upright), chest (leans and twists through the waist), head, arms, legs.
    const w = official || this.human ? 1 : wide; // the MakeHuman body's joints don't move with build (bulk is a shape delta)
    const hips = cl(root).multiply(trans(0, B.hipH + pose.crouch, 0));
    const pel = cl(hips).multiply(rotX(pose.lean)).multiply(rotY(pose.twist));
    const head = cl(pel).multiply(trans(0, B.headY, B.headZ)).multiply(rotY(-(pose.headYaw || 0))).multiply(rotX(pose.head));
    this.bone(i, BONE.hips, hips, w);
    this.bone(i, BONE.chest, pel, w);
    this.bone(i, BONE.head, head, w);
    // Build: width, limb thickness, chest depth (linemen are deep through the chest), shoulder pads (none on officials).
    this.texel(i, COL_PARAMS, w, official ? 0.92 : limb, w * (official ? 0.95 : 1 + p.bulk * 0.22), official ? 0.72 : 1);
    // Gear sits on the skull (the MakeHuman head bone pivots at the top of the neck: helmY / helmZ up to the skull center).
    const hg = B.helmY || B.helmZ ? cl(head).multiply(trans(0, B.helmY, B.helmZ)) : head;
    if (official) {
      // Officials and coaches: a bare head (the helmet part, skin-colored) under a cap: the towel part is the
      // crown, the helmet stripe the brim.
      P.helmet.setMatrixAt(i, this.human ? ZERO : cl(head).multiply(trans(0, 0.01, 0.01)).multiply(scaleM(0.23, 0.27, 0.25)));
      P.towel.setMatrixAt(i, cl(hg).multiply(trans(0, this.human ? 0.115 : 0.185, this.human ? -0.01 : 0)).multiply(scaleM(2.3, 0.33, 16.5)));
      P.stripe.setMatrixAt(i, cl(hg).multiply(trans(0, this.human ? 0.075 : 0.07, this.human ? 0.1 : 0.07)).multiply(scaleM(0.5, 0.2, 0.3)));
      P.mask.setMatrixAt(i, ZERO); P.face.setMatrixAt(i, ZERO);
      P.decal.setMatrixAt(i * 2, ZERO); P.decal.setMatrixAt(i * 2 + 1, ZERO);
      P.visor.setMatrixAt(i, ZERO);
    } else {
      P.helmet.setMatrixAt(i, cl(hg).multiply(scaleM(0.33, 0.33, 0.33)));
      P.face.setMatrixAt(i, this.human ? ZERO : cl(head).multiply(trans(0, -0.04, 0.075)));
      const g = gearOf(p);
      P.visor.setMatrixAt(i, g.visor ? cl(hg).multiply(scaleM(0.33 * 0.97, 0.33 * 0.97, 0.33 * 1.1)) : ZERO);
      P.towel.setMatrixAt(i, g.towel ? cl(hips).multiply(trans(-0.07, 0.03, 0.15 * wide)).multiply(rotX(0.08 + Math.sin(time * 9 + i) * Math.min(0.5, Math.hypot(p.vx || 0, p.vz || 0) * 0.05))) : ZERO);
      // Decals on both sides (the left one mirrored through x), a little behind the ear hole.
      P.decal.setMatrixAt(i * 2, cl(hg).multiply(trans(0, 0.01, -0.012)).multiply(scaleM(0.33, 0.33, 0.33)));
      P.decal.setMatrixAt(i * 2 + 1, cl(hg).multiply(trans(0, 0.01, -0.012)).multiply(scaleM(-0.33, 0.33, 0.33)));
      P.stripe.setMatrixAt(i, cl(hg).multiply(scaleM(0.33, 0.33, 0.33)));
      P.mask.setMatrixAt(i, hg);
    }

    // Arms.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1; // -1 = left
      const a = pose.arms[s];
      const sh = cl(pel).multiply(trans(side * B.shX * w, B.shY, B.shZ)).multiply(rotX(-a.pitch)).multiply(rotZ(side * a.out)).multiply(rotY(side * (a.twist || 0)));
      const el = cl(sh).multiply(trans(0, -B.upper, 0)).multiply(rotX(-a.elbow));
      this.bone(i, s ? BONE.shR : BONE.shL, sh, w);
      this.bone(i, s ? BONE.elR : BONE.elL, el, w);
      if (s === 1) (this.handPos[i] ||= new THREE.Vector3()).setFromMatrixPosition(cl(el).multiply(trans(0, -B.fore - 0.05, 0)));
    }
    // Legs.
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const l = pose.legs[s];
      const hip = cl(root).multiply(trans(side * B.hipX * w, B.hipH + pose.crouch, 0)).multiply(rotX(-l.hip)).multiply(rotZ(side * (l.out || 0)));
      const knee = cl(hip).multiply(trans(0, -B.thigh, 0)).multiply(rotX(l.knee));
      const foot = cl(knee).multiply(trans(0, -B.shin - 0.01, 0.06)).multiply(rotX(-l.knee + l.hip * (l.flat ?? 0.6)));
      this.bone(i, s ? BONE.hipR : BONE.hipL, hip, w);
      this.bone(i, s ? BONE.kneeR : BONE.kneeL, knee, w);
      this.bone(i, s ? BONE.footR : BONE.footL, foot, w);
      P.shoe.setMatrixAt(i * 2 + s, this.human ? ZERO : foot); // the MakeHuman foot is the cleat (shoe region)
    }
  }

  /** Write bone b of instance i: the posed frame times the inverse bind (a translation back to the origin). */
  bone(i, b, m, w) {
    const o = bindOrigin(b, w, this._v);
    const k = this._s.copy(m).multiply(this._t.makeTranslation(-o.x, -o.y, -o.z)).elements;
    this.boneData.set(k, (i * TEX_W + b * 4) * 4);
  }

  /**
   * Crossfade between animations: when a player's animation changes, blend from the pose he was in toward
   * the new one over ~0.2 s (falls and dives a bit faster), so moves flow instead of snapping.
   */
  blend(i, anim, target, dt) {
    const last = (this.lastPose[i] ||= new Float32Array(POSE_N));
    if (this.lastAnim[i] === undefined) { this.lastAnim[i] = anim; this.fadeT[i] = 1; packPose(target, last); return target; }
    if (anim !== this.lastAnim[i]) {
      (this.fromPose[i] ||= new Float32Array(POSE_N)).set(last);
      this.lastAnim[i] = anim;
      this.fadeT[i] = 0;
    }
    const dur = FAST_FADE.has(anim) ? 0.12 : 0.22;
    if (this.fadeT[i] < 1) {
      this.fadeT[i] = Math.min(1, this.fadeT[i] + dt / dur);
      const k = this.fadeT[i] * this.fadeT[i] * (3 - 2 * this.fadeT[i]);
      packPose(target, TMP);
      const from = this.fromPose[i];
      for (let j = 0; j < POSE_N; j++) TMP[j] = from[j] + (TMP[j] - from[j]) * k;
      unpackPose(TMP, target);
    }
    packPose(target, last);
    return target;
  }

  /** World position for the ball when it's carried by player i. */
  carryPoint(sim, i, alpha, out) {
    const p = sim.players[i];
    const x = p.px + (p.x - p.px) * alpha, z = p.pz + (p.z - p.pz) * alpha;
    const f = p.facing;
    const sc = p.height / 2.06;
    if (p.anim === 'throw' || p.anim === 'stance_qb' || p.anim === 'passset' || p.anim === 'reach' || p.anim === 'catch') {
      const h = this.handPos[i];
      if (h) return out.copy(h);
    }
    if (p.state === 'down' || p.state === 'tackled') return out.set(x + Math.cos(f) * 0.3, 0.25, z + Math.sin(f) * 0.3);
    // Tucked under the carrying arm (right unless he switched it: p.ballArm = -1).
    const arm = p.ballArm === -1 ? -1 : 1;
    const rx = -Math.sin(f) * arm, rz = Math.cos(f) * arm; // the carrying side
    return out.set(x + Math.cos(f) * 0.12 + rx * 0.2 * sc, 1.25 * sc, z + Math.sin(f) * 0.12 + rz * 0.2 * sc);
  }
}

// ---------- Arm IK: hands go to the ball ----------
const REACH_ANIMS = new Set(['reach', 'swat', 'pick', 'catch', 'fair_catch']);
/** Aim both arms (one for a swat) from the shoulders at the ball, more as it arrives; elbows nearly straight. */
function reachForBall(pose, p, b, x, z, f, sc, w, alpha) {
  const bx = b.px + (b.x - b.px) * alpha, by = b.py + (b.y - b.py) * alpha, bz = b.pz + (b.z - b.pz) * alpha;
  const dist = Math.hypot(bx - x, bz - z);
  if (dist > 4.5) return;
  const k = Math.min(1, (4.5 - dist) / 3) * (p.anim === 'catch' ? Math.max(0, 1 - p.animT / 0.18) : 1);
  const sin = Math.sin(f), cos = Math.cos(f);
  const dxw = bx - x, dzw = bz - z;
  const lx = (dxw * sin - dzw * cos) / sc, lz = (dxw * cos + dzw * sin) / sc;
  const shY = B.hipH + pose.crouch + pose.rootY + B.shY;
  for (let s = 0; s < 2; s++) {
    if (p.anim === 'swat' && s === 0) continue;
    const side = s ? 1 : -1, a = pose.arms[s];
    const dx = lx - side * B.shX * w * 0.6, dy = by / sc - shY, dz = lz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const pitch = Math.atan2(dz, -dy) - pose.lean;
    const out = Math.asin(Math.max(-0.9, Math.min(0.9, (dx * side) / len)));
    a.pitch += (pitch - a.pitch) * k;
    a.out += (out - a.out) * k;
    a.elbow += (0.18 - a.elbow) * k;
  }
  // Eyes on the ball.
  pose.head += (-Math.max(-0.6, Math.min(0.9, Math.atan2(by / sc - shY - 0.2, Math.hypot(lx, lz)))) - pose.head) * k; // negative = up
}

// ---------- Pose packing (for crossfades) ----------
const POSE_KEYS = ['rootY', 'rootPitch', 'rootRoll', 'rootYaw', 'crouch', 'lean', 'twist', 'head'];
const ARM_KEYS = ['pitch', 'out', 'elbow', 'twist'];
const LEG_KEYS = ['hip', 'knee', 'out'];
const POSE_N = POSE_KEYS.length + 2 * ARM_KEYS.length + 2 * LEG_KEYS.length;
const TMP = new Float32Array(POSE_N);
const FAST_FADE = new Set(['tackle', 'falling', 'dive', 'tackle_dive', 'hitstick', 'juke', 'spin', 'catch', 'throw', 'swat']);
function packPose(p, a) {
  let j = 0;
  for (const k of POSE_KEYS) a[j++] = p[k] || 0;
  for (const arm of p.arms) for (const k of ARM_KEYS) a[j++] = arm[k] || 0;
  for (const leg of p.legs) for (const k of LEG_KEYS) a[j++] = leg[k] || 0;
}
function unpackPose(a, p) {
  let j = 0;
  for (const k of POSE_KEYS) p[k] = a[j++];
  for (const arm of p.arms) for (const k of ARM_KEYS) arm[k] = a[j++];
  for (const leg of p.legs) for (const k of LEG_KEYS) leg[k] = a[j++];
}

// ---------- Procedural poses ----------
let FALL = null; // fall direction of the player being posed (set by drawPlayer)
function computePose(p, time, sim) {
  const sp = Math.hypot(p.vx, p.vz);
  const run = Math.min(1, sp / 8);
  const cyc = p.cycle;
  const sw = Math.sin(cyc);
  const pose = {
    rootY: 0, rootPitch: 0, rootRoll: 0, rootYaw: 0, crouch: 0, lean: 0.08 + run * 0.3, twist: 0, head: 0,
    arms: [{ pitch: 0, out: 0.15, elbow: 0.4 }, { pitch: 0, out: 0.15, elbow: 0.4 }],
    legs: [{ hip: 0, knee: 0.05 }, { hip: 0, knee: 0.05 }],
  };
  const t = p.animT;
  const runLegs = (amp) => {
    // Sprint mechanics: the thigh drives further forward than back, the knee folds through the swing,
    // arms pump opposite the legs with the hands coming up, shoulders counter-rotate, two bounces per cycle.
    const drive = (x) => (x > 0 ? x * 1.25 : x * 0.75) * amp;
    pose.legs[0].hip = drive(sw); pose.legs[1].hip = drive(-sw);
    pose.legs[0].knee = 0.25 + Math.max(0, -Math.cos(cyc)) * amp * 1.75;
    pose.legs[1].knee = 0.25 + Math.max(0, Math.cos(cyc)) * amp * 1.75;
    pose.arms[0].pitch = -sw * amp * 1.15 + 0.15 * amp; pose.arms[1].pitch = sw * amp * 1.15 + 0.15 * amp;
    pose.arms[0].elbow = 1.25 + Math.max(0, -sw) * 0.35 * amp; pose.arms[1].elbow = 1.25 + Math.max(0, sw) * 0.35 * amp;
    pose.twist = sw * 0.14 * amp;
    pose.rootY = Math.abs(Math.cos(cyc)) * 0.06 * amp;
    pose.crouch = -0.06 * amp;
    pose.head = -pose.lean * 0.55; // eyes up the field, not at the turf
  };
  switch (p.anim) {
    case 'stance3':
      pose.crouch = -0.38; pose.lean = 1.15; pose.head = -0.9;
      pose.legs[0].hip = 1.0; pose.legs[0].knee = 1.6; pose.legs[1].hip = 0.7; pose.legs[1].knee = 1.4;
      pose.arms[1].pitch = 1.25; pose.arms[1].elbow = 0.1; pose.arms[0].pitch = 0.6; pose.arms[0].elbow = 1.0;
      pose.legs[0].out = 0.15; pose.legs[1].out = 0.15;
      break;
    case 'stance2':
      pose.crouch = -0.2; pose.lean = 0.5; pose.head = -0.35;
      pose.legs[0].hip = 0.6; pose.legs[0].knee = 0.9; pose.legs[1].hip = 0.15; pose.legs[1].knee = 0.6;
      pose.arms[0].pitch = 0.5; pose.arms[1].pitch = 0.5; pose.arms[0].elbow = pose.arms[1].elbow = 1.0;
      // Linebackers and safeties waiting on the snap: on their toes, and now and then pointing out a receiver.
      if (sim?.state === 'presnap' && p.side === 'D') {
        const ph = time * 1.7 + p.id * 1.3;
        pose.rootY = Math.abs(Math.sin(ph * 2.2)) * 0.03;
        if ((ph % 6) < 0.9 && ['MLB', 'OLB', 'FS', 'SS'].includes(p.pos)) { pose.arms[1].pitch = 1.6; pose.arms[1].elbow = 0.1; pose.arms[1].out = Math.sin(p.id) * 0.5; pose.lean = 0.25; pose.head = 0; }
      }
      break;
    case 'stance_qb': {
      const gun = sim && sim.toLocal(p.x, p.z).down < -2;
      // Reading the defense before the snap: his shoulders scan side to side; in the gun he points out the
      // middle linebacker now and then.
      const scan = sim?.state === 'presnap' ? time * 0.9 + p.id : 0;
      pose.crouch = gun ? -0.12 : -0.2; pose.lean = gun ? 0.35 : 0.55;
      pose.legs[0].hip = 0.35; pose.legs[0].knee = 0.6; pose.legs[1].hip = 0.35; pose.legs[1].knee = 0.6;
      pose.legs[0].out = pose.legs[1].out = 0.15;
      pose.arms[0].pitch = pose.arms[1].pitch = gun ? 0.6 : 1.1; pose.arms[0].elbow = pose.arms[1].elbow = gun ? 1.2 : 0.5;
      pose.arms[0].out = pose.arms[1].out = -0.1;
      if (scan) {
        pose.twist = Math.sin(scan) * (gun ? 0.3 : 0.1); // hands stay under center
        if (gun && (scan % 7) < 0.8) { pose.arms[1].pitch = 1.7; pose.arms[1].elbow = 0.05; pose.arms[1].out = 0.1; }
      }
      break;
    }
    case 'idle':
      pose.lean = 0.12;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.3;
      pose.rootY = Math.sin(time * 2 + p.id) * 0.005;
      break;
    case 'passset':
    case 'block':
      runLegs(Math.min(0.5, run * 0.6));
      pose.crouch = -0.22; pose.lean = 0.55;
      pose.legs[0].out = pose.legs[1].out = 0.25;
      pose.legs[0].knee += 0.5; pose.legs[1].knee += 0.5;
      pose.legs[0].hip += 0.35; pose.legs[1].hip += 0.35;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.35 + Math.sin(time * 9 + p.id) * 0.1;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.6;
      pose.arms[0].out = pose.arms[1].out = -0.05;
      break;
    case 'backpedal':
      runLegs(0.55 * Math.min(1, sp / 5));
      pose.lean = 0.35; pose.crouch = -0.15;
      pose.legs[0].hip *= -0.7; pose.legs[1].hip *= -0.7;
      break;
    case 'shuffle':
      pose.crouch = -0.15; pose.lean = 0.3;
      pose.legs[0].out = 0.2 + Math.max(0, sw) * 0.35; pose.legs[1].out = 0.2 + Math.max(0, -sw) * 0.35;
      pose.legs[0].knee = pose.legs[1].knee = 0.6; pose.legs[0].hip = pose.legs[1].hip = 0.25;
      pose.arms[0].pitch = pose.arms[1].pitch = 0.6; pose.arms[0].elbow = pose.arms[1].elbow = 1.2;
      break;
    case 'throw': {
      // Load (ball back by the ear, front shoulder closed, weight on the back foot), stride and whip (hips open
      // first, then the shoulders, the arm comes over the top), then follow through across the body.
      const k = Math.min(1, t / 0.42);
      const load = Math.min(1, k / 0.38), rel = Math.max(0, Math.min(1, (k - 0.38) / 0.3)), fol = Math.max(0, (k - 0.68) / 0.32);
      const e = rel * rel * (3 - 2 * rel);
      pose.twist = -0.75 * load + 1.3 * e - 0.15 * fol;
      pose.arms[1].pitch = 2.25 + 0.45 * load - 1.9 * e - 0.5 * fol; pose.arms[1].out = 0.85 - 0.35 * e; pose.arms[1].elbow = 1.7 - 1.45 * e + 0.5 * fol;
      pose.arms[0].pitch = 1.45 - 1.0 * e; pose.arms[0].out = 0.25 + 0.2 * e; pose.arms[0].elbow = 1.1 + 0.4 * e;
      pose.legs[0].hip = 0.15 + 0.4 * load - 0.1 * e; pose.legs[0].knee = 0.25 + 0.15 * e; // front foot strides at the target
      pose.legs[1].hip = -0.1 - 0.3 * e; pose.legs[1].knee = 0.35 + 0.35 * e; // back foot pushes off
      pose.lean = 0.05 + 0.4 * e + 0.12 * fol; pose.crouch = -0.06 * e;
      pose.head = -0.15;
      break;
    }
    case 'fair_catch':
      // One arm straight up, waving side to side; eyes on the ball.
      if (sp > 1) runLegs(Math.min(0.6, run));
      pose.arms[1].pitch = 3.05; pose.arms[1].elbow = 0.05; pose.arms[1].out = 0.25 + Math.sin(time * 9) * 0.35;
      pose.arms[0].pitch = 0.5; pose.arms[0].elbow = 1.0;
      pose.head = -0.45;
      break;
    case 'reach':
    case 'swat':
      if (sp > 1) runLegs(Math.min(0.8, run));
      pose.arms[0].pitch = pose.arms[1].pitch = 2.6; pose.arms[0].elbow = pose.arms[1].elbow = 0.3;
      pose.arms[0].out = pose.arms[1].out = 0.25;
      if (p.anim === 'swat') { pose.rootY = Math.sin(Math.min(1, t / 0.5) * Math.PI) * 0.35; pose.arms[1].pitch = 3.0; }
      pose.head = -0.3;
      break;
    case 'catch': {
      // Hands up to the ball, then pull it into the chest.
      if (sp > 1) runLegs(Math.min(0.8, run));
      const k = Math.min(1, t / 0.3);
      pose.arms[0].pitch = pose.arms[1].pitch = 2.4 - k * 1.3;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.3 + k * 1.5;
      pose.arms[0].out = pose.arms[1].out = 0.2 - k * 0.3;
      pose.head = -0.25 + k * 0.35; pose.lean = 0.15 + k * 0.2;
      break;
    }
    case 'pick': {
      // Interception: a leap for the ball, high-pointing it, then the tuck.
      const k = Math.min(1, t / 0.45);
      pose.rootY = Math.sin(Math.min(1, t / 0.4) * Math.PI) * 0.45;
      pose.arms[0].pitch = pose.arms[1].pitch = 3.0 - k * 1.8;
      pose.arms[0].elbow = pose.arms[1].elbow = 0.15 + k * 1.6;
      pose.legs[0].hip = 0.9 * (1 - k); pose.legs[0].knee = 1.3 * (1 - k); pose.legs[1].knee = 0.4;
      pose.head = -0.4 + k * 0.5;
      break;
    }
    case 'falling': {
      // Ball carrier going down: pitch/roll toward the fall direction; on his back after a big hit.
      const f = FALL || { fwd: 1, side: 0 };
      const k = Math.min(1, t / 0.45), e = k * k * (3 - 2 * k);
      const back = f.fwd < -0.25;
      pose.rootPitch = e * (back ? -1.35 : 1.4 * Math.max(0.3, f.fwd));
      pose.rootRoll = -e * f.side * 1.2;
      pose.rootY = -e * 0.12; pose.lean = back ? -0.2 : 0.3;
      pose.arms[0].pitch = pose.arms[1].pitch = back ? 2.6 : 1.7; pose.arms[0].elbow = pose.arms[1].elbow = 0.5;
      pose.arms[0].out = pose.arms[1].out = 0.35 + e * 0.4;
      pose.legs[0].hip = back ? 1.0 * e : -0.35; pose.legs[1].hip = back ? 0.6 * e : -0.1; pose.legs[0].knee = 0.5; pose.legs[1].knee = 0.3;
      pose.head = back ? 0.5 : -0.2;
      break;
    }
    case 'tackle': {
      // Tackler: drive in with arms wrapped, then go down with the runner.
      const f = FALL || { fwd: 1, side: 0 };
      const k = Math.min(1, t / 0.4), e = k * k * (3 - 2 * k);
      pose.rootPitch = e * 1.35; pose.rootRoll = -e * f.side * 0.6; pose.rootY = -e * 0.15; pose.lean = 0.45;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.6; pose.arms[0].elbow = pose.arms[1].elbow = 1.3;
      pose.arms[0].out = pose.arms[1].out = -0.35; // wrapped around the ball carrier
      pose.legs[0].hip = -0.4; pose.legs[1].hip = 0.2; pose.legs[0].knee = 0.6; pose.legs[1].knee = 0.9;
      pose.head = -0.4;
      break;
    }
    case 'down': {
      const f = FALL || { fwd: 1, side: 0 };
      const back = f.fwd < -0.25;
      pose.rootPitch = back ? -1.45 : 1.5; pose.rootRoll = -f.side * 0.5; pose.rootY = -0.02;
      pose.arms[0].pitch = back ? 2.9 : 2.4; pose.arms[1].pitch = back ? 2.2 : 1.2; pose.arms[0].elbow = 0.6; pose.arms[1].elbow = 1.0;
      pose.arms[0].out = 0.6; pose.arms[1].out = back ? 0.5 : 0.15;
      pose.legs[0].hip = back ? 0.5 : 0.2; pose.legs[0].knee = back ? 1.0 : 0.6; pose.legs[1].knee = 0.1;
      pose.lean = 0;
      break;
    }
    case 'getup': {
      const k = Math.min(1, t / 0.6);
      pose.rootPitch = (FALL && FALL.fwd < -0.25 ? -1.45 : 1.5) * (1 - k); pose.crouch = -0.3 * (1 - k);
      pose.legs[0].hip = pose.legs[1].hip = 1.2 * (1 - k); pose.legs[0].knee = pose.legs[1].knee = 1.6 * (1 - k);
      break;
    }
    case 'stumble':
      runLegs(0.5);
      pose.lean = 0.7; pose.arms[0].out = pose.arms[1].out = 0.9; pose.rootRoll = Math.sin(t * 12) * 0.15;
      break;
    case 'juke':
      runLegs(0.6);
      pose.rootRoll = (p.move?.dir || 1) * -0.35 * Math.sin(Math.min(1, t / 0.45) * Math.PI);
      pose.crouch = -0.12;
      break;
    case 'spin':
      runLegs(0.5);
      pose.arms[0].out = pose.arms[1].out = 0.5; pose.crouch = -0.1;
      break;
    case 'stiffarm':
      runLegs(Math.min(1, run));
      pose.arms[0].pitch = 1.55; pose.arms[0].elbow = 0; pose.arms[0].out = 0.15;
      break;
    case 'truck':
      runLegs(Math.min(1, run));
      pose.lean = 0.75; pose.crouch = -0.15; pose.head = -0.3;
      pose.arms[0].pitch = 0.9; pose.arms[0].elbow = 1.4;
      break;
    case 'hurdle': {
      const k = Math.min(1, t / 0.6);
      pose.rootY = Math.sin(k * Math.PI) * 0.75;
      pose.legs[0].hip = 1.3; pose.legs[0].knee = 0.2; pose.legs[1].hip = -0.6; pose.legs[1].knee = 1.4;
      pose.arms[0].pitch = 1.2; pose.arms[1].pitch = -0.5;
      break;
    }
    case 'dive':
    case 'tackle_dive':
    case 'hitstick': {
      const k = Math.min(1, t / 0.35);
      pose.rootPitch = (p.anim === 'hitstick' ? 0.6 : 1.4) * k; pose.rootY = (p.anim === 'hitstick' ? 0 : Math.sin(k * Math.PI) * 0.25) - k * 0.2;
      pose.arms[0].pitch = pose.arms[1].pitch = 2.0; pose.arms[0].elbow = pose.arms[1].elbow = 0.3;
      pose.legs[0].hip = -0.5; pose.legs[1].hip = -0.3;
      break;
    }
    case 'slide':
      pose.rootPitch = -1.0 * Math.min(1, t / 0.3); pose.legs[0].hip = 1.4; pose.legs[1].hip = 1.2;
      break;
    case 'strip':
      runLegs(Math.min(1, run));
      pose.arms[1].pitch = 2.2; pose.arms[1].elbow = 0.2;
      break;
    case 'celebrate':
      pose.arms[0].pitch = pose.arms[1].pitch = 2.9 + Math.sin(time * 8) * 0.2; pose.arms[0].elbow = pose.arms[1].elbow = 0.2;
      pose.rootY = Math.abs(Math.sin(time * 6)) * 0.2;
      break;
    // ---- touchdown celebrations (scorer) ----
    case 'cel_spike': {
      // Wind up and spike the ball, then arms out.
      const k = Math.min(1, t / 0.55);
      pose.lean = k < 0.6 ? -0.15 : 0.35 * (1 - (k - 0.6) / 0.4) + 0.05;
      pose.arms[1].pitch = k < 0.6 ? 2.9 : 2.9 - (k - 0.6) / 0.4 * 2.6; pose.arms[1].elbow = 0.3;
      if (t > 0.8) { pose.arms[0].pitch = pose.arms[1].pitch = 2.5; pose.arms[0].out = pose.arms[1].out = 0.7; pose.lean = -0.1; }
      break;
    }
    case 'cel_point':
      // Point to the sky with both hands.
      pose.lean = -0.2; pose.head = -0.45;
      pose.arms[0].pitch = 2.7; pose.arms[1].pitch = 2.95; pose.arms[0].elbow = 0.35; pose.arms[1].elbow = 0.05; pose.arms[0].out = 0.25; pose.arms[1].out = 0.1;
      break;
    case 'cel_flex':
      // Wide stance, both arms flexed.
      pose.crouch = -0.08; pose.legs[0].out = pose.legs[1].out = 0.28; pose.legs[0].knee = pose.legs[1].knee = 0.3;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.5; pose.arms[0].out = pose.arms[1].out = 0.85 + Math.sin(t * 7) * 0.06; pose.arms[0].elbow = pose.arms[1].elbow = 1.75;
      break;
    case 'cel_leap': {
      // Jump with arms up, every 1.1 s.
      const c = (t % 1.1) / 1.1, air = c < 0.5 ? Math.sin(c / 0.5 * Math.PI) : 0;
      pose.rootY = air * 0.7; pose.legs[0].hip = pose.legs[1].hip = air * 0.6; pose.legs[0].knee = pose.legs[1].knee = air * 1.1 + (c > 0.85 ? 0.4 : 0);
      pose.arms[0].pitch = pose.arms[1].pitch = 2.6 + air * 0.4; pose.arms[0].out = pose.arms[1].out = 0.35;
      break;
    }
    case 'cel_dance': {
      // Side to side with the arms swinging (the celebration wheel's "Dance").
      const w = Math.sin(t * 7);
      pose.rootRoll = w * 0.12; pose.twist = w * 0.35; pose.rootY = Math.abs(Math.cos(t * 7)) * 0.12;
      pose.legs[0].out = 0.2 + Math.max(0, w) * 0.3; pose.legs[1].out = 0.2 + Math.max(0, -w) * 0.3; pose.legs[0].knee = pose.legs[1].knee = 0.45;
      pose.arms[0].pitch = 1.9 + w * 0.6; pose.arms[1].pitch = 1.9 - w * 0.6; pose.arms[0].out = pose.arms[1].out = 0.55; pose.arms[0].elbow = pose.arms[1].elbow = 0.9;
      break;
    }
    case 'cel_first':
      // First down: the runner pops up and points the way the offense is going.
      pose.lean = 0.05; pose.arms[1].pitch = 1.6; pose.arms[1].elbow = 0.02; pose.arms[1].out = 0.05; pose.arms[0].pitch = 0.3; pose.arms[0].elbow = 1.2;
      break;
    case 'cel_sack':
      // Sack: arms out wide, chest up, a little shimmy.
      pose.lean = -0.18; pose.head = -0.3; pose.rootY = Math.abs(Math.sin(t * 5)) * 0.08;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.4; pose.arms[0].out = pose.arms[1].out = 1.25 + Math.sin(t * 9) * 0.1; pose.arms[0].elbow = pose.arms[1].elbow = 0.25;
      pose.legs[0].out = pose.legs[1].out = 0.25;
      break;
    case 'cel_pick':
      // Interception: the ball held up high in one hand.
      pose.lean = -0.1; pose.head = -0.35; pose.arms[1].pitch = 3.0; pose.arms[1].elbow = 0.05; pose.arms[0].pitch = 0.9; pose.arms[0].elbow = 1.3;
      pose.rootY = Math.abs(Math.sin(t * 4)) * 0.05;
      break;
    case 'huddle':
      // Hands on knees in the huddle, listening for the call.
      pose.crouch = -0.12; pose.lean = 0.55; pose.head = -0.1;
      pose.legs[0].hip = pose.legs[1].hip = 0.45; pose.legs[0].knee = pose.legs[1].knee = 0.55; pose.legs[0].out = pose.legs[1].out = 0.12;
      pose.arms[0].pitch = pose.arms[1].pitch = 0.75; pose.arms[0].elbow = pose.arms[1].elbow = 0.25; pose.arms[0].out = pose.arms[1].out = 0.18;
      break;
    case 'clap':
      // Breaking the huddle.
      pose.lean = 0.25; pose.arms[0].pitch = pose.arms[1].pitch = 1.4 + Math.sin(t * 14) * 0.15; pose.arms[0].elbow = pose.arms[1].elbow = 0.6;
      pose.arms[0].out = pose.arms[1].out = -0.25 + Math.max(0, Math.sin(t * 14)) * 0.2;
      break;
    // ---- officials' signals ----
    case 'sig_td':
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 3.1; pose.arms[0].elbow = pose.arms[1].elbow = 0; pose.arms[0].out = pose.arms[1].out = 0.08;
      break;
    case 'sig_incomplete': {
      // Arms crossing back and forth at waist height.
      const w = Math.sin(t * 9);
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 0.9; pose.arms[0].elbow = pose.arms[1].elbow = 0;
      pose.arms[0].out = pose.arms[1].out = -0.25 + w * 0.7;
      break;
    }
    case 'sig_first':
      // Point downfield with the right arm.
      pose.lean = 0; pose.arms[1].pitch = 1.55; pose.arms[1].elbow = 0; pose.arms[1].out = 0.05;
      break;
    case 'sig_flag':
      // Throwing the flag.
      runLegs(Math.min(0.6, run)); pose.arms[1].pitch = 2.6 - Math.min(1, t / 0.3) * 1.2; pose.arms[1].elbow = 0.3;
      break;
    case 'sig_holding':
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 1.3; pose.arms[0].elbow = 0.9; pose.arms[1].elbow = 0.5;
      pose.arms[0].out = -0.45; pose.arms[1].out = -0.2; // one hand grips the other wrist
      break;
    case 'sig_offside':
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 0.25; pose.arms[0].elbow = pose.arms[1].elbow = 1.7; pose.arms[0].out = pose.arms[1].out = 0.75; // hands on hips
      break;
    case 'sig_pi':
      pose.lean = 0.05; pose.arms[0].pitch = pose.arms[1].pitch = 1.55 + Math.sin(t * 6) * 0.1; pose.arms[0].elbow = pose.arms[1].elbow = 0.1; pose.arms[0].out = pose.arms[1].out = -0.05; // push
      break;
    case 'sig_false_start': {
      const w = Math.sin(t * 10);
      pose.lean = 0; pose.arms[0].pitch = 1.3 + w * 0.3; pose.arms[1].pitch = 1.3 - w * 0.3; pose.arms[0].elbow = pose.arms[1].elbow = 1.6; pose.arms[0].out = pose.arms[1].out = -0.2; // rolling forearms
      break;
    }
    case 'sig_personal':
      pose.lean = 0; pose.arms[0].pitch = 0.9; pose.arms[0].elbow = 1.6; pose.arms[1].pitch = 2.9; pose.arms[1].elbow = 1.4; pose.arms[1].out = 0.3; // chop at the wrist overhead
      break;
    case 'sig_formation':
      // Forearms folded across the chest.
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 1.2; pose.arms[0].elbow = pose.arms[1].elbow = 1.9; pose.arms[0].out = pose.arms[1].out = -0.55;
      break;
    case 'sig_motion':
      // One flat hand sweeping sideways at shoulder height.
      pose.lean = 0; pose.arms[1].pitch = 1.5; pose.arms[1].elbow = 0.1; pose.arms[1].out = 0.2 + Math.sin(t * 5) * 0.6;
      break;
    case 'sig_contact':
      // One open hand pushed forward, the other at the side.
      pose.lean = 0.05; pose.arms[1].pitch = 1.5 + Math.sin(t * 7) * 0.08; pose.arms[1].elbow = 0.2 + Math.max(0, Math.sin(t * 7)) * 0.4; pose.arms[1].out = 0;
      break;
    case 'sig_grounding':
      // Both palms pushed down and out, toward the ground.
      pose.lean = 0.1; pose.arms[0].pitch = pose.arms[1].pitch = 0.7 + Math.sin(t * 6) * 0.15; pose.arms[0].elbow = pose.arms[1].elbow = 0.2; pose.arms[0].out = pose.arms[1].out = 0.35;
      break;
    case 'sig_kicker':
      // Personal-foul chop, then a kicking swing of the arm.
      pose.lean = 0; pose.arms[0].pitch = 0.9; pose.arms[0].elbow = 1.6;
      pose.arms[1].pitch = (t % 2) < 1 ? 2.9 : 0.4 + Math.sin(t * 7) * 0.9; pose.arms[1].elbow = (t % 2) < 1 ? 1.4 : 0.1; pose.arms[1].out = 0.25;
      break;
    case 'tired':
      // Hands on knees, breathing hard.
      pose.crouch = 0.22; pose.lean = 0.75 + Math.sin(t * 5) * 0.04; pose.head = -0.3;
      pose.arms[0].pitch = pose.arms[1].pitch = 1.05; pose.arms[0].elbow = pose.arms[1].elbow = 0.25;
      pose.arms[0].out = pose.arms[1].out = 0.12;
      break;
    case 'sig_timeout':
      // Timeout: both arms overhead, hands crossing back and forth.
      pose.lean = 0; pose.arms[0].pitch = pose.arms[1].pitch = 2.9; pose.arms[0].elbow = pose.arms[1].elbow = 0.15;
      pose.arms[0].out = pose.arms[1].out = -0.35 + Math.sin(t * 8) * 0.3;
      break;
    case 'sig_spot':
      // Spotting the ball / waving the play dead.
      pose.lean = 0.1; pose.arms[1].pitch = 2.8; pose.arms[1].elbow = 0.2; pose.arms[1].out = 0.4 + Math.sin(t * 8) * 0.25;
      break;
    default: // run
      runLegs(Math.min(1.05, 0.25 + run * 0.85));
  }
  // A ball carrier cradles it in the right arm (both arms when protecting it) instead of pumping that arm.
  const b = sim?.ball;
  if (b && b.carrier === p.id && b.state === 'held' && CARRY_ANIMS.has(p.anim) && p.slot !== undefined && !(p.task?.type === 'qb_pass' && !sim.passThrown)) {
    const left = p.ballArm === -1;
    const a = pose.arms[left ? 0 : 1];
    a.pitch = 0.55; a.elbow = 2.0; a.out = -0.2; a.twist = 0;
    pose.carryArm = left ? 0 : 1; // the gait's mocap leaves this arm alone
    if (p.protect) { const l = pose.arms[left ? 1 : 0]; l.pitch = 0.75; l.elbow = 1.9; l.out = -0.35; pose.carryArm = 2; }
  }
  return pose;
}
// Includes going down and getting up: a tackled runner keeps the ball cradled (drawn in his hand), so it never looks loose.
const CARRY_ANIMS = new Set(['run', 'idle', 'juke', 'spin', 'truck', 'stumble', 'hurdle', 'backpedal', 'falling', 'down', 'getup', 'dive', 'slide']);

/** Per-player gear, stable by number: visors on ~35% (more for skill players), towels on QBs and some skill players. */
function gearOf(p) {
  const k = ((p.number || 0) * 37 + (p.skin || 0) * 11) % 100;
  const skill = ['QB', 'HB', 'WR', 'CB', 'FS', 'SS'].includes(p.pos);
  const look = p.look || {};
  // The roster editor's appearance choices win over the automatic gear.
  const visor = look.visor && look.visor !== 'auto' ? look.visor !== 'none' : k < (skill ? 45 : 22);
  const towel = look.towel && look.towel !== 'auto' ? look.towel === 'yes' : p.pos === 'QB' || (skill && k % 3 === 0);
  return { visor, towel };
}
export const VISOR_COLORS = { dark: '#1a1f2a', gold: '#3a2a10', clear: '#9fb4c8' };

// ---------- matrix helpers ----------
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
// Preallocated pool so per-frame posing allocates nothing (no GC hitches).
const POOL = Array.from({ length: 200 }, () => new THREE.Matrix4());
let poolI = 0;
const M = () => POOL[poolI++];
const cl = (m) => M().copy(m);
function rotX(a) { return M().makeRotationX(a); }
function rotY(a) { return M().makeRotationY(a); }
function rotZ(a) { return M().makeRotationZ(a); }
function trans(x, y, z) { return M().makeTranslation(x, y, z); }
function scaleM(x, y, z) { return M().makeScale(x, y, z); }

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function isDark(hex) {
  const c = new THREE.Color(hex);
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114 < 0.45;
}

// ---------- gear geometry ----------
/**
 * Helmet shell in the old unit-sphere space (radius 0.5, scaled 0.33 per player so the decal still sits on it): a
 * rounded crown, jaw flaps that come down and forward at the sides, a lower back, and an open face below the brow.
 */
function helmetGeometry() {
  const NU = 36, NV = 20;
  const pos = [], idx = [];
  for (let j = 0; j <= NV; j++) {
    const v = (j / NV) * Math.PI * 0.86;
    for (let k = 0; k <= NU; k++) {
      const u = (k / NU) * Math.PI * 2;
      const f = Math.cos(u), sd = Math.sin(u);
      // A slightly longer crown front to back, a flared rim at the bottom.
      const r = 0.5 * (1 + Math.max(0, v - Math.PI * 0.6) * 0.12);
      let x = Math.sin(v) * sd * r * 0.95, y = Math.cos(v) * r * 0.95, z = Math.sin(v) * f * r * 1.08;
      // Jaw flaps pull forward along the cheeks.
      if (v > Math.PI * 0.55 && Math.abs(sd) > 0.5 && f > -0.2) z += (v - Math.PI * 0.55) * 0.18 * Math.abs(sd);
      pos.push(x, y, z);
    }
  }
  const keep = (u, v) => {
    const f = Math.cos(u), a = Math.abs(f + 0.05);
    if (f > 0.42) return v < Math.PI * 0.44; // the face opening below the brow
    if (f < -0.55) return v < Math.PI * 0.72; // the back sits above the neck
    return v < Math.PI * (0.86 - a * 0.1);
  };
  for (let j = 0; j < NV; j++) for (let k = 0; k < NU; k++) {
    const u = ((k + 0.5) / NU) * Math.PI * 2, v = ((j + 0.5) / NV) * Math.PI * 0.86;
    if (!keep(u, v)) continue;
    const a = j * (NU + 1) + k, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Facemask cage in head space (yards): three bars across the face and two uprights, joined to the shell at the sides. */
function facemaskGeometry() {
  const geos = [];
  const bar = (pts, r = 0.0075) => geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 16, r, 5, false));
  const arc = (y, rad, a0, a1, fwd = 0) => {
    const pts = [];
    for (let k = 0; k <= 8; k++) { const a = a0 + (a1 - a0) * (k / 8); pts.push([Math.sin(a) * rad, y, Math.cos(a) * rad * 1.05 + fwd]); }
    return pts;
  };
  bar(arc(-0.02, 0.172, -1.25, 1.25));
  bar(arc(-0.075, 0.19, -1.05, 1.05));
  bar(arc(-0.13, 0.175, -0.85, 0.85, -0.005));
  for (const s of [-1, 1]) {
    bar([[s * 0.06, -0.02, 0.176], [s * 0.065, -0.075, 0.19], [s * 0.055, -0.13, 0.172]]);
    bar([[s * 0.16, -0.02, 0.07], [s * 0.165, -0.075, 0.085], [s * 0.13, -0.13, 0.11]]);
  }
  const g = mergeGeometries(geos);
  geos.forEach((x) => x.dispose());
  return g;
}

/** A low-cut cleat: flat sole, rounded toe, higher heel counter (foot-bone space, toe toward +z). */
function cleatGeometry() {
  const g = new THREE.CapsuleGeometry(0.058, 0.19, 4, 10).rotateX(Math.PI / 2).scale(0.92, 0.62, 1);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    let y = p.getY(k), z = p.getZ(k);
    if (y < -0.022) y = -0.03 - (y + 0.022) * 0.1; // flat sole
    if (z < -0.06 && y > 0) y += (-0.06 - z) * 0.5; // heel counter
    if (z > 0.08) y -= (z - 0.08) * 0.25 * (y > 0 ? 1 : 0); // toe drops
    p.setY(k, y);
  }
  g.computeVertexNormals();
  return g;
}

/** The helmet's center stripe: a ribbon over the crown from the back rim to the brow (helmet unit space). */
function helmetStripeGeometry() {
  const pos = [], idx = [], N = 24, R = 0.508, hw = 0.05;
  for (let k = 0; k <= N; k++) {
    const t = -Math.PI * 0.62 + (k / N) * Math.PI * 1.04; // back rim → brow
    for (const sx of [-1, 1]) {
      const x = sx * hw, c = Math.sqrt(Math.max(0, R * R - x * x));
      pos.push(x * 0.95, Math.cos(t) * c * 0.95, Math.sin(t) * c * 1.08);
    }
    if (k < N) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
