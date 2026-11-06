// Team pick (UPDATE 3.1 slide 6): a grid of logos on the left, the focused team on the right — banner in its
// colors with OVR / OFF / DEF, its five best players, where it ranks in the league and a few franchise facts.
import { el } from './nav.js';
import { alphaOrder } from './screens.js';
import { logoCanvas } from '../render/logo.js';
import { teamRatings } from '../data/positions.js';
import { CONFERENCES, DIVISIONS } from '../data/teams.js';
import { faceImg } from './faces.js';

const CATS = [
  ['Passing', { QB: [['throwAccuracy', 2], ['throwPower', 1], ['awareness', 1]], WR: [['routeRunning', 1], ['catching', 1], ['speed', 1]], TE: [['catching', 1]] }],
  ['Rushing', { HB: [['speed', 1], ['breakTackle', 1], ['carrying', 1], ['agility', 1]], T: [['runBlock', 1]], G: [['runBlock', 1]], C: [['runBlock', 1]] }],
  ['Blocking', { T: [['passBlock', 1], ['runBlock', 1]], G: [['passBlock', 1], ['runBlock', 1]], C: [['passBlock', 1], ['runBlock', 1]] }],
  ['Pass Rush', { DE: [['passRush', 2], ['speed', 1]], DT: [['passRush', 1], ['strength', 1]], OLB: [['passRush', 1]] }],
  ['Coverage', { CB: [['coverage', 2], ['speed', 1]], FS: [['coverage', 1], ['awareness', 1]], SS: [['coverage', 1], ['tackling', 1]], OLB: [['coverage', 1]], MLB: [['coverage', 1]] }],
  ['Team Speed', { HB: [['speed', 1]], WR: [['speed', 1]], TE: [['speed', 1]], CB: [['speed', 1]], FS: [['speed', 1]], SS: [['speed', 1]], OLB: [['speed', 1]], MLB: [['speed', 1]] }],
];
// Starters by position (enough to score each group).
const STARTERS = { QB: 1, HB: 1, WR: 3, TE: 1, T: 2, G: 2, C: 1, DE: 2, DT: 2, OLB: 2, MLB: 1, CB: 3, FS: 1, SS: 1 };

function groupScore(t, spec) {
  let sum = 0, w = 0;
  for (const [pos, keys] of Object.entries(spec)) {
    const top = t.roster.filter((p) => p.pos === pos).sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0)).slice(0, STARTERS[pos] || 1);
    for (const p of top) for (const [k, kw] of keys) { sum += (p.ratings?.[k] ?? 50) * kw; w += kw; }
  }
  return w ? sum / w : 50;
}

/** League ranks per category for every team: ranks[teamIndex][cat] = 1..N (cached per call of the screen). */
export function leagueRanks(teams) {
  const out = teams.map(() => ({}));
  for (const [name, spec] of CATS) {
    const sc = teams.map((t, i) => [i, groupScore(t, spec)]).sort((a, b) => b[1] - a[1]);
    sc.forEach(([i], r) => { out[i][name] = r + 1; });
  }
  const ovr = teams.map((t, i) => [i, teamRatings(t).ovr]).sort((a, b) => b[1] - a[1]);
  ovr.forEach(([i], r) => { out[i].ovr = r + 1; });
  return out;
}

const ord = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 >> 3 === 1 ? 0 : n % 10] || 'th'}`;
const statusOf = (r, n) => (r <= Math.ceil(n * 0.19) ? 'Title Contender' : r <= Math.ceil(n * 0.44) ? 'Playoff Hopeful' : r <= Math.ceil(n * 0.75) ? 'Middle of the Pack' : 'Rebuilding');

/** The five best players, at most one lineman per side so the QB / playmakers show. */
function topFive(t) {
  const seen = new Map();
  return [...t.roster].filter((p) => !['K', 'P'].includes(p.pos)).sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0))
    .filter((p) => { const g = ['T', 'G', 'C'].includes(p.pos) ? 'OL' : ['DE', 'DT'].includes(p.pos) ? 'DL' : p.pos; const n = seen.get(g) || 0; if (n >= 2) return false; seen.set(g, n + 1); return true; })
    .slice(0, 5);
}

function panel(t, ti, teams, ranks, extra) {
  const r = teamRatings(t), rk = ranks[ti];
  const c = t.colors;
  const badge = (v, l) => el('div.tp-badge', {}, el('b', { text: String(v) }), el('small', { text: l }));
  const players = topFive(t).map((p) => {
    const face = faceImg(p, 'tp-face');
    if (face) face.onerror = () => face.replaceWith(el('span.tp-num', { text: String(p.number) }));
    return el('div.tp-pl', {}, el('div.tp-pic', {}, face || el('span.tp-num', { text: String(p.number) })),
      el('div.tp-pos', { text: `${p.pos} | ${p.ovr} OVR` }), el('div.tp-nm', { text: `${p.first[0]}. ${p.last}`.toUpperCase() }));
  });
  const n = teams.length;
  const tone = (v) => (v <= Math.round(n / 4) ? 'good' : v > n - Math.round(n / 4) ? 'bad' : '');
  const rankRows = CATS.map(([name]) => el('div.tp-row', {}, el('span', { text: name }), el(`b.${tone(rk[name]) || 'mid'}`, { text: ord(rk[name]) })));
  const tiers = [['90+', (o) => o >= 90], ['85-89', (o) => o >= 85 && o < 90], ['80-84', (o) => o >= 80 && o < 85], ['70-79', (o) => o >= 70 && o < 80], ['<70', (o) => o < 70]]
    .map(([l, f]) => el('div.tp-tier', {}, el('small', { text: l }), el('b', { text: String(t.roster.filter((p) => f(p.ovr ?? 0)).length) })));
  const info = [['Division', `${CONFERENCES[t.conference] || ''} ${DIVISIONS[t.division] || ''}`.trim()], ['Status', statusOf(rk.ovr, n)], ['Roster', `${t.roster.length} players`], ...(extra || [])];
  return el('div.tp-panel', { style: { '--tc': c.primary, '--tc2': c.secondary } },
    el('div.tp-banner', {}, el('div.tp-logo', {}, logoCanvas(t.logo, 120)), el('div.tp-names', {}, el('small', { text: t.city.toUpperCase() }), el('b', { text: t.name.toUpperCase() })),
      el('div.tp-badges', {}, badge(r.ovr, 'OVR'), badge(r.off, 'OFF'), badge(r.def, 'DEF'))),
    el('div.tp-players', {}, players),
    el('div.tp-cols', {},
      el('div.tp-col', {}, el('h4', { text: 'League Ranking' }), rankRows),
      el('div.tp-col', {}, el('h4', { text: 'Franchise Info' }), info.map(([k, v]) => el('div.tp-row', {}, el('span', { text: k }), el('b', { text: v }))),
        el('div.tp-tiers', {}, tiers))));
}

/**
 * screens.frame + nav: pick a team. opts = { title, focus (team index), onPick(ti), onBack, info(ti) → extra [label, value] rows }.
 */
export function teamPickScreen(screens, teams, { title = 'Pick Your Team', focus = 0, onPick, onBack, info = null }) {
  const ranks = leagueRanks(teams);
  const order = alphaOrder(teams);
  const right = el('div.tp-right');
  const cells = order.map((ti) => {
    const c = el('div.tp-cell', {}, logoCanvas(teams[ti].logo, 64));
    c.ti = ti;
    c.onfocusitem = () => { right.innerHTML = ''; right.append(panel(teams[ti], ti, teams, ranks, info?.(ti))); };
    c.activate = () => onPick(ti);
    return c;
  });
  screens.frame('tp-screen', el('div.tp-head', {}, el('h1', { text: title })),
    el('div.tp-body', {}, el('div.tp-grid', {}, cells), right),
    el('div.tp-help', { html: '<b class="btn A">A</b> Select &nbsp; <b class="btn B">B</b> Back' }));
  screens.nav.set(cells, { columns: 4, onBack, index: Math.max(0, order.indexOf(focus)) });
}
