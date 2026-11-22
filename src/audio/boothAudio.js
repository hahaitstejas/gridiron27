// Plays the booth's calls (game/booth.js) from the recorded clips in voice/clips (`npm run voices`). Render side, like
// the rest of audio/. Each call is a list of clips stitched back to back with a tiny gap; big calls cut in, filler is
// dropped when something is already playing, and a call that waited past its `ttl` is thrown away (a live call about the
// catch is no use once the runner is ten yards on). Clips are fetched once (compressed) and decoded when first needed.
import { voiceOut, duckCrowd } from './audio.js';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const GAP = 0.035; // seconds between stitched clips

export class BoothAudio {
  constructor() {
    this.have = new Set(); // clip ids that exist (voice/index.json)
    this.ready = false;
    this.bytes = new Map(); // id -> Promise<ArrayBuffer>
    this.decoded = new Map(); // id -> AudioBuffer (most recent first, capped)
    this.queue = [];
    this.playing = null; // { sources, end, pri }
    this.onLine = null; // subtitles: (who, ids | null)
  }

  /** Read voice/index.json; no file (voices not recorded yet) = the booth stays off. */
  async load(tries = 3) {
    for (let k = 0; k < tries && !this.ready; k++) {
      try {
        const r = await fetch(`${BASE}voice/index.json`, { cache: 'no-cache' });
        if (r.status === 404) return false; // not recorded: no point asking again
        if (r.ok) { const j = await r.json(); this.have = new Set(j.clips || []); this.ready = this.have.size > 0; }
      } catch { /* the page is still starting up: try again */ }
      if (!this.ready) await new Promise((res) => setTimeout(res, 1500 * (k + 1)));
    }
    return this.ready;
  }

  /** Start fetching clips ahead of time (the phrases, and the names of the players in this game). */
  prefetch(ids) { for (const id of ids) if (this.have.has(id)) this.fetch(id); }

  fetch(id) {
    if (!this.bytes.has(id)) this.bytes.set(id, fetch(`${BASE}voice/clips/${id}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
    return this.bytes.get(id);
  }

  async buffer(ctx, id) {
    if (this.decoded.has(id)) { const b = this.decoded.get(id); this.decoded.delete(id); this.decoded.set(id, b); return b; }
    const raw = await this.fetch(id);
    if (!raw) return null;
    const b = await ctx.decodeAudioData(raw.slice(0)).catch(() => null);
    if (b) { this.decoded.set(id, b); if (this.decoded.size > 160) this.decoded.delete(this.decoded.keys().next().value); }
    return b;
  }

  /** Calls from the booth: [{ parts, who, pri, ttl }]. */
  say(calls) {
    const now = performance.now() / 1000;
    for (const c of calls) {
      if (!c.parts?.length) continue;
      if (c.pri >= 2) { this.queue = []; this.stopCurrent(); }
      else if (c.pri <= 0 && (this.playing || this.queue.length)) continue;
      if (this.queue.length >= 3) this.queue.shift();
      this.queue.push({ ...c, at: now });
    }
    this.pump();
  }

  async pump() {
    if (this.playing || this.busy) return;
    const out = voiceOut();
    if (!out) { this.queue = []; return; }
    let c;
    const now = performance.now() / 1000;
    while ((c = this.queue.shift()) && now - c.at > c.ttl) { /* stale */ }
    if (!c) return;
    this.busy = true;
    const bufs = (await Promise.all(c.parts.map((id) => this.buffer(out.ctx, id)))).filter(Boolean);
    this.busy = false;
    if (!bufs.length || performance.now() / 1000 - c.at > c.ttl + 0.4) { this.pump(); return; }
    const { ctx } = out;
    let t = ctx.currentTime + 0.02;
    const sources = bufs.map((b) => {
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(out.out); s.start(t);
      t += b.duration + GAP;
      return s;
    });
    const me = (this.playing = { sources, end: t, pri: c.pri });
    duckCrowd(1);
    this.onLine?.(c.who, c.parts);
    sources[sources.length - 1].onended = () => {
      if (this.playing !== me) return;
      this.playing = null;
      duckCrowd(0);
      this.onLine?.(null, null);
      this.pump();
    };
  }

  stopCurrent() {
    if (!this.playing) return;
    for (const s of this.playing.sources) { try { s.onended = null; s.stop(); } catch { /* not started */ } }
    this.playing = null;
    duckCrowd(0);
    this.onLine?.(null, null);
  }

  /** Quiet: menus, pause, replays, the end of a game. */
  stop() { this.queue = []; this.stopCurrent(); }
}
