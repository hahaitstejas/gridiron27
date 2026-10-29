// Procedural game audio (Web Audio API, no sample files): crowd ambience that follows the action,
// whistles, hits, catches, kicks, a stadium horn and crowd reactions, menu clicks. Browser-only;
// reads game events, never touches the sim.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.levels = { master: 0.8, crowd: 0.7, sfx: 0.8 };
    this.crowdTarget = 0.25;
  }

  /** Create/resume the audio context. Call from user gestures (browsers block autoplay). */
  ensure() {
    try {
      if (!this.ctx) this.build();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* no audio available */ }
  }

  build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.crowdBus = ctx.createGain();
    this.crowdBus.connect(this.master);
    // Two seconds of white noise, reused by every noisy sound.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Crowd bed: low rumble + a murmur band whose loudness wobbles like many voices.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 520;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 0.7;
    const bandGain = ctx.createGain(); bandGain.gain.value = 0.35;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.12;
    lfo.connect(lfoAmt); lfoAmt.connect(bandGain.gain); lfo.start();
    this.crowd = ctx.createGain();
    this.crowd.gain.value = 0;
    src.connect(low); low.connect(this.crowd);
    src.connect(band); band.connect(bandGain); bandGain.connect(this.crowd);
    this.crowd.connect(this.crowdBus);
    src.start();
    this.applyLevels();
  }

  setLevels(levels) {
    Object.assign(this.levels, levels);
    this.applyLevels();
  }

  applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.levels.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.levels.sfx, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.levels.crowd, t, 0.05);
  }

  /** Per frame: crowd loudness follows excitement (0..1); 0 = silent (menus). */
  setExcitement(x) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.crowd.gain.setTargetAtTime(0.06 + x * 0.32, this.ctx.currentTime, 0.4);
  }

  // ---------- building blocks ----------
  env(node, t0, attack, peak, decay) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  noiseBurst({ type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.005, decay = 0.1, to = this.sfx, sweep = null }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, decay);
    src.connect(f); f.connect(g); g.connect(to);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ type = 'sine', freq = 440, to2 = null, peak = 0.3, attack = 0.005, decay = 0.15, delay = 0, dest = this.sfx }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to2) o.frequency.exponentialRampToValueAtTime(to2, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, decay);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  ready() { return this.ctx && this.ctx.state === 'running'; }

  // ---------- game sounds ----------
  whistle() {
    if (!this.ready()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    this.env(g, t, 0.02, 0.22, 0.45);
    const trem = ctx.createOscillator(); trem.frequency.value = 32;
    const tremAmt = ctx.createGain(); tremAmt.gain.value = 0.08;
    trem.connect(tremAmt); tremAmt.connect(g.gain);
    for (const f of [2950, 3120]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(g); o.start(t); o.stop(t + 0.55);
    }
    trem.start(t); trem.stop(t + 0.55);
    g.connect(this.sfx);
  }

  hit(power = 0.5) {
    if (!this.ready()) return;
    const p = Math.min(1.4, Math.max(0.2, power));
    this.noiseBurst({ type: 'lowpass', freq: 260 + p * 200, peak: 0.25 + p * 0.45, decay: 0.12 + p * 0.06 });
    this.tone({ freq: 120, to2: 42, peak: 0.25 + p * 0.4, decay: 0.16 });
    if (p > 1) this.noiseBurst({ type: 'bandpass', freq: 1800, q: 0.8, peak: 0.25, decay: 0.08 }); // pads cracking
  }

  catchBall() {
    if (!this.ready()) return;
    this.noiseBurst({ type: 'bandpass', freq: 1400, q: 2.5, peak: 0.35, decay: 0.05 });
    this.tone({ freq: 260, to2: 180, peak: 0.12, decay: 0.05 });
  }

  kick() {
    if (!this.ready()) return;
    this.tone({ freq: 170, to2: 55, peak: 0.55, decay: 0.12 });
    this.noiseBurst({ type: 'highpass', freq: 2200, peak: 0.3, decay: 0.03 });
  }

  hut() {
    if (!this.ready()) return;
    // A short barked "hut": a buzzy tone through a vowel-ish formant.
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(115, t + 0.12);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 4;
    const g = ctx.createGain(); this.env(g, t, 0.01, 0.25, 0.11);
    o.connect(f); f.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + 0.15);
  }

  /** Crowd reaction: positive = roar (home team did something good), negative = groan. */
  react(amount) {
    if (!this.ready() || !amount) return;
    const a = Math.min(1, Math.abs(amount));
    if (amount > 0) {
      this.noiseBurst({ type: 'bandpass', freq: 1100, q: 0.5, peak: 0.25 + a * 0.5, attack: 0.25, decay: 1.2 + a * 1.8, to: this.crowdBus });
      this.noiseBurst({ type: 'lowpass', freq: 600, peak: 0.2 + a * 0.4, attack: 0.3, decay: 1.5 + a * 1.5, to: this.crowdBus });
    } else {
      this.noiseBurst({ type: 'bandpass', freq: 700, q: 1.2, peak: 0.15 + a * 0.3, attack: 0.15, decay: 1.0 + a, sweep: 260, to: this.crowdBus });
    }
  }

  horn() {
    if (!this.ready()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.06);
    g.gain.setValueAtTime(0.22, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    for (const fr of [196, 247, 294]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      o.connect(f); o.start(t); o.stop(t + 1.35);
    }
    f.connect(g); g.connect(this.sfx);
  }

  ui(kind) {
    if (!this.ready()) return;
    if (kind === 'move') this.tone({ freq: 720, peak: 0.08, decay: 0.03 });
    else if (kind === 'select') { this.tone({ freq: 880, peak: 0.12, decay: 0.05 }); this.tone({ freq: 1320, peak: 0.1, decay: 0.08, delay: 0.05 }); }
    else if (kind === 'back') this.tone({ freq: 520, to2: 380, peak: 0.1, decay: 0.07 });
  }
}
