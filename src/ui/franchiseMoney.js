import { el } from './nav.js';
import { payroll, money, marketValue } from '../franchise/contracts.js';
import { ensurePicks, picksOf, pickLabel, pickValue, expectedSlot, evaluateDeal, executeDeal, dealText, pickKey, tradeAssets, cheapestPackage } from '../franchise/trades.js';
import { sortHead, sortKeys, sortRows, POS_TABS } from './sortable.js';
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

/** Trades: pick a team, then players and draft picks from both sides. The CPU accepts a fair-or-better deal that fits the cap. */
export function tradeScreen(ui, preset = null) {
  const f = ui.f;
  if (tradeDeadlinePassed(f) && f.phase === 'regular') { window.alert('The trade deadline has passed. Trades open again after the season.'); return; }
  ensurePicks(f, ui.teams);
  if (preset?.team !== undefined && preset.team !== f.userTeam) { tradeBuilder(ui, preset.team, newDeal(preset)); return; }
  if (!preset) { tradeFinder(ui); return; }
  pickTeam(ui, preset);
}

function pickTeam(ui, preset) {
  const f = ui.f;
  ui.ctx.pickTeam('Trade with: pick a team', (ti) => {
    if (ti === f.userTeam) { tradeScreen(ui, preset); return; }
    tradeBuilder(ui, ti, newDeal(preset));
  }, () => ui.hub('Front Office'), (f.userTeam + 1) % ui.teams.length);
}

const newDeal = (preset) => ({ give: new Set(preset?.give || []), get: new Set(preset?.get || []), givePk: new Set(preset?.givePk || []), getPk: new Set(), side: preset?.get?.length ? 2 : 0 });

/**
 * Trade Finder: pick the position you want (LB/RB) and see the best players at it on every other team, with the
 * cheapest package of yours each team would take (cheapestPackage). A loads that deal into the builder to tweak and
 * propose; X picks a team instead. The list is the 60 best at the position by overall, then sorted as you like.
 */
export function tradeFinder(ui, st = null, focus = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams, me = f.userTeam;
  st ||= { filter: 0, sort: { col: null, asc: false, cur: 4 } };
  const [fname, want] = POS_TABS[st.filter];
  let list = [];
  teams.forEach((t, ti) => { if (ti !== me) for (const p of t.roster) if (!p.career && (!want || want.includes(p.pos))) list.push({ p, t, ti }); });
  list = list.sort((a, b) => b.p.ovr - a.p.ovr).slice(0, 60);
  const assets = tradeAssets(f, teams, me);
  for (const x of list) x.pkg = cheapestPackage(f, teams, x.ti, x.p, me, assets);
  const short = (p) => `${p.pos} ${p.first ? p.first[0] + '. ' : ''}${p.last}`;
  const pkgText = (x) => (x.pkg ? [...x.pkg.players.map(short), ...x.pkg.picks.map((pk) => `'${String(pk.year).slice(2)} Rd ${pk.round}`)].join(' + ') : 'No deal fits');
  const cols = [['TM', (x) => x.t.abbr], ['POS', (x) => x.p.pos], ['PLAYER', (x) => `${x.p.first} ${x.p.last}`, (x) => `${x.p.first} ${x.p.last}${x.p.injury ? ' (INJ)' : ''}${x.p.onBlock ? ' · BLOCK' : ''}`, 'wide'],
    ['AGE', (x) => x.p.age ?? 0], ['OVR', (x) => x.p.ovr], ['$M', (x) => x.p.salary ?? 0, (x) => (x.p.salary ?? 0).toFixed(1)], ['YRS', (x) => x.p.years ?? 0],
    ["THEY'D TAKE", (x) => x.pkg?.v ?? 1e9, pkgText, 'wide']];
  const shown = sortRows(list, st.sort, cols.map((c) => (x) => c[1](x)));
  const head = el('div.st-row.st-head', {}, sortHead(cols.map((c) => c[0]), st.sort, 'span.st-num').map((h, i) => { if (cols[i][3]) h.classList.add(cols[i][3]); return h; }));
  const rows = shown.map((x, i) => {
    const r = el(`div.st-row${x.pkg ? '' : '.down'}`, {}, cols.map((c, ci) => el(`span.st-num${ci === st.sort.col ? '.sorted' : ''}${c[3] ? '.' + c[3] : ''}`, { text: String(c[2] ? c[2](x) : c[1](x)) })));
    r.activate = () => {
      const preset = { get: [x.p.id], give: x.pkg ? x.pkg.players.map((p) => p.id) : [], givePk: x.pkg ? x.pkg.picks.map(pickKey) : [] };
      tradeBuilder(ui, x.ti, newDeal(preset), 0, () => tradeFinder(ui, st, i));
    };
    return r;
  });
  screens.frame('stats-screen wide-table', el('h1', { text: 'Trade Finder' }),
    el('div.league-status', { text: `${capLine(f, teams[me])} · pick the position you want; each row shows the cheapest deal that team would take.` }),
    el('div.pc-tabs', {}, POS_TABS.map(([n], i) => el(`div.pc-tab${i === st.filter ? '.on' : ''}`, { text: n }))),
    el('div.st-table', {}, head, rows.length ? rows : el('div.st-empty', { text: 'Nobody.' })),
    el('div.setup-help', { html: `<b class="btn LB">LB</b>/<b class="btn RB">RB</b> ${fname} &nbsp; ◀▶ column <b class="btn X">X</b> sort &nbsp; <b class="btn A">A</b> load the deal &nbsp; <b class="btn Y">Y</b> pick a team &nbsp; <b class="btn B">B</b> back` }));
  screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, index: Math.min(focus, Math.max(0, rows.length - 1)), onBack: () => ui.hub('Front Office'),
    onTab: (d) => tradeFinder(ui, { ...st, filter: (st.filter + d + POS_TABS.length) % POS_TABS.length }) });
  screens.extraButtons = (fr) => {
    if (sortKeys(fr, st.sort, cols.length, () => tradeFinder(ui, st, screens.nav.index))) return;
    if (fr.pressed.Y) pickTeam(ui, {});
  };
}
const TABS = ['Your roster', 'Your picks', 'Their roster', 'Their picks'];

export function tradeBuilder(ui, ti, st, focus = 0, backTo = null) {
  if (backTo) st.backTo = backTo;
  const leave = () => (st.backTo ? st.backTo() : ui.hub('Front Office'));
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams, me = teams[f.userTeam], them = teams[ti];
  const mine = st.side < 2, picksTab = st.side % 2 === 1;
  const team = mine ? me : them;
  let rows;
  if (!picksTab) {
    const set = mine ? st.give : st.get;
    const list = [...team.roster].filter((p) => !p.career).sort((a, b) => b.ovr - a.ovr);
    rows = list.map((p) => {
      const on = set.has(p.id);
      const r = el(`div.st-row${on ? '.mine' : ''}`, {}, el('span.dc-pos', { text: p.pos }), el('span.st-name', {}, el('b', { text: who(p) }),
        el('small', { text: `${p.injury ? ' INJ' : ''}${p.onBlock ? ' BLOCK' : ''}${p.tradeRequest ? ' WANTS OUT' : ''}` })),
        el('span.st-num', { text: String(p.age) }), el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: money(p.salary || 0) }),
        el('span.st-num', { text: on ? '✓' : '' }));
      r.activate = () => { on ? set.delete(p.id) : set.add(p.id); tradeBuilder(ui, ti, st, list.indexOf(p)); };
      return r;
    });
  } else {
    const set = mine ? st.givePk : st.getPk;
    const list = picksOf(f, mine ? f.userTeam : ti);
    rows = list.map((pk, i) => {
      const k = pickKey(pk), on = set.has(k);
      const r = el(`div.st-row${on ? '.mine' : ''}`, {}, el('span.dc-pos', { text: `R${pk.round}` }), el('span.st-name', {}, el('b', { text: pickLabel(pk, teams) })),
        el('span.st-num', { text: `~#${expectedSlot(f, teams, pk.orig, pk.year)}` }), el('span.st-num', { text: pickValue(f, teams, pk).toFixed(1) }), el('span.st-num', { text: '' }),
        el('span.st-num', { text: on ? '✓' : '' }));
      r.activate = () => { on ? set.delete(k) : set.add(k); tradeBuilder(ui, ti, st, i); };
      return r;
    });
  }
  const players = (t, ids) => t.roster.filter((p) => ids.has(p.id));
  const picks = (owner, keys) => picksOf(f, owner).filter((pk) => keys.has(pickKey(pk)));
  const give = { players: players(me, st.give), picks: picks(f.userTeam, st.givePk) };
  const get = { players: players(them, st.get), picks: picks(ti, st.getPk) };
  const ev = evaluateDeal(f, teams, ti, give, f.userTeam, get);
  const meter = Math.max(0, Math.min(1, ev.ratio));
  const line = (side) => [...side.players.map((p) => `${p.pos} ${who(p)} (${p.ovr}, ${money(p.salary)})`), ...side.picks.map((pk) => `${pickLabel(pk, teams)} pick`)];
  const summary = el('div.fr-week', {},
    el('div.dc-head', { text: 'You give' }), ...(line(give).length ? line(give) : ['—']).map((t) => el('div.fr-score', { text: t })),
    el('div.dc-head', { text: 'You get' }), ...(line(get).length ? line(get) : ['—']).map((t) => el('div.fr-score', { text: t })),
    el('div.dc-head', { text: `${them.abbr} interest` }),
    el('div.tr-meter', {}, el('div', { style: { width: `${Math.round(meter * 100)}%`, background: ev.accept ? '#fff' : meter > 0.8 ? '#bbb' : '#666' } })),
    el('div.fr-score', { text: !line(give).length || !line(get).length ? 'Something has to go each way: players or picks.' : !ev.capOk ? 'Doesn\'t fit under the salary cap.' : ev.accept ? 'They\'d take this deal.' : meter > 0.8 ? 'Close: add a little more.' : 'Not enough value for them.' }));
  const propose = el('div.start-btn', { text: 'Propose trade' });
  propose.activate = () => {
    // Nothing for nothing: a deal needs something going each way.
    if (!evaluateDeal(f, teams, ti, give, f.userTeam, get).accept) { window.alert(`${them.city} ${them.name} turned it down.`); return; }
    executeDeal(f, teams, f.userTeam, give, ti, get);
    logTransaction(f, `${me.abbr} trade ${dealText(teams, give)} to ${them.abbr} for ${dealText(teams, get)}`);
    ui.save();
    window.alert('Trade accepted! Check your depth chart.');
    ui.hub('Front Office');
  };
  const buttons = [propose, back(leave, 'Cancel')];
  screens.frame('stats-screen', el('h1', { text: `Trade with ${them.city} ${them.name}` }),
    el('div.league-status', { text: `${capLine(f, me)}` }),
    el('div.pc-tabs', {}, TABS.map((l, i) => el(`div.pc-tab${i === st.side ? '.on' : ''}`, { text: `${l} (${[give.players, give.picks, get.players, get.picks][i].length})` }))),
    el('div.fr-sched', {}, el('div.st-table', {}, el('div.st-row.st-head', {}, el('span.dc-pos', { text: picksTab ? 'RND' : 'POS' }), el('span.st-name', { text: picksTab ? 'Pick' : 'Player' }),
      ...(picksTab ? ['SLOT', 'VALUE', '', ''] : ['AGE', 'OVR', 'SALARY', '']).map((c) => el('span.st-num', { text: c }))), rows.length ? rows : el('div.st-empty', { text: 'None.' })), summary),
    el('div.over-buttons', {}, buttons),
    el('div.setup-help', { html: '<b class="btn A">A</b> add / remove &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> your roster · your picks · their roster · their picks &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set([...rows, ...buttons], { columns: 1, index: focus, onBack: leave, onTab: (d) => { st.side = (st.side + d + 4) % 4; tradeBuilder(ui, ti, st); } });
}

/** Trade block: toggle who you're shopping (CPU teams make offers each week). */
export function tradeBlockScreen(ui, focus = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, me = ui.teams[f.userTeam];
  const list = [...me.roster].filter((p) => !p.career).sort((a, b) => (b.onBlock ? 1 : 0) - (a.onBlock ? 1 : 0) || b.ovr - a.ovr);
  const rows = list.map((p, i) => {
    const r = el(`div.st-row${p.onBlock ? '.mine' : ''}`, {}, el('span.dc-pos', { text: p.pos }), el('span.st-name', {}, el('b', { text: who(p) }), el('small', { text: p.tradeRequest ? ' WANTS OUT' : '' })),
      el('span.st-num', { text: String(p.age) }), el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: money(p.salary || 0) }), el('span.st-num', { text: p.onBlock ? 'ON BLOCK' : '' }));
    r.activate = () => { p.onBlock = !p.onBlock; ui.save(); tradeBlockScreen(ui, i); };
    return r;
  });
  screens.frame('stats-screen', el('h1', { text: 'Trade Block' }),
    el('div.league-status', { text: 'Players on the block draw offers every week (Trade Offers). Teams can still ask about anyone. Being shopped hurts morale a little.' }),
    el('div.st-table', {}, rows),
    el('div.setup-help', { html: '<b class="btn A">A</b> put on / take off the block &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows, { columns: 1, index: Math.min(focus, rows.length - 1), onBack: () => ui.hub('Front Office') });
}

/** Offers that came in this week: A accepts, X declines. */
export function offersScreen(ui) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams, me = teams[f.userTeam];
  const offers = (f.offers || []).filter((o) => me.roster.some((p) => p.id === o.player));
  const rows = offers.map((o) => {
    const p = me.roster.find((q) => q.id === o.player);
    const give = { players: o.give.players.map((x) => teams[o.from].roster.find((q) => q.id === x.id)).filter(Boolean), picks: o.give.picks.filter((pk) => f.picks?.[pk.year]?.[pk.round]?.[pk.orig] === o.from) };
    const r = el('div.st-row', {}, el('span.st-team', { text: teams[o.from].abbr }), el('span.st-name', {}, el('b', { text: `${p.pos} ${who(p)} (${p.ovr})` }), el('small', { text: `  for ${dealText(teams, give)}${o.unsolicited ? ' · unsolicited' : ''}` })));
    r.activate = () => {
      if (!window.confirm(`Trade ${p.pos} ${who(p)} to ${teams[o.from].abbr} for ${dealText(teams, give)}?`)) return;
      executeDeal(f, teams, f.userTeam, { players: [p], picks: [] }, o.from, give);
      logTransaction(f, `${me.abbr} trade ${p.pos} ${who(p)} to ${teams[o.from].abbr} for ${dealText(teams, give)}`);
      f.offers = f.offers.filter((x) => x.player !== o.player);
      ui.save(); offersScreen(ui);
    };
    r.offer = o;
    return r;
  });
  screens.frame('stats-screen', el('h1', { text: 'Trade Offers' }),
    el('div.league-status', { text: 'Offers last until the week ends. Put players on the trade block to get more.' }),
    el('div.st-table', {}, rows.length ? rows : el('div.st-empty', { text: 'No offers this week.' })),
    el('div.setup-help', { html: '<b class="btn A">A</b> accept &nbsp; <b class="btn X">X</b> decline &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, onBack: () => ui.hub('Front Office') });
  screens.extraButtons = (fr) => {
    if (!fr.pressed.X) return;
    const o = screens.nav.items[screens.nav.index]?.offer;
    if (o) { f.offers = f.offers.filter((x) => x !== o); ui.save(); offersScreen(ui); }
  };
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

