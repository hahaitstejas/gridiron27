import { el } from './nav.js';
import { STAT_TABS, statRows } from '../game/boxscore.js';

/** Full player stats for the current game (or practice session): LB/RB switch category, X switches team. */
export function statsScreen(screens, match, { onBack, tab = 0, team = null }) {
  const t = STAT_TABS[tab];
  const teams = match.teams;
  const rows = statRows(match, t.id, team);
  const teamName = team === null ? 'Both teams' : `${teams[team].city} ${teams[team].name}`;
  const go = (d) => statsScreen(screens, match, { onBack, tab: (tab + d + STAT_TABS.length) % STAT_TABS.length, team });
  const head = el('div.st-row.st-head', {}, el('span.st-team', { text: 'TM' }), el('span.st-name', { text: 'Player' }), t.cols.map(([c]) => el('span.st-num', { text: c })));
  const items = rows.map((rw) => {
    const tm = teams[rw.team];
    return el('div.st-row', { style: { borderLeftColor: tm.colors.primary } },
      el('span.st-team', { text: tm.abbr }),
      el('span.st-name', {}, el('b', { text: rw.name }), el('small', { text: ` #${rw.number} ${rw.pos}` })),
      rw.cells.map((c) => el('span.st-num', { text: String(c) })));
  });
  const empty = el('div.st-empty', { text: 'No stats yet.' });
  screens.frame('stats-screen',
    el('h1', { text: 'Stats' }),
    el('div.pc-tabs', {}, STAT_TABS.map((x, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: x.label, onclick: () => go(i - tab) }))),
    el('div.st-team-filter', { text: teamName }),
    el('div.st-table', {}, head, items.length ? items : empty),
    el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> category &nbsp; <b class="btn X">X</b> team &nbsp; ▲▼ scroll &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items.length ? items : [empty], { columns: 1, onBack, onTab: go });
  screens.extraButtons = (f) => {
    if (!f.pressed.X) return;
    const next = team === null ? 0 : team === 0 ? 1 : null; // both -> home -> away -> both
    statsScreen(screens, match, { onBack, tab, team: next });
  };
}
