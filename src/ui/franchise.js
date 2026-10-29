import { el } from './nav.js';
import { logoCanvas } from '../render/logo.js';
import { CONFERENCES, DIVISIONS } from '../data/teams.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { createFranchise, currentGames, userGame, simGame, simOthers, advance, recordGame, matchToResult, recordOf } from '../franchise/franchise.js';
import { standings, rank, leaders, SEASON_LENGTHS, PLAYOFF_ROUND_NAMES } from '../franchise/season.js';

const recText = (r) => `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`;

/**
 * Franchise mode screens. ctx = { teams, prefs, screens, league, playGame(g), rosterScreen(ti), depthScreen(ti),
 * pickTeam(title, onPick, onBack), onExit, offseason (hub for the offseason steps) }.
 */
export class FranchiseUI {
  constructor(ctx) { this.ctx = ctx; }
  get f() { return this.ctx.league.franchise; }
  get teams() { return this.ctx.teams; }
  save() { this.ctx.league.changed(); }

  open() { if (this.f) this.hub(); else this.newFranchise(); }

  // ---------- new franchise ----------
  newFranchise() {
    const { screens, prefs } = this.ctx;
    const opts = { userTeam: prefs.home, weeks: 17, difficulty: prefs.difficulty, quarterMinutes: prefs.quarterMinutes };
    const option = (label, values, key, fmt) => {
      const row = el('div.opt-row');
      const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ ${fmt(opts[key])} ▶` })); };
      row.spin = (d) => { const i = Math.max(0, values.indexOf(opts[key])); opts[key] = values[(i + d + values.length) % values.length]; draw(); };
      row.activate = () => row.spin(1);
      draw();
      return row;
    };
    const teamIdx = this.teams.map((_, i) => i);
    const rows = [
      option('Your team', teamIdx, 'userTeam', (i) => `${this.teams[i].city} ${this.teams[i].name}`),
      option('Season length', SEASON_LENGTHS, 'weeks', (w) => `${w} games`),
      option('Difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label),
      option('Quarter length (games you play)', [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15], 'quarterMinutes', (v) => `${v} min`),
    ];
    const start = el('div.start-btn', { text: 'Start Franchise' });
    start.activate = async () => {
      const L = this.ctx.league;
      // A franchise gets its own save slot (a copy of the current league), so the league itself stays as is.
      L.franchise = createFranchise(this.teams, { ...opts, seed: (Date.now() % 100000) + 1 });
      L.name = L.franchise.name;
      L.slot = null;
      await L.saveNow();
      this.hub();
    };
    screens.frame('setup-screen', el('h1', { text: 'New Franchise' }),
      el('div.league-status', { text: 'Starts from your current league (rosters, teams, logos) in a new save slot.' }),
      el('div.setup-opts', {}, ...rows, start),
      el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set([...rows, start], { columns: 1, onBack: this.ctx.onExit, index: rows.length });
  }

  // ---------- hub ----------
  hub(focus = 0) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams, me = teams[f.userTeam];
    screens.extraButtons = null;
    if (f.phase === 'offseason') { this.ctx.offseason(this); return; }
    const g = userGame(f);
    const rec = recordOf(f, teams, f.userTeam);
    const stage = f.phase === 'regular' ? `Week ${f.week + 1} of ${f.weeks}` : PLAYOFF_ROUND_NAMES[f.playoffs.rounds.length - 1];
    const items = [];
    const add = (label, sub, fn) => { const it = screens.menuItem(label, sub, fn); items.push(it); return it; };
    let next = 'Your season is over: watch the rest of the playoffs.';
    if (g && !g.score) {
      const home = g.home === f.userTeam;
      const opp = teams[home ? g.away : g.home];
      const oppRec = recordOf(f, teams, home ? g.away : g.home);
      next = `${home ? 'vs' : '@'} ${opp.city} ${opp.name} (${recText(oppRec)})`;
      add(`Play: ${next}`, `${f.phase === 'playoffs' ? 'Playoff game · ' : ''}${f.settings.quarterMinutes}-minute quarters`, () => this.ctx.playGame(g));
      add('Sim this game', 'Quick result, your stats count', () => { simGame(f, teams, g); this.afterUserGame(); });
    } else if (g && g.score) {
      next = `Final: ${teams[g.away].abbr} ${g.score[1]} – ${g.score[0]} ${teams[g.home].abbr}`;
    }
    const allDone = !currentGames(f).some((x) => !x.score);
    const advLabel = f.phase === 'regular' ? 'Finish the week' : 'Finish the round';
    if (!g || g.score) add(advLabel, allDone ? 'Move on' : 'Quick-sim the remaining games', () => { simOthers(f, teams); advance(f, teams); this.save(); this.hub(); });
    if (f.phase === 'regular') add('Sim to the playoffs', 'Quick-sim the rest of the regular season (your games too)', () => {
      while (f.phase === 'regular') { simOthers(f, teams); const ug = userGame(f); if (ug && !ug.score) simGame(f, teams, ug); advance(f, teams); }
      this.save(); this.hub();
    });
    add('Standings', 'Divisions, records, points', () => this.standingsScreen());
    add('Schedule & Results', 'Your games and every week\'s scores', () => this.scheduleScreen(f.phase === 'regular' ? f.week : f.weeks - 1));
    if (f.phase === 'playoffs') add('Playoff Bracket', 'Seeds and results', () => this.bracketScreen());
    add('League Leaders', 'Season stats', () => this.leadersScreen());
    add('Roster', `${me.roster.length} players`, () => this.ctx.rosterScreen(f.userTeam, () => this.hub(items.length - 3)));
    add('Depth Chart', 'Starters and rotation', () => this.ctx.depthScreen(f.userTeam, () => this.hub(items.length - 2)));
    add('Main Menu', 'Your franchise autosaves', this.ctx.onExit);
    screens.frame('menu-screen',
      el('div.fr-head', {}, logoCanvas(me.logo, 64), el('div', {},
        el('div.fr-team', { text: `${me.city} ${me.name}` }),
        el('div.fr-sub', { text: `${f.year} season · ${stage} · ${recText(rec)}` }),
        el('div.fr-next', { text: next }))),
      el('div.menu-list', {}, items));
    screens.nav.set(items, { onBack: this.ctx.onExit, index: Math.min(focus, items.length - 1) });
  }

  /** The human's game is decided (played or simmed): sim the others, move on if everything is done. */
  afterUserGame() {
    simOthers(this.f, this.teams);
    advance(this.f, this.teams);
    this.save();
    this.hub();
  }

  /** Called by the app when a franchise game the human played ends. */
  recordPlayed(g, match) {
    const r = matchToResult(match);
    recordGame(this.f, this.teams, g, r.score, r.lines);
    this.afterUserGame();
  }

  // ---------- standings ----------
  standingsScreen(conf = this.teams[this.f.userTeam].conference) {
    const { screens } = this.ctx;
    const teams = this.teams, rows = standings(teams, this.f.schedule);
    const divs = DIVISIONS.map((d, di) => {
      const r = rank(rows.filter((x) => teams[x.team].conference === conf && teams[x.team].division === di));
      return el('div.fr-div', {}, el('div.dc-head', { text: `${CONFERENCES[conf]} ${d}` }),
        el('div.st-row.st-head', {}, el('span.st-name', { text: 'Team' }), ...['W-L', 'PF', 'PA', 'DIV'].map((c) => el('span.st-num', { text: c }))),
        r.map((x) => el(`div.st-row${x.team === this.f.userTeam ? '.mine' : ''}`, { style: { borderLeftColor: teams[x.team].colors.primary } },
          el('span.st-name', {}, el('b', { text: `${teams[x.team].city} ${teams[x.team].name}` })),
          el('span.st-num', { text: recText(x) }), el('span.st-num', { text: String(x.pf) }), el('span.st-num', { text: String(x.pa) }),
          el('span.st-num', { text: `${x.divW}-${x.divL}` }))));
    });
    const back = el('div.start-btn', { text: 'Back' });
    back.activate = () => this.hub();
    screens.frame('stats-screen', el('h1', { text: 'Standings' }),
      el('div.pc-tabs', {}, CONFERENCES.map((c, i) => el(`div.pc-tab${i === conf ? '.on' : ''}`, { text: c }))),
      el('div.fr-divs', {}, divs), back,
      el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> conference &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set([back], { onBack: () => this.hub(), onTab: () => this.standingsScreen(1 - conf) });
  }

  // ---------- schedule ----------
  scheduleScreen(week) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams;
    const score = (g) => (g.score ? `${teams[g.away].abbr} ${g.score[1]} – ${g.score[0]} ${teams[g.home].abbr}` : `${teams[g.away].abbr} @ ${teams[g.home].abbr}`);
    const mine = f.schedule.map((wk, i) => {
      const g = wk.find((x) => x.home === f.userTeam || x.away === f.userTeam);
      const home = g.home === f.userTeam;
      const opp = teams[home ? g.away : g.home];
      let res = '';
      if (g.score) { const [a, b] = home ? g.score : [g.score[1], g.score[0]]; res = `${a > b ? 'W' : a < b ? 'L' : 'T'} ${a}-${b}`; }
      const row = el(`div.st-row${i === week ? '.mine' : ''}`, {}, el('span.st-team', { text: `Wk ${i + 1}` }),
        el('span.st-name', { text: `${home ? 'vs' : '@'} ${opp.city} ${opp.name}` }), el('span.st-num', { text: res || '—' }));
      row.activate = () => this.scheduleScreen(i);
      return row;
    });
    const results = (f.schedule[week] || []).map((g) => el('div.fr-score', { text: score(g) }));
    screens.frame('stats-screen', el('h1', { text: 'Schedule & Results' }),
      el('div.fr-sched', {}, el('div.st-table', {}, mine), el('div.fr-week', {}, el('div.dc-head', { text: `Week ${week + 1} around the league` }), results)),
      el('div.setup-help', { html: '<b class="btn A">A</b> show that week &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set(mine, { columns: 1, index: week, onBack: () => this.hub() });
  }

  bracketScreen() {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams;
    const rounds = f.playoffs.rounds.map((games, r) => el('div.fr-round', {}, el('div.dc-head', { text: PLAYOFF_ROUND_NAMES[r] }),
      games.map((g) => el('div.fr-score', { text: g.score
        ? `(${g.seedA}) ${teams[g.away].abbr} ${g.score[1]} – ${g.score[0]} ${teams[g.home].abbr} (${g.seedH})`
        : `(${g.seedA}) ${teams[g.away].abbr} @ ${teams[g.home].abbr} (${g.seedH})` }))));
    const back = el('div.start-btn', { text: 'Back' });
    back.activate = () => this.hub();
    screens.frame('stats-screen', el('h1', { text: 'Playoffs' }), el('div.fr-bracket', {}, rounds), back);
    screens.nav.set([back], { onBack: () => this.hub() });
  }

  // ---------- leaders ----------
  leadersScreen(tab = 0) {
    const { screens } = this.ctx;
    const cats = [['Passing yards', 'passYds'], ['Passing TD', 'passTD'], ['Rushing yards', 'rushYds'], ['Rushing TD', 'rushTD'],
      ['Receiving yards', 'recYds'], ['Receptions', 'rec'], ['Receiving TD', 'recTD'], ['Tackles', 'tackles'], ['Sacks', 'sacks'], ['Interceptions', 'defInt'], ['Field goals', 'fgMade']];
    const [label, field] = cats[tab];
    const list = leaders(this.f, field, 20);
    const rows = list.map((x, i) => el(`div.st-row${this.teams[this.f.userTeam].abbr === x.team ? '.mine' : ''}`, {},
      el('span.dc-rank', { text: String(i + 1) }), el('span.st-team', { text: x.team }),
      el('span.st-name', {}, el('b', { text: x.name }), el('small', { text: ` ${x.pos}` })), el('span.st-num', { text: String(x.value) })));
    const empty = el('div.st-empty', { text: 'No games played yet.' });
    screens.frame('stats-screen', el('h1', { text: 'League Leaders' }),
      el('div.pc-tabs', {}, cats.map(([l], i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: l }))),
      el('div.st-table', {}, rows.length ? rows : empty),
      el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> category &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => this.hub(), onTab: (d) => this.leadersScreen((tab + d + cats.length) % cats.length) });
  }
}
