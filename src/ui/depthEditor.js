import { el } from './nav.js';
import { DEPTH_SLOTS, eligibleForSlot, slotRating, placeInDepth, removeFromDepth } from '../data/depthChart.js';

const SLOT_NAMES = {
  QB: 'Quarterback', HB: 'Halfback', FB: 'Fullback', WR: 'Wide receiver', TE: 'Tight end', LT: 'Left tackle', LG: 'Left guard',
  C: 'Center', RG: 'Right guard', RT: 'Right tackle', LE: 'Left end', RE: 'Right end', DT: 'Defensive tackle',
  LOLB: 'Left OLB', MLB: 'Middle LB', ROLB: 'Right OLB', CB: 'Cornerback', FS: 'Free safety', SS: 'Strong safety',
  K: 'Kicker', P: 'Punter', KR: 'Kick returner', PR: 'Punt returner',
};

/**
 * Coaching: depth chart editor for one team (changes apply from the next snap).
 * energy(id) -> 0..1 shows how fresh each player is during a game (optional).
 */
export function depthChartScreen(screens, team, { energy = null, onDone, onChange = () => {}, inGame = false, status = null }) {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const who = (p) => `#${p.number} ${p.first[0]}. ${p.last}`;
  // Why a player isn't playing: hurt today (status(id) from the game: 'OUT' / 'QUES'), or a roster injury.
  const hurt = (p) => {
    const st = status?.(p.id);
    if (st) return ` · ${st}`;
    return p.injury ? ` · INJ ${p.injury.weeks >= 8 ? 'season' : p.injury.weeks > 0 ? p.injury.weeks + ' wk' : 'Q'}` : '';
  };
  const out = (p) => !!status?.(p.id) && status(p.id) !== 'BACK' || (p.injury?.weeks > 0);
  const fresh = (p) => {
    if (!energy) return null;
    const e = energy(p.id);
    return el('span.dc-energy', {}, el('i', { style: { width: `${Math.round(e * 100)}%`, background: e > 0.75 ? '#3fbf3f' : e > 0.5 ? '#e8c32c' : '#e0403a' } }));
  };

  function slots(focus = 0) {
    screens.extraButtons = null;
    const cards = Object.keys(DEPTH_SLOTS).map((slot) => {
      const starter = byId.get(team.depth[slot]?.[0]);
      const card = el(`div.dc-slot${starter && out(starter) ? '.hurt' : ''}`, {},
        el('div.dc-slot-name', { text: slot }),
        el('div.dc-slot-player', { text: starter ? who(starter) + hurt(starter) : '—' }),
        el('div.dc-slot-sub', { text: starter ? `${SLOT_NAMES[slot]} · ${slotRating(starter, slot)} OVR` : SLOT_NAMES[slot] }));
      card.activate = () => edit(slot);
      return card;
    });
    screens.frame('depth-screen',
      el('h1', { text: `${team.city} ${team.name}: depth chart` }),
      inGame ? el('div.league-status', { text: 'Changes made here last for this game only; your saved depth chart is back for the next one. Players marked OUT are skipped automatically.' }) : null,
      el('div.dc-grid', {}, cards),
      el('div.setup-help', { html: `<b class="btn A">A</b> edit position &nbsp; <b class="btn X">X</b> play the backups &nbsp; <b class="btn Y">Y</b> ${inGame ? 'starters back in' : 'auto (best first)'} &nbsp; <b class="btn B">B</b> done` }));
    screens.nav.set(cards, { columns: 6, onBack: () => { screens.extraButtons = null; onDone(); }, index: focus });
    // Blowouts: X sends the backups in at every position (worst first, kickers and returners untouched); Y puts the
    // best players back on top.
    screens.extraButtons = (f) => {
      if (!f.pressed.X && !f.pressed.Y) return;
      const backups = !!f.pressed.X;
      for (const slot of Object.keys(DEPTH_SLOTS)) {
        if (['K', 'P', 'KR', 'PR'].includes(slot)) continue;
        const ids = [...new Set([...(team.depth[slot] || []), ...eligibleForSlot(team, slot).map((p) => p.id)])].filter((id) => byId.has(id) && !byId.get(id).injury?.ir);
        team.depth[slot] = ids.sort((a, b) => (slotRating(byId.get(a), slot) - slotRating(byId.get(b), slot)) * (backups ? 1 : -1)).slice(0, Math.max(team.depth[slot]?.length || 0, 3));
      }
      onChange();
      slots(screens.nav.index);
    };
  }

  function edit(slot, focusIdx = 0, holding = null) {
    const list = team.depth[slot] || [];
    const rows = [];
    const depthRows = list.map((id, i) => {
      const p = byId.get(id);
      const row = el(`div.dc-row${holding === id ? '.holding' : ''}${out(p) ? '.hurt' : ''}`, {},
        el('span.dc-rank', { text: String(i + 1) }), el('span.dc-name', { text: who(p) + hurt(p) }), el('span.dc-pos', { text: p.pos }),
        el('span.dc-ovr', { text: String(slotRating(p, slot)) }), fresh(p));
      row.activate = () => edit(slot, i, holding === id ? null : id); // A: pick up / put down
      row.onfocusitem = () => {
        // Moving the stick while holding a player carries him to the new spot.
        if (holding && holding !== id) { placeInDepth(team, slot, holding, i); onChange(); edit(slot, i, holding); }
      };
      row.removePlayer = () => { removeFromDepth(team, slot, id); onChange(); edit(slot, Math.min(i, team.depth[slot].length - 1)); };
      return row;
    });
    rows.push(...depthRows);
    const avail = eligibleForSlot(team, slot).slice(0, 12).map((p) => {
      const row = el(`div.dc-row.avail${out(p) ? '.hurt' : ''}`, {},
        el('span.dc-rank', { text: '+' }), el('span.dc-name', { text: who(p) + hurt(p) }), el('span.dc-pos', { text: p.pos }),
        el('span.dc-ovr', { text: String(slotRating(p, slot)) }), fresh(p));
      row.activate = () => { placeInDepth(team, slot, p.id, team.depth[slot]?.length ?? 0); onChange(); edit(slot, team.depth[slot].length - 1, p.id); };
      return row;
    });
    rows.push(...avail);
    screens.frame('depth-screen',
      el('h1', { text: `${SLOT_NAMES[slot]} (${slot})` }),
      el('div.dc-list', {}, el('div.dc-head', { text: 'Depth order' }), depthRows, avail.length ? el('div.dc-head', { text: 'Available' }) : null, avail),
      el('div.setup-help', { html: holding
        ? '▲▼ move player &nbsp; <b class="btn A">A</b> drop here'
        : '<b class="btn A">A</b> pick up / add &nbsp; <b class="btn X">X</b> remove &nbsp; <b class="btn B">B</b> back' }));
    screens.nav.set(rows, { columns: 1, index: Math.min(focusIdx, rows.length - 1), onBack: () => (holding ? edit(slot, focusIdx) : slots(Object.keys(DEPTH_SLOTS).indexOf(slot))) });
    // X removes the focused depth row (handled by the app loop through screens.extraButtons).
    screens.extraButtons = (f) => {
      if (f.pressed.X && !holding) depthRows.includes(screens.nav.current) && screens.nav.current.removePlayer();
    };
  }

  slots();
}

/**
 * Pause → Coaching: a small menu (Depth Chart, Injury Center). `game` = { session, team, energy }.
 */
export function coachingScreen(screens, { session, team, energy, onDone }) {
  const t = session.teams[team];
  const status = gameStatus(session, team);
  const item = (label, note, act) => { const it = el('div.pz-item', {}, el('span', { text: label }), el('small', { text: note })); it.activate = act; return it; };
  const menu = () => {
    screens.extraButtons = null;
    const hurtCount = (session.injuries || []).filter((i) => i.team === team && i.status !== 'returned').length + (session.settings.unavailable?.[team] || []).length;
    const items = [
      item('Depth Chart', 'starters and rotation · this game', () => depthChartScreen(screens, t, { energy, onDone: menu, inGame: true, status })),
      item('Injury Center', hurtCount ? `${hurtCount} unavailable` : 'everyone healthy', () => injuryCenter(screens, session, team, menu)),
    ];
    screens.frame('mono-screen pz-screen', el('h1', { text: 'Coaching' }), el('div.pz-main', {}, el('div.pz-list', {}, items), el('div')),
      el('div.setup-help.pz-help', { html: '<b class="btn A">A</b> Select &nbsp; <b class="btn B">B</b> Back' }));
    screens.nav.set(items, { columns: 1, onBack: onDone });
  };
  menu();
}

/** status(id) for the depth chart during a game: 'OUT' / 'QUES' (hurt today, not back yet), 'BACK' (returned), null. */
export function gameStatus(session, team) {
  const map = new Map();
  for (const id of session.settings.unavailable?.[team] || []) map.set(id, 'OUT');
  for (const i of session.injuries || []) if (i.team === team) map.set(i.rid, i.status === 'returned' ? 'BACK' : i.status === 'questionable' ? 'QUES' : 'OUT');
  return (id) => map.get(id) || null;
}

/** Injury Center: today's injuries (both teams) and who was already out before the game (your team). */
export function injuryCenter(screens, session, team, onBack) {
  const rows = [];
  const line = (abbr, p, what, st) => el('div.dc-row.hurt', {}, el('span.dc-rank', { text: abbr }), el('span.dc-name', { text: p }), el('span.dc-pos', { text: what }), el('span.dc-ovr', { text: st }));
  for (const i of session.injuries || []) {
    rows.push(line(session.teams[i.team].abbr, `${i.pos} #${i.number} ${i.name}`, i.part || 'injury',
      i.status === 'returned' ? 'returned' : i.status === 'questionable' ? 'questionable' : 'out'));
  }
  const before = [];
  const t = session.teams[team];
  for (const p of t.roster) {
    if (!p.injury) continue;
    const today = (session.settings.unavailable?.[team] || []).includes(p.id);
    before.push(line(t.abbr, `${p.pos} #${p.number} ${p.first} ${p.last}`, p.injury.name || p.injury.type || 'injury',
      today ? (p.injury.ir ? 'IR' : 'out') : p.injury.weeks > 0 ? `${p.injury.weeks} wk` : 'questionable'));
  }
  const all = [...rows, ...before];
  all.forEach((r) => { r.activate = () => {}; });
  screens.frame('depth-screen', el('h1', { text: 'Injury Center' }),
    el('div.dc-list', {}, el('div.dc-head', { text: 'This game' }), rows.length ? rows : el('div.st-empty', { text: 'No injuries in this game.' }),
      el('div.dc-head', { text: `${t.abbr} injury report` }), before.length ? before : el('div.st-empty', { text: 'Nobody on the injury report.' })),
    el('div.setup-help', { html: 'Hurt players are skipped on the depth chart automatically. &nbsp; <b class="btn B">B</b> back' }));
  const dummy = el('div');
  dummy.activate = () => {};
  screens.nav.set(all.length ? all : [dummy], { columns: 1, onBack });
}
