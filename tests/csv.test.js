import { describe, it, expect } from 'vitest';
import { parseCSV, importRosterRows, exportRosterCSV } from '../src/data/csv.js';
import { defaultTeams } from '../src/data/teams.js';
import { generateLeagueRosters } from '../src/data/generator.js';

describe('roster CSV', () => {
  it('parses quoted fields', () => {
    const rows = parseCSV('team,first,last,pos\nCHI,"Jo, Jr",O\'Neil,QB\n');
    expect(rows).toEqual([{ team: 'CHI', first: 'Jo, Jr', last: "O'Neil", pos: 'QB' }]);
  });
  it('imports partial rosters as pinned starters and keeps 53 players', () => {
    const teams = generateLeagueRosters(defaultTeams(), 1);
    const chi = teams.find((t) => t.abbr === 'CHI');
    const csv = 'team,first,last,pos,number,SPD\nCHI,Test,Passer,QB,,\nCHI,Fast,Corner,CB,24,95\nCHI,Slot,Corner,NB,,\nCHI,Run,Back,RB,,';
    const s = importRosterRows(teams, parseCSV(csv));
    expect(s.imported).toBe(4);
    expect(chi.roster).toHaveLength(53);
    const byId = (id) => chi.roster.find((p) => p.id === id);
    expect(byId(chi.depth.QB[0]).last).toBe('Passer');
    expect(byId(chi.depth.HB[0]).last).toBe('Back');
    expect(byId(chi.depth.CB[0]).last).toBe('Corner');
    expect(byId(chi.depth.CB[0]).ratings.speed).toBe(95);
    expect(byId(chi.depth.CB[0]).number).toBe(24);
    expect(new Set(chi.roster.map((p) => p.number)).size).toBe(53);
  });
  it('round-trips through export', () => {
    const teams = generateLeagueRosters(defaultTeams(), 2);
    const rows = parseCSV(exportRosterCSV(teams));
    expect(rows).toHaveLength(32 * 53);
    expect(rows[0]).toHaveProperty('SPD');
  });
});
