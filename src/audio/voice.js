// Commentary voice (render side, like the rest of audio/): speaks the booth's lines (game/commentary.js) with the
// browser's built-in speech (Web Speech API: free, offline, any name). Two voices, play-by-play and the analyst, picked
// from what the system offers; a short queue where big calls cut in and filler is dropped when the booth is busy, and
// stale lines are thrown away (nobody wants to hear about the last play after the next snap).
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// Voices we like when they exist (Mac / Chrome / Edge names), best first; else any English voice.
const PBP = ['Alex', 'Daniel', 'Google US English', 'Microsoft Guy Online (Natural) - English (United States)', 'Microsoft David - English (United States)', 'Aaron', 'Fred', 'Tom'];
const COLOR = ['Microsoft Davis Online (Natural) - English (United States)', 'Google UK English Male', 'Arthur', 'Oliver', 'Rishi', 'Eddy (English (US))', 'Reed (English (US))', 'Microsoft Mark - English (United States)'];

export class Voice {
  constructor() {
    this.enabled = !!synth;
    this.volume = 0.9;
    this.queue = [];
    this.busy = false;
    this.voices = { pbp: null, color: null };
    this.onLine = null; // subtitles: (who, text | null)
    if (synth) {
      this.pickVoices();
      synth.addEventListener?.('voiceschanged', () => this.pickVoices());
    }
  }

  get available() { return !!synth; }

  pickVoices() {
    const all = synth.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!all.length) return;
    const find = (names, not) => names.map((n) => all.find((v) => v.name === n && v !== not)).find(Boolean);
    const pbp = find(PBP) || all.find((v) => /en-US/i.test(v.lang)) || all[0];
    const color = find(COLOR, pbp) || all.find((v) => v !== pbp && /en-(GB|AU|US)/i.test(v.lang)) || pbp;
    this.voices = { pbp, color };
  }

  /** Lines from the brain: [{ who, text, pri }]. pri 2 cuts in, 0 is dropped when anything is playing or waiting. */
  say(lines, now = performance.now() / 1000) {
    if (!this.enabled || !synth) return;
    for (const l of lines) {
      if (l.pri >= 2) { this.queue = []; synth.cancel(); this.busy = false; }
      else if (l.pri <= 0 && (this.busy || this.queue.length)) continue;
      if (this.queue.length >= 2) this.queue.shift();
      this.queue.push({ ...l, at: now });
    }
    this.next();
  }

  next() {
    if (this.busy || !this.queue.length) return;
    const now = performance.now() / 1000;
    let l;
    while ((l = this.queue.shift()) && now - l.at > (l.who === 'color' ? 6 : 3.5)) { /* too old: skip */ }
    if (!l) return;
    const u = new SpeechSynthesisUtterance(l.text);
    const v = this.voices[l.who] || this.voices.pbp;
    if (v) u.voice = v;
    u.lang = v?.lang || 'en-US';
    u.volume = this.volume;
    // Play-by-play a touch quicker and brighter, the analyst slower and lower.
    u.rate = l.who === 'color' ? 1.0 : l.pri >= 2 ? 1.18 : 1.1;
    u.pitch = l.who === 'color' ? 0.85 : l.pri >= 2 ? 1.12 : 1.0;
    this.busy = true;
    this.onLine?.(l.who, l.text);
    const done = () => { if (this.current !== u) return; this.busy = false; this.current = null; this.onLine?.(l.who, null); setTimeout(() => this.next(), 150); };
    u.onend = done; u.onerror = done;
    this.current = u;
    synth.speak(u);
  }

  /** Stop talking (pause, replay, menus, the end of a game). */
  stop() {
    this.queue = [];
    if (synth && (this.busy || synth.speaking || synth.pending)) synth.cancel();
    this.busy = false;
    this.current = null;
    this.onLine?.(null, null);
  }
}
