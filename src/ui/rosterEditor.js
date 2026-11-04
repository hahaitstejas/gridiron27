import { traitsOf, TRAITS } from '../data/traits.js';
import { numberAllowed } from '../data/positions.js';
import { el } from './nav.js';
import { faceImg, shrinkFace } from './faces.js';
import { pickFile, loadImage } from '../data/storage.js';
import { RATINGS, POSITIONS, overall } from '../data/positions.js';
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

/**
 * League → Rosters. ctx = { screens, teams, onBack, onChange, pickTeam(title, onPick, onBack) }.
 * LB/RB switch team, A opens a player, X adds one.
 */
export function rosterScreen(ctx, ti, focus = 0) {
  const { screens, teams } = ctx;
  const t = teams[ti];
  screens.extraButtons = null;
  const players = [...t.roster].sort((a, b) => posOrder(a) - posOrder(b) || b.ovr - a.ovr);
  const rows = players.map((p) => {
    const row = el('div.dc-row', {},
      el('span.dc-pos', { text: p.pos }), el('span.dc-rank', { text: String(p.number) }),
      el('span.dc-name', { text: `${p.first} ${p.last}` + (p.injury ? ` · INJ ${p.injury.weeks >= 8 ? 'season' : p.injury.weeks + ' wk'}` : '') }), el('span.dc-pos', { text: `${p.age}` }), el('span.dc-ovr', { text: String(p.ovr) }));
    row.activate = () => playerCard(ctx, ti, p.id);
    return row;
  });
  const avg = Math.round(t.roster.reduce((a, p) => a + p.ovr, 0) / Math.max(1, t.roster.length));
  screens.frame('depth-screen',
    el('h1', { text: `${t.city} ${t.name}` }),
    el('div.league-status', { text: `${t.roster.length} players · average OVR ${avg}${t.roster.length < 45 ? ' · short-handed: add players' : ''}` }),
    el('div.dc-list', {}, el('div.dc-row.st-head', {}, el('span.dc-pos', { text: 'POS' }), el('span.dc-rank', { text: '#' }), el('span.dc-name', { text: 'Player' }), el('span.dc-pos', { text: 'AGE' }), el('span.dc-ovr', { text: 'OVR' })), rows),
    el('div.setup-help', { html: '<b class="btn A">A</b> edit player &nbsp; <b class="btn X">X</b> add player &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> team &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows, { columns: 1, index: Math.min(focus, rows.length - 1), onBack: ctx.onBack, onTab: (d) => rosterScreen(ctx, (ti + d + teams.length) % teams.length) });
  screens.extraButtons = (f) => { if (f.pressed.X) newPlayer(ctx, ti); };
}

function newPlayer(ctx, ti) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const items = POSITIONS.map((pos) => {
    const it = el('div.dc-slot', {}, el('div.dc-slot-name', { text: pos }));
    it.activate = () => {
      const p = generatePlayer(pos, new RNG((Date.now() % 1e9) + pos.length), 0);
      addPlayer(ctx.teams[ti], p);
      ctx.onChange();
      playerCard(ctx, ti, p.id);
    };
    return it;
  });
  screens.frame('depth-screen', el('h1', { text: 'New player: position' }), el('div.dc-grid', {}, items),
    el('div.setup-help', { html: '<b class="btn A">A</b> create &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { columns: 6, onBack: () => rosterScreen(ctx, ti) });
}

/** Edit one player. Left/right changes a value (hold to repeat), A types it. */
export function playerCard(ctx, ti, id, focus = 0) {
  const { screens, teams } = ctx;
  screens.extraButtons = null;
  const team = teams[ti];
  const p = team.roster.find((q) => q.id === id);
  if (!p) { rosterScreen(ctx, ti); return; }
  const ovrEl = el('span.pc-ovr', { text: String(p.ovr) });
  const titleEl = el('h1');
  const subEl = el('span');
  const traitEl = el('span.pc-traits');
  const refresh = () => {
    p.ovr = overall(p);
    ovrEl.textContent = String(p.ovr);
    titleEl.textContent = `#${p.number} ${p.first} ${p.last}`;
    subEl.textContent = `${team.abbr} · ${p.pos} · OVR `;
    traitEl.innerHTML = traitsOf(p).map((t) => `<i title="${TRAITS[t].desc}">★ ${TRAITS[t].name}</i>`).join('');
  };
  const changed = () => { refresh(); ctx.onChange(); };
  const action = (label, fn) => { const r = el('div.opt-row.action', {}, el('span.opt-label', { text: label })); r.activate = fn; return r; };

  const row = (label, get, spin, type) => {
    const val = el('span.opt-val');
    const r = el('div.opt-row', {}, el('span.opt-label', { text: label }), val);
    const draw = () => { val.innerHTML = `◀ ${get()} ▶`; };
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

  const rows = [
    text('First name', 'first'),
    text('Last name', 'last'),
    row('Number', () => String(p.number), (d, v) => {
      // Taken, retired and position-illegal numbers (QB 0-19, OL 50-79, ...) are skipped.
      const used = new Set([...team.roster.filter((q) => q !== p).map((q) => q.number), ...(team.retired || []).map((r) => (typeof r === 'object' ? +r.number : +r))]);
      const bad = (x) => used.has(x) || !numberAllowed(p.pos, x);
      let n = v !== undefined ? clampInt(parseInt(v, 10) || p.number, 0, 99) : p.number;
      if (v === undefined) { let k = 0; do { n = (n + d + 100) % 100; } while (bad(n) && ++k < 100); }
      if (!bad(n)) p.number = n;
      else if (v !== undefined) window.alert(`#${n} isn't available for a ${p.pos} (taken, retired, or outside the position's numbers).`);
    }, 'num'),
    row('Position', () => p.pos, (d, v) => {
      let pos = v !== undefined ? v.trim().toUpperCase() : POSITIONS[(POSITIONS.indexOf(p.pos) + d + POSITIONS.length) % POSITIONS.length];
      if (POSITIONS.includes(pos)) changePosition(team, p, pos);
    }),
    num('Age', 'age', 20, 45),
    row('Height', () => feet(p.height), (d, v) => {
      if (v !== undefined) { const m = v.match(/(\d+)\D+(\d+)/); p.height = clampInt(m ? +m[1] * 12 + +m[2] : parseInt(v, 10) || p.height, 60, 84); }
      else p.height = clampInt(p.height + d, 60, 84);
    }),
    num('Weight (lbs)', 'weight', 150, 400, 5),
    text('College', 'college', 32),
    // Face photo: a file in public/local/faces/ or a web link (typed), or an uploaded picture (A on the next row).
    row('Face photo', () => (!p.face ? 'none' : /^data:/i.test(p.face) ? 'uploaded' : p.face.length > 22 ? `${p.face.slice(0, 20)}…` : p.face), (d, v) => {
      if (v !== undefined) { if (v.trim()) p.face = v.trim(); else delete p.face; }
      else if (d) delete p.face;
      setTimeout(() => playerCard(ctx, ti, id, screens.nav.index), 0);
    }),
    action('Upload a face photo…', async () => {
      const f = await pickFile('image/*', true);
      if (!f) return;
      const img = await loadImage(f.data);
      if (!img) { window.alert("That file couldn't be read as an image."); return; }
      p.face = shrinkFace(img);
      ctx.onChange();
      playerCard(ctx, ti, id, screens.nav.index);
    }),
    // Appearance (the 3D player): skin tone, visor, towel, arm sleeves.
    row('Skin tone', () => `${(p.skin ?? 2) + 1} of 6`, (d) => { p.skin = ((p.skin ?? 2) + d + 6) % 6; }),
    ...[['Visor', 'visor', ['auto', 'none', 'dark', 'gold', 'clear']], ['Towel', 'towel', ['auto', 'yes', 'no']], ['Arm sleeves', 'sleeves', ['none', 'white', 'black', 'team']]]
      .map(([label, key, opts]) => row(label, () => (p.look?.[key] || opts[0]).replace(/^./, (c) => c.toUpperCase()), (d) => { const cur = p.look?.[key] || opts[0]; (p.look ||= {})[key] = opts[(opts.indexOf(cur) + d + opts.length) % opts.length]; })),
    ...RATINGS.map(([key]) => row(RATING_NAMES[key], () => String(p.ratings[key]), (d, v) => {
      p.ratings[key] = clampInt(v !== undefined ? parseInt(v, 10) || p.ratings[key] : p.ratings[key] + d, 0, 99);
    }, 'num')),
  ];
  const trade = el('div.opt-row.action', {}, el('span.opt-label', { text: 'Trade to another team…' }));
  // In a franchise a trade goes through the trade screen (something has to come back); in the league editor it's a move.
  if (ctx.onTrade) trade.activate = () => ctx.onTrade(p, ti);
  else trade.activate = () => ctx.pickTeam(`Trade ${p.first} ${p.last} to…`, (to) => {
    if (to === ti) return playerCard(ctx, ti, id);
    tradePlayer(team, teams[to], id);
    ctx.onChange();
    rosterScreen(ctx, ti);
  }, () => playerCard(ctx, ti, id));
  const release = el('div.opt-row.action', {}, el('span.opt-label', { text: 'Release player' }));
  release.activate = () => {
    if (!window.confirm(`Release ${p.first} ${p.last}?`)) return;
    releasePlayer(team, id);
    ctx.onRelease?.(p); // franchise: he becomes a free agent
    ctx.onChange();
    rosterScreen(ctx, ti);
  };
  const done = el('div.start-btn', { text: 'Done' });
  done.activate = () => rosterScreen(ctx, ti);
  const all = [...rows, trade, release, done];
  const face = faceImg(p, 'pc-face');
  screens.frame('depth-screen',
    face ? el('div.pc-head', {}, face, titleEl) : titleEl,
    el('div.league-status', {}, subEl, ovrEl, traitEl),
    el('div.setup-opts.card-opts', {}, all),
    el('div.setup-help', { html: '◀▶ change (hold to repeat) &nbsp; <b class="btn A">A</b> type a value &nbsp; <b class="btn B">B</b> back' }));
  refresh();
  screens.nav.set(all, { columns: 1, index: focus, onBack: () => rosterScreen(ctx, ti) });
}
