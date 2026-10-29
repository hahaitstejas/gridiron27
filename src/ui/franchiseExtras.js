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
