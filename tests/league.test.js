import { describe, it, expect } from 'vitest';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters, generatePlayer } from '../src/data/generator.js';
import { serializeLeague, deserializeLeague, freeNumber } from '../src/data/league.js';
import { RNG } from '../src/core/rng.js';

describe('league saves', () => {
  it('round-trips teams, rosters, depth charts and logos through JSON', () => {
    const teams = generateLeagueRosters(defaultTeams(), 11);
    teams[4].city = 'Harbor City'; teams[4].colors.primary = '#123456';
    teams[4].logo = { ...teams[4].logo, shape: 'star', text: 'HC', dataUrl: 'data:image/png;base64,AAAA', _img: { not: 'saved' } };
    const p = teams[4].roster[0];
    p.ratings.speed = 99; p.first = 'Test';
    teams[4].depth.QB = [teams[4].depth.QB[1], teams[4].depth.QB[0]];
    const json = JSON.stringify(serializeLeague(teams, { name: 'Test League', playAs: 4 }));
    const L = deserializeLeague(JSON.parse(json));
    expect(L.name).toBe('Test League');
    expect(L.playAs).toBe(4);
    const t = L.teams[4];
    expect(t.city).toBe('Harbor City');
    expect(t.colors.primary).toBe('#123456');
    expect(t.logo.shape).toBe('star');
    expect(t.logo.dataUrl).toBe('data:image/png;base64,AAAA');
    expect(t.logo._img).toBeUndefined();
    expect(t.roster.find((q) => q.id === p.id).ratings.speed).toBe(99);
    expect(t.depth.QB).toEqual(teams[4].depth.QB);
    expect(t.roster).toHaveLength(53);
  });

  it('repairs missing depth slots and keeps new player ids unique', () => {
    const teams = generateLeagueRosters(defaultTeams(), 12);
    const data = JSON.parse(JSON.stringify(serializeLeague(teams)));
    delete data.teams[0].depth.WR;
    data.teams[0].depth.QB = [999999];
    const L = deserializeLeague(data);
    expect(L.teams[0].depth.WR.length).toBeGreaterThan(0);
    expect(L.teams[0].depth.QB.length).toBeGreaterThan(0);
    const maxId = Math.max(...L.teams.flatMap((t) => t.roster.map((q) => q.id)));
    expect(generatePlayer('WR', new RNG(1)).id).toBeGreaterThan(maxId);
    expect(() => deserializeLeague({ teams: [] })).toThrow();
  });

  it('finds a free jersey number', () => {
    const t = generateLeagueRosters(defaultTeams(), 13)[0];
    const n = freeNumber(t);
    expect(t.roster.some((p) => p.number === n)).toBe(false);
    expect(freeNumber(t, t.roster[0].number)).not.toBe(t.roster[0].number);
  });
});

describe('roster edits', () => {
  it('adds, releases, trades and re-positions players with consistent depth charts', async () => {
    const { addPlayer, releasePlayer, tradePlayer, changePosition } = await import('../src/data/rosterOps.js');
    const teams = generateLeagueRosters(defaultTeams(), 14);
    const [a, b] = teams;
    const allDepthIds = (t) => Object.values(t.depth).flat();
    const qb1 = a.depth.QB[0];
    releasePlayer(a, qb1);
    expect(a.roster.some((p) => p.id === qb1)).toBe(false);
    expect(allDepthIds(a)).not.toContain(qb1);
    expect(a.depth.QB.length).toBeGreaterThan(0);
    const wr = a.depth.WR[0];
    const num = a.roster.find((p) => p.id === wr).number;
    b.roster.find((p) => p.number !== num).number = num; // force a number clash on the new team
    tradePlayer(a, b, wr);
    expect(allDepthIds(a)).not.toContain(wr);
    expect(b.depth.WR).toContain(wr);
    expect(new Set(b.roster.map((p) => p.number)).size).toBe(b.roster.length);
    const p = generatePlayer('CB', new RNG(3));
    addPlayer(b, p);
    expect(b.depth.CB).toContain(p.id);
    changePosition(b, p, 'FS');
    expect(b.depth.CB).toContain(p.id); // a safety can still play corner
    expect(b.depth.FS).toContain(p.id);
    changePosition(b, p, 'QB');
    expect(b.depth.CB).not.toContain(p.id);
    expect(b.depth.QB).toContain(p.id);
    for (const t of [a, b]) for (const ids of Object.values(t.depth)) for (const id of ids) expect(t.roster.some((q) => q.id === id)).toBe(true);
  });
});
