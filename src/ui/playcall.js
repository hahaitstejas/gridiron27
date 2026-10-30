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
    this.list = this.groups();
    this.g = 0;
    this.page = 0;
    // On 4th down / kickoffs / tries, start on special teams.
    const m = session.match;
    const special = this.list.findIndex((g) => g.special);
    if (special >= 0 && (m.phase !== 'scrimmage' || (m.down === 4 && this.side === 'offense'))) this.g = special;
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
      if (listOffPlays().some((p) => p.custom)) fams.set('My Plays', new Map()); // the user's plays, right after Suggested
      for (const p of listOffPlays()) {
        const f = getOffFormation(p.formation);
        const fam = p.custom ? 'My Plays' : f.family;
        if (!fams.has(fam)) fams.set(fam, new Map());
        const fm = fams.get(fam);
        if (!fm.has(p.formation)) fm.set(p.formation, []);
        fm.get(p.formation).push(p);
      }
      for (const [name, forms] of fams) tabs.push({ name, formations: forms });
      const st = [];
      if (m.phase === 'try') st.push(getOffPlay('st_fg'));
      else {
        st.push(getOffPlay('st_punt'));
        if (fgDistance(m.yardLine) <= 66) st.push(getOffPlay('st_fg'));
        st.push(getOffPlay('st_fake_punt'), getOffPlay('st_fake_punt_pass'));
        if (fgDistance(m.yardLine) <= 55) st.push(getOffPlay('st_fake_fg'));
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

  /** Flatten tabs into the formation strip: Suggested, My Plays, every formation (grouped by family), special teams. */
  groups() {
    const out = [];
    for (const t of this.tabs) {
      if (t.plays) out.push({ name: t.name, family: t.name, plays: t.plays, special: !!t.special });
      else if (t.name === 'My Plays') out.push({ name: 'My Plays', family: 'My Plays', plays: [...t.formations.values()].flat() });
      else for (const [fid, plays] of t.formations) {
        const f = this.side === 'offense' ? getOffFormation(fid) : getDefFormation(fid);
        out.push({ name: f.name, family: t.name, plays });
      }
    }
    return out.filter((g) => g.plays.length);
  }

  render() {
    const s = this.session;
    const m = s.match;
    this.list ||= this.groups();
    const groups = this.list;
    this.g = Math.max(0, Math.min(groups.length - 1, this.g ?? 0));
    const grp = groups[this.g];
    const pages = Math.max(1, Math.ceil(grp.plays.length / 3));
    this.page = ((this.page ?? 0) % pages + pages) % pages;
    this.root.innerHTML = '';
    const sideLabel = this.side === 'offense' ? 'OFFENSE' : 'DEFENSE';
    const situation = m.phase === 'scrimmage' ? `${downText(m)} · ${yardLineText(m)}` : downText(m);
    const top = el('div.pc2-top', {}, el('div.pc2-side', { text: sideLabel }), el('div.pc2-sit', { text: situation }),
      el('div.pc-clock#pc-clock', { text: `${Math.ceil(m.playClock)}` }));
    // Formation strip (LB / RB), the selected one highlighted and kept in view.
    const pills = groups.map((g, i) => {
      const pill = el(`div.pc2-pill${i === this.g ? '.on' : ''}`, { text: g.name });
      pill.onclick = () => { this.g = i; this.page = 0; this.render(); };
      return pill;
    });
    const strip = el('div.pc2-strip', {}, el('b.btn.LB', { text: 'LB' }), el('div.pc2-pills', {}, pills), el('b.btn.RB', { text: 'RB' }),
      el('div.pc2-count', { text: `${grp.plays.length} PLAYS` }));
    // Three play cards: X / A / Y pick them.
    const W = this.root.clientWidth || window.innerWidth;
    const cw = Math.max(240, Math.min(560, Math.floor((W - 140) / 3)));
    const ch = Math.round(cw * 0.46);
    const cards = grp.plays.slice(this.page * 3, this.page * 3 + 3).map((p, i) => this.playCard(p, ['X', 'A', 'Y'][i], cw, ch));
    this.cards = cards;
    const crumb = el('div.pc2-crumb', { text: `${sideLabel} / ${grp.family} / ${grp.name}`.toUpperCase() });
    const pager = el('div.pc2-pager', { html: pages > 1 ? `◀ ${this.page + 1} / ${pages} ▶` : '' });
    const help = el('div.pc-help', { html:
      `<b class="btn LB">LB</b>/<b class="btn RB">RB</b> formation &nbsp; ◀▶ more plays &nbsp; ▲▼ group &nbsp; <b class="btn X">X</b> <b class="btn A">A</b> <b class="btn Y">Y</b> call play` +
      (this.side === 'offense' ? ` &nbsp; <b class="btn RB">RT</b> flip${this.flipped ? ' (on)' : ''}` : '') +
      (this.side === 'offense' && this.session.lastOffPlay && m.phase === 'scrimmage' ? ` &nbsp; <b class="btn LB">LS</b> no huddle (${this.session.lastOffPlay.name})` : '') +
      ` &nbsp; <b class="btn view">View</b> timeout (${m.timeouts[s.humanTeam]})` });
    this.root.append(top, strip, el('div.pc2-body', {}, crumb, el('div.pc2-cards', {}, cards)), pager, help);
    this.root.querySelector('.pc2-pill.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    this.nav.clear();
  }

  playCard(p0, btn, cw = 400, ch = 180) {
    const flip = this.side === 'offense' && this.flipped && !/^st_/.test(p0.id);
    const p = flip ? mirrorOffPlay(p0) : p0;
    let art;
    if (/^st_/.test(p.id) && !p.fake) art = specialArt(p.name, cw, ch, true);
    else art = this.side === 'offense' ? offenseArt(p, cw, ch, true) : defenseArt(p, cw, ch, true);
    const kind = this.side === 'defense' ? (p.coverage === 'man' ? 'MAN' : 'ZONE') : p.type === 'pass' ? 'PASS' : p.type === 'run' ? 'RUN' : 'KICK';
    const cs = this.session.callStats?.[p0.id.replace(/__flip$/, '')];
    const stats = `${cs?.n || 0} CALLS | ${cs?.n ? (cs.yds / cs.n).toFixed(1) : '0.0'} AVG YDS`;
    const sub = /^st_/.test(p.id) ? (p.type === 'fg' ? `${fgDistance(this.session.match.phase === 'try' ? 85 : this.session.match.yardLine)} yd attempt` : 'Special teams')
      : this.side === 'offense' ? getOffFormation(p.formation).name : getDefFormation(p.formation).name;
    const card = el('div.pc2-card', { style: { width: cw + 'px' } },
      el('div.pc2-art', {}, art, el('div.pc2-meta', {}, el(`span.pc2-kind.${kind.toLowerCase()}`, { text: kind }), el('span.pc2-stats', { text: stats }))),
      el('div.pc2-label', {}, el(`b.btn.${btn}`, { text: btn }), el('div', {}, el('div.pc2-name', { text: p.name.toUpperCase() }), el('div.pc2-sub', { text: sub.toUpperCase() }))));
    card.activate = () => { const cb = this.onPick; this.hide(); cb(p); };
    card.onclick = card.activate;
    return card;
  }

  /** Per frame while open: formation strip, paging, X/A/Y calls, flip, no huddle, timeout, live play clock. */
  update(f, dt) {
    if (!this.open) return;
    // The situation changed underneath us (e.g. a penalty or timeout re-opened the call): rebuild.
    if (this.situationKey(this.session) !== this.key) { this.show(this.session, this.onPick); return; }
    const n = this.list.length;
    if (f.pressed.LB || f.pressed.RB) { this.g = (this.g + (f.pressed.LB ? -1 : 1) + n) % n; this.page = 0; this.render(); return; }
    // Stick / d-pad with repeat: left/right page, up/down jump to the next family of formations.
    let dir = null;
    if (f.down.Left || f.lx < -0.6) dir = 'l'; else if (f.down.Right || f.lx > 0.6) dir = 'r';
    else if (f.down.Up || f.ly < -0.6) dir = 'u'; else if (f.down.Down || f.ly > 0.6) dir = 'd';
    if (dir !== this.held) { this.held = dir; this.repT = 0.38; if (dir) this.step(dir); }
    else if (dir && (this.repT -= dt) <= 0) { this.repT = 0.14; this.step(dir); }
    for (const [i, b] of ['X', 'A', 'Y'].entries()) if (f.pressed[b] && this.cards?.[i]) { this.cards[i].activate(); return; }
    const rt = f.rt > 0.6;
    if (rt && !this.rtHeld && this.side === 'offense') { this.flipped = !this.flipped; this.render(); }
    this.rtHeld = rt;
    if (f.pressed.View) { this.session.callTimeout(this.session.humanTeam); this.render(); }
    if (f.pressed.LS && this.side === 'offense' && this.session.noHuddle()) { this.hide(); return; }
    const c = this.root.querySelector('#pc-clock');
    if (c) {
      const pc = Math.ceil(this.session.match.playClock);
      c.textContent = String(pc);
      c.classList.toggle('low', pc <= 10);
    }
  }

  step(dir) {
    if (dir === 'l' || dir === 'r') { this.page += dir === 'l' ? -1 : 1; this.render(); return; }
    // Up / down: first formation of the previous / next family.
    const fam = this.list[this.g].family;
    const n = this.list.length;
    let i = this.g;
    for (let k = 0; k < n; k++) { i = (i + (dir === 'u' ? -1 : 1) + n) % n; if (this.list[i].family !== fam) break; }
    if (dir === 'u') while (i > 0 && this.list[i - 1].family === this.list[i].family) i--;
    this.g = i; this.page = 0; this.render();
  }
}
