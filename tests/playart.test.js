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
