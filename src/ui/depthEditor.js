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
export function depthChartScreen(screens, team, { energy = null, onDone, onChange = () => {} }) {
  const byId = new Map(team.roster.map((p) => [p.id, p]));
  const who = (p) => `#${p.number} ${p.first[0]}. ${p.last}`;
  const fresh = (p) => {
    if (!energy) return null;
    const e = energy(p.id);
    return el('span.dc-energy', {}, el('i', { style: { width: `${Math.round(e * 100)}%`, background: e > 0.75 ? '#3fbf3f' : e > 0.5 ? '#e8c32c' : '#e0403a' } }));
  };

  function slots(focus = 0) {
    screens.extraButtons = null;
    const cards = Object.keys(DEPTH_SLOTS).map((slot) => {
      const starter = byId.get(team.depth[slot]?.[0]);
      const card = el('div.dc-slot', {},
        el('div.dc-slot-name', { text: slot }),
        el('div.dc-slot-player', { text: starter ? who(starter) : '—' }),
        el('div.dc-slot-sub', { text: starter ? `${SLOT_NAMES[slot]} · ${slotRating(starter, slot)} OVR` : SLOT_NAMES[slot] }));
      card.activate = () => edit(slot);
      return card;
    });
    screens.frame('depth-screen',
      el('h1', { text: `${team.city} ${team.name}: depth chart` }),
      el('div.dc-grid', {}, cards),
      el('div.setup-help', { html: '<b class="btn A">A</b> edit position &nbsp; <b class="btn B">B</b> done' }));
    screens.nav.set(cards, { columns: 6, onBack: () => { screens.extraButtons = null; onDone(); }, index: focus });
  }

  function edit(slot, focusIdx = 0, holding = null) {
    const list = team.depth[slot] || [];
    const rows = [];
    const depthRows = list.map((id, i) => {
      const p = byId.get(id);
      const row = el(`div.dc-row${holding === id ? '.holding' : ''}`, {},
        el('span.dc-rank', { text: String(i + 1) }), el('span.dc-name', { text: who(p) }), el('span.dc-pos', { text: p.pos }),
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
      const row = el('div.dc-row.avail', {},
        el('span.dc-rank', { text: '+' }), el('span.dc-name', { text: who(p) }), el('span.dc-pos', { text: p.pos }),
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
