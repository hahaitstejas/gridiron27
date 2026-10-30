import { topActive } from '../franchise/legacy.js';
import { statLine } from '../franchise/extras.js';
import { el } from './nav.js';
import { RECORD_CATS } from '../franchise/extras.js';

// Franchise hub: news feed, and awards & records. `ui` is the FranchiseUI.

const KIND_TAG = { game: 'GAME', playoff: 'PLAYOFFS', injury: 'INJURY', trade: 'TRADE', award: 'AWARD', record: 'RECORD', draft: 'DRAFT', signing: 'SIGNING' };

export function latestHeadline(f) {
  return f.news?.[0]?.text || 'No news yet';
}

export function newsScreen(ui) {
  const { screens } = ui.ctx;
  const f = ui.f;
  const rows = (f.news || []).map((n) => el('div.st-row', {}, el('span.st-team', { text: n.week ? `W${n.week}` : String(n.year) }),
    el(`span.nw-tag.nw-${n.kind}`, { text: KIND_TAG[n.kind] || n.kind.toUpperCase() }), el('span.st-name', { text: n.text })));
  const empty = el('div.st-empty', { text: 'Nothing has happened yet: play a game!' });
  screens.frame('stats-screen', el('h1', { text: 'League News' }), el('div.st-table', {}, rows.length ? rows : empty),
    el('div.setup-help', { html: '▲▼ scroll &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => ui.hub() });
}

export function awardsScreen(ui, tab = 0) {
  const { screens } = ui.ctx;
  const f = ui.f;
  const tabs = ['Awards', 'Season records', 'Game records', 'Champions'];
  let rows = [];
  if (tab === 0) {
    for (const year of Object.keys(f.awards || {}).sort((a, b) => b - a)) {
      rows.push(el('div.dc-head', { text: `${year}` }));
      for (const a of f.awards[year]) rows.push(el('div.st-row', {}, el('span.st-name', {}, el('b', { text: a.award })), el('span.st-name', { text: `${a.name}, ${a.pos}, ${a.team}` }), el('span.st-name', { text: a.line })));
    }
  } else if (tab === 1 || tab === 2) {
    const recs = f.records?.[tab === 1 ? 'season' : 'game'] || {};
    rows = RECORD_CATS.filter(([k]) => recs[k]).map(([k, label]) => el('div.st-row', {}, el('span.st-name', {}, el('b', { text: label })),
      el('span.st-num', { text: String(Math.round(recs[k].value * 10) / 10) }), el('span.st-name', { text: `${recs[k].name} (${recs[k].team}, ${recs[k].year})` })));
  } else {
    rows = [...(f.history || [])].reverse().map((h) => el('div.st-row', {}, el('span.st-team', { text: String(h.year) }), el('span.st-name', {}, el('b', { text: h.championName })), el('span.st-name', { text: `You: ${h.record}${h.madePlayoffs ? ', playoffs' : ''}` })));
  }
  const empty = el('div.st-empty', { text: tab === 0 ? 'Awards are given at the end of the regular season.' : tab === 3 ? 'No champions yet.' : 'Records start with your first games.' });
  const nav = rows.filter((r) => r.classList.contains('st-row'));
  screens.frame('stats-screen', el('h1', { text: 'Awards & Records' }),
    el('div.pc-tabs', {}, tabs.map((t, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: t }))),
    el('div.st-table', {}, rows.length ? rows : empty),
    el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> switch &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(nav.length ? nav : [empty], { columns: 1, onBack: () => ui.hub(), onTab: (d) => awardsScreen(ui, (tab + d + tabs.length) % tabs.length) });
}

/** Hall of Fame (inductees), Legends in the Making (best active careers) and Franchise History (your seasons). */
export function hallScreen(ui, tab = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams;
  const tabs = ['Hall of Fame', 'Legends in the making', 'Franchise history'];
  let rows = [];
  if (tab === 0) {
    rows = (f.hof || []).map((h) => el('div.hof-card', {},
      el('div.hof-year', {}, el('small', { text: 'CLASS OF' }), el('b', { text: String(h.inducted) })),
      el('div.hof-main', {}, el('b', { text: h.name }), el('span', { text: `${h.pos} · ${h.team} · ${h.years} · ${h.seasons} seasons` }), el('span.hof-line', { text: h.line })),
      el('div.hof-honors', {}, h.awards.slice(0, 3).map((a) => el('span', { text: a })), h.rings ? el('span.ring', { text: `${h.rings}× champion` }) : null)));
  } else if (tab === 1) {
    rows = topActive(f, 12).map((c, i) => el('div.st-row', {}, el('span.st-team', { text: String(i + 1) }), el('span.st-name', {}, el('b', { text: c.name })),
      el('span.st-name', { text: `${c.pos} · ${c.team} · ${c.seasons} seasons` }), el('span.st-name', { text: statLine(c) }),
      el('span.st-name', { text: `${c.awards.length ? `${c.awards.length} award${c.awards.length > 1 ? 's' : ''}` : ''}${c.rings ? ` · ${c.rings}× champ` : ''}` })));
  } else {
    rows = [...(f.history || [])].reverse().map((h) => el('div.st-row', {}, el('span.st-team', { text: String(h.year) }),
      el('span.st-name', {}, el('b', { text: `${teams[f.userTeam].abbr} ${h.record}` })),
      el('span.st-name', { text: h.champion === f.userTeam ? 'CHAMPIONS' : h.madePlayoffs ? 'Made the playoffs' : 'Missed the playoffs' }),
      el('span.st-name', { text: `Champion: ${h.championName}` })));
  }
  const empty = el('div.st-empty', { text: tab === 0 ? 'No one has been inducted yet: great careers go in when the player retires.' : tab === 1 ? 'Careers build up after the first season.' : 'Your finished seasons show up here.' });
  const nav = rows.filter((r) => r.classList.contains('st-row') || r.classList.contains('hof-card'));
  screens.frame('stats-screen', el('h1', { text: 'Hall of Fame' }),
    el('div.pc-tabs', {}, tabs.map((t, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: t }))),
    el('div.st-table', {}, rows.length ? rows : empty),
    el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> switch &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(nav.length ? nav : [empty], { columns: 1, onBack: () => ui.hub('Hall of Fame'), onTab: (d) => hallScreen(ui, (tab + d + tabs.length) % tabs.length) });
}
