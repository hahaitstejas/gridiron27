import { traitsOf, TRAITS } from '../data/traits.js';
import { numberAllowed } from '../data/positions.js';
import { el } from './nav.js';
import { faceImg, shrinkFace, skinToneFromImage, nearestSkin, deriveSkin } from './faces.js';
import { pickFile, loadImage } from '../data/storage.js';
import { RATINGS, POSITIONS, overall, OVERALL_WEIGHTS } from '../data/positions.js';
import { logoCanvas } from '../render/logo.js';
import { ICONS, alphaOrder } from './screens.js';
import { sortRows } from './sortable.js';
import { generatePlayer } from '../data/generator.js';
import { addPlayer, releasePlayer, tradePlayer, changePosition } from '../data/rosterOps.js';
import { RNG } from '../core/rng.js';

const RATING_NAMES = {
  speed: 'Speed', acceleration: 'Acceleration', agility: 'Agility', strength: 'Strength', awareness: 'Awareness',
  catching: 'Catching', carrying: 'Carrying', breakTackle: 'Break tackle', throwPower: 'Throw power', throwAccuracy: 'Throw accuracy',
  runBlock: 'Run block', passBlock: 'Pass block', passRush: 'Pass rush', blockShed: 'Block shed', tackling: 'Tackling',
  hitPower: 'Hit power', coverage: 'Coverage', routeRunning: 'Route running', kickPower: 'Kick power', kickAccuracy: 'Kick accuracy',
};
const posOrder = (p) => POSITIONS.indexOf(p.pos);
const feet = (inches) => `${Math.floor(inches / 12)}'${inches % 12}"`;
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const CODE = Object.fromEntries(RATINGS);
const BASE_COLS = ['speed', 'strength', 'agility', 'acceleration', 'awareness'];
const ALL_EXTRA = ['catching', 'breakTackle', 'throwPower', 'passBlock', 'passRush', 'tackling', 'coverage'];
const POS_FILTERS = ['ALL', ...POSITIONS];

/** Rating columns for a position filter: the five athletic ones, then what that position is rated on. */
function ratingCols(pos) {
  if (pos === 'ALL') return [...BASE_COLS, ...ALL_EXTRA];
  const w = OVERALL_WEIGHTS[pos] || {};
  const extra = Object.keys(w).filter((k) => !BASE_COLS.includes(k)).sort((a, b) => w[b] - w[a]).slice(0, 5);
  return [...BASE_COLS, ...extra];
}

/**
 * The player header shared by the roster table and the player card: a team-colored photo panel (face or number over
 * the team logo), first name thin / last name bold, bio lines and traits.
 */
export function playerHero(p, team, { big = false } = {}) {
  const face = faceImg(p, 'rh-face');
  const photo = el('div.rh-photo', { style: { '--tc': team?.colors?.primary || '#333', '--tc2': team?.colors?.secondary || '#111' } },
    team ? el('div.rh-logo', {}, logoCanvas(team.logo, 150)) : null,
    face || el('div.rh-num', { text: String(p.number) }),
    el('div.rh-tag', { html: `${p.pos} #${p.number} <i></i> OVR <b>${p.ovr}</b>` }));
  const traits = traitsOf(p);
  return el(`div.rh${big ? '.big' : ''}`, {}, photo,
    el('div.rh-id', {}, el('div.rh-first', { text: p.first.toUpperCase() }), el('div.rh-last', { text: p.last.toUpperCase() }),
      el('div.rh-bio', { html: `HT/WT: <b>${feet(p.height)}, ${p.weight} LBS</b>` }),
      el('div.rh-bio', { html: `COLLEGE: <b>${p.college || '—'}</b>` }),
      el('div.rh-bio', { html: `AGE: <b>${p.age}</b>${p.exp !== undefined ? ` &nbsp; EXP: <b>${p.exp}</b>` : ''}${team ? ` &nbsp; TEAM: <b>${team.abbr}</b>` : ''}${p.injury ? ` &nbsp; <b class="rh-inj">INJURED ${p.injury.weeks >= 8 ? 'SEASON' : p.injury.weeks + ' WK'}</b>` : ''}` })),
    el('div.rh-traits', {}, traits.map((t) => el('div.rh-trait', { html: `<span>★</span>${TRAITS[t].name.toUpperCase()}` }))));
}

/**
 * Rosters, opened from the main menu / League: tiles for what you can do (the user's reference: dark filled tiles,
 * title top-left, a big line icon bottom-right, the focused one white). ctx also carries onDepth / onSpreadsheets.
 */
export function rosterHub(ctx, focus = 0) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const back = () => rosterHub(ctx, screens.nav.index);
  const hubCtx = { ...ctx, onBack: back };
  const tile = (label, sub, icon, fn) => {
    const t = el('div.rx-tile', {}, el('div.rx-title', { text: label }), el('div.rx-sub', { text: sub }), el('div.rx-ico', { html: ICONS[icon] || '' }));
    t.activate = fn;
    return t;
  };
  const tiles = [
    tile('Manage Players', 'Every player in the league: ratings, edit, trade, release', 'people', () => rosterScreen(hubCtx, ctx.view?.ti ?? -1)),
    tile('Create Player', 'Add a new player to any team', 'user', () => ctx.pickTeam('Create player: pick a team', (ti) => newPlayer(hubCtx, ti), back)),
    tile('Order Depth Chart', 'Starters and rotation for any team', 'list', () => ctx.onDepth?.(back)),
    tile('Trade Players', 'Move players between teams', 'swap', () => rosterScreen({ ...hubCtx, trading: true }, ctx.view?.ti ?? -1)),
    tile('Spreadsheets', 'Export or import rosters, teams and depth charts', 'chart', () => ctx.onSpreadsheets?.(back)),
  ];
  screens.frame('mono-screen rx-screen', el('h1', { text: 'Edit Rosters' }), el('div.rx-grid', {}, tiles),
    el('div.mm2-bar', { html: '<span><b class="btn A">A</b> SELECT</span><span><b class="btn B">B</b> BACK</span>' }));
  screens.nav.set(tiles, { spatial: true, index: Math.min(focus, tiles.length - 1), onBack: ctx.onBack });
}

/**
 * Manage Players: one table for the whole league or one team (LB/RB), filtered by position (LT/RT), sortable
 * (◀▶ column, X sort), with the focused player's header on top. A opens his actions (edit / trade / release).
 * ctx = { screens, teams, onBack, onChange, pickTeam, onTrade?, onRelease?, trading? }. ti = team index, -1 = all teams.
 */
export function rosterScreen(ctx, ti, focus = 0) {
  const { screens, teams } = ctx;
  screens.extraButtons = null;
  const v = (ctx.view ||= { ti, pos: 'ALL', sort: { col: 3, asc: false, cur: 3 }, focus: 0 });
  if (v.ti !== ti) { v.ti = ti; v.focus = 0; }
  if (focus) v.focus = focus;
  const order = alphaOrder(teams);
  const rcols = ratingCols(v.pos);
  const cols = [['PLAYER', (x) => x.p.last], ['TEAM', (x) => x.t.abbr], ['POS', (x) => posOrder(x.p)], ['OVR', (x) => x.p.ovr], ['AGE', (x) => x.p.age],
    ...rcols.map((k) => [CODE[k], (x) => x.p.ratings[k]])];
  if (v.sort.cur >= cols.length) v.sort.cur = 3;
  if (v.sort.col >= cols.length) v.sort.col = 3;
  let list = [];
  (ti < 0 ? order : [ti]).forEach((i) => { for (const p of teams[i].roster) if (v.pos === 'ALL' || p.pos === v.pos) list.push({ p, t: teams[i], ti: i }); });
  list = sortRows(list, v.sort, cols.map((c) => c[1]));
  const hero = el('div.rh-host');
  const showHero = (x) => { hero.innerHTML = ''; if (x) hero.append(playerHero(x.p, x.t)); };
  const headCells = () => cols.map((c, i) => el(`span.rt-c${i === 0 ? '.name' : ''}${i === v.sort.cur ? '.cur' : ''}${i === v.sort.col ? '.sorted' : ''}`, { text: `${i === v.sort.col ? (v.sort.asc ? '▲' : '▼') : ''}${c[0]}` }));
  const head = el('div.rt-row.rt-head', {}, headCells());
  const redrawHead = () => { head.innerHTML = ''; head.append(...headCells()); };
  const rows = list.map((x) => {
    const p = x.p;
    const vals = [`${p.first[0]}. ${p.last}${p.injury ? ' ✚' : ''}`, x.t.abbr, p.pos, p.ovr, p.age, ...rcols.map((k) => p.ratings[k])];
    const r = el('div.rt-row', {}, vals.map((val, i) => el(`span.rt-c${i === 0 ? '.name' : ''}`, { text: String(val) })));
    r.onfocusitem = () => { v.focus = rows.indexOf(r); showHero(x); };
    r.spin = (d) => { v.sort.cur = (v.sort.cur + d + cols.length) % cols.length; redrawHead(); };
    r.activate = () => (ctx.trading ? tradeTo(ctx, x) : actions(ctx, x));
    return r;
  });
  const teamLabel = ti < 0 ? 'ALL TEAMS' : `${teams[ti].name.toUpperCase()}`;
  const count = ti < 0 ? `${list.length} players` : `${teams[ti].roster.length} players · avg OVR ${Math.round(teams[ti].roster.reduce((a, p) => a + p.ovr, 0) / Math.max(1, teams[ti].roster.length))}`;
  screens.frame('mono-screen rt-screen', hero,
    el('div.rt-filters', {}, el('div.rt-chip', { html: `<b class="btn LB">LB</b><b class="btn RB">RB</b> ${teamLabel}` }),
      el('div.rt-chip', { html: `<b class="btn LT">LT</b><b class="btn RT">RT</b> ${v.pos === 'ALL' ? 'ALL POSITIONS' : v.pos}` }),
      el('div.rt-count', { text: ctx.trading ? `TRADE PLAYERS · ${count}` : count })),
    el('div.rt-table', {}, head, el('div.rt-body', {}, rows.length ? rows : el('div.rt-empty', { text: 'No players.' }))),
    el('div.mm2-bar', { html: `<span><b class="btn A">A</b> ${ctx.trading ? 'TRADE' : 'ACTIONS'}</span><span>◀▶ COLUMN</span><span><b class="btn X">X</b> SORT</span>${ti >= 0 ? '<span><b class="btn Y">Y</b> CREATE PLAYER</span>' : ''}<span><b class="btn B">B</b> BACK</span>` }));
  const go = (d) => { const i = ti < 0 ? -1 : order.indexOf(ti); const n = i + d; rosterScreen(ctx, n < -1 ? order[order.length - 1] : n >= order.length ? -1 : n < 0 ? -1 : order[n]); };
  screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, index: Math.min(v.focus, Math.max(0, rows.length - 1)), onBack: ctx.onBack, onTab: go });
  if (!rows.length) showHero(null);
  screens.extraButtons = (f) => {
    if (f.pressed.X) {
      if (v.sort.col === v.sort.cur) v.sort.asc = !v.sort.asc; else { v.sort.col = v.sort.cur; v.sort.asc = v.sort.cur <= 2; }
      v.focus = 0; rosterScreen(ctx, ti);
    } else if (f.pressed.Y && ti >= 0) newPlayer(ctx, ti);
    posTrigger(f);
  };
  // Positions on the triggers: a tap steps one (LT back, RT forward); holding one opens the list right there —
  // ▲▼ to pick, let go (or A) to jump to it.
  const posTrigger = (f) => {
    const now = performance.now();
    if (f.pressed.LT || f.pressed.RT) { v.trig = { at: now, d: f.pressed.RT ? 1 : -1, list: null }; return; }
    const t = v.trig;
    if (!t) return;
    const held = f.down.LT || f.down.RT || (f.lt || 0) > 0.4 || (f.rt || 0) > 0.4;
    if (held && !t.list && now - t.at > 320) t.list = openPosList();
    if (!held) {
      v.trig = null;
      if (t.list) { const pos = t.list.pick(); if (pos) { v.pos = pos; v.focus = 0; } rosterScreen(ctx, ti); return; }
      const i = POS_FILTERS.indexOf(v.pos);
      v.pos = POS_FILTERS[(i + t.d + POS_FILTERS.length) % POS_FILTERS.length];
      v.focus = 0; rosterScreen(ctx, ti);
    }
  };
  const openPosList = () => {
    const items = POS_FILTERS.map((pos) => {
      const it = el(`div.rx-pos${pos === v.pos ? '.on' : ''}`, { text: pos === 'ALL' ? 'ALL POSITIONS' : pos });
      it.pos = pos;
      it.activate = () => { v.pos = pos; v.focus = 0; v.trig = null; rosterScreen(ctx, ti); };
      return it;
    });
    screens.root.append(el('div.rx-poslist', {}, items));
    screens.nav.set(items, { columns: 1, index: Math.max(0, POS_FILTERS.indexOf(v.pos)), onBack: () => { v.trig = null; rosterScreen(ctx, ti); } });
    return { pick: () => screens.nav.current?.pos };
  };
}

/**
 * A player table in the Manage Players look (header card of the focused player on top, filter chips, dark table,
 * black hint bar). rows = [{ p, team, cells: [...], cls?, act }]; head = column labels (first = name column).
 */
export function playerTable(screens, { title = '', head, rows, chips = [], count = '', bar, focus = 0, onBack, onTab = null, extra = null, empty = 'No players.' }) {
  screens.extraButtons = null;
  const hero = el('div.rh-host');
  const show = (r) => { hero.innerHTML = ''; if (r) hero.append(playerHero(r.p, r.team)); };
  const items = rows.map((r) => {
    const it = el(`div.rt-row${r.cls ? '.' + r.cls : ''}`, {}, r.cells.map((c, i) => el(`span.rt-c${i === 0 ? '.name' : ''}`, { text: String(c) })));
    it.onfocusitem = () => show(r);
    it.activate = () => r.act?.(it);
    it.player = r.p;
    return it;
  });
  screens.frame('mono-screen rt-screen', hero,
    el('div.rt-filters', {}, title ? el('div.rt-title', { text: title }) : null, chips.map((c) => el('div.rt-chip', { html: c })), el('div.rt-count', { text: count })),
    el('div.rt-table', {}, el('div.rt-row.rt-head', {}, head.map((h, i) => el(`span.rt-c${i === 0 ? '.name' : ''}`, { text: h }))),
      el('div.rt-body', {}, items.length ? items : el('div.rt-empty', { text: empty }))),
    el('div.mm2-bar', { html: bar }));
  screens.nav.set(items.length ? items : [el('div')], { columns: 1, index: Math.min(focus, Math.max(0, items.length - 1)), onBack, onTab });
  if (!items.length) show(null);
  if (extra) screens.extraButtons = extra;
  return items;
}

/**
 * Pick a new signing's jersey number: every number he's allowed to wear (position rules) that the team doesn't
 * already use or has retired, his current one focused. A takes it; B keeps the one he has.
 */
export function numberPicker(screens, team, p, onDone) {
  screens.extraButtons = null;
  const used = new Set([...team.roster.filter((q) => q !== p).map((q) => q.number), ...(team.ps || []).filter((q) => q !== p).map((q) => q.number),
    ...(team.retired || []).map((r) => (typeof r === 'object' ? +r.number : +r))]);
  const nums = [];
  for (let n = 0; n <= 99; n++) if (numberAllowed(p.pos, n) && !used.has(n)) nums.push(n);
  const tiles = nums.map((n) => {
    const t = el(`div.nx-num${n === p.number ? '.on' : ''}`, { text: String(n) });
    t.activate = () => { p.number = n; onDone(n); };
    return t;
  });
  screens.frame('mono-screen rt-screen nx-screen', el('div.rh-host', {}, playerHero(p, team)),
    el('div.rt-filters', {}, el('div.rt-title', { text: 'Pick a Jersey Number' }), el('div.rt-count', { text: `${p.pos}: ${nums.length} numbers open on the ${team.name}` })),
    el('div.nx-grid', {}, tiles),
    el('div.mm2-bar', { html: '<span><b class="btn A">A</b> WEAR THIS NUMBER</span><span><b class="btn B">B</b> KEEP #' + p.number + '</span>' }));
  screens.nav.set(tiles, { spatial: true, index: Math.max(0, nums.indexOf(p.number)), onBack: () => onDone(p.number) });
}

/** The Actions panel over a table: [[label, fn], ...]; B (or a picked item) returns via `back`. */
export function actionsPanel(screens, title, list, back) {
  screens.root.querySelector('.rx-actions')?.remove();
  const items = list.filter(Boolean).map(([label, fn, note]) => {
    const it = el('div.rx-act', {}, el('span', { text: label }), note ? el('small', { text: note }) : null);
    it.activate = fn;
    return it;
  });
  screens.root.append(el('div.rx-actions', {}, el('div.rx-acth', { text: title }), el('div.rx-actlist', {}, items)));
  screens.extraButtons = null;
  screens.nav.set(items, { columns: 1, onBack: back });
}

/** A on a player: the actions panel over the table. */
function actions(ctx, x) {
  const { screens } = ctx;
  const { p, ti } = x;
  const back = () => rosterScreen(ctx, ctx.view.ti);
  const item = (label, fn) => { const it = el('div.rx-act', { text: label }); it.activate = fn; return it; };
  const items = [
    item('Edit Player', () => playerCard(ctx, ti, p.id)),
    item('Trade Player', () => tradeTo(ctx, x)),
    item('Release Player', () => {
      if (!window.confirm(`Release ${p.first} ${p.last}?`)) return;
      releasePlayer(ctx.teams[ti], p.id);
      ctx.onRelease?.(p);
      ctx.onChange();
      back();
    }),
  ];
  screens.root.querySelector('.rx-actions')?.remove();
  const panel = el('div.rx-actions', {}, el('div.rx-acth', { text: 'Actions' }), el('div.rx-actlist', {}, items));
  screens.root.append(panel);
  screens.extraButtons = null;
  screens.nav.set(items, { columns: 1, onBack: back });
}

/** Trade a player: in a franchise the trade screen (something has to come back), in the league editor a straight move. */
function tradeTo(ctx, x) {
  const { p, ti } = x;
  const back = () => rosterScreen(ctx, ctx.view.ti);
  if (ctx.onTrade) return ctx.onTrade(p, ti);
  ctx.pickTeam(`Trade ${p.first} ${p.last} to…`, (to) => {
    if (to !== ti) { tradePlayer(ctx.teams[ti], ctx.teams[to], p.id); ctx.onChange(); }
    back();
  }, back, ti);
}

function newPlayer(ctx, ti) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const items = POSITIONS.map((pos) => {
    const it = el('div.rx-tile.small', {}, el('div.rx-title', { text: pos }));
    it.activate = () => {
      const p = generatePlayer(pos, new RNG((Date.now() % 1e9) + pos.length), 0);
      addPlayer(ctx.teams[ti], p);
      ctx.onChange();
      playerCard(ctx, ti, p.id);
    };
    return it;
  });
  screens.frame('mono-screen rx-screen', el('h1', { text: `Create Player · ${ctx.teams[ti].name}` }), el('div.rx-grid.pos', {}, items),
    el('div.mm2-bar', { html: '<span><b class="btn A">A</b> CREATE</span><span><b class="btn B">B</b> BACK</span>' }));
  screens.nav.set(items, { spatial: true, onBack: () => (ctx.view ? rosterScreen(ctx, ti) : ctx.onBack()) });
}

const CARD_TABS = ['Player Info', 'Ratings', 'Appearance'];

/**
 * Edit one player (the reference's player screen): his header on top, then tabs (LB/RB) — Player Info, Ratings (a
 * grid of attribute tiles with bars), Appearance. ◀▶ changes the focused value (hold to repeat), A types it.
 */
export function playerCard(ctx, ti, id, focus = 0, tab = 0) {
  const { screens, teams } = ctx;
  screens.extraButtons = null;
  const team = teams[ti];
  const p = team.roster.find((q) => q.id === id) || team.ps?.find((q) => q.id === id); // practice squad too
  const back = ctx.cardBack || (() => (ctx.view ? rosterScreen(ctx, ctx.view.ti) : rosterScreen(ctx, ti)));
  if (!p) { back(); return; }
  const hero = el('div.rh-host');
  const refresh = () => { p.ovr = overall(p); hero.innerHTML = ''; hero.append(playerHero(p, team, { big: true })); };
  const changed = () => { refresh(); ctx.onChange(); };
  const again = () => playerCard(ctx, ti, id, screens.nav.index, tab);

  const row = (label, get, spin, type) => {
    const val = el('span.pcd-val');
    const r = el('div.pcd-row', {}, el('span.pcd-label', { text: label }), val);
    const draw = () => { val.innerHTML = `<i>‹</i><b>${get()}</b><i>›</i>`; };
    r.spin = (d) => { spin(d); draw(); changed(); };
    r.activate = () => {
      const v = window.prompt(`${label}:`, String(type === 'num' ? get().replace(/[^\d-]/g, '') : get()));
      if (v === null) return;
      spin(0, v);
      draw(); changed();
    };
    draw();
    return r;
  };
  const text = (label, key, max = 24) => row(label, () => p[key], (d, v) => { if (v !== undefined && v.trim()) p[key] = v.trim().slice(0, max); });
  const num = (label, key, lo, hi, step = 1, fmt = (v) => v) => row(label, () => String(fmt(p[key])),
    (d, v) => { p[key] = clampInt(v !== undefined ? parseInt(v, 10) || p[key] : p[key] + d * step, lo, hi); }, 'num');
  const action = (label, fn) => { const r = el('div.pcd-row.action', {}, el('span.pcd-label', { text: label })); r.activate = fn; return r; };

  let items = [];
  let body;
  if (tab === 0) {
    items = [
      text('First Name', 'first'),
      text('Last Name', 'last'),
      row('Position', () => p.pos, (d, v) => {
        const pos = v !== undefined ? v.trim().toUpperCase() : POSITIONS[(POSITIONS.indexOf(p.pos) + d + POSITIONS.length) % POSITIONS.length];
        if (!POSITIONS.includes(pos)) return;
        if (team.roster.includes(p)) changePosition(team, p, pos); else { p.pos = pos; p.ovr = overall(p); } // practice squad: no depth chart
      }),
      row('Jersey #', () => `#${p.number}`, (d, v) => {
        // Taken, retired and position-illegal numbers (QB 0-19, OL 50-79, ...) are skipped.
        const used = new Set([...team.roster.filter((q) => q !== p).map((q) => q.number), ...(team.retired || []).map((r) => (typeof r === 'object' ? +r.number : +r))]);
        const bad = (x) => used.has(x) || !numberAllowed(p.pos, x);
        let n = v !== undefined ? clampInt(parseInt(v, 10) || p.number, 0, 99) : p.number;
        if (v === undefined) { let k = 0; do { n = (n + d + 100) % 100; } while (bad(n) && ++k < 100); }
        if (!bad(n)) p.number = n;
        else if (v !== undefined) window.alert(`#${n} isn't available for a ${p.pos} (taken, retired, or outside the position's numbers).`);
      }, 'num'),
      num('Age', 'age', 20, 45),
      row('Height', () => feet(p.height), (d, v) => {
        if (v !== undefined) { const m = v.match(/(\d+)\D+(\d+)/); p.height = clampInt(m ? +m[1] * 12 + +m[2] : parseInt(v, 10) || p.height, 60, 84); }
        else p.height = clampInt(p.height + d, 60, 84);
      }),
      num('Weight', 'weight', 150, 400, 5, (w) => `${w} lbs`),
      text('College', 'college', 32),
    ];
    body = el('div.pcd-list', {}, el('div.pcd-h', { text: 'Fill out the info' }), items);
  } else if (tab === 1) {
    items = RATINGS.map(([key, code]) => {
      const t = el('div.pcd-attr');
      const draw = () => {
        const v = p.ratings[key];
        t.innerHTML = '';
        t.append(el('b', { text: String(v) }), el('span', { text: RATING_NAMES[key] }), el('i', { style: { '--w': `${v}%` } }), el('small', { text: code }));
      };
      t.spin = (d) => { p.ratings[key] = clampInt(p.ratings[key] + d, 0, 99); draw(); changed(); };
      t.activate = () => {
        const v = window.prompt(`${RATING_NAMES[key]}:`, String(p.ratings[key]));
        if (v === null) return;
        p.ratings[key] = clampInt(parseInt(v, 10) || p.ratings[key], 0, 99); draw(); changed();
      };
      draw();
      return t;
    });
    body = el('div.pcd-attrs-wrap', {}, el('div.pcd-h', { text: 'Core attributes' }), el('div.pcd-attrs', {}, items));
  } else {
    items = [
      // Face photo: a file in public/local/faces/ or a web link (typed), or an uploaded picture.
      row('Face Photo', () => (!p.face ? 'None' : /^data:/i.test(p.face) ? 'Uploaded' : p.face.length > 22 ? `${p.face.slice(0, 20)}…` : p.face), (d, v) => {
        if (v !== undefined) { if (v.trim()) p.face = v.trim(); else delete p.face; }
        else if (d) delete p.face;
        // A new photo gives a new skin tone (unless the tone was picked by hand).
        if (!p.skinManual) { delete p.skinColor; deriveSkin(p, () => { ctx.onChange(); again(); }); }
        setTimeout(again, 0);
      }),
      action('Upload a face photo…', async () => {
        const f = await pickFile('image/*', true);
        if (!f) return;
        const img = await loadImage(f.data);
        if (!img) { window.alert("That file couldn't be read as an image."); return; }
        p.face = shrinkFace(img);
        // Skin tone from the photo, for the 3D player (the Skin Tone row follows it; spinning it overrides).
        const tone = skinToneFromImage(img);
        if (tone && !p.skinManual) { p.skinColor = tone; p.skin = nearestSkin(tone); }
        ctx.onChange();
        again();
      }),
      row('Skin Tone', () => (p.skinColor && !p.skinManual ? 'From photo' : `${(p.skin ?? 2) + 1} of 6`), (d) => {
        // Picking a tone by hand wins over the photo's (and stays that way); from the photo again: clear the photo and re-add it.
        if (!d) return;
        p.skin = ((p.skin ?? 2) + d + 6) % 6; p.skinManual = true; delete p.skinColor;
      }),
      ...[['Visor', 'visor', ['auto', 'none', 'dark', 'gold', 'clear']], ['Towel', 'towel', ['auto', 'yes', 'no']], ['Arm Sleeves', 'sleeves', ['none', 'white', 'black', 'team']]]
        .map(([label, key, opts]) => row(label, () => (p.look?.[key] || opts[0]).replace(/^./, (c) => c.toUpperCase()), (d) => { const cur = p.look?.[key] || opts[0]; (p.look ||= {})[key] = opts[(opts.indexOf(cur) + d + opts.length) % opts.length]; })),
    ];
    body = el('div.pcd-list', {}, el('div.pcd-h', { text: 'Look' }), items);
  }
  screens.frame('mono-screen pcd-screen', hero,
    el('div.pcd-tabs', {}, el('b.btn.LB', { text: 'LB' }), CARD_TABS.map((t, i) => el(`div.pcd-tab${i === tab ? '.on' : ''}`, { text: t })), el('b.btn.RB', { text: 'RB' })),
    body,
    el('div.mm2-bar', { html: '<span>◀▶ CHANGE</span><span><b class="btn A">A</b> TYPE A VALUE</span><span><b class="btn LB">LB</b><b class="btn RB">RB</b> TABS</span><span><b class="btn B">B</b> BACK</span>' }));
  refresh();
  screens.nav.set(items, { columns: 1, index: Math.min(focus, items.length - 1), onBack: back,
    onTab: (d) => playerCard(ctx, ti, id, 0, (tab + d + CARD_TABS.length) % CARD_TABS.length) });
}
