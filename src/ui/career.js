// Career mode screens: create your player (New Career) and the My Player card in the franchise hub
// (ratings, skill points to spend, game log). Logic lives in franchise/career.js.
import { el } from './nav.js';
import { RNG } from '../core/rng.js';
import { RATINGS } from '../data/positions.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { createFranchise } from '../franchise/franchise.js';
import { SEASON_LENGTHS } from '../franchise/season.js';
import { CAREER_POSITIONS, createCareerPlayer, startCareer, careerPlayer, careerKeys, upgradeCost, trainRating, lineText, XP_PER_POINT } from '../franchise/career.js';

const POS_NAMES = { QB: 'Quarterback (calls the offense)', HB: 'Running back', WR: 'Wide receiver', TE: 'Tight end', DE: 'Defensive end', OLB: 'Outside linebacker',
  MLB: 'Middle linebacker (calls the defense)', CB: 'Cornerback', SS: 'Strong safety' };
const label = (k) => RATINGS.find((r) => r[0] === k)?.[1] || k;

/** New Career: your player (name, position, number) and the franchise around him. */
export function newCareer(ui) {
  const { screens, prefs } = ui.ctx;
  const o = { first: 'Jordan', last: 'Reyes', pos: 'WR', number: 18, team: prefs.home, weeks: 17, difficulty: prefs.difficulty, quarterMinutes: prefs.quarterMinutes };
  const rows = [];
  const option = (lab, values, key, fmt) => {
    const row = el('div.opt-row');
    const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: lab }), el('span.opt-val', { html: `◀ ${fmt(o[key])} ▶` })); };
    row.spin = (d) => { const i = Math.max(0, values.indexOf(o[key])); o[key] = values[(i + d + values.length) % values.length]; draw(); };
    row.activate = () => row.spin(1);
    draw();
    rows.push(row);
    return row;
  };
  const text = (lab, key) => {
    const row = el('div.opt-row');
    const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: lab }), el('span.opt-val', { text: o[key] })); };
    row.activate = () => { const v = window.prompt(lab, o[key]); if (v && v.trim()) { o[key] = v.trim().slice(0, 18); draw(); } };
    draw();
    rows.push(row);
    return row;
  };
  text('First name', 'first');
  text('Last name', 'last');
  option('Position', CAREER_POSITIONS, 'pos', (p) => POS_NAMES[p]);
  option('Number', Array.from({ length: 99 }, (_, i) => i + 1), 'number', (n) => `#${n}`);
  option('Team', ui.teams.map((_, i) => i), 'team', (i) => `${ui.teams[i].city} ${ui.teams[i].name}`);
  option('Season length', SEASON_LENGTHS, 'weeks', (w) => `${w} games`);
  option('Difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label);
  option('Quarter length', [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15], 'quarterMinutes', (v) => `${v} min`);
  const start = el('div.start-btn', { text: 'Start Career' });
  start.activate = async () => {
    const L = ui.ctx.league;
    const seed = (Date.now() % 100000) + 1;
    const p = createCareerPlayer(ui.teams[o.team], o, new RNG(seed));
    L.franchise = createFranchise(ui.teams, { userTeam: o.team, weeks: o.weeks, difficulty: o.difficulty, quarterMinutes: o.quarterMinutes, seed, name: `${o.first} ${o.last} career` });
    startCareer(L.franchise, p);
    L.name = L.franchise.name;
    L.slot = null;
    await L.saveNow();
    careerScreen(ui);
  };
  screens.frame('setup-screen', el('h1', { text: 'New Career' }),
    el('div.league-status', { text: 'Create a rookie and play only as him: games lock the controls to your player; the snaps he sits out play themselves. Earn XP every game and spend it on his ratings.' }),
    el('div.setup-opts', {}, ...rows, start),
    el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set([...rows, start], { columns: 1, onBack: () => ui.open(), index: rows.length });
}

/** My Player: the card, skill points (A on a rating trains it) and the game log. */
export function careerScreen(ui, focus = 0) {
  const { screens } = ui.ctx;
  const f = ui.f, c = f.career, p = careerPlayer(f, ui.teams);
  if (!c || !p) { ui.hub(); return; }
  const team = ui.teams.find((t) => t.roster.includes(p));
  const rows = careerKeys(p.pos).map((k) => {
    const v = p.ratings[k] ?? 40, cost = upgradeCost(v);
    const row = el(`div.cr-row${c.points >= cost && v < 99 ? '' : '.dim'}`, {},
      el('span.cr-k', { text: label(k) }), el('span.cr-bar', {}, el('i', { style: { width: `${v}%` } })), el('b', { text: String(v) }), el('small', { text: v >= 99 ? 'MAX' : `+1 · ${cost} pt${cost > 1 ? 's' : ''}` }));
    row.activate = () => { if (trainRating(f, p, k)) { ui.save(); careerScreen(ui, rows.indexOf(row)); } };
    return row;
  });
  const back = el('div.start-btn', { text: 'Back to the Hub' });
  back.activate = () => ui.hub();
  const log = c.games.slice(0, 8).map((g) => el('div.cr-game', {}, el('b', { text: `${g.year}${g.week ? ` · Wk ${g.week}` : ' · Playoffs'} vs ${ui.teams[g.opp]?.abbr || '?'}` }),
    el('span', { text: lineText(g.line) }), el('em', { text: `+${g.xp} XP` })));
  screens.frame('setup-screen career-screen',
    el('div.cr-head', { style: { '--tc': team?.colors.primary || '#333' } },
      el('div.cr-num', { text: `#${p.number}` }),
      el('div', {}, el('div.cr-name', { text: `${p.first} ${p.last}` }), el('div.cr-sub', { text: `${p.pos} · ${team ? `${team.city} ${team.name}` : 'Free agent'} · age ${p.age} · year ${f.year - (p.rookieYear || f.year) + 1}` })),
      el('div.cr-ovr', {}, el('small', { text: 'OVR' }), el('b', { text: String(p.ovr) })),
      el('div.cr-pts', {}, el('small', { text: 'SKILL POINTS' }), el('b', { text: String(c.points) }), el('div.cr-xp', {}, el('i', { style: { width: `${(100 * c.xp) / XP_PER_POINT}%` } })))),
    el('div.cr-body', {}, el('div.cr-ratings', {}, rows), el('div.cr-log', {}, el('h3', { text: 'Game log' }), ...(log.length ? log : [el('div.cr-game', { text: 'No games yet: play (or sim) your first game from the hub.' })]))),
    back,
    el('div.setup-help', { html: `<b class="btn A">A</b> train the rating (+1) &nbsp; <b class="btn B">B</b> back &nbsp; · XP comes from every game, played or simmed (${XP_PER_POINT} XP = 1 point)` }));
  screens.nav.set([...rows, back], { columns: 1, onBack: () => ui.hub(), index: Math.min(focus, rows.length) });
}
