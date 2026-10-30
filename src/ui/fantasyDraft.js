// Fantasy draft screen (franchise/fantasy.js is the logic): the best available players, your roster against the
// shape you're drafting toward, and the latest picks. A drafts, X auto-picks, Y auto-drafts the rest, LB/RB filter.
import { el } from './nav.js';
import { logoCanvas } from '../render/logo.js';
import { roundOf, draftDone, makeFantasyPick, simToUser, finishFantasyDraft, bestPick, draftValue, TARGET, FANTASY_ROUNDS } from '../franchise/fantasy.js';

const FILTERS = [
  ['All', null], ['QB', ['QB']], ['RB', ['HB', 'FB']], ['WR', ['WR']], ['TE', ['TE']], ['OL', ['T', 'G', 'C']],
  ['DL', ['DE', 'DT']], ['LB', ['OLB', 'MLB']], ['DB', ['CB', 'FS', 'SS']], ['K/P', ['K', 'P']],
];

/** ui = FranchiseUI (ctx.screens, f, teams, save(), hub()). */
export function fantasyDraftScreen(ui, filter = 0, focus = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams, d = f.fantasy, me = teams[f.userTeam];
  screens.extraButtons = null;
  simToUser(f, teams);
  if (draftDone(d)) { finishFantasyDraft(f, teams); ui.save(); ui.hub(); return; }
  const [fname, positions] = FILTERS[filter];
  // All: ranked by what your roster needs (draftValue, so kickers don't top the board); a position: by overall.
  const list = positions ? d.pool.filter((p) => positions.includes(p.pos)).slice(0, 40)
    : d.pool.slice(0, 200).map((p) => [p, draftValue(me, p)]).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([p]) => p);
  const suggested = bestPick(d, me);
  const mine = {};
  for (const p of me.roster) mine[p.pos] = (mine[p.pos] || 0) + 1;
  const pick = (p) => { makeFantasyPick(f, teams, p); ui.save(); fantasyDraftScreen(ui, filter, 0); };
  const rows = list.map((p) => {
    const r = el(`div.fd-row${p === suggested ? '.sugg' : ''}`, {},
      el('b.fd-ovr', { text: String(p.ovr) }), el('span.fd-pos', { text: p.pos }), el('span.fd-name', { text: `${p.first} ${p.last}` }),
      el('span.fd-age', { text: `${p.age} yrs` }), el('span.fd-full', { text: (mine[p.pos] || 0) >= (TARGET[p.pos] ?? 1) ? 'FULL' : '' }));
    r.activate = () => pick(p);
    return r;
  });
  const needs = el('div.fd-needs', {}, Object.entries(TARGET).map(([pos, n]) => el(`div${(mine[pos] || 0) >= n ? '.ok' : (mine[pos] || 0) === 0 ? '.none' : ''}`, {},
    el('span', { text: pos }), el('b', { text: `${mine[pos] || 0}/${n}` }))));
  const log = el('div.fd-log', {}, d.log.slice(0, 12).map((l) => el(`div${l.team === f.userTeam ? '.mine' : ''}`, {},
    el('span', { text: `R${l.round}.${((l.pick - 1) % teams.length) + 1}` }), el('b', { text: teams[l.team].abbr }), el('span', { text: `${l.pos} ${l.name} (${l.ovr})` }))));
  screens.frame('hub-screen fd-screen',
    el('div.hub-top', {}, el('div.hub-logo', { html: 'FANTASY <span>DRAFT</span>' }),
      el('div.hub-me', { style: { '--tc': me.colors.primary } }, logoCanvas(me.logo, 40),
        el('div', {}, el('small', { text: `ROUND ${roundOf(d)} OF ${FANTASY_ROUNDS} · PICK ${d.pick + 1} · YOU'RE ON THE CLOCK` }), el('b', { text: `${me.city} ${me.name}` })))),
    el('div.fd-main', {},
      el('div.fd-board', {}, el('div.pc-tabs', {}, FILTERS.map(([n], i) => el(`div.pc-tab${i === filter ? '.on' : ''}`, { text: n }))), el('div.fd-list', {}, rows)),
      el('div.fd-side', {}, el('div.fr-col-head', { text: `Your roster · ${me.roster.length}/${FANTASY_ROUNDS}` }), needs,
        el('div.fr-col-head', { text: 'Latest picks' }), log)),
    el('div.hub-foot', { html: `<b class="btn A">A</b> Draft &nbsp; <b class="btn X">X</b> Auto-pick (${suggested.pos} ${suggested.last}) &nbsp; <b class="btn Y">Y</b> Auto-draft the rest &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> ${fname} &nbsp; <b class="btn B">B</b> Main menu` }));
  screens.root.style.setProperty('--accent', me.colors.primary);
  screens.nav.set(rows, { onBack: ui.ctx.onExit, index: Math.min(focus, rows.length - 1),
    onTab: (dir) => fantasyDraftScreen(ui, (filter + dir + FILTERS.length) % FILTERS.length, 0) });
  screens.extraButtons = (fr) => {
    if (fr.pressed.X) { screens.extraButtons = null; pick(suggested); }
    else if (fr.pressed.Y) { screens.extraButtons = null; finishFantasyDraft(f, teams); ui.save(); ui.hub(); }
  };
}
