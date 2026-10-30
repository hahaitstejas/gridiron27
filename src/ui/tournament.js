// Tournament screens: setup, the bracket (logos, scores, your path) and the champion. State lives in localStorage
// `g27.tournament` (franchise/tournament.js is the logic).
import { el } from './nav.js';
import { ICONS } from './screens.js';
import { logoCanvas } from '../render/logo.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { createTournament, TOURNAMENT_SIZES, roundName, userGame, winnerOf, eliminated, simTournamentGame, advanceTournament, currentRound, seedOf, recordResult } from '../franchise/tournament.js';

const KEY = 'g27.tournament';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const store = (t) => { try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch { /* no storage */ } };

/** ctx = { teams, prefs, screens, playGame(t, g), onExit } */
export class TournamentUI {
  constructor(ctx) { this.ctx = ctx; this.t = null; }

  open() {
    this.t = load();
    if (this.t && this.t.seeds.some((i) => !this.ctx.teams[i])) this.t = null; // a different league
    if (this.t) this.bracket(); else this.setup();
  }

  setup() {
    const { screens, prefs, teams } = this.ctx;
    const o = { userTeam: prefs.home, size: 8, difficulty: prefs.difficulty, quarterMinutes: prefs.quarterMinutes };
    const option = (label, values, key, fmt) => {
      const row = el('div.opt-row');
      const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ ${fmt(o[key])} ▶` })); };
      row.spin = (d) => { const i = Math.max(0, values.indexOf(o[key])); o[key] = values[(i + d + values.length) % values.length]; draw(); };
      row.activate = () => row.spin(1);
      draw();
      return row;
    };
    const rows = [
      option('Your team', teams.map((_, i) => i), 'userTeam', (i) => `${teams[i].city} ${teams[i].name}`),
      option('Bracket', TOURNAMENT_SIZES, 'size', (n) => `${n} teams`),
      option('Difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label),
      option('Quarter length', [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15], 'quarterMinutes', (v) => `${v} min`),
    ];
    const start = el('div.start-btn', { text: 'Start Tournament' });
    start.activate = () => {
      this.t = createTournament(teams, { ...o, seed: (Date.now() % 100000) + 1 });
      store(this.t);
      this.bracket();
    };
    screens.frame('setup-screen', el('h1', { text: 'Tournament' }),
      el('div.league-status', { text: 'Single elimination at neutral sites: your team and the best of the rest, seeded by team rating. Win every game.' }),
      el('div.setup-opts', {}, ...rows, start),
      el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set([...rows, start], { columns: 1, onBack: this.ctx.onExit, index: rows.length });
  }

  /** Back from a played game. */
  recordPlayed(g, match) {
    this.t = load();
    const live = this.t && currentRound(this.t).find((x) => x.home === g.home && x.away === g.away && !x.score);
    if (live) recordResult(this.t, live, [...match.score]);
    store(this.t);
    this.bracket();
  }

  bracket() {
    const { screens, teams } = this.ctx;
    const t = this.t, me = teams[t.userTeam];
    const g = t.champion === null ? userGame(t) : null;
    const out = eliminated(t);
    const roundDone = !currentRound(t).some((x) => !x.score);
    const tile = (cls, icon, label, sub, action, ...extra) => {
      const x = el(`div.hub-tile${cls ? '.' + cls : ''}`, {}, el('div.ht-icon', { html: ICONS[icon] }), el('div.ht-text', {}, el('div.ht-label', { text: label }), el('div.ht-sub', { text: sub })), ...extra);
      x.activate = action;
      return x;
    };
    const save = () => { store(t); this.bracket(); };
    const tiles = [];
    if (t.champion !== null) {
      const c = teams[t.champion];
      tiles.push(tile('feature', 'trophy', t.champion === t.userTeam ? 'Champions!' : `${c.name} win it`, t.champion === t.userTeam ? `${me.city} ${me.name} win the tournament` : `${c.city} ${c.name} are champions`, () => this.setup()));
    } else if (g && !g.score) {
      const opp = teams[g.home === t.userTeam ? g.away : g.home];
      tiles.push(tile('feature', 'play', 'Play Game', `${roundName(t)} vs (${seedOf(t, teams.indexOf(opp))}) ${opp.city} ${opp.name}`, () => this.ctx.playGame(t, g)));
      tiles.push(tile('', 'fast', 'Sim Game', 'Quick result', () => { simTournamentGame(t, teams, g, 99); save(); }));
    } else {
      tiles.push(tile('feature', 'fast', roundDone ? 'Next Round' : 'Finish the Round', out ? 'You\'re out: watch the rest of the bracket' : `${roundName(t)}: quick-sim the other games`, () => { advanceTournament(t, teams); save(); }));
    }
    tiles.push(tile('', 'calendar', 'New Tournament', 'Start over', () => { store(null); this.setup(); }));
    tiles.push(tile('', 'exit', 'Main Menu', 'The bracket is saved', this.ctx.onExit));

    // The bracket: one column per round (later rounds filled as they're set).
    const nRounds = Math.log2(t.size);
    const cols = [];
    for (let r = 0; r < nRounds; r++) {
      const games = t.rounds[r] || Array.from({ length: t.size >> (r + 1) }, () => null);
      cols.push(el('div.tb-col', {}, el('div.tb-head', { text: roundNameFor(t.size, r) }), el('div.tb-games', {}, ...games.map((gm) => matchCard(t, teams, gm)))));
    }
    if (t.champion !== null) cols.push(el('div.tb-col.tb-champ', {}, el('div.tb-head', { text: 'Champion' }), el('div.tb-games', {}, el('div.tb-card', { style: { '--tc': teams[t.champion].colors.primary } }, teamRow(t, teams, t.champion, null, true)))));
    screens.frame('hub-screen tourney-screen', el('div.hub-top', {}, el('div.hub-logo', { html: `TOURNAMENT <span>${t.size}</span>` }),
      el('div.hub-me', { style: { '--tc': me.colors.primary } }, logoCanvas(me.logo, 40), el('div', {}, el('small', { text: out ? 'ELIMINATED' : t.champion === t.userTeam ? 'CHAMPIONS' : `SEED ${seedOf(t, t.userTeam)}` }), el('b', { text: `${me.city} ${me.name}` })))),
      el('div.tb-bracket', {}, cols), el('div.tb-tiles', {}, tiles),
      el('div.hub-foot', { html: '<b class="btn A">A</b> Select &nbsp;&nbsp; <b class="btn B">B</b> Main menu' }));
    screens.root.style.setProperty('--accent', me.colors.primary);
    screens.nav.set(tiles, { spatial: true, onBack: this.ctx.onExit });
  }
}

function roundNameFor(size, r) { return roundName({ size }, r); }

function teamRow(t, teams, i, score, win) {
  if (i === null || i === undefined) return el('div.tb-team.tbd', { text: 'TBD' });
  const tm = teams[i];
  return el(`div.tb-team${win ? '.win' : ''}${i === t.userTeam ? '.me' : ''}`, { style: { '--tc': tm.colors.primary } },
    el('span.tb-seed', { text: String(seedOf(t, i)) }), logoCanvas(tm.logo, 28), el('b', { text: tm.abbr }), el('span.tb-score', { text: score ?? '' }));
}

function matchCard(t, teams, g) {
  if (!g) return el('div.tb-card', {}, teamRow(t, teams, null), teamRow(t, teams, null));
  const w = winnerOf(g);
  return el(`div.tb-card${g.home === t.userTeam || g.away === t.userTeam ? '.mine' : ''}`, {},
    teamRow(t, teams, g.home, g.score?.[0], w === g.home), teamRow(t, teams, g.away, g.score?.[1], w === g.away));
}
