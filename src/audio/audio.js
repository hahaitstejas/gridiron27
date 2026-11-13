// Game audio, all synthesized with Web Audio (no sound files): a stadium crowd bed that follows the game's excitement,
// roars / groans on big plays, referee whistles, pad hits, kicks, the snap, catches, a touchdown horn and menu clicks.
// Read-only like the rest of the presentation: main.js feeds it session / sim events and the crowd level each frame.
// Volumes come from prefs (`volume`, `crowdVolume`, `sfxVolume`, 0..1); nothing plays until the first user gesture.

let ctx = null;
let master = null, crowdBus = null, sfxBus = null;
let noiseBuf = null, brownBuf = null;
let bed = null; // { gain, roar, roarF } the crowd bed
let level = 0.2, target = 0.2, swell = 0; // crowd excitement (0..1) and a short extra swell after events
let vols = { volume: 0.8, crowdVolume: 0.7, sfxVolume: 0.8 };
let unlocked = false;

/** Create the audio graph (call from a user gesture: key, click or pad button). Safe to call repeatedly. */
export function unlockAudio() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain(); master.connect(ctx.destination);
    // A gentle compressor on everything so a roar plus a hit never clips.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    comp.connect(master);
    crowdBus = ctx.createGain(); crowdBus.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    noiseBuf = makeNoise(2.5, false);
    brownBuf = makeNoise(3.5, true);
    applyVolumes();
  }
  if (ctx.state === 'suspended') ctx.resume();
  unlocked = true;
}

export function setVolumes(prefs = {}) {
  vols = { volume: prefs.volume ?? 0.8, crowdVolume: prefs.crowdVolume ?? 0.7, sfxVolume: prefs.sfxVolume ?? 0.8 };
  applyVolumes();
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(vols.volume, t, 0.05);
  crowdBus.gain.setTargetAtTime(vols.crowdVolume, t, 0.05);
  sfxBus.gain.setTargetAtTime(vols.sfxVolume, t, 0.05);
}

function makeNoise(secs, brown) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
  }
  return b;
}

const noiseSrc = (buf = noiseBuf, loop = false) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; };

// ---------------------------------------------------------------------------------------------------------------
// The crowd: brown + band-passed white noise (the murmur of thousands of voices), a slow wobble, and a "roar" layer
// (higher, brighter band) that opens with excitement.

function startBed() {
  if (bed || !ctx) return;
  const t = ctx.currentTime;
  const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(crowdBus);
  // Murmur: brown noise through a broad mid band.
  const m = noiseSrc(brownBuf, true);
  const mf = ctx.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 420; mf.Q.value = 0.6;
  const mg = ctx.createGain(); mg.gain.value = 0.9;
  m.connect(mf).connect(mg).connect(gain);
  // Voices: white noise in the vowel band, slowly wobbling (a crowd breathes).
  const v = noiseSrc(noiseBuf, true);
  const vf = ctx.createBiquadFilter(); vf.type = 'bandpass'; vf.frequency.value = 900; vf.Q.value = 1.1;
  const vg = ctx.createGain(); vg.gain.value = 0.12;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.17;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.05;
  lfo.connect(lfoG).connect(vg.gain);
  v.connect(vf).connect(vg).connect(gain);
  // Roar: brighter band that opens with excitement.
  const r = noiseSrc(noiseBuf, true);
  const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 1300; rf.Q.value = 0.8;
  const roar = ctx.createGain(); roar.gain.value = 0;
  r.connect(rf).connect(roar).connect(gain);
  m.start(t); v.start(t, 0.7); r.start(t, 1.3); lfo.start(t);
  bed = { gain, roar, rf, srcs: [m, v, r, lfo] };
}

function stopBed() {
  if (!bed) return;
  const t = ctx.currentTime;
  bed.gain.gain.setTargetAtTime(0, t, 0.4);
  const b = bed; bed = null;
  setTimeout(() => { for (const s of b.srcs) { try { s.stop(); } catch { /* already stopped */ } } b.gain.disconnect(); }, 2500);
}

/**
 * Every frame. `crowd` = the game's excitement (0..1, main.js `excite`) or null outside a game (the bed fades out).
 * `paused` ducks the crowd.
 */
export function updateAudio(dt, crowd, paused = false) {
  if (!ctx || !unlocked) return;
  if (crowd === null || crowd === undefined) { stopBed(); return; }
  startBed();
  target = Math.max(0, Math.min(1, crowd));
  swell = Math.max(0, swell - dt * 0.35);
  level += (target - level) * Math.min(1, dt * 1.5);
  const t = ctx.currentTime, e = Math.min(1.3, level + swell);
  bed.gain.gain.setTargetAtTime((paused ? 0.25 : 1) * (0.18 + 0.22 * e), t, 0.15);
  bed.roar.gain.setTargetAtTime(Math.max(0, e - 0.35) * 0.55, t, 0.12);
  bed.rf.frequency.setTargetAtTime(1100 + 600 * e, t, 0.3);
  // The chant: one "DE-FENSE (clap clap)" bar every 1.45 s while it's on.
  if (chant > 0.05 && !paused) {
    if (chantNext < t) chantNext = t + 0.05;
    while (chantNext < t + 0.3) { chantBeat(chantNext, chant); chantNext += 1.45; }
  } else chantNext = 0;
}

// The home crowd's two-syllable "DE-FENSE" chant while the visitors are at the line on a big down: thousands of voices
// = band-passed noise shaped like two vowels ("eh" short, then "ehns" longer and lower), with a clap on each beat.
let chant = 0, chantNext = 0;
/** 0..1: how hard the crowd chants (0 stops it). */
export function setChant(v) { chant = Math.max(0, Math.min(1, v || 0)); }

function chantBeat(t, amt) {
  const syl = (at, f1, f2, len, a) => {
    for (const [f, q, g0] of [[f1, 4, 1], [f2, 5, 0.6]]) {
      const s = noiseSrc(), bf = ctx.createBiquadFilter(), g = ctx.createGain();
      bf.type = 'bandpass'; bf.frequency.value = f; bf.Q.value = q;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(a * g0, at + 0.05);
      g.gain.setValueAtTime(a * g0, at + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      s.connect(bf).connect(g).connect(crowdBus); s.start(at, Math.random() * 2); s.stop(at + len + 0.05);
    }
  };
  syl(t, 560, 1700, 0.28, 1.1 * amt);        // DE
  syl(t + 0.42, 470, 1500, 0.5, 1.2 * amt);  // FENSE
  for (const at of [t + 0.84, t + 1.05]) {   // clap clap
    const s = noiseSrc(), bf = ctx.createBiquadFilter(), g = ctx.createGain();
    bf.type = 'bandpass'; bf.frequency.value = 1500; bf.Q.value = 0.8;
    env(g, at, 0.004, 0.55 * amt, 0.08);
    s.connect(bf).connect(g).connect(crowdBus); s.start(at, Math.random() * 2); s.stop(at + 0.15);
  }
}

/** A burst of crowd reaction: `amt` 0..1 (a roar that fades over a few seconds). */
export function crowdSwell(amt = 0.6) { swell = Math.max(swell, amt); }

/** A groan: the crowd's pitch sags (the visitors made a play). */
export function crowdGroan(amt = 0.5) {
  if (!ctx || !bed) return;
  const t = ctx.currentTime;
  const s = noiseSrc(brownBuf), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.Q.value = 1.5; f.frequency.setValueAtTime(520, t); f.frequency.exponentialRampToValueAtTime(260, t + 1.4);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * amt, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
  s.connect(f).connect(g).connect(crowdBus); s.start(t); s.stop(t + 1.9);
}

// ---------------------------------------------------------------------------------------------------------------
// Effects.

function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

/** Referee whistle: a pea whistle trill (two beating sines + a little breath noise). `n` blasts. */
export function whistle(n = 1, len = 0.32) {
  if (!ctx) return;
  for (let k = 0; k < n; k++) {
    const t = ctx.currentTime + k * (len + 0.12);
    const g = ctx.createGain(); g.connect(sfxBus);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.setValueAtTime(0.16, t + len - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.frequency.value = 2900; o2.frequency.value = 2945;
    const trill = ctx.createOscillator(), tg = ctx.createGain(); trill.frequency.value = 28; tg.gain.value = 70;
    trill.connect(tg); tg.connect(o1.frequency); tg.connect(o2.frequency);
    o1.connect(g); o2.connect(g);
    const b = noiseSrc(), bf = ctx.createBiquadFilter(), bg = ctx.createGain();
    bf.type = 'highpass'; bf.frequency.value = 3500; bg.gain.value = 0.25;
    b.connect(bf).connect(bg).connect(g);
    for (const o of [o1, o2, trill]) { o.start(t); o.stop(t + len); }
    b.start(t); b.stop(t + len);
  }
}

/** Pads colliding: a dull plastic crack and a low body thump. `power` 0..1+. */
export function hit(power = 0.5) {
  if (!ctx) return;
  const t = ctx.currentTime, p = Math.min(1.4, Math.max(0.15, power));
  const s = noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 400; f.Q.value = 1.2;
  env(g, t, 0.003, 0.5 * p, 0.09 + 0.05 * p);
  s.connect(f).connect(g).connect(sfxBus); s.start(t, Math.random()); s.stop(t + 0.3);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  env(og, t, 0.004, 0.7 * p, 0.2);
  o.connect(og).connect(sfxBus); o.start(t); o.stop(t + 0.3);
}

/** Foot on ball: a hollow thump with a leather snap. */
export function kick(power = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  env(og, t, 0.002, 0.8 * power, 0.16);
  o.connect(og).connect(sfxBus); o.start(t); o.stop(t + 0.25);
  const s = noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'highpass'; f.frequency.value = 1800;
  env(g, t, 0.001, 0.35 * power, 0.05);
  s.connect(f).connect(g).connect(sfxBus); s.start(t, Math.random()); s.stop(t + 0.1);
}

/** Ball into hands: a soft slap. */
export function catchSound() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.9;
  env(g, t, 0.002, 0.4, 0.07);
  s.connect(f).connect(g).connect(sfxBus); s.start(t, Math.random()); s.stop(t + 0.12);
}

/** The throw: a short whoosh of air. */
export function whoosh(strength = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.22);
  env(g, t, 0.06, 0.16 * strength, 0.2);
  s.connect(f).connect(g).connect(sfxBus); s.start(t, Math.random()); s.stop(t + 0.35);
}

/** The snap call: a short barked "hut" (a voiced formant burst). */
export function hut(pitch = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(150 * pitch, t); o.frequency.exponentialRampToValueAtTime(110 * pitch, t + 0.16);
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 650; f1.Q.value = 3;
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1100; f2.Q.value = 4;
  const mix = ctx.createGain(); mix.gain.value = 1;
  o.connect(f1).connect(mix); o.connect(f2).connect(mix);
  env(g, t, 0.01, 0.5, 0.14);
  mix.connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.2);
  // The 'h' before it.
  const s = noiseSrc(), sf = ctx.createBiquadFilter(), sg = ctx.createGain();
  sf.type = 'bandpass'; sf.frequency.value = 1600;
  env(sg, t - 0.0, 0.004, 0.12, 0.04);
  s.connect(sf).connect(sg).connect(sfxBus); s.start(t, Math.random()); s.stop(t + 0.06);
}

/** The QB's "Set!" once the line is down: an 's' hiss, a short 'eh' vowel, the 't' click. */
export function setCall(pitch = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = noiseSrc(), sf = ctx.createBiquadFilter(), sg = ctx.createGain();
  sf.type = 'highpass'; sf.frequency.value = 4200;
  env(sg, t, 0.01, 0.1, 0.08);
  s.connect(sf).connect(sg).connect(sfxBus); s.start(t, Math.random()); s.stop(t + 0.12);
  const v = t + 0.07;
  const o = ctx.createOscillator(), g = ctx.createGain(), mix = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(165 * pitch, v); o.frequency.exponentialRampToValueAtTime(130 * pitch, v + 0.15);
  for (const [f, q] of [[560, 4], [1850, 6]]) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; o.connect(b).connect(mix); }
  env(g, v, 0.01, 0.42, 0.13);
  mix.connect(g).connect(sfxBus); o.start(v); o.stop(v + 0.18);
  const c = noiseSrc(), cf = ctx.createBiquadFilter(), cg = ctx.createGain();
  cf.type = 'bandpass'; cf.frequency.value = 3000;
  env(cg, v + 0.17, 0.002, 0.12, 0.02);
  c.connect(cf).connect(cg).connect(sfxBus); c.start(v + 0.17, Math.random()); c.stop(v + 0.22);
}

/** The stadium horn after a home touchdown: a big brassy chord. */
export function horn() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [fq, a] of [[110, 0.22], [138.6, 0.16], [165, 0.16], [220, 0.1]]) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = fq;
    f.type = 'lowpass'; f.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.08);
    g.gain.setValueAtTime(a, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(f).connect(g).connect(sfxBus); o.start(t); o.stop(t + 2.3);
  }
}

/** Menu: a short tick on focus moves and a slightly fuller click on select / back. */
export function uiTick(kind = 'move') {
  if (!ctx || !unlocked) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = kind === 'select' ? 880 : kind === 'back' ? 440 : 1320;
  env(g, t, 0.002, kind === 'move' ? 0.05 : 0.1, kind === 'move' ? 0.03 : 0.07);
  o.connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.12);
}

/** For tests / dev tools: is the context running, is the crowd bed up, and how loud is the crowd right now. */
export const audioDebug = () => ({ state: ctx?.state ?? 'none', bed: !!bed, level: +(level + swell).toFixed(2) });
