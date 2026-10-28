// Minimal event emitter used to decouple the sim from UI/audio.
export class Emitter {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  emit(type, data) {
    const hs = this.handlers.get(type);
    if (hs) for (const fn of hs) fn(data);
    const all = this.handlers.get('*');
    if (all) for (const fn of all) fn(type, data);
  }
}
