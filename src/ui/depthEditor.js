import { el } from './nav.js';
import { playerHero } from './rosterEditor.js';
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

  // One screen (the user's reference): positions down the left, the picked position's depth order and the players
  // who could play it on the right, with the starter's header on top. ▲▼ moves, ▶ goes into the order, ◀ back out.
  const SLOTS = Object.keys(DEPTH_SLOTS);
  let cur = 0;
  function slots(focus = 0) { cur = Math.max(0, focus); draw('left'); }
  function edit(slot, focusIdx = 0, holding = null) { cur = SLOTS.indexOf(slot); draw('right', focusIdx, holding); }

  function draw(side = 'left', focusIdx = 0, holding = null) {
    screens.extraButtons = null;
    const slot = SLOTS[cur];
    const left = SLOTS.map((sl, i) => {
      const starter = byId.get(team.depth[sl]?.[0]);
      const it = el(`div.dx-pos${i === cur ? '.on' : ''}${starter && out(starter) ? '.hurt' : ''}`, {},
        el('b', { text: sl }), el('span', { text: starter ? `${starter.first[0]}. ${starter.last}` : '—' }), el('em', { text: starter ? String(slotRating(starter, sl)) : '' }));
      it.onfocusitem = () => { if (i !== cur && !holding) { cur = i; queueMicrotask(() => draw('left')); } };
      it.activate = () => draw('right', 0);
      return it;
    });
    const list = team.depth[slot] || [];
    const row = (p, rank, cls = '') => el(`div.dx-row${cls}${out(p) ? '.hurt' : ''}`, {},
      el('span.dx-rank', { text: rank }), el('span.dx-name', { text: who(p) + hurt(p) }), el('span.dx-c', { text: p.pos }), el('span.dx-c', { text: String(p.age) }),
      el('span.dx-c.ovr', { text: String(slotRating(p, slot)) }), fresh(p) || el('span'));
    const depthRows = list.map((id, i) => {
      const p = byId.get(id);
      const r = row(p, String(i + 1), holding === id ? '.holding' : '');
      r.activate = () => draw('right', i, holding === id ? null : id); // A: pick up / put down
      r.onfocusitem = () => {
        // Moving the stick while holding a player carries him to the new spot.
        if (holding && holding !== id) { placeInDepth(team, slot, holding, i); onChange(); queueMicrotask(() => draw('right', i, holding)); }
      };
      r.removePlayer = () => { removeFromDepth(team, slot, id); onChange(); draw('right', Math.min(i, team.depth[slot].length - 1)); };
      r.navTo = { left: left[cur] };
      return r;
    });
    const avail = eligibleForSlot(team, slot).slice(0, 12).map((p) => {
      const r = row(p, '+', '.avail');
      r.activate = () => { placeInDepth(team, slot, p.id, team.depth[slot]?.length ?? 0); onChange(); draw('right', team.depth[slot].length - 1, p.id); };
      r.navTo = { left: left[cur] };
      return r;
    });
    const right = [...depthRows, ...avail];
    left[cur].navTo = { right: right[0] };
    const starter = byId.get(list[0]);
    const head = el('div.dx-row.dx-head', {}, el('span.dx-rank', { text: '#' }), el('span.dx-name', { text: 'PLAYER' }), el('span.dx-c', { text: 'POS' }),
      el('span.dx-c', { text: 'AGE' }), el('span.dx-c.ovr', { text: 'OVR' }), el('span', { text: energy ? 'ENERGY' : '' }));
    screens.frame('mono-screen dx-screen',
      el('div.dx-top', {}, el('h1', { text: `${team.name} Depth Chart` }),
        inGame ? el('div.dx-note', { text: 'Changes last for this game only. Players marked OUT are skipped automatically.' }) : null),
      el('div.dx-main', {},
        el('div.dx-left', {}, left),
        el('div.dx-right', {}, starter ? playerHero(starter, team) : el('div.dx-empty', { text: SLOT_NAMES[slot] }),
          el('div.dx-title', { text: `${SLOT_NAMES[slot]} (${slot})` }),
          el('div.dx-table', {}, head, el('div.dx-h', { text: 'DEPTH ORDER' }), depthRows, avail.length ? el('div.dx-h', { text: 'AVAILABLE' }) : null, avail))),
      el('div.mm2-bar', { html: holding
        ? '<span>▲▼ MOVE PLAYER</span><span><b class="btn A">A</b> DROP HERE</span>'
        : side === 'left'
          ? `<span><b class="btn A">A</b> EDIT POSITION</span><span><b class="btn X">X</b> PLAY THE BACKUPS</span><span><b class="btn Y">Y</b> ${inGame ? 'STARTERS BACK IN' : 'AUTO (BEST FIRST)'}</span><span><b class="btn B">B</b> DONE</span>`
          : '<span><b class="btn A">A</b> PICK UP / ADD</span><span><b class="btn X">X</b> REMOVE</span><span>◀ POSITIONS</span><span><b class="btn B">B</b> BACK</span>' }));
    const items = [...left, ...right];
    const index = side === 'left' ? cur : left.length + Math.min(focusIdx, right.length - 1);
    screens.nav.set(items, { spatial: true, index: Math.max(0, index),
      onBack: () => (holding ? draw('right', focusIdx) : side === 'right' || screens.nav.index >= left.length ? draw('left') : (screens.extraButtons = null, onDone())) });
    screens.extraButtons = (f) => {
      const onLeft = screens.nav.index < left.length;
      if (!onLeft) { if (f.pressed.X && !holding && depthRows.includes(screens.nav.current)) screens.nav.current.removePlayer(); return; }
      if (!f.pressed.X && !f.pressed.Y) return;
      // Blowouts: X sends the backups in at every position (worst first, kickers and returners untouched); Y puts the
      // best players back on top.
      const backups = !!f.pressed.X;
      for (const sl of SLOTS) {
        if (['K', 'P', 'KR', 'PR'].includes(sl)) continue;
        const ids = [...new Set([...(team.depth[sl] || []), ...eligibleForSlot(team, sl).map((p) => p.id)])].filter((id) => byId.has(id) && !byId.get(id).injury?.ir);
        team.depth[sl] = ids.sort((a, b) => (slotRating(byId.get(a), sl) - slotRating(byId.get(b), sl)) * (backups ? 1 : -1)).slice(0, Math.max(team.depth[sl]?.length || 0, 3));
      }
      onChange();
      draw('left');
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
