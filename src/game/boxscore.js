// Full player box score by category, built from Match stats. Pure logic (the stats screen draws it).

const r = (v) => Math.round(v);
const avg = (yds, n) => (n ? (yds / n).toFixed(1) : '0.0');

/** Traditional passer rating (0–158.3). */
export function passerRating(s) {
  if (!s.passAtt) return 0;
  const c = (x) => Math.max(0, Math.min(2.375, x));
  const a = c((s.passCmp / s.passAtt - 0.3) * 5);
  const b = c((s.passYds / s.passAtt - 3) * 0.25);
  const t = c((s.passTD / s.passAtt) * 20);
  const i = c(2.375 - (s.int / s.passAtt) * 25);
  return ((a + b + t + i) / 6) * 100;
}

export const STAT_TABS = [
  { id: 'passing', label: 'Passing', has: (s) => s.passAtt > 0, sort: (s) => s.passYds,
    cols: [['C/ATT', (s) => `${s.passCmp}/${s.passAtt}`], ['YDS', (s) => r(s.passYds)], ['TD', (s) => s.passTD], ['INT', (s) => s.int],
      ['Y/A', (s) => avg(s.passYds, s.passAtt)], ['RTG', (s) => passerRating(s).toFixed(1)]] },
  { id: 'rushing', label: 'Rushing', has: (s) => s.rushAtt > 0, sort: (s) => s.rushYds,
    cols: [['CAR', (s) => s.rushAtt], ['YDS', (s) => r(s.rushYds)], ['AVG', (s) => avg(r(s.rushYds), s.rushAtt)], ['TD', (s) => s.rushTD]] },
  { id: 'receiving', label: 'Receiving', has: (s) => s.rec > 0, sort: (s) => s.recYds,
    cols: [['REC', (s) => s.rec], ['YDS', (s) => r(s.recYds)], ['AVG', (s) => avg(r(s.recYds), s.rec)], ['TD', (s) => s.recTD]] },
  { id: 'defense', label: 'Defense', has: (s) => s.tackles + s.sacks + s.defInt + s.ff > 0, sort: (s) => s.tackles + s.sacks * 2 + s.defInt * 3 + s.ff * 2,
    cols: [['TKL', (s) => s.tackles], ['SACK', (s) => s.sacks], ['INT', (s) => s.defInt], ['FF', (s) => s.ff]] },
  { id: 'kicking', label: 'Kicking', has: (s) => s.fgAtt + s.xpAtt + s.punts > 0, sort: (s) => s.fgMade * 3 + s.xpMade + s.punts,
    cols: [['FG', (s) => `${s.fgMade}/${s.fgAtt}`], ['XP', (s) => `${s.xpMade}/${s.xpAtt}`], ['PUNTS', (s) => s.punts], ['P AVG', (s) => avg(s.puntYds, s.punts)]] },
];

/**
 * Rows for one tab: every player with numbers in that category, best first.
 * team = null for both teams, or 0/1 for one. Returns [{ team, name, number, pos, cells: [...] }].
 */
export function statRows(m, tabId, team = null) {
  const tab = STAT_TABS.find((t) => t.id === tabId);
  return Object.values(m.stats.players)
    .filter((s) => (team === null || s.team === team) && tab.has(s))
    .sort((a, b) => tab.sort(b) - tab.sort(a))
    .map((s) => {
      const p = m.teams[s.team].roster.find((x) => x.id === s.rid);
      return { team: s.team, name: p ? `${p.first[0]}. ${p.last}` : '?', number: p?.number ?? '', pos: p?.pos ?? '', cells: tab.cols.map(([, f]) => f(s)) };
    });
}
