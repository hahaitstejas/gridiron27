import { el } from './nav.js';
import { payroll, money, marketValue, evaluateTrade, executeTrade } from '../franchise/contracts.js';
import { logTransaction, tradeDeadlinePassed } from '../franchise/franchise.js';

// Franchise money screens: contracts & cap, trades with CPU teams, the transaction log.
// `ui` is the FranchiseUI (ui.f, ui.teams, ui.ctx, ui.hub(), ui.save()).

const who = (p) => `${p.first} ${p.last}`;
const back = (fn, label = 'Back') => { const b = el('div.start-btn', { text: label }); b.activate = fn; return b; };

/** One line for the hub: payroll and cap space. */
export function capLine(f, team) {
  const pay = payroll(team);
  return `Payroll ${money(pay)} of ${money(f.cap)} · ${pay > f.cap ? 'over the cap by ' + money(pay - f.cap) : money(f.cap - pay) + ' cap space'}`;
}

export function contractsScreen(ui, sortBy = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, team = ui.teams[f.userTeam];
  const sorts = [['Salary', (a, b) => b.salary - a.salary], ['Overall', (a, b) => b.ovr - a.ovr], ['Expiring', (a, b) => a.years - b.years || b.salary - a.salary]];
  const list = [...team.roster].sort(sorts[sortBy][1]);
  const head = el('div.st-row.st-head', {}, el('span.dc-pos', { text: 'POS' }), el('span.st-name', { text: 'Player' }),
    ...['AGE', 'OVR', 'SALARY', 'YRS', 'VALUE'].map((c) => el('span.st-num', { text: c })));
  const rows = list.map((p) => {
    const mv = marketValue(p);
    return el('div.st-row', {}, el('span.dc-pos', { text: p.pos }), el('span.st-name', {}, el('b', { text: who(p) })),
      el('span.st-num', { text: String(p.age) }), el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: money(p.salary || 0) }),
      el('span.st-num', { text: String(Math.max(0, p.years ?? 0)) }),
      el(`span.st-num${mv > (p.salary || 0) * 1.15 ? '.up' : mv < (p.salary || 0) * 0.85 ? '.down' : ''}`, { text: money(mv) }));
  });
  screens.frame('stats-screen', el('h1', { text: 'Contracts & Salary Cap' }),
    el('div.league-status', { text: capLine(f, team) }),
    el('div.pc-tabs', {}, sorts.map(([l], i) => el(`div.pc-tab${i === sortBy ? '.on' : ''}`, { text: `By ${l.toLowerCase()}` }))),
    el('div.st-table', {}, head, rows),
    el('div.setup-help', { html: 'VALUE = what he\'d get on the open market (green: a bargain, red: overpaid). Expiring deals come up in the offseason. &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> sort &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows, { columns: 1, onBack: () => ui.hub(), onTab: (d) => contractsScreen(ui, (sortBy + d + sorts.length) % sorts.length) });
}

/** Trades: pick a team, then players from both rosters. The CPU accepts a fair-or-better deal that fits the cap. */
export function tradeScreen(ui) {
  const f = ui.f;
  if (tradeDeadlinePassed(f)) { window.alert('The trade deadline has passed. Trades open again next season.'); return; }
  ui.ctx.pickTeam('Trade with: pick a team', (ti) => {
    if (ti === f.userTeam) { tradeScreen(ui); return; }
    tradeBuilder(ui, ti, { give: new Set(), get: new Set(), side: 1 });
  }, () => ui.hub(), (f.userTeam + 1) % ui.teams.length);
}

function tradeBuilder(ui, ti, st, focus = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, me = ui.teams[f.userTeam], them = ui.teams[ti];
  const team = st.side ? them : me, set = st.side ? st.get : st.give;
  const list = [...team.roster].sort((a, b) => b.ovr - a.ovr);
  const rows = list.map((p) => {
    const on = set.has(p.id);
    const r = el(`div.st-row${on ? '.mine' : ''}`, {}, el('span.dc-pos', { text: p.pos }), el('span.st-name', {}, el('b', { text: who(p) }), el('small', { text: p.injury ? ' INJ' : '' })),
      el('span.st-num', { text: String(p.age) }), el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: money(p.salary || 0) }),
      el('span.st-num', { text: on ? '✓' : '' }));
    r.activate = () => { on ? set.delete(p.id) : set.add(p.id); tradeBuilder(ui, ti, st, list.indexOf(p)); };
    return r;
  });
  const pick = (t, ids) => t.roster.filter((p) => ids.has(p.id));
  const give = pick(me, st.give), get = pick(them, st.get);
  const ev = evaluateTrade(them, give, me, get, f.cap);
  const meter = Math.max(0, Math.min(1, ev.ratio));
  const summary = el('div.fr-week', {},
    el('div.dc-head', { text: 'You give' }), give.length ? give.map((p) => el('div.fr-score', { text: `${p.pos} ${who(p)} (${p.ovr}, ${money(p.salary)})` })) : el('div.fr-score', { text: '—' }),
    el('div.dc-head', { text: 'You get' }), get.length ? get.map((p) => el('div.fr-score', { text: `${p.pos} ${who(p)} (${p.ovr}, ${money(p.salary)})` })) : el('div.fr-score', { text: '—' }),
    el('div.dc-head', { text: `${them.abbr} interest` }),
    el('div.tr-meter', {}, el('div', { style: { width: `${Math.round(meter * 100)}%`, background: ev.accept ? '#3ccf6e' : meter > 0.8 ? '#e8c547' : '#e05a4f' } })),
    el('div.fr-score', { text: !give.length || !get.length ? 'Pick players on both sides.' : !ev.capOk ? 'Doesn\'t fit under the salary cap.' : ev.accept ? 'They\'d take this deal.' : meter > 0.8 ? 'Close: add a little more.' : 'Not enough value for them.' }));
  const propose = el('div.start-btn', { text: 'Propose trade' });
  propose.activate = () => {
    if (!evaluateTrade(them, give, me, get, f.cap).accept) { window.alert(`${them.city} ${them.name} turned it down.`); return; }
    executeTrade(me, give, them, get);
    logTransaction(f, `${me.abbr} trades ${give.map((p) => `${p.pos} ${who(p)}`).join(', ')} to ${them.abbr} for ${get.map((p) => `${p.pos} ${who(p)}`).join(', ')}`);
    ui.save();
    window.alert('Trade accepted! Check your depth chart.');
    ui.hub();
  };
  const buttons = [propose, back(() => ui.hub(), 'Cancel')];
  screens.frame('stats-screen', el('h1', { text: `Trade with ${them.city} ${them.name}` }),
    el('div.league-status', { text: `${capLine(f, me)}` }),
    el('div.pc-tabs', {}, [`Your roster (${give.length})`, `${them.abbr} roster (${get.length})`].map((l, i) => el(`div.pc-tab${i === st.side ? '.on' : ''}`, { text: l }))),
    el('div.fr-sched', {}, el('div.st-table', {}, el('div.st-row.st-head', {}, el('span.dc-pos', { text: 'POS' }), el('span.st-name', { text: 'Player' }),
      ...['AGE', 'OVR', 'SALARY', ''].map((c) => el('span.st-num', { text: c }))), rows), summary),
    el('div.over-buttons', {}, buttons),
    el('div.setup-help', { html: '<b class="btn A">A</b> add / remove player &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> switch roster &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set([...rows, ...buttons], { columns: 1, index: focus, onBack: () => ui.hub(), onTab: () => { st.side = 1 - st.side; tradeBuilder(ui, ti, st); } });
}

export function transactionsScreen(ui) {
  const { screens } = ui.ctx;
  const f = ui.f;
  const rows = f.transactions.map((t) => el('div.st-row', {}, el('span.st-team', { text: t.week ? `${t.year} W${t.week}` : String(t.year) }), el('span.st-name', { text: t.text })));
  const empty = el('div.st-empty', { text: 'No trades or signings yet.' });
  screens.frame('stats-screen', el('h1', { text: 'Transactions' }), el('div.st-table', {}, rows.length ? rows : empty),
    el('div.setup-help', { html: '▲▼ scroll &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => ui.hub() });
}

