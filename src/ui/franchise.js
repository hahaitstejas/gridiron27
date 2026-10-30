import { el } from './nav.js';
import { ICONS } from './screens.js';
import { logoCanvas } from '../render/logo.js';
import { CONFERENCES, DIVISIONS } from '../data/teams.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { createFranchise, currentGames, userGame, simGame, simOthers, advance, recordGame, matchToResult, recordOf, upgradeFranchise, tradeDeadlinePassed } from '../franchise/franchise.js';
import { contractsScreen, tradeScreen, transactionsScreen, capLine } from './franchiseMoney.js';
import { newsScreen, awardsScreen, latestHeadline } from './franchiseExtras.js';
import { standings, rank, leaders, SEASON_LENGTHS, PLAYOFF_ROUND_NAMES } from '../franchise/season.js';
import { STAT_TABS } from '../game/boxscore.js';
import { listSaves, readSave, setActiveSlot } from '../data/storage.js';
import { deserializeLeague } from '../data/league.js';
import { newCareer, careerScreen } from './career.js';
import { careerPlayer } from '../franchise/career.js';

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

  /** Franchise menu: continue the loaded franchise, load another saved one, or start a new one. */
  async open() {
    const { screens, league } = this.ctx;
    const saves = (await listSaves()).filter((s) => s.franchise);
    if (!saves.length && !this.f) { this.newFranchise(); return; }
    const byAbbr = (name) => this.teams.find((t) => `${t.city} ${t.name}` === name || t.name === name || t.abbr === name);
    const tile = (cls, label, sub, action, art) => {
      const t = el(`div.hub-tile${cls ? '.' + cls : ''}`, {}, art, el('div.ht-text', {}, el('div.ht-label', { text: label }), el('div.ht-sub', { text: sub })));
      t.activate = action;
      return t;
    };
    const tiles = [];
    for (const s of saves) {
      const cur = s.slot === league.slot && this.f;
      const t = byAbbr(s.franchise.team);
      const art = t ? el('div.fr-save-logo', { style: { '--tc': t.colors.primary } }, logoCanvas(t.logo, 72)) : el('div.ht-icon', { html: ICONS.trophy });
      const it = tile(cur ? 'feature' : '', cur ? `Continue` : s.franchise.team, `${cur ? `${s.franchise.team} · ` : ''}${s.franchise.year} · ${s.franchise.when}`, async () => {
        if (!cur) {
          const L = deserializeLeague(await readSave(s.slot));
          league.slot = s.slot; setActiveSlot(s.slot);
          league.franchise = L.franchise;
          await league.replaceLeague(L.teams, L.name);
        }
        this.hub();
      }, art);
      cur ? tiles.unshift(it) : tiles.push(it);
    }
    tiles.push(tile('new', 'New Franchise', 'Run a team: seasons, the draft, free agency', () => this.newFranchise(), el('div.ht-icon', { html: ICONS.trophy })));
    tiles.push(tile('new', 'New Career', 'Create a player and play as him', () => newCareer(this), el('div.ht-icon', { html: ICONS.user })));
    screens.frame('hub-screen', el('div.hub-top', {}, el('div.hub-logo', { html: 'FRANCHISE <span>MODE</span>' })),
      el('div.fr-saves', {}, tiles),
      el('div.hub-foot', { html: '<b class="btn A">A</b> Select &nbsp;&nbsp; <b class="btn B">B</b> Back' }));
    screens.nav.set(tiles, { spatial: true, onBack: this.ctx.onExit });
  }

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
      // A franchise gets its own save slot (a copy of the current league), so the league itself stays as is;
      // remember that league so leaving the franchise goes back to it (LeagueUI.leaveFranchise).
      if (L.slot && !L.franchise) await L.saveNow();
      const baseSlot = L.franchise ? L.franchise.baseSlot ?? null : L.slot ?? null;
      L.franchise = createFranchise(this.teams, { ...opts, seed: (Date.now() % 100000) + 1 });
      L.franchise.baseSlot = baseSlot;
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
  hub(focus = null) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams, me = teams[f.userTeam];
    screens.extraButtons = null;
    upgradeFranchise(f, teams);
    if (f.phase === 'offseason') { this.ctx.offseason(this); return; }
    const g = userGame(f);
    const rec = recordOf(f, teams, f.userTeam);
    const stage = f.phase === 'regular' ? `Week ${f.week + 1} of ${f.weeks}` : PLAYOFF_ROUND_NAMES[f.playoffs.rounds.length - 1];
    const tile = (cls, icon, label, sub, action, ...extra) => {
      const t = el(`div.hub-tile${cls ? '.' + cls : ''}`, {}, el('div.ht-icon', { html: ICONS[icon] || '' }),
        el('div.ht-text', {}, el('div.ht-label', { text: label }), sub ? el('div.ht-sub', { text: sub }) : null), ...extra);
      t.activate = action;
      t.key = label;
      return t;
    };
    const back = (key) => () => this.hub(key);

    // The next game: a big matchup card (or the result / what's left of the season).
    const hero = [];
    const allDone = !currentGames(f).some((x) => !x.score);
    const advance1 = () => { simOthers(f, teams); advance(f, teams); this.save(); this.hub(); };
    if (g && !g.score) {
      const home = g.home === f.userTeam, oi = home ? g.away : g.home, opp = teams[oi];
      const side = (t, r) => el('div.htm-team', { style: { '--tc': t.colors.primary } }, logoCanvas(t.logo, 96), el('b', { text: t.abbr }), el('small', { text: recText(r) }));
      const matchup = el('div.ht-matchup', {}, side(teams[g.away], recordOf(f, teams, g.away)), el('div.htm-at', { text: '@' }), side(teams[g.home], recordOf(f, teams, g.home)));
      hero.push(tile('feature.fr-play', 'play', f.phase === 'playoffs' ? 'Play Playoff Game' : 'Play Game',
        `${home ? 'vs' : 'at'} ${opp.city} ${opp.name} (${recText(recordOf(f, teams, oi))}) · ${stage} · ${f.settings.quarterMinutes}-min quarters`, () => this.ctx.playGame(g), matchup));
      hero.push(tile('small', 'fast', 'Sim Game', 'Quick result, stats count', () => { simGame(f, teams, g); this.afterUserGame(); }));
    } else {
      const done = g && g.score ? `Final: ${teams[g.away].abbr} ${g.score[1]} – ${g.score[0]} ${teams[g.home].abbr}` : 'Your season is over: watch the rest of the playoffs';
      hero.push(tile('feature.fr-play', 'fast', f.phase === 'regular' ? 'Finish the Week' : 'Finish the Round', `${done} · ${allDone ? 'move on' : 'quick-sim the other games'}`, advance1));
    }
    if (f.phase === 'regular') hero.push(tile('small', 'calendar', 'Sim to Playoffs', 'The rest of the regular season', () => {
      while (f.phase === 'regular') { simOthers(f, teams); const ug = userGame(f); if (ug && !ug.score) simGame(f, teams, ug); advance(f, teams); }
      this.save(); this.hub();
    }));

    // Division race: your division's top four on the standings tile.
    const rows = rank(standings(teams, f.schedule).filter((x) => teams[x.team].conference === me.conference && teams[x.team].division === me.division));
    const mini = el('div.fr-mini', {}, rows.slice(0, 4).map((x, i) => el(`div${x.team === f.userTeam ? '.mine' : ''}`, { style: { '--tc': teams[x.team].colors.primary } },
      el('span', { text: `${i + 1}` }), el('b', { text: teams[x.team].abbr }), el('span', { text: recText(x) }))));

    const cp = careerPlayer(f, teams);
    const hurt = me.roster.filter((p) => p.injury).length;
    const season = [
      tile('', 'list', 'Standings', `${CONFERENCES[me.conference]} ${DIVISIONS[me.division]}`, () => this.standingsScreen(), mini),
      tile('', 'calendar', 'Schedule', 'Your games, every score', () => this.scheduleScreen(f.phase === 'regular' ? f.week : f.weeks - 1)),
      f.phase === 'playoffs' ? tile('', 'bracket', 'Bracket', 'Seeds and results', () => this.bracketScreen()) : null,
      tile('', 'chart', 'Team Stats', 'Season totals', () => this.teamStatsScreen()),
      tile('', 'trophy', 'Leaders', 'League stat leaders', () => this.leadersScreen()),
    ].filter(Boolean);
    const team = [
      cp ? tile('', 'user', 'My Player', `${cp.pos} · ${cp.ovr} OVR · ${f.career.points} pts`, () => careerScreen(this)) : null,
      tile('', 'people', 'Roster', `${me.roster.length} players`, () => this.ctx.rosterScreen(f.userTeam, back('Roster'))),
      tile('', 'clipboard', 'Depth Chart', 'Starters, rotation', () => this.ctx.depthScreen(f.userTeam, back('Depth Chart'))),
      tile('', 'medkit', 'Injuries', hurt ? `${hurt} hurt` : 'All healthy', () => this.injuryScreen()),
      tile('', 'money', 'Contracts', capLine(f, me), () => contractsScreen(this)),
      f.phase === 'regular' ? tile('', 'swap', 'Trade', tradeDeadlinePassed(f) ? 'Deadline passed' : `Deadline: week ${Math.ceil(f.weeks * 0.6)}`, () => tradeScreen(this)) : null,
    ].filter(Boolean);
    const league = [
      tile('', 'news', 'News', latestHeadline(f), () => newsScreen(this)),
      tile('', 'star', 'Awards & Records', 'MVP, records, champions', () => awardsScreen(this)),
      tile('', 'swap', 'Transactions', 'Trades and signings', () => transactionsScreen(this)),
      tile('', 'exit', 'Main Menu', 'Autosaved', this.ctx.onExit),
    ];
    const col = (title, tiles, cls = '') => el(`div.fr-col${cls}`, {}, el('div.fr-col-head', { text: title }), ...tiles);
    const top = el('div.hub-top', {}, el('div.hub-logo', { html: `FRANCHISE <span>${f.year}</span>` }),
      el('div.hub-me', { style: { '--tc': me.colors.primary } }, logoCanvas(me.logo, 40),
        el('div', {}, el('small', { text: `${stage.toUpperCase()} · ${recText(rec)}` }), el('b', { text: `${me.city} ${me.name}` }))));
    screens.frame('hub-screen fr-hub-screen', top,
      el('div.fr-hub', {}, el('div.fr-hero', {}, ...hero), col('Season', season), col('Team', team), col('League', league)),
      el('div.hub-foot', { html: `<b class="btn A">A</b> Select &nbsp;&nbsp; <b class="btn B">B</b> Main menu <span class="tiny">${f.name || ''} · autosaves</span>` }));
    screens.root.style.setProperty('--accent', me.colors.primary);
    const items = [...hero, ...season, ...team, ...league];
    const at = typeof focus === 'string' ? items.findIndex((t) => t.key === focus) : focus ?? 0;
    screens.nav.set(items, { spatial: true, onBack: this.ctx.onExit, index: Math.max(0, Math.min(at, items.length - 1)) });
  }

  /** The human's game is decided (played or simmed): sim the others, move on if everything is done. */
  afterUserGame() {
    simOthers(this.f, this.teams);
    advance(this.f, this.teams);
    this.save();
    this.hub();
  }

  /** Called by the app when a franchise game the human played ends. */
  recordPlayed(g, match, injuries = []) {
    const r = matchToResult(match);
    recordGame(this.f, this.teams, g, r.score, r.lines, injuries);
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

  // ---------- season stats (same tabs as the end-of-game stats) ----------
  teamStatsScreen(tab = 0, mine = true) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams, t = STAT_TABS[tab];
    const list = Object.values(f.stats).filter((s) => (!mine || s.teamIdx === f.userTeam) && t.has(s)).sort((a, b) => t.sort(b) - t.sort(a));
    const head = el('div.st-row.st-head', {}, el('span.st-team', { text: 'TM' }), el('span.st-name', { text: 'Player' }), el('span.st-num', { text: 'GP' }),
      t.cols.map(([c]) => el('span.st-num', { text: c })));
    const rows = list.map((s) => {
      const tm = teams[s.teamIdx];
      return el('div.st-row', { style: { borderLeftColor: tm?.colors.primary } }, el('span.st-team', { text: s.team }),
        el('span.st-name', {}, el('b', { text: s.name }), el('small', { text: ` ${s.pos}` })), el('span.st-num', { text: String(s.gp) }),
        t.cols.map(([, fn]) => el('span.st-num', { text: String(fn(s)) })));
    });
    const empty = el('div.st-empty', { text: 'No stats yet this season.' });
    const go = (d) => this.teamStatsScreen((tab + d + STAT_TABS.length) % STAT_TABS.length, mine);
    screens.frame('stats-screen', el('h1', { text: `${f.year} Season Stats` }),
      el('div.pc-tabs', {}, STAT_TABS.map((x, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: x.label }))),
      el('div.st-team-filter', { text: mine ? `${teams[f.userTeam].city} ${teams[f.userTeam].name}` : 'Whole league' }),
      el('div.st-table', {}, head, rows.length ? rows : empty),
      el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> category &nbsp; <b class="btn X">X</b> my team / league &nbsp; ▲▼ scroll &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => this.hub(), onTab: go });
    screens.extraButtons = (fr) => { if (fr.pressed.X) this.teamStatsScreen(tab, !mine); };
  }

  // ---------- injuries ----------
  injuryScreen(mine = true) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams;
    const list = teams.flatMap((t, ti) => (mine && ti !== f.userTeam ? [] : t.roster.filter((p) => p.injury).map((p) => ({ p, t }))))
      .sort((a, b) => b.p.injury.weeks - a.p.injury.weeks);
    const rows = list.map(({ p, t }) => el('div.st-row', { style: { borderLeftColor: t.colors.primary } }, el('span.st-team', { text: t.abbr }),
      el('span.dc-pos', { text: p.pos }), el('span.st-name', {}, el('b', { text: `${p.first} ${p.last}` }), el('small', { text: ` ${p.injury.type}` })),
      el('span.st-num', { text: String(p.ovr) }), el('span.st-num.down', { text: p.injury.weeks >= 8 ? 'Season' : `${p.injury.weeks} wk` })));
    const empty = el('div.st-empty', { text: mine ? 'Your team is healthy.' : 'No injuries around the league.' });
    screens.frame('stats-screen', el('h1', { text: 'Injury Report' }),
      el('div.st-team-filter', { text: mine ? `${teams[f.userTeam].city} ${teams[f.userTeam].name}` : 'Whole league' }),
      el('div.st-table', {}, rows.length ? rows : empty),
      el('div.setup-help', { html: 'Injured players sit out until they heal (a week per game). &nbsp; <b class="btn X">X</b> my team / league &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => this.hub() });
    screens.extraButtons = (fr) => { if (fr.pressed.X) this.injuryScreen(!mine); };
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
