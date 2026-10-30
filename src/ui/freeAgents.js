// Franchise → Free Agents: sign players without a team during the season (franchise/freeAgents.js). A full roster
// picks someone to release first. X imports a CSV of the current free agents (roster.csv format, team column ignored).
import { el } from './nav.js';
import { signInSeason, inSeasonAsk, setFreeAgents, ROSTER_MAX } from '../franchise/freeAgents.js';
import { payroll } from '../franchise/contracts.js';
import { logTransaction } from '../franchise/franchise.js';
import { parseCSV, freeAgentsFromRows } from '../data/csv.js';
import { pickFile } from '../data/storage.js';

const FILTERS = [
  ['All', null], ['QB', ['QB']], ['RB', ['HB', 'FB']], ['WR', ['WR']], ['TE', ['TE']], ['OL', ['T', 'G', 'C']],
  ['DL', ['DE', 'DT']], ['LB', ['OLB', 'MLB']], ['DB', ['CB', 'FS', 'SS']], ['K/P', ['K', 'P']],
];
const money = (v) => `$${(+v || 0).toFixed(1)}M`;

/** ui = FranchiseUI. note = a status line (signed / problem). */
export function freeAgentsScreen(ui, filter = 0, note = '') {
  const { screens } = ui.ctx;
  const f = ui.f, teams = ui.teams, me = teams[f.userTeam];
  screens.extraButtons = null;
  const [fname, positions] = FILTERS[filter];
  const pool = (f.freeAgents || []).filter((p) => !positions || positions.includes(p.pos));
  const space = f.cap - payroll(me);
  const rows = pool.slice(0, 60).map((p) => {
    const ask = inSeasonAsk(p);
    const r = el(`div.fd-row${ask > space ? '.dim' : ''}`, {},
      el('b.fd-ovr', { text: String(p.ovr) }), el('span.fd-pos', { text: p.pos }), el('span.fd-name', { text: `${p.first} ${p.last}` }),
      el('span.fd-age', { text: `${p.age} yrs` }), el('span.fd-full', { text: money(ask) }));
    r.activate = () => trySign(ui, p, filter);
    return r;
  });
  const empty = el('div.st-empty', { text: pool.length ? '' : 'No free agents here. X imports a CSV of free agents.' });
  screens.frame('hub-screen fd-screen',
    el('div.hub-top', {}, el('div.hub-logo', { html: 'FREE <span>AGENTS</span>' }),
      el('div.fa-cap', { html: `Roster <b>${me.roster.length}/${ROSTER_MAX}</b> &nbsp; Cap space <b>${money(space)}</b>` })),
    note ? el('div.fa-note', { text: note }) : null,
    el('div.fd-board.fa-board', {}, el('div.pc-tabs', {}, FILTERS.map(([n], i) => el(`div.pc-tab${i === filter ? '.on' : ''}`, { text: n }))),
      el('div.fd-list', {}, rows.length ? rows : empty)),
    el('div.hub-foot', { html: `<b class="btn A">A</b> Sign (one-year deal) &nbsp; <b class="btn X">X</b> Import free agents (CSV) &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> ${fname} &nbsp; <b class="btn B">B</b> Back` }));
  screens.root.style.setProperty('--accent', me.colors.primary);
  screens.nav.set(rows.length ? rows : [empty], { onBack: () => { screens.extraButtons = null; ui.hub('Free Agents'); },
    onTab: (d) => freeAgentsScreen(ui, (filter + d + FILTERS.length) % FILTERS.length) });
  screens.extraButtons = (fr) => { if (fr.pressed.X) { screens.extraButtons = null; importCSV(ui, filter); } };
}

function trySign(ui, p, filter, releaseId = null) {
  const f = ui.f, me = ui.teams[f.userTeam];
  const r = signInSeason(f, me, p.id, releaseId);
  if (r.reason === 'roster-full') { releasePicker(ui, p, filter); return; }
  if (!r.ok) { freeAgentsScreen(ui, filter, r.reason); return; }
  logTransaction(f, `${me.abbr} sign ${p.pos} ${p.first} ${p.last} (${money(p.salary)}, 1 yr)${r.released ? `; release ${r.released.pos} ${r.released.first} ${r.released.last}` : ''}`);
  ui.save();
  freeAgentsScreen(ui, filter, `Signed ${p.pos} ${p.first} ${p.last}${r.released ? `, released ${r.released.first} ${r.released.last}` : ''}.`);
}

/** Roster full: pick who goes (your lowest-rated players first, the same position on top). */
function releasePicker(ui, p, filter) {
  const { screens } = ui.ctx;
  const me = ui.teams[ui.f.userTeam];
  const cands = me.roster.filter((q) => !q.career).sort((a, b) => (b.pos === p.pos) - (a.pos === p.pos) || a.ovr - b.ovr).slice(0, 14);
  const rows = cands.map((q) => {
    const r = el('div.fd-row', {}, el('b.fd-ovr', { text: String(q.ovr) }), el('span.fd-pos', { text: q.pos }), el('span.fd-name', { text: `${q.first} ${q.last}` }),
      el('span.fd-age', { text: `${q.age} yrs` }), el('span.fd-full', { text: money(q.salary) }));
    r.activate = () => trySign(ui, p, filter, q.id);
    return r;
  });
  screens.frame('hub-screen fd-screen', el('div.hub-top', {}, el('div.hub-logo', { html: 'MAKE <span>ROOM</span>' })),
    el('div.fa-note', { text: `Your roster is full (${ROSTER_MAX}). Release someone to sign ${p.pos} ${p.first} ${p.last}: he goes to free agency.` }),
    el('div.fd-board.fa-board', {}, el('div.fd-list', {}, rows)),
    el('div.hub-foot', { html: '<b class="btn A">A</b> Release and sign &nbsp; <b class="btn B">B</b> Cancel' }));
  screens.nav.set(rows, { onBack: () => freeAgentsScreen(ui, filter) });
}

async function importCSV(ui, filter) {
  const file = await pickFile('.csv,text/csv');
  if (!file) { freeAgentsScreen(ui, filter); return; }
  const { players, skipped } = freeAgentsFromRows(parseCSV(file.data));
  if (!players.length) { freeAgentsScreen(ui, filter, `No players imported${skipped.length ? `: ${skipped[0]}` : ''}.`); return; }
  setFreeAgents(ui.f, players);
  ui.save();
  freeAgentsScreen(ui, 0, `Imported ${players.length} free agents${skipped.length ? ` (${skipped.length} rows skipped)` : ''}. They replace the old pool.`);
}
