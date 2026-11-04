// More franchise screens (Update 1.0): injury report with injured reserve, practice squad, waiver wire, league-wide
// player search and the pre-game preview from your coordinators. `ui` = FranchiseUI (ctx.screens, f, teams, save(), hub()).
import { el } from './nav.js';
import { logoCanvas } from '../render/logo.js';
import { sortHead, sortKeys, sortRows } from './sortable.js';
import { gameStatus, reinjuryRisk, injuryLine, placeOnIR, canActivate, activateFromIR, activeCount, IR_MIN, IR_RETURNS } from '../franchise/health.js';
import { PS_MAX, ELEVATE_MAX, ELEVATE_PER_GAME, addToPS, promoteFromPS, elevate, psEligible, isVeteranPS } from '../franchise/practiceSquad.js';
import { standings, rank } from '../franchise/season.js';
import { gameWhen } from '../franchise/nflSchedule.js';
import { moraleOf } from '../franchise/development.js';
import { traitsOf, TRAITS } from '../data/traits.js';
import { alphaOrder } from './screens.js';
import { logTransaction } from '../franchise/franchise.js';
import { ensureDraftClass, scoutInSeason, importDraftClass } from '../franchise/draftClass.js';
import { scoutView } from '../franchise/extras.js';
import { pickFile } from '../data/storage.js';
import { parseCSV, freeAgentsFromRows } from '../data/csv.js';

const POS_FILTERS = [['All', null], ['QB', ['QB']], ['RB', ['HB', 'FB']], ['WR', ['WR']], ['TE', ['TE']], ['OL', ['T', 'G', 'C']],
  ['DL', ['DE', 'DT']], ['LB', ['OLB', 'MLB']], ['DB', ['CB', 'FS', 'SS']], ['K/P', ['K', 'P']]];

/** A generic sortable player table. cols = [[label, getter(p, t), fmt?]]. */
function table(cols, list, sort, onRow) {
  const head = el('div.st-row.st-head', {}, sortHead(cols.map((c) => c[0]), sort, 'span.st-num'));
  const rows = sortRows(list, sort, cols.map((c) => (x) => c[1](x))).map((x) => {
    const r = el(`div.st-row${x.mine ? '.mine' : ''}`, {}, cols.map((c, i) => el(`span.st-num${i === sort.col ? '.sorted' : ''}${c[3] ? '.' + c[3] : ''}`, { text: String(c[2] ? c[2](x) : c[1](x)) })));
    r.activate = () => onRow?.(x);
    return r;
  });
  return { head, rows };
}

// ---------------------------------------------------------------------------------------------------------------
/** Injury report: status (Out / Doubtful / Questionable / IR), the diagnosis, re-injury risk; IR moves; sit/play. */
export function injuryReport(ui, mine = true, sort = { col: null, asc: false, cur: 0 }) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams, me = teams[f.userTeam];
  const list = teams.flatMap((t, ti) => (mine && ti !== f.userTeam ? [] : t.roster.filter((p) => p.injury).map((p) => ({ p, t, ti }))));
  const cols = [['TM', (x) => x.t.abbr], ['POS', (x) => x.p.pos], ['PLAYER', (x) => `${x.p.first} ${x.p.last}`, null, 'wide'], ['OVR', (x) => x.p.ovr],
    ['STATUS', (x) => gameStatus(x.p.injury) || 'Healthy'], ['INJURY', (x) => injuryLine(x.p.injury), null, 'wide'], ['RISK', (x) => (x.p.injury.weeks <= 1 && !x.p.injury.ir ? reinjuryRisk(x.p.injury).toUpperCase() : '—')],
    ['PLAYS?', (x) => (x.p.injury.ir ? 'No' : x.p.injury.weeks >= 2 ? 'No' : x.p.injury.sit ? 'Sits' : 'Plays')]];
  const { head, rows } = table(cols, list.length ? list : [], sort, (x) => mine && action(x.p));
  const action = (p) => {
    const inj = p.injury;
    if (inj.ir) {
      if (activateFromIR(me, p)) { logTransaction(f, `${me.abbr} activate ${p.pos} ${p.first} ${p.last} from injured reserve`); ui.save(); }
    } else if (inj.weeks >= IR_MIN || inj.severe) {
      if (placeOnIR(me, p)) { logTransaction(f, `${me.abbr} place ${p.pos} ${p.first} ${p.last} on injured reserve`); ui.save(); }
    } else if (inj.weeks <= 1) { inj.sit = !inj.sit; ui.save(); }
    injuryReport(ui, mine, sort);
  };
  const empty = el('div.st-empty', { text: mine ? 'Your team is healthy.' : 'No injuries around the league.' });
  const irCount = me.roster.filter((p) => p.injury?.ir).length;
  screens.frame('stats-screen wide-table', el('h1', { text: 'Injury Report' }),
    el('div.st-team-filter', { text: mine ? `${me.city} ${me.name} · ${activeCount(me)}/53 active · ${irCount} on IR · ${IR_RETURNS - (me.irReturns || 0)} IR returns left` : 'Whole league' }),
    el('div.st-table', {}, head, rows.length ? rows : empty),
    el('div.setup-help', { html: `<b class="btn A">A</b> ${mine ? 'IR: place (out 4+ weeks) / activate · questionable: play or sit' : ''} &nbsp; ◀▶ column <b class="btn X">X</b> sort &nbsp; <b class="btn Y">Y</b> my team / league &nbsp; <b class="btn B">B</b> back` }));
  screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => ui.hub('Team') });
  screens.extraButtons = (fr) => {
    if (sortKeys(fr, sort, cols.length, () => injuryReport(ui, mine, sort))) return;
    if (fr.pressed.Y) injuryReport(ui, !mine, sort);
  };
}

// ---------------------------------------------------------------------------------------------------------------
/** Practice squad: your 16, A = elevate for this week / sign to the 53; X = add the best young free agent you pick. */
export function practiceSquadScreen(ui, mode = 'squad', filter = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, me = ui.teams[f.userTeam];
  const ps = me.ps ||= [];
  const sort = { col: null, cur: 0 };
  if (mode === 'add') {
    const [fname, positions] = POS_FILTERS[filter];
    const pool = (f.freeAgents || []).filter((p) => (!positions || positions.includes(p.pos)) && psEligible(me, p)).sort((a, b) => b.ovr - a.ovr || (a.age ?? 30) - (b.age ?? 30)).slice(0, 60);
    const rows = pool.map((p) => {
      const r = el('div.st-row', {}, el('span.st-num', { text: p.pos }), el('span.st-num.wide', { text: `${p.first} ${p.last}` }), el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: `${p.age}` }), el('span.st-num', { text: isVeteranPS(p) ? 'Vet' : 'Young' }));
      r.activate = () => {
        f.freeAgents.splice(f.freeAgents.indexOf(p), 1);
        if (addToPS(me, p)) logTransaction(f, `${me.abbr} sign ${p.pos} ${p.first} ${p.last} to the practice squad`);
        ui.save(); practiceSquadScreen(ui);
      };
      return r;
    });
    screens.frame('stats-screen', el('h1', { text: 'Add to Practice Squad' }),
      el('div.pc-tabs', {}, POS_FILTERS.map(([n], i) => el(`div.pc-tab${i === filter ? '.on' : ''}`, { text: n }))),
      el('div.st-team-filter', { text: `${ps.length}/${PS_MAX} on the squad · up to 6 veterans` }),
      el('div.st-table', {}, rows.length ? rows : el('div.st-empty', { text: 'Nobody eligible here.' })),
      el('div.setup-help', { html: `<b class="btn A">A</b> Sign to the practice squad &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> ${fname} &nbsp; <b class="btn B">B</b> back` }));
    screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, onBack: () => practiceSquadScreen(ui), onTab: (d) => practiceSquadScreen(ui, 'add', (filter + d + POS_FILTERS.length) % POS_FILTERS.length) });
    return;
  }
  const elevatedNow = me.roster.filter((p) => p.elevated).length;
  const rows = [...ps].sort((a, b) => b.ovr - a.ovr).map((p) => {
    const r = el(`div.st-row${p.elevated ? '.mine' : ''}`, {}, el('span.st-num', { text: p.pos }), el('span.st-num.wide', { text: `${p.first} ${p.last}` }),
      el('span.st-num', { text: String(p.ovr) }), el('span.st-num', { text: String(p.age) }),
      el('span.st-num', { text: `${p.elevations || 0}/${ELEVATE_MAX}` }), el('span.st-num', { text: p.elevated ? 'ELEVATED' : '' }));
    r.activate = () => {
      // A: elevate for this week's game (2 a game, 3 a season each); Y: sign him to the 53.
      if (!p.elevated && elevate(me, p)) logTransaction(f, `${me.abbr} elevate ${p.pos} ${p.first} ${p.last} from the practice squad`);
      ui.save(); practiceSquadScreen(ui);
    };
    r.player = p;
    return r;
  });
  screens.frame('stats-screen', el('h1', { text: 'Practice Squad' }),
    el('div.st-team-filter', { text: `${ps.length}/${PS_MAX} players · elevated this week ${elevatedNow}/${ELEVATE_PER_GAME} · each player can be elevated ${ELEVATE_MAX} times a season, then must be signed` }),
    el('div.st-row.st-head', {}, ['POS', 'PLAYER', 'OVR', 'AGE', 'ELEV', ''].map((h, i) => el(`span.st-num${i === 1 ? '.wide' : ''}`, { text: h }))),
    el('div.st-table', {}, rows.length ? rows : el('div.st-empty', { text: 'Empty. X adds players from free agency.' })),
    el('div.setup-help', { html: '<b class="btn A">A</b> Elevate for this game &nbsp; <b class="btn Y">Y</b> Sign to the 53 &nbsp; <b class="btn X">X</b> Add a free agent &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, onBack: () => ui.hub('Team') });
  screens.extraButtons = (fr) => {
    if (fr.pressed.X) { screens.extraButtons = null; practiceSquadScreen(ui, 'add'); return; }
    if (fr.pressed.Y) {
      const p = screens.nav.items?.[screens.nav.index]?.player;
      if (p && promoteFromPS(me, p)) { logTransaction(f, `${me.abbr} sign ${p.pos} ${p.first} ${p.last} off the practice squad`); ui.save(); }
      practiceSquadScreen(ui);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
/** Waiver wire: players released this week; A puts in (or withdraws) a claim. Claims are processed in waiver order. */
export function waiversScreen(ui) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams;
  const list = f.waivers || [];
  const rows = list.map((w) => {
    const claimed = w.claims.includes(f.userTeam);
    const r = el(`div.st-row${claimed ? '.mine' : ''}`, {}, el('span.st-num', { text: w.p.pos }), el('span.st-num.wide', { text: `${w.p.first} ${w.p.last}` }),
      el('span.st-num', { text: String(w.p.ovr) }), el('span.st-num', { text: String(w.p.age) }), el('span.st-num', { text: w.from !== null && w.from !== undefined ? teams[w.from].abbr : '' }),
      el('span.st-num', { text: claimed ? 'CLAIMED' : '' }));
    r.activate = () => { if (claimed) w.claims.splice(w.claims.indexOf(f.userTeam), 1); else w.claims.push(f.userTeam); ui.save(); waiversScreen(ui); };
    return r;
  });
  const order = rank(standings(teams, f.schedule)).reverse().map((r) => r.team);
  const pos = order.indexOf(f.userTeam) + 1;
  screens.frame('stats-screen', el('h1', { text: 'Waiver Wire' }),
    el('div.st-team-filter', { text: `Your waiver priority: ${pos} of ${teams.length} (worst record claims first). Claims go through when the week ends.` }),
    el('div.st-row.st-head', {}, ['POS', 'PLAYER', 'OVR', 'AGE', 'FROM', ''].map((h, i) => el(`span.st-num${i === 1 ? '.wide' : ''}`, { text: h }))),
    el('div.st-table', {}, rows.length ? rows : el('div.st-empty', { text: 'Nobody on waivers right now.' })),
    el('div.setup-help', { html: '<b class="btn A">A</b> Claim / withdraw &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, onBack: () => ui.hub('Front Office') });
}

// ---------------------------------------------------------------------------------------------------------------
/** Every player in the league: position filter (LB/RB), team filter (Y), sortable columns, your players highlighted. */
export function playerSearch(ui, state = null) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams;
  const st = state || { filter: 0, team: null, sort: { col: 3, asc: false, cur: 3 } };
  const [fname, positions] = POS_FILTERS[st.filter];
  const order = alphaOrder(teams);
  const list = [];
  teams.forEach((t, ti) => {
    if (st.team !== null && st.team !== ti) return;
    for (const p of t.roster) if (!positions || positions.includes(p.pos)) list.push({ p, t, ti, mine: ti === f.userTeam });
  });
  if (st.team === -1 || st.team === null) for (const p of f.freeAgents || []) if (!positions || positions.includes(p.pos)) list.push({ p, t: { abbr: 'FA' }, ti: -1 });
  const cols = [['TM', (x) => x.t.abbr], ['POS', (x) => x.p.pos], ['PLAYER', (x) => `${x.p.first} ${x.p.last}`, null, 'wide'], ['OVR', (x) => x.p.ovr], ['AGE', (x) => x.p.age ?? 0],
    ['$M', (x) => x.p.salary ?? 0, (x) => (x.p.salary ?? 0).toFixed(1)], ['YRS', (x) => x.p.years ?? 0], ['MOOD', (x) => moraleOf(x.p)],
    ['TRAITS', (x) => traitsOf(x.p).length, (x) => traitsOf(x.p).map((id) => TRAITS[id].name).join(', ') || '', 'wide']];
  const all = sortRows(list, st.sort, cols.map((c) => (x) => c[1](x))).slice(0, 150);
  const head = el('div.st-row.st-head', {}, sortHead(cols.map((c) => c[0]), st.sort, 'span.st-num'));
  const rows = all.map((x) => {
    const r = el(`div.st-row${x.mine ? '.mine' : ''}`, {}, cols.map((c, i) => el(`span.st-num${i === st.sort.col ? '.sorted' : ''}${c[3] ? '.' + c[3] : ''}`, { text: String(c[2] ? c[2](x) : c[1](x)) })));
    r.activate = () => { if (x.ti >= 0) ui.ctx.rosterScreen(x.ti, () => playerSearch(ui, st)); };
    return r;
  });
  const teamLabel = st.team === null ? 'Whole league + free agents' : `${teams[st.team].city} ${teams[st.team].name}`;
  screens.frame('stats-screen wide-table', el('h1', { text: 'Player Search' }),
    el('div.pc-tabs', {}, POS_FILTERS.map(([n], i) => el(`div.pc-tab${i === st.filter ? '.on' : ''}`, { text: n }))),
    el('div.st-team-filter', { text: `${teamLabel} · ${list.length} players${list.length > 150 ? ' (top 150 shown)' : ''}` }),
    el('div.st-table', {}, head, rows.length ? rows : el('div.st-empty', { text: 'Nobody.' })),
    el('div.setup-help', { html: `<b class="btn LB">LB</b>/<b class="btn RB">RB</b> ${fname} &nbsp; ◀▶ column <b class="btn X">X</b> sort &nbsp; <b class="btn Y">Y</b> team &nbsp; <b class="btn A">A</b> open roster &nbsp; <b class="btn B">B</b> back` }));
  screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, onBack: () => ui.hub('Front Office'), onTab: (d) => playerSearch(ui, { ...st, filter: (st.filter + d + POS_FILTERS.length) % POS_FILTERS.length }) });
  screens.extraButtons = (fr) => {
    if (sortKeys(fr, st.sort, cols.length, () => playerSearch(ui, st))) return;
    if (fr.pressed.Y) {
      const i = st.team === null ? -1 : order.indexOf(st.team);
      st.team = i + 1 >= order.length ? null : order[i + 1];
      playerSearch(ui, st);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
/** Season team ranks from the franchise stats (per game): offense and defense yards, points, 3rd downs. */
export function teamRanks(f, teams) {
  const n = teams.length;
  const T = teams.map(() => ({ gp: 0, pf: 0, pa: 0, passY: 0, rushY: 0, passA: 0, rushA: 0, passYA: 0, rushYA: 0, sacks: 0, sacked: 0 }));
  for (const wk of f.schedule) for (const g of wk) {
    if (!g.score) continue;
    for (const [ti, oi, pf, pa] of [[g.home, g.away, g.score[0], g.score[1]], [g.away, g.home, g.score[1], g.score[0]]]) { T[ti].gp++; T[ti].pf += pf; T[ti].pa += pa; }
  }
  // Player season totals by team (roster ownership now).
  const owner = new Map();
  teams.forEach((t, ti) => t.roster.forEach((p) => owner.set(String(p.id), ti)));
  for (const [rid, s] of Object.entries(f.stats || {})) {
    const ti = owner.get(rid) ?? s.teamIdx;
    if (ti === undefined || ti < 0) continue;
    T[ti].passY += s.passYds || 0; T[ti].rushY += s.rushYds || 0; T[ti].sacks += s.sacks || 0;
  }
  const per = (k) => T.map((x) => (x.gp ? x[k] / x.gp : 0));
  const rankOf = (vals, low = false) => vals.map((v) => 1 + vals.filter((w) => (low ? w < v : w > v)).length);
  const passY = per('passY'), rushY = per('rushY'), pf = per('pf'), pa = per('pa'), sacks = per('sacks');
  return { passY, rushY, pf, pa, sacks, r: { passY: rankOf(passY), rushY: rankOf(rushY), pf: rankOf(pf), pa: rankOf(pa, true), sacks: rankOf(sacks) }, n };
}

/** Pre-game preview: your coordinators on the opponent — their stars and leaders, and how the teams rank. */
export function gamePreview(ui, g) {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams;
  const oi = g.home === f.userTeam ? g.away : g.home;
  const opp = teams[oi], me = teams[f.userTeam];
  const R = teamRanks(f, teams);
  const lead = (ti, k) => Object.entries(f.stats || {}).filter(([rid]) => teams[ti].roster.some((p) => String(p.id) === rid)).map(([rid, s]) => ({ s, p: teams[ti].roster.find((q) => String(q.id) === rid) }))
    .filter((x) => (x.s[k] || 0) > 0).sort((a, b) => b.s[k] - a.s[k])[0];
  const leaderRow = (label, x, k, unit) => el('div.pg-lead', {}, el('small', { text: label }), el('b', { text: x ? `${x.p.pos} ${x.p.first[0]}. ${x.p.last}` : '—' }), el('span', { text: x ? `${Math.round(x.s[k])} ${unit}` : '' }));
  const stars = [...opp.roster].sort((a, b) => b.ovr - a.ovr).slice(0, 4);
  const coord = (role) => opp.coaches?.[role]?.name || (role === 'oc' ? 'Offensive coordinator' : 'Defensive coordinator');
  const myOC = me.coaches?.oc?.name || 'Your offensive coordinator', myDC = me.coaches?.dc?.name || 'Your defensive coordinator';
  const ord = (k) => { const r = R.r[k][oi]; return `${r}${r % 10 === 1 && r !== 11 ? 'st' : r % 10 === 2 && r !== 12 ? 'nd' : r % 10 === 3 && r !== 13 ? 'rd' : 'th'}`; };
  const passD = lead(oi, 'passYds'), rushD = lead(oi, 'rushYds'), recD = lead(oi, 'recYds'), sackD = lead(oi, 'sacks'), intD = lead(oi, 'defInt');
  const dc = el('div.pv-card', {}, el('div.pg-ptitle', { text: `${myDC.toUpperCase()}: THEIR OFFENSE` }),
    el('p', { text: `${opp.name} average ${R.pf[oi].toFixed(1)} points (${ord('pf')}), ${R.passY[oi].toFixed(0)} passing yards (${ord('passY')}) and ${R.rushY[oi].toFixed(0)} rushing yards (${ord('rushY')}) a game.` }),
    leaderRow('PASS', passD, 'passYds', 'yds'), leaderRow('RUSH', rushD, 'rushYds', 'yds'), leaderRow('REC', recD, 'recYds', 'yds'),
    el('p.pv-key', { text: rushD && R.r.rushY[oi] <= 8 ? `Stop the run: ${rushD.p.last} is the key.` : passD ? `Keep ${passD.p.last} uncomfortable: pressure and disguise.` : 'Play sound, assignment football.' }));
  const oc = el('div.pv-card', {}, el('div.pg-ptitle', { text: `${myOC.toUpperCase()}: THEIR DEFENSE` }),
    el('p', { text: `${opp.name} allow ${R.pa[oi].toFixed(1)} points a game (${ord('pa')}) and get ${R.sacks[oi].toFixed(1)} sacks a game (${ord('sacks')}).` }),
    leaderRow('SACKS', sackD, 'sacks', ''), leaderRow('INT', intD, 'defInt', ''),
    el('p.pv-key', { text: sackD && sackD.s.sacks >= 4 ? `Account for ${sackD.p.last} on every pass: slide protection his way.` : intD ? `${intD.p.last} has a nose for the ball: don't stare down your first read.` : 'Take what the coverage gives you.' }));
  const starsCard = el('div.pv-card', {}, el('div.pg-ptitle', { text: 'PLAYERS TO WATCH' }),
    ...stars.map((p) => el('div.pg-lead', {}, el('small', { text: p.pos }), el('b', { text: `${p.first} ${p.last}` }), el('span', { text: `${p.ovr} OVR${traitsOf(p).length ? ' · ' + traitsOf(p).map((id) => TRAITS[id].name).join(', ') : ''}` }))));
  const start = el('div.start-btn', { text: 'Play Game' });
  start.activate = () => ui.ctx.playGame(g);
  screens.frame('mono-screen pv-screen', el('h1', { text: 'Game Preview' }),
    el('div.pv-top', {}, logoCanvas(teams[g.away].logo, 90), el('div.pv-vs', {}, el('b', { text: `${teams[g.away].abbr} @ ${teams[g.home].abbr}` }), el('small', { text: `${gameWhen(g)}${g.venue ? ` · ${g.venue.stadium}, ${g.venue.city}` : ''}` })), logoCanvas(teams[g.home].logo, 90)),
    el('div.pv-grid', {}, dc, oc, starsCard), start,
    el('div.setup-help', { html: '<b class="btn A">A</b> Play &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set([start], { onBack: () => ui.hub() });
}

// ---------------------------------------------------------------------------------------------------------------
/**
 * Draft scouting all season: next year's class (generated, or imported from a CSV with Y), sorted by what your scouts
 * think. X spends a scouting point (3 a week) to see a prospect's real overall and potential.
 */
export function scoutingScreen(ui, filter = 0, focus = 0) {
  const { screens } = ui.ctx;
  const f = ui.f;
  const dc = ensureDraftClass(f);
  const [fname, positions] = POS_FILTERS[filter];
  const list = dc.players.filter((p) => !positions || positions.includes(p.pos)).map((p) => ({ p, v: scoutView(p) })).sort((a, b) => b.v.sort - a.v.sort).slice(0, 80);
  const rows = list.map(({ p, v }, i) => {
    const r = el(`div.st-row${v.scouted ? '.mine' : ''}`, {}, el('span.st-num', { text: String(i + 1) }), el('span.st-num', { text: p.pos }), el('span.st-num.wide', { text: `${p.first} ${p.last}` }),
      el('span.st-num', { text: p.college || '' }), el('span.st-num', { text: String(p.age) }), el('span.st-num', { text: v.ovr }), el('span.st-num', { text: v.pot }));
    r.scout = () => { if (scoutInSeason(f, p.id)) { ui.save(); scoutingScreen(ui, filter, i); } };
    r.activate = r.scout;
    return r;
  });
  screens.frame('stats-screen', el('h1', { text: `${dc.year} Draft Class` }),
    el('div.pc-tabs', {}, POS_FILTERS.map(([n], i) => el(`div.pc-tab${i === filter ? '.on' : ''}`, { text: n }))),
    el('div.st-team-filter', { text: `${f.scoutPoints ?? 0} scouting points (3 more each week; the rest carry into the draft) · ${dc.imported ? 'imported class' : 'generated class'}` }),
    el('div.st-row.st-head', {}, ['RK', 'POS', 'PROSPECT', 'SCHOOL', 'AGE', 'OVR', 'POT'].map((h, i) => el(`span.st-num${i === 2 ? '.wide' : ''}`, { text: h }))),
    el('div.st-table', {}, rows),
    el('div.setup-help', { html: `<b class="btn A">A</b>/<b class="btn X">X</b> scout &nbsp; <b class="btn Y">Y</b> import a draft class (CSV) &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> ${fname} &nbsp; <b class="btn B">B</b> back` }));
  screens.nav.set(rows, { columns: 1, index: Math.min(focus, rows.length - 1), onBack: () => ui.hub('Season'), onTab: (d) => scoutingScreen(ui, (filter + d + POS_FILTERS.length) % POS_FILTERS.length) });
  screens.extraButtons = async (fr) => {
    if (fr.pressed.X) screens.nav.items[screens.nav.index]?.scout?.();
    if (fr.pressed.Y) {
      screens.extraButtons = null;
      const file = await pickFile('.csv,text/csv');
      if (file) {
        const rowsCSV = parseCSV(file.data);
        const { players } = freeAgentsFromRows(rowsCSV);
        if (players.length) { importDraftClass(f, players, rowsCSV); ui.save(); window.alert(`Imported ${players.length} prospects for the ${f.year + 1} draft.`); }
        else window.alert('No prospects found (roster.csv format: first, last, pos, ratings...; optional POT column).');
      }
      scoutingScreen(ui, filter);
    }
  };
}

/** Your roster by position against what a 53-man roster usually carries (for the draft / re-signing / trades). */
export function needsPanel(team) {
  const TARGET = { QB: 3, HB: 4, FB: 1, WR: 6, TE: 3, T: 4, G: 4, C: 2, DE: 4, DT: 4, OLB: 4, MLB: 3, CB: 6, FS: 2, SS: 2, K: 1, P: 1 };
  const have = {}, best = {};
  for (const p of team.roster) { have[p.pos] = (have[p.pos] || 0) + 1; best[p.pos] = Math.max(best[p.pos] || 0, p.ovr); }
  return el('div.fd-needs', {}, Object.entries(TARGET).map(([pos, n]) => el(`div${(have[pos] || 0) >= n ? '.ok' : (have[pos] || 0) === 0 ? '.none' : ''}`, {},
    el('span', { text: pos }), el('b', { text: `${have[pos] || 0}/${n}` }), el('small', { text: best[pos] ? ` top ${best[pos]}` : '' }))));
}
