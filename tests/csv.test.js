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
  it('accepts depth-chart slot names as positions (LT, RG, LE, ROLB...)', () => {
    const teams = generateLeagueRosters(defaultTeams(), 6);
    const csv = 'team,first,last,pos,number\n' + ['LT', 'RG', 'LE', 'ROLB', 'MIKE'].map((pos, i) => `${teams[2].abbr},Test,Player${i},${pos},${60 + i}`).join('\n');
    const r = importRosterRows(teams, parseCSV(csv));
    expect(r.skipped).toEqual([]);
    const got = ['Player0', 'Player1', 'Player2', 'Player3', 'Player4'].map((last) => teams[2].roster.find((p) => p.last === last).pos);
    expect(got).toEqual(['T', 'G', 'DE', 'OLB', 'MLB']);
  });

  it('round-trips through export', () => {
    const teams = generateLeagueRosters(defaultTeams(), 2);
    const rows = parseCSV(exportRosterCSV(teams));
    expect(rows).toHaveLength(32 * 53);
    expect(rows[0]).toHaveProperty('SPD');
  });
});

describe('league spreadsheets', () => {
  it('round-trips teams, full rosters and depth charts', async () => {
    const { exportTeamsCSV, importTeamsRows, exportDepthCSV, importDepthRows } = await import('../src/data/csv.js');
    const a = generateLeagueRosters(defaultTeams(), 3);
    a[5].city = 'Lakeview'; a[5].name = 'Herons'; a[5].abbr = 'LKV';
    const lkv = a[5];
    const qb2 = lkv.roster.find((p) => p.id === lkv.depth.QB[1]);
    lkv.depth.QB = [qb2.id, ...lkv.depth.QB.filter((id) => id !== qb2.id)];
    const teamsCsv = exportTeamsCSV(a, 5), rosterCsv = exportRosterCSV(a), depthCsv = exportDepthCSV(a);

    const b = generateLeagueRosters(defaultTeams(), 99); // a different league, overwritten by the files
    const tr = importTeamsRows(b, parseCSV(teamsCsv));
    expect(tr.playAs).toBe(5);
    expect(b[5].name).toBe('Herons');
    importRosterRows(b, parseCSV(rosterCsv));
    expect(importDepthRows(b, parseCSV(depthCsv))).toEqual([]);
    const bl = b[5];
    expect(bl.roster).toHaveLength(53);
    const starter = bl.roster.find((p) => p.id === bl.depth.QB[0]);
    expect(`${starter.first} ${starter.last} ${starter.number}`).toBe(`${qb2.first} ${qb2.last} ${qb2.number}`);
    expect(starter.ratings).toEqual(qb2.ratings);
  });

  it('uses the names column for shared numbers and players listed without one', async () => {
    const { importDepthRows } = await import('../src/data/csv.js');
    const t = generateLeagueRosters(defaultTeams(), 4)[0];
    const [te1, te2] = t.roster.filter((p) => p.pos === 'TE');
    te2.number = te1.number; // two players wearing the same number
    const [g1, g2] = t.roster.filter((p) => p.pos === 'G');
    const csv = `team,slot,players,names
${t.abbr},TE,${te1.number} ${te1.number},${te2.first[0]}. ${te2.last} / ${te1.first[0]}. ${te1.last}
${t.abbr},LG,-- ${g1.number},${g2.first[0]}. ${g2.last} Jr. / ${g1.first[0]}. ${g1.last}`;
    expect(importDepthRows([t], parseCSV(csv))).toEqual([]);
    expect(t.depth.TE).toEqual([te2.id, te1.id]);
    expect(t.depth.LG).toEqual([g2.id, g1.id]);
  });
});

describe('depth chart editing', () => {
  it('moves, adds and removes players in a slot', async () => {
    const { placeInDepth, removeFromDepth, eligibleForSlot } = await import('../src/data/depthChart.js');
    const t = generateLeagueRosters(defaultTeams(), 8)[3];
    const [a, b, c] = t.depth.HB;
    placeInDepth(t, 'HB', c, 0);
    expect(t.depth.HB.slice(0, 3)).toEqual([c, a, b]);
    const extra = eligibleForSlot(t, 'HB')[0];
    expect(t.depth.HB).not.toContain(extra.id);
    placeInDepth(t, 'HB', extra.id, 1);
    expect(t.depth.HB[1]).toBe(extra.id);
    removeFromDepth(t, 'HB', extra.id);
    expect(t.depth.HB).not.toContain(extra.id);
    removeFromDepth(t, 'QB', t.depth.QB[0]);
    while (t.depth.QB.length > 1) removeFromDepth(t, 'QB', t.depth.QB[0]);
    expect(removeFromDepth(t, 'QB', t.depth.QB[0])).toHaveLength(1); // never empty
  });
});

describe('in-game spreadsheet import', () => {
  it('recognizes teams, roster and depth files by their columns', async () => {
    const { csvKind } = await import('../src/ui/spreadsheets.js');
    const { exportTeamsCSV, exportDepthCSV } = await import('../src/data/csv.js');
    const teams = generateLeagueRosters(defaultTeams(), 21);
    expect(csvKind(parseCSV(exportTeamsCSV(teams, 0)))).toBe('teams');
    expect(csvKind(parseCSV(exportRosterCSV(teams)))).toBe('roster');
    expect(csvKind(parseCSV(exportDepthCSV(teams)))).toBe('depth');
    expect(csvKind(parseCSV('a,b\n1,2'))).toBeNull();
  });
});
