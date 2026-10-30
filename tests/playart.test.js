import { describe, it, expect } from 'vitest';
import { RNG } from '../src/core/rng.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';
import { listOffPlays, listDefPlays } from '../src/data/playbook.js';
import { PlaySim } from '../src/sim/play.js';
import { playArt } from '../src/game/playArt.js';

const teams = generateLeagueRosters(defaultTeams(), 5);
const finite = (shapes) => shapes.lines.every((l) => l.pts.length >= 2 && l.pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)))
  && shapes.zones.every((z) => Number.isFinite(z.x) && Number.isFinite(z.z));

describe('pre-snap play art', () => {
  it('draws every offensive play (routes for pass plays, a run path for runs)', () => {
    const defs = listDefPlays();
    listOffPlays().forEach((play, i) => {
      const sim = new PlaySim({ rng: new RNG(i), teams: [teams[0], teams[1]], offIdx: 0, dir: i % 2 ? 1 : -1, losX: 0, ballZ: 3, offPlay: play, defPlay: defs[i % defs.length], humanTeam: 0 });
      const art = playArt(sim, 0);
      expect(finite(art)).toBe(true);
      if (play.type === 'run') expect(art.lines.some((l) => l.head && l.width > 0.4)).toBe(true);
      else expect(art.lines.filter((l) => l.head).length).toBeGreaterThan(0);
      // Routes stay readable: nothing drawn far downfield.
      for (const l of art.lines) for (const p of l.pts) expect(Math.abs(p.x)).toBeLessThan(60);
    });
  });
  it('draws every defense (zones, man, rushers)', () => {
    const offs = listOffPlays();
    listDefPlays().forEach((play, i) => {
      const sim = new PlaySim({ rng: new RNG(i), teams: [teams[2], teams[3]], offIdx: 0, dir: 1, losX: -10, ballZ: -3, offPlay: offs[i % offs.length], defPlay: play, humanTeam: 1 });
      const art = playArt(sim, 1);
      expect(finite(art)).toBe(true);
      expect(art.lines.length + art.zones.length).toBeGreaterThan(5);
    });
  });
});

describe('disguised coverage', async () => {
  const { shellOf } = await import('../src/ai/defense.js');
  const { getDefPlay } = await import('../src/data/playbook.js');
  it('shows the other safety shell before the snap and rotates after it', () => {
    const off = listOffPlays().find((p) => p.type === 'pass');
    for (const id of ['43_cover3', '43_cover2']) {
      const play = getDefPlay(id);
      const mk = (disguise) => new PlaySim({ rng: new RNG(3), teams: [teams[4], teams[5]], offIdx: 0, dir: 1, losX: 0, ballZ: 0, offPlay: off, defPlay: play, defAdj: disguise ? { disguise: true } : null });
      const plain = mk(false), dis = mk(true);
      const deepSafeties = (sim) => sim.defense().filter((d) => ['FS', 'SS'].includes(d.slot) && sim.toLocal(d.x, d.z).down > 11).length;
      expect(dis.disguise.real).toBe(shellOf(play));
      expect(deepSafeties(dis)).toBe(dis.disguise.shown);
      const fs = (sim) => sim.defense().find((d) => d.slot === 'FS');
      expect(Math.hypot(fs(dis).x - fs(plain).x, fs(dis).z - fs(plain).z)).toBeGreaterThan(1);
      dis.snap();
      for (let k = 0; k < 150; k++) dis.tick(1 / 60, null);
      expect(dis.state).not.toBe('presnap');
    }
  });
});

describe('pass protection calls', async () => {
  const { protectCall } = await import('../src/game/audibles.js');
  const { getOffPlay } = await import('../src/data/playbook.js');
  it('max protect keeps backs and tight ends in, everyone out releases them, reset restores the call', () => {
    for (const play of listOffPlays().filter((p) => p.type === 'pass')) {
      const max = protectCall(play, 'max');
      expect(max.read.length).toBeGreaterThan(0);
      for (const s of max.read) expect(max.routes[s]).not.toBe('block');
      const out = protectCall(play, 'out');
      expect(Object.values(out.routes).filter((r) => r === 'block').length).toBeLessThanOrEqual(Object.values(play.routes).filter((r) => r === 'block').length);
      expect(protectCall(protectCall(max, 'left'), 'reset')).toBe(play);
      expect(protectCall(play, 'right').prot).toBe('right');
      // Every variant still runs.
      for (const v of [max, out]) {
        const sim = new PlaySim({ rng: new RNG(2), teams: [teams[6], teams[7]], offIdx: 0, dir: 1, losX: -10, ballZ: 0, offPlay: v, defPlay: listDefPlays()[0] });
        sim.snap();
        for (let k = 0; k < 600 && !sim.finished; k++) sim.tick(1 / 60, null);
      }
    }
    expect(protectCall(getOffPlay('gun_doubles_iz'), 'max').type).toBe('run'); // runs ignore protection calls
  }, 60000);
});
