import { el } from './nav.js';
import { POSITIONS } from '../data/positions.js';
import { startNextSeason } from '../franchise/franchise.js';
import {
  progressPlayers, expiring, resign, contractYears, finishResigning, signFreeAgent, cpuFreeAgency, makeDraft,
  makePick, simToUserPick, finishDraft, cutDown, cpuCutDowns, ROSTER_LIMIT, askingSalary, projectedPayroll, fillRoster,
} from '../franchise/offseason.js';
import { payroll, money } from '../franchise/contracts.js';
import { logTransaction } from '../franchise/franchise.js';
import { capLine } from './franchiseMoney.js';
import { scoutView, scoutProspect } from '../franchise/extras.js';
import { releasePlayer } from '../data/rosterOps.js';

/**
 * Offseason screens for the franchise hub (FranchiseUI calls this when f.phase === 'offseason').
 * ctx = { screens, teams, league, onExit }; ui = the FranchiseUI (for hub()).
 */
export function offseasonScreen(ctx, ui) {
  const f = ctx.league.franchise;
  const step = f.offseason?.step || 'summary';
  const S = { summary, progression, resign: resignStep, freeagency, draft, cutdown }[step] || summary;
  ctx.screens.extraButtons = null;
  S(ctx, ui, f);
}

const save = (ctx) => ctx.league.changed();
const who = (p) => `${p.first} ${p.last}`;
const frame = (ctx, title, sub, list, buttons, help, opts = {}) => {
  ctx.screens.frame('stats-screen', el('h1', { text: title }), sub ? el('div.league-status', { text: sub }) : null,
    list, el('div.over-buttons', {}, buttons), el('div.setup-help', { html: help }));
  ctx.screens.nav.set([...(opts.rows || []), ...buttons], { columns: 1, index: opts.index || 0, onBack: ctx.onExit, onTab: opts.onTab });
};
const button = (label, fn, cls = '') => { const b = el(`div.start-btn${cls}`, { text: label }); b.activate = fn; return b; };
const row = (cells, cls = '') => el(`div.st-row${cls}`, {}, cells);

function summary(ctx, ui, f) {
  const h = f.history[f.history.length - 1];
  const past = f.history.slice().reverse().map((x) => row([el('span.st-team', { text: String(x.year) }), el('span.st-name', { text: `Champion: ${x.championName}` }), el('span.st-num', { text: x.record })]));
  frame(ctx, `${h.year} Season Complete`, `${h.championName} won the Gridiron Championship · you went ${h.record}${h.madePlayoffs ? ' and made the playoffs' : ''}`,
    el('div.st-table', {}, past),
    [button('Start the offseason', () => { progressPlayers(f, ctx.teams); save(ctx); offseasonScreen(ctx, ui); }), button('Main Menu', ctx.onExit, '.secondary')],
    'Players age a year, then contracts, free agency, the draft and cut-downs.');
}

function progression(ctx, ui, f) {
  const rows = (f.offseason.report || []).map((r) => {
    const d = r.retired ? 'Retired' : `${r.after - r.before >= 0 ? '+' : ''}${r.after - r.before}`;
    return row([el('span.dc-pos', { text: r.pos }), el('span.st-name', { text: r.name }), el('span.st-num', { text: String(r.age) }),
      el('span.st-num', { text: `${r.before} → ${r.after ?? '—'}` }), el(`span.st-num${r.retired || r.after < r.before ? '.down' : '.up'}`, { text: d })]);
  });
  frame(ctx, 'Player Progression', `Your players a year older · ${f.offseason.retired} players retired around the league`,
    el('div.st-table', {}, row([el('span.dc-pos', { text: 'POS' }), el('span.st-name', { text: 'Player' }), el('span.st-num', { text: 'AGE' }), el('span.st-num', { text: 'OVR' }), el('span.st-num', { text: '+/-' })], '.st-head'), rows),
    [button('Contracts', () => { f.offseason.step = 'resign'; save(ctx); offseasonScreen(ctx, ui); })], '▲▼ scroll', { rows });
}

function resignStep(ctx, ui, f, focus = 0) {
  const team = ctx.teams[f.userTeam];
  const keep = (f.offseason.keep ||= Object.fromEntries(expiring(team).map((p) => [p.id, p.ovr >= 68 && p.age < 32])));
  const list = expiring(team).sort((a, b) => b.ovr - a.ovr);
  const keepIds = () => new Set(list.filter((p) => keep[p.id]).map((p) => p.id));
  const proj = projectedPayroll(team, keepIds());
  const rows = list.map((p, i) => {
    const r = row([el('span.dc-pos', { text: p.pos }), el('span.st-name', { text: who(p) }), el('span.st-num', { text: `age ${p.age}` }),
      el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: `${money(p.salary || 0)} → ${money(askingSalary(p))}` }),
      el(`span.st-num${keep[p.id] ? '.up' : '.down'}`, { text: keep[p.id] ? `Re-sign ${contractYears(p)} yr` : 'Let go' })]);
    r.activate = () => { keep[p.id] = !keep[p.id]; resignStep(ctx, ui, f, i); };
    return r;
  });
  const done = button('Done: on to free agency', () => {
    if (projectedPayroll(team, keepIds()) > f.cap) { window.alert(`That's over the ${money(f.cap)} salary cap: let someone go.`); return; }
    for (const p of list) if (keep[p.id]) resign(team, p.id);
    delete f.offseason.keep;
    finishResigning(f, ctx.teams);
    save(ctx);
    offseasonScreen(ctx, ui);
  });
  frame(ctx, 'Re-sign Players', list.length ? `${list.length} contracts expired · next season's payroll ${money(proj)} of ${money(f.cap)}${proj > f.cap ? ' (over the cap!)' : ''}` : 'No contracts expired this year',
    el('div.st-table', {}, rows), [done], 'Salary now → asking price. &nbsp; <b class="btn A">A</b> re-sign / let go', { rows, index: focus });
}

function freeagency(ctx, ui, f, filter = 0) {
  const team = ctx.teams[f.userTeam];
  const tabs = ['All', ...POSITIONS];
  const pool = f.offseason.pool.filter((p) => filter === 0 || p.pos === tabs[filter]).slice(0, 60);
  const rows = pool.map((p) => {
    const ask = askingSalary(p);
    const r = row([el('span.dc-pos', { text: p.pos }), el('span.st-name', { text: who(p) }), el('span.st-num', { text: `age ${p.age}` }), el('span.st-num', { text: String(p.ovr) }),
      el(`span.st-num${payroll(team) + ask > f.cap ? '.down' : ''}`, { text: money(ask) })]);
    r.activate = () => {
      if (team.roster.length >= ROSTER_LIMIT + 8) { window.alert('Your roster is full: release someone in the Roster screen first.'); return; }
      if (!signFreeAgent(f, team, p.id)) { window.alert(`Not enough cap space: he wants ${money(ask)}.`); return; }
      if (p.ovr >= 72) logTransaction(f, `${team.abbr} signs free agent ${p.pos} ${who(p)} (${money(ask)})`);
      save(ctx);
      freeagency(ctx, ui, f, filter);
    };
    return r;
  });
  const done = button('Done: on to the draft', () => {
    cpuFreeAgency(f, ctx.teams);
    makeDraft(f, ctx.teams);
    save(ctx);
    offseasonScreen(ctx, ui);
  });
  ctx.screens.frame('stats-screen', el('h1', { text: 'Free Agency' }),
    el('div.league-status', { text: `Your roster: ${team.roster.length} players · ${capLine(f, team)} · A signs a player at his asking price` }),
    el('div.pc-tabs', {}, tabs.map((t, i) => el(`div.pc-tab${i === filter ? '.on' : ''}`, { text: t }))),
    el('div.st-table', {}, rows.length ? rows : el('div.st-empty', { text: 'Nobody available at this position.' })),
    el('div.over-buttons', {}, done),
    el('div.setup-help', { html: '<b class="btn A">A</b> sign &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> position &nbsp; ▲▼ scroll' }));
  ctx.screens.nav.set([...rows, done], { columns: 1, onBack: ctx.onExit, onTab: (d) => freeagency(ctx, ui, f, (filter + d + tabs.length) % tabs.length) });
}

function draft(ctx, ui, f, focus = 0) {
  const d = f.offseason.draft;
  const teams = ctx.teams;
  if (d.at >= d.picks.length) { finishDraft(f, teams); save(ctx); offseasonScreen(ctx, ui); return; }
  const pick = d.picks[d.at];
  const mine = pick.team === f.userTeam;
  const myPicks = d.picks.filter((p) => p.team === f.userTeam && p.player).map((p) => row([el('span.st-team', { text: `R${p.round}` }), el('span.dc-pos', { text: p.player.pos }), el('span.st-name', { text: p.player.name }), el('span.st-num', { text: String(p.player.ovr) })]));
  const recent = d.picks.slice(Math.max(0, d.at - 6), d.at).reverse().map((p) => el('div.fr-score', { text: `R${p.round} #${p.pick} ${teams[p.team].abbr}: ${p.player.name} (${p.player.pos} ${p.player.ovr})` }));
  let rows = [];
  let buttons;
  if (mine) {
    // You see scouting estimates: a range for overall and no potential until you spend a scouting point (X).
    const board = d.cls.map((p) => ({ p, v: scoutView(p) })).sort((a, b) => b.v.sort - a.v.sort).slice(0, 40);
    rows = board.map(({ p, v }) => {
      const r = row([el('span.dc-pos', { text: p.pos }), el('span.st-name', { text: who(p) }), el('span.st-num', { text: `age ${p.age}` }),
        el(`span.st-num${v.scouted ? '.up' : ''}`, { text: v.ovr }), el('span.st-num', { text: v.pot })]);
      r.activate = () => { makePick(f, teams, p.id); save(ctx); draft(ctx, ui, f); };
      r.scout = () => { if (scoutProspect(f, p.id)) { save(ctx); draft(ctx, ui, f, rows.indexOf(r)); } };
      return r;
    });
    buttons = [button('Auto-pick', () => { makePick(f, teams); save(ctx); draft(ctx, ui, f); }, '.secondary')];
  } else {
    buttons = [
      button('Sim to my next pick', () => { simToUserPick(f, teams); save(ctx); draft(ctx, ui, f); }),
      button('Sim the rest of the draft', () => { finishDraft(f, teams); save(ctx); offseasonScreen(ctx, ui); }, '.secondary'),
    ];
  }
  ctx.screens.frame('stats-screen', el('h1', { text: `Draft · Round ${pick.round}, Pick ${pick.pick}` }),
    el('div.league-status', { text: mine ? `You are on the clock: A drafts a player · X scouts him (${d.scoutLeft ?? 0} scouting points left) to see his real overall and potential` : `${teams[pick.team].city} ${teams[pick.team].name} on the clock` }),
    el('div.fr-sched', {}, el('div.st-table', {}, mine ? rows : myPicks.length ? myPicks : el('div.st-empty', { text: 'Your picks will show here.' })),
      el('div.fr-week', {}, el('div.dc-head', { text: 'Latest picks' }), recent)),
    el('div.over-buttons', {}, buttons),
    el('div.setup-help', { html: mine ? '<b class="btn A">A</b> draft &nbsp; <b class="btn X">X</b> scout &nbsp; ▲▼ scroll' : '<b class="btn A">A</b> select' }));
  ctx.screens.nav.set([...rows, ...buttons], { columns: 1, onBack: ctx.onExit, index: focus });
  ctx.screens.extraButtons = mine ? (fr) => { if (fr.pressed.X) ctx.screens.nav.items[ctx.screens.nav.index]?.scout?.(); } : null;
}

function cutdown(ctx, ui, f) {
  const team = ctx.teams[f.userTeam];
  const over = team.roster.length - ROSTER_LIMIT;
  const overCap = payroll(team) - f.cap;
  const list = [...team.roster].sort((a, b) => a.ovr - b.ovr);
  const rows = list.map((p) => {
    const r = row([el('span.dc-pos', { text: p.pos }), el('span.st-name', { text: who(p) }), el('span.st-num', { text: `age ${p.age}` }), el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: money(p.salary || 0) })]);
    r.activate = () => { if (window.confirm(`Release ${who(p)}?`)) { releasePlayer(team, p.id); save(ctx); cutdown(ctx, ui, f); } };
    return r;
  });
  const next = () => {
    cutDown(team, ROSTER_LIMIT, f.cap);
    fillRoster(f, team, 46); // a short roster gets the best affordable free agents
    cpuCutDowns(f, ctx.teams);
    startNextSeason(f, ctx.teams);
    save(ctx);
    ui.hub();
  };
  const buttons = over > 0 || overCap > 0
    ? [button(`Auto-cut${over > 0 ? ' ' + over : ''}${overCap > 0 ? ' (and get under the cap)' : ''} and start ${f.year + 1}`, next), button('Main Menu', ctx.onExit, '.secondary')]
    : [button(`Start the ${f.year + 1} season`, next)];
  const capNote = overCap > 0 ? ` · over the cap by ${money(overCap)}` : ` · ${capLine(f, team)}`;
  frame(ctx, 'Cut Down to 53', (over > 0 ? `${team.roster.length} players: release ${over} more (A), or auto-cut the lowest rated` : `${team.roster.length} players: you're set`) + capNote,
    el('div.st-table', {}, rows), buttons, '<b class="btn A">A</b> release player &nbsp; ▲▼ scroll', { rows });
}
