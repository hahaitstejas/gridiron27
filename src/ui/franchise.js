import { addGeneratedFreeAgents, posLevels, topUpPool } from '../franchise/freeAgents.js';
import { cpuFillPS } from '../franchise/practiceSquad.js';
import { el } from './nav.js';
import { LEAGUE } from '../data/leagueInfo.js';
import { ICONS, alphaOrder } from './screens.js';
import { teamPickScreen } from './teamPick.js';
import { faceImg } from './faces.js';
import { logoCanvas } from '../render/logo.js';
import { CONFERENCES, DIVISIONS } from '../data/teams.js';
import { DIFFICULTY, DIFFICULTY_KEYS } from '../ai/difficulty.js';
import { gameConditions } from '../franchise/franchise.js';
import { teamRatings } from '../data/positions.js';
import { createFranchise, currentGames, userGame, simGame, simOthers, advance, recordGame, matchToResult, recordOf, upgradeFranchise, tradeDeadlinePassed } from '../franchise/franchise.js';
import { contractsScreen, tradeScreen, transactionsScreen, capLine, tradeBlockScreen, offersScreen } from './franchiseMoney.js';
import { newsScreen, awardsScreen, latestHeadline, hallScreen } from './franchiseExtras.js';
import { standings, rank, seeds, leaders, PLAYOFF_ROUND_NAMES } from '../franchise/season.js';
import { gameWhen } from '../franchise/nflSchedule.js';

const SLOT_NAMES = { TNF: 'Thursday Night', SNF: 'Sunday Night', MNF: 'Monday Night', Opener: 'Kickoff Opener', Thanksgiving: 'Thanksgiving', Christmas: 'Christmas Day', International: 'International' };
export const slotName = (g) => (g.slot === 'International' && g.venue ? `${g.venue.city} game` : SLOT_NAMES[g.slot] || '');
import { STAT_TABS } from '../game/boxscore.js';
import { sortHead, sortKeys, sortRows } from './sortable.js';
import { listSaves, readSave, setActiveSlot } from '../data/storage.js';
import { deserializeLeague } from '../data/league.js';
import { newCareer, careerScreen } from './career.js';
import { fantasyDraftScreen } from './fantasyDraft.js';
import { freeAgentsScreen } from './freeAgents.js';
import { setFreeAgents } from '../franchise/freeAgents.js';
import { parseCSV, freeAgentsFromRows } from '../data/csv.js';
import { startFantasyDraft } from '../franchise/fantasy.js';
import { careerPlayer } from '../franchise/career.js';
import { scheduleFromRows, exportSchedule } from '../data/extraCSV.js';
import { setSchedule } from '../franchise/franchise.js';
import { pickFile, downloadFile } from '../data/storage.js';
import { cutDownScreen, injuryReport, practiceSquadScreen, waiversScreen, playerSearch, gamePreview, scoutingScreen } from './franchiseMore.js';
import { teamMorale } from '../franchise/development.js';
import { localBook } from '../data/localLeague.js';

async function loadLocalFreeAgents(f) {
  if (localBook.freeAgents?.length) { setFreeAgents(f, localBook.freeAgents.map((p) => ({ ...p, ratings: { ...p.ratings } }))); return; }
  if (location.protocol === 'file:') return;
  try {
    const res = await fetch('local/free_agents.csv', { cache: 'no-store' });
    if (!res.ok || !/text|csv|octet/.test(res.headers.get('content-type') || 'text')) return;
    const text = await res.text();
    if (/<html/i.test(text)) return; // the dev server's fallback page, not a CSV
    const { players } = freeAgentsFromRows(parseCSV(text));
    if (players.length) setFreeAgents(f, players);
  } catch { /* no file */ }
}

/** public/local/schedule.csv (week, away, home[, day, date, time]) replaces the generated first season. */
async function loadLocalSchedule(f, teams) {
  if (localBook.schedule) { setSchedule(f, teams, localBook.schedule.map((wk) => wk.map((g) => ({ ...g, score: null })))); return; }
  if (location.protocol === 'file:') return;
  try {
    const res = await fetch('local/schedule.csv', { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    if (!/^\s*week\s*,/i.test(text)) return;
    const { weeks } = scheduleFromRows(teams, parseCSV(text));
    if (weeks) setSchedule(f, teams, weeks);
  } catch { /* no file */ }
}

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
      const kind = s.franchise.mode === 'season' ? 'Season' : 'Franchise';
      const it = tile(cur ? 'feature' : '', cur ? `Continue` : s.franchise.team, `${cur ? `${s.franchise.team} · ` : ''}${kind} · ${s.franchise.year} · ${s.franchise.when}`, async () => {
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
    tiles.push(tile('new', 'New Season', 'One season to a championship, no offseason', () => this.newFranchise('season'), el('div.ht-icon', { html: ICONS.calendar })));
    tiles.push(tile('new', 'Tournament', '4, 8 or 16 teams, single elimination', () => this.ctx.tournament(), el('div.ht-icon', { html: ICONS.bracket })));
    tiles.push(tile('new', 'New Career', 'Create a player and play as him', () => newCareer(this), el('div.ht-icon', { html: ICONS.user })));
    screens.frame('hub-screen', el('div.hub-top', {}, el('div.hub-logo', { html: 'SEASONS <span>&amp; MORE</span>' })),
      el('div.fr-saves', {}, tiles),
      el('div.hub-foot', { html: '<b class="btn A">A</b> Select &nbsp;&nbsp; <b class="btn B">B</b> Back' }));
    screens.nav.set(tiles, { spatial: true, onBack: this.ctx.onExit });
  }

  // ---------- new franchise ----------
  newFranchise(mode = 'franchise', preset = null) {
    const { screens, prefs } = this.ctx;
    const opts = preset || { userTeam: prefs.home, weeks: mode === 'season' ? 10 : 17, difficulty: prefs.difficulty, quarterMinutes: prefs.quarterMinutes, rosters: 'current' };
    opts.rosters ||= 'current';
    opts.extraFA ??= true;
    // First the team (slide 6: logo grid + team card), then these advanced settings.
    if (!opts.picked) {
      teamPickScreen(screens, this.teams, { title: mode === 'season' ? 'New Season: Pick Your Team' : 'New Franchise: Pick Your Team', focus: opts.userTeam,
        onPick: (ti) => this.newFranchise(mode, { ...opts, userTeam: ti, picked: true }), onBack: this.ctx.onExit });
      return;
    }
    const option = (label, values, key, fmt) => {
      const row = el('div.opt-row');
      const draw = () => { row.innerHTML = ''; row.append(el('span.opt-label', { text: label }), el('span.opt-val', { html: `◀ ${fmt(opts[key])} ▶` })); };
      row.spin = (d) => { const i = Math.max(0, values.indexOf(opts[key])); opts[key] = values[(i + d + values.length) % values.length]; draw(); };
      row.activate = () => row.spin(1);
      draw();
      return row;
    };
    const teamIdx = alphaOrder(this.teams);
    const rows = [
      Object.assign(el('div.opt-row.action', {}, el('span.opt-label', { text: 'Your team' }), el('span.opt-val', { text: `${this.teams[opts.userTeam].city} ${this.teams[opts.userTeam].name} (change…)` })),
        { activate: () => this.newFranchise(mode, { ...opts, picked: false }) }),
      option('Difficulty', DIFFICULTY_KEYS, 'difficulty', (k) => DIFFICULTY[k].label),
      option('Quarter length (games you play)', [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15], 'quarterMinutes', (v) => `${v} min`),
      option('Rosters', ['current', 'fantasy'], 'rosters', (v) => (v === 'fantasy' ? 'Fantasy draft: every team drafts from scratch' : 'Keep the current rosters')),
      option('Extra free agents', [true, false], 'extraFA', (v) => (v ? 'Add 800 created players to the pool' : 'Only the pool / your CSV')),
    ];
    const start = el('div.start-btn', { text: mode === 'season' ? 'Start Season' : 'Start Franchise' });
    start.activate = async () => {
      const L = this.ctx.league;
      // A franchise gets its own save slot (a copy of the current league), so the league itself stays as is;
      // remember that league so leaving the franchise goes back to it (LeagueUI.leaveFranchise).
      if (L.slot && !L.franchise) await L.saveNow();
      const baseSlot = L.franchise ? L.franchise.baseSlot ?? null : L.slot ?? null;
      const seed = (Date.now() % 100000) + 1;
      L.franchise = createFranchise(this.teams, { ...opts, mode, seed });
      L.franchise.baseSlot = baseSlot;
      // Fantasy draft: the franchise (its own save slot) empties every roster into one pool; the hub runs the draft.
      if (opts.rosters === 'fantasy') startFantasyDraft(L.franchise, this.teams, seed);
      // Your own list of current free agents (public/local/free_agents.csv, roster format) replaces the generated pool.
      await loadLocalFreeAgents(L.franchise);
      await loadLocalSchedule(L.franchise, this.teams);
      // Depth for everyone: 800 created (mostly fringe) players on top of the free-agent list, and practice squads.
      if (opts.extraFA !== false) addGeneratedFreeAgents(L.franchise, 800, seed * 3, { levels: posLevels(this.teams) });
      for (const t of this.teams) cpuFillPS(t, L.franchise.freeAgents);
      if (opts.extraFA !== false) topUpPool(L.franchise, posLevels(this.teams), seed * 5); // every position keeps a real pool
      L.name = L.franchise.name;
      L.slot = null;
      await L.saveNow();
      this.hub();
    };
    screens.frame('setup-screen', el('h1', { text: mode === 'season' ? 'New Season' : 'New Franchise' }),
      el('div.league-status', { text: mode === 'season' ? 'One season with your current league: the schedule, the playoffs and a champion. No offseason.' : 'Starts from your current league (rosters, teams, logos) in a new save slot.' }),
      el('div.setup-opts', {}, ...rows, start),
      el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set([...rows, start], { columns: 1, onBack: () => this.newFranchise(mode, { ...opts, picked: false }), index: rows.length });
  }

  // ---------- hub ----------
  hub(focus = null) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams, me = teams[f.userTeam];
    screens.extraButtons = null;
    upgradeFranchise(f, teams);
    if (f.phase === 'offseason') { this.ctx.offseason(this); return; }
    if (f.phase === 'done') { this.seasonOver(); return; }
    if (f.fantasy && !f.fantasy.done) { fantasyDraftScreen(this); return; }
    // Opening cut-down: your roster is over 53 and the season can't start until you've picked who goes.
    if (f.needsCut) {
      if (me.roster.length > 53) { cutDownScreen(this, { onDone: () => { f.needsCut = false; this.save(); this.hub(); } }); return; }
      f.needsCut = false;
    }
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
        `${home ? 'vs' : 'at'} ${opp.city} ${opp.name} (${recText(recordOf(f, teams, oi))}) · ${stage}${g.date ? ` · ${gameWhen(g)}${g.slot ? ` · ${slotName(g)}` : ''}` : ''}`, () => this.ctx.playGame(g), matchup));
      hero.push(tile('small', 'clipboard', 'Game Preview', 'Your coordinators on the opponent', () => gamePreview(this, g)));
      hero.push(tile('small', 'fast', 'Sim Game', 'Quick result, stats count', () => { simGame(f, teams, g); this.afterUserGame(); }));
    } else {
      const bye = f.phase === 'regular' && !g;
      const done = g && g.score ? `Final: ${teams[g.away].abbr} ${g.score[1]} – ${g.score[0]} ${teams[g.home].abbr}` : bye ? `Bye week: your team rests (${stage})` : 'Your season is over: watch the rest of the playoffs';
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
    const hurt = me.roster.filter((p) => p.injury && (p.injury.weeks > 0 || p.injury.ir)).length;
    const ir = me.roster.filter((p) => p.injury?.ir).length;
    // Four boxes; each opens its own menu (the old hub had every screen on one page).
    const box = (icon, label, sub, preview, tiles) => {
      const t = tile('box', icon, label, sub, () => this.boxMenu(label, tiles), preview);
      return t;
    };
    const seasonTiles = () => [
      tile('', 'list', 'Standings', `${CONFERENCES[me.conference]} ${DIVISIONS[me.division]} · playoff picture`, () => this.standingsScreen()),
      tile('', 'calendar', 'Schedule & Results', 'Your games, kickoff times, every score', () => this.scheduleScreen(f.phase === 'regular' ? f.week : f.weeks - 1)),
      f.phase === 'playoffs' ? tile('', 'bracket', 'Bracket', 'Seeds and results', () => this.bracketScreen()) : null,
      tile('', 'chart', 'Team Stats', 'Season totals, sortable', () => this.teamStatsScreen()),
      tile('', 'trophy', 'League Leaders', 'Your players highlighted', () => this.leadersScreen()),
      tile('', 'star', 'Draft Scouting', `${f.year + 1} class · ${f.scoutPoints ?? 0} points`, () => scoutingScreen(this)),
    ].filter(Boolean);
    const teamTiles = () => [
      cp ? tile('', 'user', 'My Player', `${cp.pos} · ${cp.ovr} OVR · ${f.career.points} pts`, () => careerScreen(this)) : null,
      tile('', 'people', 'Roster', `${me.roster.filter((p) => !p.injury?.ir).length}/53 active`, () => this.ctx.rosterScreen(f.userTeam, () => this.boxMenu('Team', teamTiles))),
      tile('', 'clipboard', 'Depth Chart', 'Starters, rotation', () => this.ctx.depthScreen(f.userTeam, () => this.boxMenu('Team', teamTiles))),
      tile('', 'medkit', 'Injury Report', hurt ? `${hurt} out · ${ir} on IR` : 'All healthy', () => injuryReport(this)),
      tile('', 'people', 'Practice Squad', `${(me.ps || []).length}/16 · elevate, sign or release`, () => practiceSquadScreen(this)),
      tile('', 'chart', 'Player Development', f.devReport?.length ? `${f.devReport.length} improved recently` : 'Growth every two weeks', () => this.devScreen()),
      tile('', 'money', 'Contracts & Cap', capLine(f, me), () => contractsScreen(this)),
    ].filter(Boolean);
    const officeTiles = () => [
      tile('', 'user', 'Free Agents', `${(f.freeAgents || []).length} available`, () => freeAgentsScreen(this)),
      f.phase === 'regular' ? tile('', 'swap', 'Trade', tradeDeadlinePassed(f) ? 'Deadline passed' : `Deadline: week ${Math.ceil(f.weeks * 0.6)}`, () => tradeScreen(this)) : null,
      f.phase === 'regular' ? tile('', 'list', 'Trade Block', `${me.roster.filter((p) => p.onBlock).length} on the block`, () => tradeBlockScreen(this)) : null,
      tile('', 'news', 'Trade Offers', `${(f.offers || []).length} this week`, () => offersScreen(this)),
      tile('', 'list', 'Waiver Wire', `${(f.waivers || []).length} on waivers`, () => waiversScreen(this)),
      tile('', 'people', 'Player Search', 'Every player in the league', () => playerSearch(this)),
      tile('', 'swap', 'Transactions', 'Trades, signings, moves', () => transactionsScreen(this)),
    ].filter(Boolean);
    const leagueTiles = () => [
      tile('', 'news', 'News', latestHeadline(f), () => newsScreen(this)),
      tile('', 'star', 'Awards & Records', 'MVP, All-Pro, records, champions', () => awardsScreen(this)),
      tile('', 'trophy', 'Hall of Fame', `${(f.hof || []).length} inducted · your history`, () => hallScreen(this)),
      tile('', 'exit', 'Main Menu', 'Autosaved', this.ctx.onExit),
    ];
    this._boxes = { Season: seasonTiles, Team: teamTiles, 'Front Office': officeTiles, League: leagueTiles };
    const season = [box('list', 'Season', `${stage} · ${recText(rec)}`, mini, seasonTiles)];
    const lines = (arr) => el('div.fr-boxlines', {}, ...arr.filter(Boolean).slice(0, 4).map(([a, b]) => el('div', {}, el('span', { text: a }), el('b', { text: b }))));
    const injured = me.roster.filter((p) => p.injury && (p.injury.weeks > 0 || p.injury.ir)).sort((a, b) => b.ovr - a.ovr);
    const team = [box('people', 'Team', `Morale ${teamMorale(me)} · ${me.roster.filter((p) => !p.injury?.ir).length}/53 active`,
      lines(injured.length ? injured.slice(0, 4).map((p) => [`${p.pos} ${p.first[0]}. ${p.last}`, p.injury.ir ? 'IR' : p.injury.weeks >= 2 ? 'Out' : 'Doubtful']) : [['Injury report', 'All healthy']]), teamTiles)];
    const league = [
      box('swap', 'Front Office', capLine(f, me), lines([['Free agents', String((f.freeAgents || []).length)], ['On waivers', String((f.waivers || []).length)],
        ['Trade deadline', tradeDeadlinePassed(f) ? 'Passed' : `Week ${Math.ceil(f.weeks * 0.6)}`], me.roster.some((p) => p.tradeRequest) ? ['Trade requests', String(me.roster.filter((p) => p.tradeRequest).length)] : null]), officeTiles),
      box('news', 'League', 'News, awards, Hall of Fame', el('div.fr-boxnews', {}, ...(f.news || []).slice(0, 3).map((n) => el('div', { text: n.text }))), leagueTiles),
    ];
    // ---- UPDATE 3.1 hub (slides 7, 9, 10): tabs across the top (LB / RB), a news ticker along the bottom. ----
    const TABS = [['Gameday', null], ['Weekly Hub', seasonTiles], ['Manage Roster', teamTiles], ['Front Office', officeTiles], ['League', leagueTiles]];
    const BOX_TAB = { Season: 'Weekly Hub', Team: 'Manage Roster', 'Front Office': 'Front Office', League: 'League' };
    if (typeof focus === 'string') {
      if (BOX_TAB[focus]) { this._tab = BOX_TAB[focus]; focus = null; }
      else for (const [name, fn] of TABS) if (fn && fn().some((t) => t.key === focus)) this._tab = name;
    }
    if (!TABS.some(([n]) => n === this._tab)) this._tab = 'Gameday';
    const tabName = this._tab;
    const tabsEl = el('div.fh-tabs', {}, el('b.btn.LB', { text: 'LB' }),
      ...TABS.map(([n]) => el(`div.fh-tab${n === tabName ? '.on' : ''}`, { text: n })), el('b.btn.RB', { text: 'RB' }));
    const meEl = el('div.fh-me', {}, logoCanvas(me.logo, 34), el('div', {}, el('b', { text: `${me.city} ${me.name}`.toUpperCase() }), el('small', { text: `${f.year} · ${stage.toUpperCase()} · ${recText(rec)}` })));
    let body, items;
    if (tabName === 'Gameday') {
      ({ body, items } = this.gamedayPanel(g, stage, advance1));
    } else {
      // Weekly-hub style cards: a tall card per screen, the team color behind the line art.
      items = TABS.find(([n]) => n === tabName)[1]();
      for (const t of items) t.classList.add('fh-card');
      body = el('div.fh-cards', {}, items);
    }
    // News Center: the latest headlines scrolling, and your next game on the right.
    const heads = (f.news || []).slice(0, 6).map((n) => n.text);
    const nextG = g && !g.score ? `${teams[g.away].abbr} @ ${teams[g.home].abbr}${g.date ? ` · ${gameWhen(g)}` : ''}` : stage;
    const ticker = el('div.fh-news', {}, el('div.fh-news-tag', { text: 'NEWS CENTER' }),
      el('div.fh-news-run', {}, el('div.fh-news-txt', { text: heads.length ? heads.join('     •     ') : 'Welcome to the season.' })),
      el('div.fh-news-next', { text: nextG }));
    screens.frame('fh-screen', el('div.fh-top', {}, tabsEl, meEl), el('div.fh-body', {}, body), ticker,
      el('div.fh-help', { html: `<b class="btn A">A</b> Select &nbsp; <b class="btn LB">LB</b><b class="btn RB">RB</b> Tabs &nbsp; <b class="btn B">B</b> Main menu <span class="tiny">${f.name || ''} · autosaves</span>` }));
    screens.root.style.setProperty('--accent', me.colors.primary);
    screens.root.style.setProperty('--tc', me.colors.primary);
    const at = typeof focus === 'string' ? items.findIndex((t) => t.key === focus) : focus ?? 0;
    const go = (d) => { const i = TABS.findIndex(([n]) => n === this._tab); this._tab = TABS[(i + d + TABS.length) % TABS.length][0]; this.hub(); };
    screens.nav.set(items, { spatial: true, onBack: this.ctx.onExit, onTab: go, index: Math.max(0, Math.min(at, items.length - 1)) });
  }

  /** Gameday tab (slide 10): the week strip, both teams big, kickoff details, Play / Sim / Preview / Advance. */
  gamedayPanel(g, stage, advance1) {
    const f = this.f, teams = this.teams;
    const items = [];
    const btn = (label, cls, act, logo = null) => { const b = el(`div.gd-btn${cls ? '.' + cls : ''}`, {}, el('span', { text: label }), logo); b.activate = act; b.key = label; items.push(b); return b; };
    // Week strip: your games around this week.
    const strip = [];
    if (f.phase === 'regular') {
      for (let w = Math.max(0, f.week - 1); w < Math.min(f.weeks, f.week + 4); w++) {
        const ug = (f.schedule[w] || []).find((x) => x.home === f.userTeam || x.away === f.userTeam);
        const opp = ug ? teams[ug.home === f.userTeam ? ug.away : ug.home] : null;
        strip.push(el(`div.gd-wk${w === f.week ? '.on' : ''}`, {}, el('div.gd-wk-logo', {}, opp ? logoCanvas(opp.logo, 34) : el('b', { text: 'BYE' })),
          el('small', { text: ug?.score ? `${ug.score[ug.home === f.userTeam ? 0 : 1]}-${ug.score[ug.home === f.userTeam ? 1 : 0]}` : `WEEK ${w + 1}` })));
      }
    }
    let center;
    if (g && !g.score) {
      const side = (ti, al) => {
        const t = teams[ti], r = teamRatings(t), rec = recordOf(f, teams, ti);
        const badges = el('div.gd-badges', {}, [['OVR', r.ovr], ['OFF', r.off], ['DEF', r.def]].map(([l, v]) => el('div.gd-badge', {}, el('b', { text: String(v) }), el('small', { text: l }))));
        return el(`div.gd-team.${al}`, { style: { '--tc': t.colors.primary } }, el('div.gd-logo', {}, logoCanvas(t.logo, 190)), badges,
          el('div.gd-name', {}, el('small', { text: t.city.toUpperCase() }), el('b', { text: t.name.toUpperCase() }), el('span', { text: recText(rec) })));
      };
      const cond = gameConditions(f, g);
      const wx = cond ? `${{ clear: cond.time === 'night' ? 'Clear night' : 'Clear', rain: 'Rain', snow: 'Snow' }[cond.type] || ''}` : '';
      const venue = g.venue ? `${g.venue.name || ''} ${g.venue.city || ''}`.trim() : teams[g.home].stadium?.name || `${teams[g.home].city}`;
      center = el('div.gd-match', {}, side(g.away, 'l'),
        el('div.gd-mid', {}, el('div.gd-at', { text: 'AT' }), el('div.gd-when', { text: g.date ? gameWhen(g) : stage }),
          g.slot ? el('div.gd-slot', { text: slotName(g) }) : null, el('div.gd-venue', { text: venue }), wx ? el('div.gd-wx', { text: wx }) : null),
        side(g.home, 'r'));
      const me = teams[f.userTeam];
      btn(f.phase === 'playoffs' ? 'Play Playoff Game' : 'Play Game', 'main', () => this.ctx.playGame(g), logoCanvas(me.logo, 34));
      btn('Sim Game', '', () => { simGame(f, teams, g); this.afterUserGame(); });
      btn('Game Preview', '', () => gamePreview(this, g));
    } else {
      const bye = f.phase === 'regular' && !g;
      const done = g && g.score ? `FINAL: ${teams[g.away].abbr} ${g.score[1]} – ${g.score[0]} ${teams[g.home].abbr}` : bye ? 'BYE WEEK' : 'YOUR SEASON IS OVER';
      center = el('div.gd-match.empty', {}, el('div.gd-done', { text: done }), el('div.gd-when', { text: stage }));
      btn(f.phase === 'regular' ? 'Advance Week' : 'Finish the Round', 'main', advance1);
    }
    if (f.phase === 'regular') btn('Sim to Playoffs', '', () => {
      while (f.phase === 'regular') { simOthers(f, teams); const ug = userGame(f); if (ug && !ug.score) simGame(f, teams, ug); advance(f, teams); }
      this.save(); this.hub();
    });
    const body = el('div.gd', {}, el('div.gd-head', {}, el('div.gd-title', { text: 'GAMEDAY' }), el('div.gd-strip', {}, strip)), center, el('div.gd-btns', {}, items));
    return { body, items };
  }

  /** One of the hub's boxes opened: its screens as tiles. */
  boxMenu(label, tiles) {
    // UPDATE 3.1: the boxes are tabs of the hub now.
    const TAB = { Season: 'Weekly Hub', Team: 'Manage Roster', 'Front Office': 'Front Office', League: 'League' };
    if (TAB[label]) { this._tab = TAB[label]; this.hub(); return; }
    const { screens } = this.ctx;
    const f = this.f, me = this.teams[f.userTeam];
    screens.extraButtons = null;
    const items = tiles();
    screens.frame('hub-screen fr-box-screen', el('div.hub-top', {}, el('div.hub-logo', { html: label.toUpperCase() }),
      el('div.hub-me', {}, logoCanvas(me.logo, 40), el('div', {}, el('small', { text: `FRANCHISE ${f.year}` }), el('b', { text: `${me.city} ${me.name}` })))),
      el('div.fr-boxgrid', {}, ...items),
      el('div.hub-foot', { html: '<b class="btn A">A</b> Select &nbsp;&nbsp; <b class="btn B">B</b> Back to the hub' }));
    screens.nav.set(items, { spatial: true, onBack: () => this.hub(label) });
  }

  /** Player development: who moved this season (from the two-week development ticks). */
  devScreen() {
    const { screens } = this.ctx;
    const f = this.f, me = this.teams[f.userTeam];
    const rows = me.roster.filter((p) => p.devLog?.some((d) => d.year === f.year)).map((p) => {
      const log = p.devLog.filter((d) => d.year === f.year);
      const start = log[0].from, now = p.ovr;
      return { p, start, now, log };
    }).sort((a, b) => (b.now - b.start) - (a.now - a.start)).map(({ p, start, now, log }) => el('div.st-row', {}, el('span.st-num', { text: p.pos }), el('span.st-num.wide', { text: `${p.first} ${p.last}` }),
      el('span.st-num', { text: `${p.age}` }), el('span.st-num', { text: `${start} → ${now}` }), el('span.st-num.wide', { text: log.map((d) => `wk ${d.week + 1}: ${d.to > d.from ? '+' : ''}${d.to - d.from}`).join(' · ') })));
    screens.frame('stats-screen', el('h1', { text: 'Player Development' }),
      el('div.st-team-filter', { text: 'Young players grow during the season (good games help); veterans can slip late in the year.' }),
      el('div.st-row.st-head', {}, ['POS', 'PLAYER', 'AGE', 'OVR', 'CHANGES'].map((h, i) => el(`span.st-num${i === 1 || i === 4 ? '.wide' : ''}`, { text: h }))),
      el('div.st-table', {}, rows.length ? rows : el('div.st-empty', { text: 'No changes yet this season.' })),
      el('div.setup-help', { html: '<b class="btn B">B</b> back' }));
    screens.nav.set(rows.length ? rows : [el('div')], { columns: 1, onBack: () => this.boxMenu('Team', this._boxes.Team) });
  }

  /** A single season is over: the champion, your finish and where to go next. */
  seasonOver() {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams, me = teams[f.userTeam];
    const h = f.history[f.history.length - 1];
    const champ = teams[h.champion];
    const won = h.champion === f.userTeam;
    const awards = (f.awards?.[f.year] || []).slice(0, 5);
    const tile = (cls, icon, label, sub, action) => {
      const t = el(`div.hub-tile${cls ? '.' + cls : ''}`, {}, el('div.ht-icon', { html: ICONS[icon] }), el('div.ht-text', {}, el('div.ht-label', { text: label }), el('div.ht-sub', { text: sub })));
      t.activate = action;
      return t;
    };
    const tiles = [
      tile('', 'calendar', 'Play Another Season', 'Same team and settings, a new schedule', () => this.newFranchise('season', { userTeam: f.userTeam, weeks: f.weeks, difficulty: f.settings.difficulty, quarterMinutes: f.settings.quarterMinutes })),
      tile('', 'list', 'Final Standings', 'Divisions and records', () => this.standingsScreen()),
      tile('', 'bracket', 'Playoff Bracket', 'How it played out', () => this.bracketScreen()),
      tile('', 'trophy', 'Leaders', 'Season stat leaders', () => this.leadersScreen()),
      tile('', 'star', 'Awards', 'MVP and more', () => awardsScreen(this)),
      tile('', 'trophy', 'Hall of Fame', 'Career history', () => hallScreen(this)),
      tile('', 'exit', 'Main Menu', 'The season is saved', this.ctx.onExit),
    ];
    screens.frame('hub-screen', el('div.hub-top', {}, el('div.hub-logo', { html: `${f.year} <span>SEASON</span>` })),
      el('div.so-banner', { style: { '--tc': champ.colors.primary } }, logoCanvas(champ.logo, 140),
        el('div', {}, el('small', { text: `${f.year} ${LEAGUE.championship}`.toUpperCase() }), el('b', { text: `${champ.city} ${champ.name}` }),
          el('div.so-me', { text: won ? 'That\'s you. Champions!' : `${me.city} ${me.name}: ${h.record}${h.madePlayoffs ? ', made the playoffs' : ', missed the playoffs'}` }),
          awards.length ? el('div.so-awards', {}, awards.map((a) => el('span', { text: `${a.award}: ${a.name} (${a.team})` }))) : null)),
      el('div.fr-saves', {}, tiles),
      el('div.hub-foot', { html: '<b class="btn A">A</b> Select &nbsp;&nbsp; <b class="btn B">B</b> Main menu' }));
    screens.root.style.setProperty('--accent', me.colors.primary);
    screens.nav.set(tiles, { spatial: true, onBack: this.ctx.onExit });
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
  /** Tabs: each conference's divisions, then the playoff picture (seeds 1–7 per conference, NFL style). */
  standingsScreen(tab = this.teams[this.f.userTeam].conference) {
    const { screens } = this.ctx;
    const teams = this.teams, rows = standings(teams, this.f.schedule);
    let body;
    if (tab === 2) body = this.playoffPicture(rows, this.f.playoffs?.seeds || [0, 1].map((c) => seeds(teams, rows, c)), !this.f.playoffs);
    else {
      // Slide 9: four division columns of team-colored rows: seed, logo, abbreviation, record.
      const seedOf = new Map((this.f.playoffs?.seeds?.[tab] || seeds(teams, rows, tab)).map((t, i) => [t, i + 1]));
      body = el('div.sd-grid', {}, DIVISIONS.map((d, di) => {
        const r = rank(rows.filter((x) => teams[x.team].conference === tab && teams[x.team].division === di));
        return el('div.sd-div', {}, el('div.sd-head', { text: `${CONFERENCES[tab]} ${d}`.toUpperCase() }),
          r.map((x) => el(`div.sd-row${x.team === this.f.userTeam ? '.mine' : ''}`, { style: { '--tc': teams[x.team].colors.primary } },
            el('span.sd-seed', { text: seedOf.has(x.team) ? String(seedOf.get(x.team)) : '' }), logoCanvas(teams[x.team].logo, 30),
            el('b.sd-ab', { text: teams[x.team].abbr }), el('span.sd-rec', { text: recText(x) }), el('small.sd-pd', { text: `${x.pf - x.pa >= 0 ? '+' : ''}${x.pf - x.pa}` }))));
      }));
    }
    const back = el('div.start-btn', { text: 'Back' });
    back.activate = () => this.hub();
    const tabs = [...CONFERENCES, 'Playoff Picture'];
    screens.frame('stats-screen', el('h1', { text: 'Standings' }),
      el('div.pc-tabs', {}, tabs.map((c, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: c }))),
      body, back,
      el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> switch &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set([back], { onBack: () => this.hub(), onTab: (d) => this.standingsScreen((tab + d + 3) % 3) });
  }

  /** Seeds 1–7 per conference: 1–4 division winners (1 = the bye), 5–7 wild cards; "if the season ended today". */
  playoffPicture(rows, seedLists, live) {
    const teams = this.teams;
    const byTeam = new Map(rows.map((r) => [r.team, r]));
    return el('div.fr-divs', {}, [0, 1].map((c) => {
      const list = seedLists[c];
      const hunt = live ? rank(rows.filter((r) => teams[r.team].conference === c && !list.includes(r.team))).slice(0, 3) : [];
      const line = (team, label, cls = '') => {
        const r = byTeam.get(team);
        return el(`div.st-row${cls}${team === this.f.userTeam ? '.mine' : ''}`, { style: { borderLeftColor: teams[team].colors.primary } },
          el('span.st-num', { text: label }), el('span.st-name', {}, el('b', { text: `${teams[team].city} ${teams[team].name}` })),
          el('span.st-num', { text: r ? recText(r) : '' }), el('span.st-name.pp-tag', { text: label === '1' ? 'Division winner · bye' : +label <= 4 ? 'Division winner' : label === '–' ? 'In the hunt' : 'Wild card' }));
      };
      return el('div.fr-div', {}, el('div.dc-head', { text: `${CONFERENCES[c]}${live ? ' · if the season ended today' : ''}` }),
        list.map((team, i) => line(team, String(i + 1))), hunt.map((r) => line(r.team, '–', '.pp-out')));
    }));
  }

  // ---------- schedule ----------
  scheduleScreen(week) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams;
    const score = (g) => (g.score ? `${teams[g.away].abbr} ${g.score[1]} – ${g.score[0]} ${teams[g.home].abbr}` : `${teams[g.away].abbr} @ ${teams[g.home].abbr}`);
    const mine = f.schedule.map((wk, i) => {
      const g = wk.find((x) => x.home === f.userTeam || x.away === f.userTeam);
      if (!g) {
        const row = el(`div.st-row${i === week ? '.mine' : ''}`, {}, el('span.st-team', { text: `Wk ${i + 1}` }), el('span.st-name', { text: 'BYE' }), el('span.st-when', { text: '' }), el('span.st-num', { text: '' }));
        row.activate = () => this.scheduleScreen(i);
        return row;
      }
      const home = g.home === f.userTeam;
      const opp = teams[home ? g.away : g.home];
      let res = '';
      if (g.score) { const [a, b] = home ? g.score : [g.score[1], g.score[0]]; res = `${a > b ? 'W' : a < b ? 'L' : 'T'} ${a}-${b}`; }
      const row = el(`div.st-row${i === week ? '.mine' : ''}`, {}, el('span.st-team', { text: `Wk ${i + 1}` }),
        el('span.st-name', { text: `${g.venue ? 'vs' : home ? 'vs' : '@'} ${opp.city} ${opp.name}${g.venue ? ` (${g.venue.city})` : ''}` }),
        el('span.st-when', { text: `${gameWhen(g)}${g.slot ? ` · ${slotName(g)}` : ''}` }), el('span.st-num', { text: res || '—' }));
      row.activate = () => this.scheduleScreen(i);
      return row;
    });
    const results = (f.schedule[week] || []).map((g) => el('div.fr-score', {}, el('span', { text: score(g) }), el('small', { text: ` ${gameWhen(g)}${g.slot ? ` · ${slotName(g)}` : ''}` })));
    screens.frame('stats-screen', el('h1', { text: 'Schedule & Results' }),
      el('div.fr-sched', {}, el('div.st-table', {}, mine), el('div.fr-week', {}, el('div.dc-head', { text: `Week ${week + 1} around the league` }), results)),
      el('div.setup-help', { html: `<b class="btn A">A</b> show that week &nbsp; <b class="btn X">X</b> export schedule.csv${f.week === 0 && f.phase === 'regular' ? ' &nbsp; <b class="btn Y">Y</b> import a schedule (CSV)' : ''} &nbsp; <b class="btn B">B</b> back` }));
    screens.nav.set(mine, { columns: 1, index: week, onBack: () => this.hub('Season') });
    screens.extraButtons = async (fr) => {
      if (fr.pressed.X) downloadFile(`schedule_${f.year}.csv`, exportSchedule(teams, f.schedule), 'text/csv');
      if (fr.pressed.Y && f.week === 0) {
        screens.extraButtons = null;
        const file = await pickFile('.csv,text/csv');
        if (file) {
          const { weeks, skipped } = scheduleFromRows(teams, parseCSV(file.data));
          if (weeks && setSchedule(f, teams, weeks)) { this.save(); window.alert(`Schedule imported: ${weeks.length} weeks${skipped.length ? ` (${skipped.length} rows skipped: ${skipped[0]})` : ''}.`); }
          else window.alert(`Couldn't use that schedule${skipped.length ? `: ${skipped[0]}` : ''}. Columns: week, away, home (team abbreviations).`);
        }
        this.scheduleScreen(0);
      }
    };
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
    screens.frame('stats-screen', el('h1', { text: 'Playoffs' }), this.playoffPicture(standings(teams, f.schedule), f.playoffs.seeds, false), el('div.fr-bracket', {}, rounds), back);
    screens.nav.set([back], { onBack: () => this.hub() });
  }

  // ---------- season stats (same tabs as the end-of-game stats) ----------
  teamStatsScreen(tab = 0, mine = true, sort = null) {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams, t = STAT_TABS[tab];
    sort ||= { col: null, asc: false, cur: 0 };
    // Sortable columns: GP, then the category's own (◀▶ picks one, X sorts by it, X again flips).
    const getters = [(s) => s.gp, ...t.cols.map(([, fn]) => (s) => { const v = fn(s); const n = parseFloat(v); return Number.isFinite(n) ? n : -1e9; })];
    let list = Object.values(f.stats).filter((s) => (!mine || s.teamIdx === f.userTeam) && t.has(s)).sort((a, b) => t.sort(b) - t.sort(a));
    list = sortRows(list, sort, getters);
    const head = el('div.st-row.st-head', {}, el('span.st-team', { text: 'TM' }), el('span.st-name', { text: 'Player' }),
      sortHead(['GP', ...t.cols.map(([c]) => c)], sort, 'span.st-num'));
    const rows = list.map((s) => {
      const tm = teams[s.teamIdx];
      return el('div.st-row', { style: { borderLeftColor: tm?.colors.primary } }, el('span.st-team', { text: s.team }),
        el('span.st-name', {}, el('b', { text: s.name }), el('small', { text: ` ${s.pos}` })),
        [String(s.gp), ...t.cols.map(([, fn]) => String(fn(s)))].map((v, i) => el(`span.st-num${i === sort.col ? '.sorted' : ''}`, { text: v })));
    });
    const empty = el('div.st-empty', { text: 'No stats yet this season.' });
    const go = (d) => this.teamStatsScreen((tab + d + STAT_TABS.length) % STAT_TABS.length, mine);
    screens.frame('stats-screen', el('h1', { text: `${f.year} Season Stats` }),
      el('div.pc-tabs', {}, STAT_TABS.map((x, i) => el(`div.pc-tab${i === tab ? '.on' : ''}`, { text: x.label, onclick: () => go(i - tab) }))),
      el('div.st-team-filter', { text: mine ? `${teams[f.userTeam].city} ${teams[f.userTeam].name}` : 'Whole league' }),
      el('div.st-table', {}, head, rows.length ? rows : empty),
      el('div.setup-help', { html: '<b class="btn LB">LB</b>/<b class="btn RB">RB</b> category &nbsp; ◀▶ column &nbsp; <b class="btn X">X</b> sort by it &nbsp; <b class="btn Y">Y</b> my team / league &nbsp; ▲▼ scroll &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => this.hub(), onTab: go });
    screens.extraButtons = (fr) => {
      if (sortKeys(fr, sort, t.cols.length + 1, () => this.teamStatsScreen(tab, mine, sort))) return;
      if (fr.pressed.Y) this.teamStatsScreen(tab, !mine, sort);
    };
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
  leadersScreen(tab = -1) {
    const { screens } = this.ctx;
    if (tab < 0) { this.leadersOverview(); return; }
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
    screens.nav.set(rows.length ? rows : [empty], { columns: 1, onBack: () => this.hub(), onTab: (d) => { const n = tab + d; this.leadersScreen(n < 0 || n >= cats.length ? -1 : n); } });
  }

  /** League leaders at a glance (slide 9): six categories, top three each with photos; LB/RB into the full lists. */
  leadersOverview() {
    const { screens } = this.ctx;
    const f = this.f, teams = this.teams;
    const byId = new Map(teams.flatMap((t) => t.roster.map((p) => [p.id, p])));
    const CATS = [['Passing Yards', 'passYds', ['CMP', 'passCmp'], ['TD', 'passTD']], ['Sacks', 'sacks', ['TKL', 'tackles'], ['TFL', 'tfl']], ['Rushing Yards', 'rushYds', ['ATT', 'rushAtt'], ['TD', 'rushTD']],
      ['Interceptions', 'defInt', ['TKL', 'tackles'], ['FF', 'ff']], ['Receiving Yards', 'recYds', ['REC', 'rec'], ['TD', 'recTD']], ['Tackles', 'tackles', ['TFL', 'tfl'], ['SACK', 'sacks']]];
    const mine = teams[f.userTeam].abbr;
    const blocks = CATS.map(([label, field, a, b]) => {
      const list = leaders(f, field, 3);
      return el('div.ld-cat', {}, el('div.ld-head', {}, el('span', { text: label.toUpperCase() }), el('small', { text: `${a[0]}   ${b[0]}   ${label.split(' ')[0] === 'Sacks' || label === 'Interceptions' || label === 'Tackles' ? label.slice(0, 3).toUpperCase() : 'YDS'}` })),
        list.length ? list.map((x) => {
          const p = byId.get(x.rid);
          const face = p ? faceImg(p, 'ld-face') : null;
          return el(`div.ld-row${x.team === mine ? '.mine' : ''}`, {}, el('div.ld-pic', {}, face || el('span', { text: p ? String(p.number) : '' })),
            el('div.ld-nm', {}, el('small', { text: `${x.team} · ${x.pos}` }), el('b', { text: x.name.toUpperCase() })),
            el('span.ld-n', { text: String(Math.round(x.s[a[1]] || 0)) }), el('span.ld-n', { text: String(Math.round(x.s[b[1]] || 0)) }), el('b.ld-v', { text: String(Math.round(x.value)) }));
        }) : el('div.ld-empty', { text: 'No games yet' }));
    });
    const back = el('div.start-btn', { text: 'Back' });
    back.activate = () => this.hub();
    screens.frame('stats-screen ld-screen', el('h1', { text: 'League Leaders' }), el('div.ld-grid', {}, blocks), back,
      el('div.setup-help', { html: '<b class="btn RB">RB</b> full lists by category &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set([back], { onBack: () => this.hub(), onTab: (d) => this.leadersScreen(d > 0 ? 0 : 10) });
  }
}
