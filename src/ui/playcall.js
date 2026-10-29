import { el } from './nav.js';
import { offenseArt, defenseArt, specialArt } from './playart.js';
import { listOffPlays, listDefPlays, getOffFormation, getDefFormation, getOffPlay, mirrorOffPlay } from '../data/playbook.js';
import { chooseOffense, chooseDefense } from '../ai/playcaller.js';
import { downText, yardLineText, clockText } from '../game/match.js';
import { fgDistance } from '../sim/kicking.js';
import { RNG } from '../core/rng.js';

// Console-style play call: tabs (LB/RB) -> formation -> play. X flips (offense), View = timeout.
export class PlayCallScreen {
  constructor(root, nav) {
    this.root = root;
    this.nav = nav;
    this.open = false;
    this.rng = new RNG(Date.now() % 1e9);
  }

  situationKey(session) {
    const m = session.match;
    return [session.plays, m.phase, m.possession, m.down, Math.round(m.yardLine), session.humanSide].join('|');
  }

  show(session, onPick) {
    this.session = session;
    this.key = this.situationKey(session);
    this.onPick = onPick;
    this.side = session.humanSide;
    this.flipped = false;
    this.tabs = this.buildTabs();
    this.tab = 0;
    // On 4th down / kickoffs / tries, start on special teams.
    const m = session.match;
    const special = this.tabs.findIndex((t) => t.special);
    if (special >= 0 && (m.phase !== 'scrimmage' || (m.down === 4 && this.side === 'offense'))) this.tab = special;
    this.formation = null;
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    this.nav.clear();
  }

  buildTabs() {
    const m = this.session.match;
    const tabs = [];
    if (this.side === 'offense') {
      if (m.phase === 'kickoff') return [{ name: 'Kickoff', special: true, plays: ['st_kickoff', 'st_squib', 'st_onside'].map(getOffPlay) }];
      const sugg = this.suggestions();
      tabs.push({ name: 'Suggested', plays: sugg });
      const fams = new Map();
      for (const p of listOffPlays()) {
        const f = getOffFormation(p.formation);
        if (!fams.has(f.family)) fams.set(f.family, new Map());
        const fm = fams.get(f.family);
        if (!fm.has(p.formation)) fm.set(p.formation, []);
        fm.get(p.formation).push(p);
      }
      for (const [name, forms] of fams) tabs.push({ name, formations: forms });
      const st = [];
      if (m.phase === 'try') st.push(getOffPlay('st_fg'));
      else {
        st.push(getOffPlay('st_punt'));
        if (fgDistance(m.yardLine) <= 66) st.push(getOffPlay('st_fg'));
        st.push(getOffPlay('st_kneel'), getOffPlay('st_spike'));
      }
      tabs.push({ name: m.phase === 'try' ? 'Extra Point' : 'Special Teams', special: true, plays: st });
    } else {
      tabs.push({ name: 'Suggested', plays: this.suggestions() });
      const fams = new Map();
      for (const p of listDefPlays()) {
        const f = getDefFormation(p.formation);
        if (!fams.has(f.family)) fams.set(f.family, new Map());
        const fm = fams.get(f.family);
        if (!fm.has(p.formation)) fm.set(p.formation, []);
        fm.get(p.formation).push(p);
      }
      for (const [name, forms] of fams) tabs.push({ name, formations: forms });
    }
    return tabs;
  }

  suggestions() {
    const m = this.session.match;
    const team = this.session.humanTeam;
    const out = [];
    for (let i = 0; i < 40 && out.length < 6; i++) {
      const p = this.side === 'offense' ? chooseOffense(m, team, this.rng) : chooseDefense(m, team, this.rng, 0.2);
      if (p && !out.includes(p) && !/^st_/.test(p.id)) out.push(p);
    }
    return out;
  }

  render() {
    const s = this.session;
    const m = s.match;
    const tab = this.tabs[this.tab];
    this.root.innerHTML = '';
    const sideLabel = this.side === 'offense' ? 'OFFENSE' : 'DEFENSE';
    const situation = m.phase === 'scrimmage' ? `${downText(m)} · ${yardLineText(m)}` : downText(m);
    const head = el('div.pc-head', {},
      el('div.pc-side', { text: sideLabel }),
      el('div.pc-sit', { text: situation }),
      el('div.pc-tabs', {}, this.tabs.map((t, i) => el(`div.pc-tab${i === this.tab ? '.on' : ''}`, { text: t.name, onclick: () => { this.tab = i; this.formation = null; this.render(); } }))),
      el('div.pc-clock#pc-clock', { text: `${clockText(m.playClock)}` }),
    );
    const help = el('div.pc-help', { html:
      `<b class="btn LB">LB</b>/<b class="btn RB">RB</b> tabs &nbsp; <b class="btn A">A</b> select &nbsp; <b class="btn B">B</b> back` +
      (this.side === 'offense' ? ` &nbsp; <b class="btn X">X</b> flip${this.flipped ? ' (on)' : ''}` : '') +
      (this.side === 'offense' && this.session.lastOffPlay && m.phase === 'scrimmage' ? ` &nbsp; <b class="btn Y">Y</b> no huddle (${this.session.lastOffPlay.name})` : '') +
      ` &nbsp; <b class="btn view">View</b> timeout (${m.timeouts[s.humanTeam]})` });
    const grid = el('div.pc-grid');
    const cards = [];
    if (tab.plays) {
      for (const p of tab.plays) cards.push(this.playCard(p));
    } else if (!this.formation) {
      for (const [fid, plays] of tab.formations) {
        const f = this.side === 'offense' ? getOffFormation(fid) : getDefFormation(fid);
        const art = this.side === 'offense' ? offenseArt({ formation: this.flipped ? mirrorOffPlay(plays[0]).formation : fid, id: 'f:' + fid + (this.flipped ? 'F' : '') }) : defenseArt({ formation: fid, id: 'f:' + fid });
        const card = el('div.pc-card', {}, art, el('div.pc-name', { text: f.name }), el('div.pc-sub', { text: `${plays.length} plays` }));
        card.activate = () => { this.formation = fid; this.render(); };
        cards.push(card);
      }
    } else {
      for (const p of tab.formations.get(this.formation)) cards.push(this.playCard(p));
    }
    grid.append(...cards);
    this.root.append(head, grid, help);
    const back = () => { if (this.formation) { this.formation = null; this.render(); } };
    this.nav.set(cards, {
      columns: Math.max(1, Math.floor((this.root.clientWidth || 1000) / 232)),
      onBack: back,
      onTab: (d) => { this.tab = (this.tab + d + this.tabs.length) % this.tabs.length; this.formation = null; this.render(); },
    });
  }

  playCard(p0) {
    const flip = this.side === 'offense' && this.flipped && !/^st_/.test(p0.id);
    const p = flip ? mirrorOffPlay(p0) : p0;
    let art;
    if (/^st_/.test(p.id)) art = specialArt(p.name);
    else art = this.side === 'offense' ? offenseArt(p) : defenseArt(p);
    const sub = /^st_/.test(p.id) ? (p.type === 'fg' ? `${fgDistance(this.session.match.phase === 'try' ? 85 : this.session.match.yardLine)} yd attempt` : '') : this.side === 'offense' ? `${getOffFormation(p.formation).name} · ${p.concept || p.type}` : `${getDefFormation(p.formation).name}`;
    const card = el('div.pc-card', {}, art, el('div.pc-name', { text: p.name }), el('div.pc-sub', { text: sub }));
    card.activate = () => { const cb = this.onPick; this.hide(); cb(p); };
    return card;
  }

  /** Per frame while open: flip, timeout, live play clock. */
  update(f, dt) {
    if (!this.open) return;
    // The situation changed underneath us (e.g. a penalty or timeout re-opened the call): rebuild.
    if (this.situationKey(this.session) !== this.key) { this.show(this.session, this.onPick); return; }
    if (f.pressed.X && this.side === 'offense') { this.flipped = !this.flipped; this.render(); }
    if (f.pressed.View) { this.session.callTimeout(this.session.humanTeam); this.render(); }
    if (f.pressed.Y && this.side === 'offense' && this.session.noHuddle()) { this.hide(); return; }
    const c = this.root.querySelector('#pc-clock');
    if (c) {
      const pc = Math.ceil(this.session.match.playClock);
      c.textContent = String(pc);
      c.classList.toggle('low', pc <= 10);
    }
    this.nav.update(f, dt);
  }
}
