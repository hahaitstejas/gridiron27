import { el } from './nav.js';
import { STAT_TABS, statRows } from '../game/boxscore.js';
import { sortHead, sortKeys } from './sortable.js';
import { faceImg } from './faces.js';
import { logoCanvas } from '../render/logo.js';

/** Full player stats for the current game (or practice session): LB/RB switch category, X switches team. */
export function statsScreen(screens, match, { onBack, tab = 0, team = null, sort = null }) {
  const t = STAT_TABS[tab];
  const teams = match.teams;
  sort ||= { col: null, asc: false, cur: 0 };
  const rows = statRows(match, t.id, team, sort.col, sort.asc);
  const teamName = team === null ? 'Both teams' : `${teams[team].city} ${teams[team].name}`;
  const again = (o) => statsScreen(screens, match, { onBack, tab, team, sort, ...o });
  const go = (d) => statsScreen(screens, match, { onBack, tab: (tab + d + STAT_TABS.length) % STAT_TABS.length, team });
  const head = el('div.st-row.st-head', {}, el('span.st-team', { text: 'TM' }), el('span.st-name', { text: 'Player' }),
    sortHead(t.cols.map(([c]) => c), sort, 'span.st-num'));
  // Header card for the focused row: photo on a team-color panel, the name, and this tab's line in big numbers.
  const card = el('div.st-card');
  const showCard = (rw) => {
    const tm = teams[rw.team], p = tm.roster.find((x) => x.id === rw.rid);
    card.replaceChildren(
      el('div.st-photo', { style: { '--tc': tm.colors.primary, '--tc2': tm.colors.secondary } }, el('div.st-logo', {}, logoCanvas(tm.logo, 120)),
        (p && faceImg(p, 'st-face')) || el('div.st-jn', { text: String(rw.number) })),
      el('div.st-id', {}, el('small', { text: `${tm.abbr} · ${rw.pos} #${rw.number}` }),
        el('div.st-first', { text: (p?.first || '').toUpperCase() }), el('div.st-last', { text: (p?.last || rw.name).toUpperCase() })),
      el('div.st-line', {}, t.cols.slice(0, 6).map(([c], i) => el('div', {}, el('b', { text: String(rw.cells[i]) }), el('small', { text: c })))));
    card.style.setProperty('--tc', tm.colors.primary);
  };
  const items = rows.map((rw) => {
    const tm = teams[rw.team];
    return el('div.st-row', { onfocusitem: () => showCard(rw) },
      el('span.st-team', { text: tm.abbr }),
      el('span.st-name', {}, el('b', { text: rw.name }), el('small', { text: ` #${rw.number} ${rw.pos}` })),
      rw.cells.map((c, i) => el(`span.st-num${i === sort.col ? '.sorted' : ''}`, { text: String(c) })));
  });
  const empty = el('div.st-empty', { text: 'No stats yet.' });
  screens.frame('stats-screen',
    el('h1', { text: 'Stats' }),
    el('div.pc-tabs', {}, STAT_TABS.map((x, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: x.label, onclick: () => go(i - tab) }))),
    items.length ? card : null,
    el('div.st-team-filter', { text: teamName }),
    el('div.st-table', {}, head, items.length ? items : empty),
    el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> category &nbsp; ◀▶ column &nbsp; <b class="btn X">X</b> sort by it &nbsp; <b class="btn Y">Y</b> team &nbsp; ▲▼ scroll &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items.length ? items : [empty], { columns: 1, onBack, onTab: go });
  screens.extraButtons = (f) => {
    if (sortKeys(f, sort, t.cols.length, () => again())) return;
    if (f.pressed.Y) {
      const next = team === null ? 0 : team === 0 ? 1 : null; // both -> home -> away -> both
      statsScreen(screens, match, { onBack, tab, team: next, sort });
    }
  };
}
