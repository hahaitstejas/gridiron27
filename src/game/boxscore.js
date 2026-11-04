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

// Columns: [label, display(s), sort value(s)] — the stat screens sort by any column (X).
const pct = (a, b) => (b ? (100 * a) / b : 0);
export const STAT_TABS = [
  { id: 'passing', label: 'Passing', has: (s) => s.passAtt > 0, sort: (s) => s.passYds,
    cols: [['C/ATT', (s) => `${s.passCmp}/${s.passAtt}`, (s) => s.passCmp], ['CMP%', (s) => pct(s.passCmp, s.passAtt).toFixed(1), (s) => pct(s.passCmp, s.passAtt)],
      ['YDS', (s) => r(s.passYds), (s) => s.passYds], ['TD', (s) => s.passTD], ['INT', (s) => s.int],
      ['Y/A', (s) => avg(s.passYds, s.passAtt), (s) => (s.passAtt ? s.passYds / s.passAtt : 0)], ['RTG', (s) => passerRating(s).toFixed(1), (s) => passerRating(s)]] },
  { id: 'rushing', label: 'Rushing', has: (s) => s.rushAtt > 0, sort: (s) => s.rushYds,
    cols: [['CAR', (s) => s.rushAtt], ['YDS', (s) => r(s.rushYds), (s) => s.rushYds], ['AVG', (s) => avg(r(s.rushYds), s.rushAtt), (s) => (s.rushAtt ? s.rushYds / s.rushAtt : 0)], ['TD', (s) => s.rushTD]] },
  { id: 'receiving', label: 'Receiving', has: (s) => s.rec > 0 || s.tgt > 0, sort: (s) => s.recYds,
    cols: [['TGT', (s) => s.tgt || s.rec], ['REC', (s) => s.rec], ['CTH%', (s) => pct(s.rec, s.tgt || s.rec).toFixed(1), (s) => pct(s.rec, s.tgt || s.rec)],
      ['YDS', (s) => r(s.recYds), (s) => s.recYds], ['AVG', (s) => avg(r(s.recYds), s.rec), (s) => (s.rec ? s.recYds / s.rec : 0)], ['TD', (s) => s.recTD]] },
  { id: 'defense', label: 'Defense', has: (s) => s.tackles + s.sacks + s.defInt + s.ff > 0, sort: (s) => s.tackles + s.sacks * 2 + s.defInt * 3 + s.ff * 2,
    cols: [['TKL', (s) => s.tackles], ['SACK', (s) => s.sacks], ['INT', (s) => s.defInt], ['FF', (s) => s.ff]] },
  { id: 'kicking', label: 'Kicking', has: (s) => s.fgAtt + s.xpAtt + s.punts > 0, sort: (s) => s.fgMade * 3 + s.xpMade + s.punts,
    cols: [['FG', (s) => `${s.fgMade}/${s.fgAtt}`, (s) => s.fgMade], ['FG%', (s) => pct(s.fgMade, s.fgAtt).toFixed(1), (s) => pct(s.fgMade, s.fgAtt)], ['XP', (s) => `${s.xpMade}/${s.xpAtt}`, (s) => s.xpMade],
      ['PUNTS', (s) => s.punts], ['P AVG', (s) => avg(s.puntYds, s.punts), (s) => (s.punts ? s.puntYds / s.punts : 0)]] },
];

/** Sort value of column `ci` for a stat line (numeric). */
export function colValue(tab, ci, s) {
  const c = tab.cols[ci];
  if (c[2]) return c[2](s);
  const v = c[1](s);
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}


/**
 * Rows for one tab: every player with numbers in that category, best first.
 * team = null for both teams, or 0/1 for one. Returns [{ team, name, number, pos, cells: [...] }].
 */
export function statRows(m, tabId, team = null, sortCol = null, asc = false) {
  const tab = STAT_TABS.find((t) => t.id === tabId);
  const key = sortCol === null ? tab.sort : (s) => colValue(tab, sortCol, s);
  return Object.values(m.stats.players)
    .filter((s) => (team === null || s.team === team) && tab.has(s))
    .sort((a, b) => (asc ? key(a) - key(b) : key(b) - key(a)))
    .map((s) => {
      const p = m.teams[s.team].roster.find((x) => x.id === s.rid);
      return { team: s.team, name: p ? `${p.first[0]}. ${p.last}` : '?', number: p?.number ?? '', pos: p?.pos ?? '', cells: tab.cols.map(([, f]) => f(s)) };
    });
}
