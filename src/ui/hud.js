import { faceImg } from './faces.js';
import { fgDistance } from '../sim/kicking.js';
import { DRILLS } from '../game/drills.js';
import { crowdNoise } from '../game/penalties.js';
import { KEY_HELP } from '../input/keyboard.js';
import { logoDataURL } from '../render/logo.js';
import { LEAGUE } from '../data/leagueInfo.js';
import { downText, yardLineText, clockText } from '../game/match.js';
import { METER } from '../sim/kicking.js';

const ICON_COLORS = { A: '#3fbf3f', B: '#e0403a', X: '#3a7be0', Y: '#e8c32c', RB: '#9aa0a8' };
const Q = ['', '1st', '2nd', '3rd', '4th', 'OT'];

/** In-game overlays: score bug, banners, penalty flags, ticker, receiver icons, kick meter, help, FPS. */
/** A stat both teams have, picked by how many plays have been run (the scorebug's between-play comparison). */
// Kick meter (the user's reference video): a "J" bar beside the ball: a flat run along the turf from the start (where the
// accuracy press belongs), bending up into a short vertical end (full power, a red cap). Blue to cyan along its length; a white
// needle rides it up for power and back down for accuracy. u = 0..1 along the bar.
const JL = 110, JR = 55, JV = 45, JT = JL + (Math.PI / 2) * JR + JV;
const J = `M 0 0 H ${JL} A ${JR} ${JR} 0 0 0 ${JL + JR} ${-JR} V ${-JR - JV}`;
/** Point and unit tangent at u along the bar. */
function jPt(u) {
  const d = Math.max(0, Math.min(1, u)) * JT;
  if (d <= JL) return { x: d, y: 0, tx: 1, ty: 0 };
  if (d <= JL + (Math.PI / 2) * JR) { const a = (d - JL) / JR; return { x: JL + Math.sin(a) * JR, y: -JR + Math.cos(a) * JR, tx: Math.cos(a), ty: -Math.sin(a) }; }
  return { x: JL + JR, y: -JR - (d - JL - (Math.PI / 2) * JR), tx: 0, ty: -1 };
}
const meterU = (v) => (v - METER.floor) / (1 - METER.floor);
/** A line across the bar at u (half-length h). */
function setTick(el, u, h) { const p = jPt(u); const nx = -p.ty, ny = p.tx; el.setAttribute('x1', p.x - nx * h); el.setAttribute('y1', p.y - ny * h); el.setAttribute('x2', p.x + nx * h); el.setAttribute('y2', p.y + ny * h); }
function setAt(el, u) { const p = jPt(u); el.setAttribute('transform', `translate(${p.x} ${p.y})`); }

function bugStat(m) {
  const S = m.stats?.team; if (!S) return null;
  const opts = [['TOTAL YARDS', (x) => Math.round(x.yards)], ['FIRST DOWNS', (x) => x.firstDowns], ['3RD DOWN', (x) => `${x.thirdConv}/${x.thirdAtt}`],
    ['PASSING YARDS', (x) => Math.round(x.passYds)], ['RUSHING YARDS', (x) => Math.round(x.rushYds)], ['TURNOVERS', (x) => x.turnovers],
    ['SACKS ALLOWED', (x) => x.sacks], ['PENALTIES', (x) => `${x.penalties}-${x.penYds}`]];
  const o = opts[Math.floor(m.playLog.length / 3) % opts.length];
  return { label: o[0], v: [o[1](S[0]), o[1](S[1])] };
}

/** Milestone watch: players closing in on a big game (300 passing, 100 rushing / receiving, 3 TDs, 2 sacks). */
const MILESTONES = [['PASSING YARDS', (s) => s.passYds, 300, 0.5], ['RUSHING YARDS', (s) => s.rushYds, 100, 0.5], ['RECEIVING YARDS', (s) => s.recYds, 100, 0.5],
  ['TOUCHDOWNS', (s) => (s.passTD || 0) + (s.rushTD || 0) + (s.recTD || 0), 3, 0.6], ['SACKS', (s) => s.sacks, 2, 0.5]];
function milestone(m) {
  const list = [];
  for (const s of Object.values(m.stats?.players || {})) {
    for (const [label, f, goal, from] of MILESTONES) {
      const v = Math.round(f(s) || 0);
      if (v >= goal * from && v < goal) {
        const p = m.teams[s.team]?.roster.find((x) => x.id === s.rid);
        if (p) list.push({ label, v, goal, team: s.team, name: `${p.first[0]}. ${p.last}`, pos: p.pos, k: v / goal });
      }
    }
  }
  list.sort((a, b) => b.k - a.k);
  return list.length ? list[Math.floor(m.playLog.length / 4) % list.length] : null;
}

/**
 * The prime-time scorebugs (the user's reference pictures; our own slot marks, no real broadcasters' names or logos). Type is
 * Oswald (big numbers, team letters) and Saira Condensed (everything else); sizes are in vw, authored for a 1280-wide screen.
 *   box    - Sunday night and the big games: two framed team panels (logo, timeout dots, letters, score in a team-color box)
 *            around a framed center (possession arrow + down & distance over quarter / clock / play clock / spot).
 *   slim   - Monday night: one full-width bar, the slot mark in neon outline, team-color bands holding logo / record / letters,
 *            hatched slanted score panels around a possession wedge in the team-with-the-ball's color, then the situation.
 *   shield - Thursday night (also openers, international): solid team-color logo panels at the ends, letters / record and big
 *            scores either side of a metal shield, the situation on a black strip underneath, and the passer's line on a tab.
 */
function primeBug(lay, pk, { m, recs, flag, stat, note, blink, hasBall, logo }) {
  const T = m.teams, tc = (i) => `--tc:${T[i].colors.primary};--tc2:${T[i].colors.secondary}`;
  const ORD = ['', 'ST', 'ND', 'RD', 'TH'];
  const q = m.over ? 'FINAL' : m.quarter > 4 ? 'OT' : `${m.quarter}<i>${ORD[m.quarter]}</i>`;
  const clk = m.over ? '' : clockText(m.clock);
  const pc = m.over || m.phase !== 'scrimmage' ? '' : `:${String(Math.ceil(m.playClock)).padStart(2, '0')}`;
  const low = m.playClock <= 10 ? ' low' : '';
  // The spot: the yard line, the arrow pointing up in your own half and down in the other team's.
  const yl = m.yardLine, own = yl < 50;
  const spot = m.phase === 'scrimmage' && !m.over ? `<span class="pk-tri">${own ? '▲' : '▼'}</span>${Math.round(own ? yl : 100 - yl)}` : '';
  const goal = m.phase === 'scrimmage' && m.toGo >= 100 - m.yardLine - 0.01;
  const dd = m.over ? 'FINAL' : flag ? '<b class="pk-flag">FLAG</b>' : note ? `<b class="pk-note" style="--tc:${m.teams[note.team].colors.primary}">${note.text}</b>` : stat ? `<span class="pk-stat">${stat.label} <b>${stat.v[1]}</b>-<b>${stat.v[0]}</b></span>`
    : m.phase === 'scrimmage' ? `${m.down}<i>${ORD[m.down]}</i> &amp; ${goal ? 'GOAL' : m.toGo < 0.5 ? 'INCHES' : Math.max(1, Math.round(m.toGo))}` : m.phase === 'try' ? 'PAT' : 'KICKOFF';
  const tos = (i, cls) => `<span class="${cls}">${[0, 1, 2].map((k) => `<i class="${k < m.timeouts[i] ? 'on' : blink === i && k === m.timeouts[i] ? 'used' : ''}"></i>`).join('')}</span>`;
  const img = (i) => `<img src="${logo(i)}" alt=""/>`;
  const rec = (i) => `(${recs[i].replace('-', ' - ')})`;
  const words = pk.label.split(' ');
  const mark = pk.mark || words.map((w) => w[0]).join('').slice(0, 3);
  const ball = hasBall(1) ? 1 : hasBall(0) ? 0 : -1;
  if (lay === 'box') {
    const side = (i, right) => `<div class="bx-team${right ? ' right' : ''}" style="${tc(i)}"><div class="bx-logo">${img(i)}</div>
      ${tos(i, 'bx-to')}<b class="bx-ab">${T[i].abbr}</b><div class="bx-sc">${m.score[i]}</div></div>`;
    return `<div class="pk pk-box" style="--pk:${pk.color}">${side(1, false)}
      <div class="bx-mid"><div class="bx-dd">${ball >= 0 ? `<span class="bx-arrow">${ball === 1 ? '◀' : '▶'}</span>` : ''}<span>${dd}</span></div>
      <div class="bx-row"><span class="bx-q">${q}</span><b>${clk}</b><span class="bx-pc${low}">${pc}</span><span>${spot}</span></div></div>${side(0, true)}</div>`;
  }
  if (lay === 'slim') {
    const band = (i, right) => `<div class="sl-band${right ? ' right' : ''}" style="${tc(i)}"><div class="sl-logo">${img(i)}</div>
      <span class="sl-rec"><small>${rec(i)}</small>${tos(i, 'sl-to')}</span><b class="sl-ab">${T[i].abbr}</b></div>`;
    return `<div class="pk pk-slim" style="--pk:${pk.color}"><div class="sl-mark">${mark}</div>${band(1, false)}
      <div class="sl-sc"><b>${m.score[1]}</b></div><div class="sl-pos"${ball >= 0 ? ` style="${tc(ball)}"` : ''}>${ball === 1 ? '◀' : ball === 0 ? '▶' : ''}</div><div class="sl-sc right"><b>${m.score[0]}</b></div>
      ${band(0, true)}<div class="sl-clock"><span class="sl-q">${q}</span><b>${clk}</b>${pc ? `<span class="sl-pc${low}">${pc}</span>` : ''}</div>
      <div class="sl-cut"></div><div class="sl-dd">${dd}</div><div class="sl-cut"></div><div class="sl-spot">${spot}</div></div>`;
  }
  // shield: the passer's line of the team with the ball rides on a tab at the left.
  const off = ball >= 0 ? ball : m.possession;
  const qbl = Object.values(m.stats?.players || {}).filter((x) => x.team === off && x.passAtt > 0).sort((a, b) => b.passAtt - a.passAtt)[0];
  const qbp = qbl && T[off].roster?.find((x) => x.id === qbl.rid);
  const tab = qbp ? `<div class="sh-tab" style="${tc(off)}"><b>${qbp.first[0]}. ${qbp.last}</b><span>${Math.round(qbl.passYds)} YDS&nbsp;&nbsp;${qbl.passTD} TDS&nbsp;&nbsp;${qbl.int} INTS</span></div>` : '';
  const end = (i, right) => `<div class="sh-end${right ? ' right' : ''}" style="${tc(i)}"><div class="sh-logo">${img(i)}</div>${tos(i, 'sh-to')}</div>`;
  const half = (i, right) => `<div class="sh-half${right ? ' right' : ''}" style="${tc(i)}"><div class="sh-ab"><b>${ball === i && !right ? '<i>➤</i>' : ''}${T[i].abbr}</b><small>${rec(i)}</small></div><b class="sh-sc">${m.score[i]}</b></div>`;
  const shield = `<div class="sh-shield"><svg viewBox="0 0 80 92"><defs><linearGradient id="shm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3f4f6"/><stop offset="0.48" stop-color="#a9adb5"/><stop offset="0.55" stop-color="#dfe1e5"/><stop offset="1" stop-color="#7f848d"/></linearGradient></defs>
    <path d="M40 2 L76 12 L76 56 Q72 76 40 90 Q8 76 4 56 L4 12 Z" fill="url(#shm)" stroke="#4d5159" stroke-width="2.5"/>
    <text x="40" y="20" text-anchor="middle" font-family="Saira Condensed, sans-serif" font-weight="700" font-size="7.5" fill="#33363c" letter-spacing="0.5">GRIDIRON</text>
    <text x="40" y="66" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="40" fill="#15171b" textLength="${mark.length > 2 ? 56 : 42}" lengthAdjust="spacingAndGlyphs">${mark}</text></svg></div>`;
  return `<div class="pk pk-shield" style="--pk:${pk.color}">${tab}${end(1, false)}<div class="sh-mid"><div class="sh-top">${half(1, false)}${shield}${half(0, true)}</div>
    <div class="sh-row"><span class="sh-dd">${dd}</span><span class="sh-q">${q}</span><b>${clk}</b><span class="sh-pc${low}">${pc}</span><span class="sh-spot">${spot}</span></div></div>${end(0, true)}</div>`;
}

const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`;

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="scorebug" class="hidden"></div>
      <div id="scoreticker" class="hidden"><div class="stk-label">AROUND THE LEAGUE</div><div class="stk-track"><div class="stk-run"></div></div></div>
      <div id="playname" class="hidden"></div>
      <div id="hint" class="hidden"></div>
      <div id="icons"></div>
      <div id="tags"><div class="tag me"></div><div class="tag other"></div></div>
      <div id="banner" class="hidden"><div class="big"></div><div class="small"></div></div>
      <div id="intro" class="hidden"></div><div id="halfcard" class="hidden"></div><div id="pbp" class="hidden"><span class="pb-tag"></span><span class="pb-text"></span></div><div id="flagbox" class="hidden"><div class="fb-head"><span class="fb-chip">FLAG</span><span class="fb-ref">REFEREE ANNOUNCEMENT</span></div><div class="fb-foul"></div><div class="flagtext"></div></div>
      <div id="ticker"></div><div id="pill" class="hidden"></div><div id="tdband" class="hidden"></div><div id="kickchip" class="hidden"></div>
      <div id="callout"></div>
      <div id="statcard" class="hidden"></div><div id="spotlight" class="hidden"></div><div id="drivecard" class="hidden"></div>
      <div id="audible" class="hidden"></div>
      <div id="penaltybox" class="hidden"></div>
      <div id="reviewbox" class="hidden"></div>
      <div id="injurybox" class="hidden"></div>
      <div id="drillbar" class="hidden"></div>
      <div id="noise" class="hidden"></div><div id="milestone" class="hidden"></div>
      <div id="replay" class="hidden"><div class="rp-badge">REPLAY</div><div class="rp-bar"><div class="rp-fill"></div></div><div class="rp-help"></div></div>
      <div id="celwheel" class="hidden"></div>
      <div id="pushmeter" class="hidden"><div class="pm-bar"><div class="pm-needle"></div></div><div class="pm-label"><b class="btn A">A</b> Snap in the green</div></div>
      <div id="kickmeter" class="hidden"><svg class="km-arc" viewBox="-24 -124 214 152"><defs><linearGradient id="kmg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${JL + JR}" y2="${-JR - JV}"><stop offset="0" stop-color="#173a86"/><stop offset="0.45" stop-color="#2468d8"/><stop offset="0.8" stop-color="#22c8e8"/><stop offset="1" stop-color="#3ff2c4"/></linearGradient></defs>
        <path class="km-track" d="${J}"/><path class="km-fill" d="${J}" stroke="url(#kmg)"/><path class="km-cap" d="${J}" pathLength="100"/>
        <line class="km-top" x1="0" y1="0" x2="0" y2="0"/><line class="km-zone" x1="0" y1="0" x2="0" y2="0"/><line class="km-set" x1="0" y1="0" x2="0" y2="0"/><line class="km-needle" x1="0" y1="0" x2="0" y2="0"/>
        <g class="km-btn"><circle r="11"/><text y="4.5" text-anchor="middle">A</text></g></svg><div class="km-label">KICK</div></div>
      <div id="help" class="hidden"></div>
      <div id="quickstart" class="hidden"></div>
      <div id="fps"></div>
      <div id="playcall" class="hidden"></div>`;
    this.$ = (id) => root.querySelector('#' + id);
    this.icons = {};
    for (const b of Object.keys(ICON_COLORS)) {
      const d = document.createElement('div');
      d.className = 'icon';
      d.textContent = b;
      d.style.background = ICON_COLORS[b];
      this.$('icons').appendChild(d);
      this.icons[b] = d;
    }
    this.buildHelp();
    this.fpsAcc = 0; this.fpsN = 0; this.fpsShow = false;
    this.bannerT = 0; this.flagT = 0; this.statT = 0;
    this._logos = new Map();
  }

  buildHelp() {
    const pad = [
      ['Pre-snap', 'A snap · X audible · Y hot route (receiver button, then stick) · RB motion (receiver button, then stick) · View timeout · (defense) LS walk your player around, B switch player, X audible, LB coverage (press / off / shade)'],
      ['Play call', 'LB/RB tabs · A select · B back · X flip play · View timeout'],
      ['Passing', 'Receiver icons A B X Y RB · tap = lob, hold = bullet · hold LB high / LT low · left stick leads · LS click pump fake · RS click throw away'],
      ['Pass rush (engaged with a blocker)', 'A bull rush (strength) · X swim · Y spin · RS↓ rip (finesse: pass rush, agility) · hold the stick toward the ball for leverage'],
      ['Camera', 'D-pad ◀▶ cycles the camera: standard, wide, tight, overhead, All-22, skycam, end zone, sideline cable cam'],
      ['Pocket', 'LS (no RT) step up / slide / climb in the pocket and still throw on target · RT breaks the pocket'],
      ['Ball carrier', 'RT sprint · RS click switch the ball to the other arm · A stiff arm · B spin · X dive/slide · Y hurdle · RS ←/→ juke · RS ↑ truck · RB protect · LB pitch (speed option) · hold LT at the mesh to keep (zone read) or pull and throw (RPO)'],
      ['At the line (offense)', 'A snap · X audible · Y hot route · RB motion · LB protection (slide left/right, max protect, everyone out) · LT hard count (may draw the defense offside: a free play) · B spike · hold RT to see the play art (one player)'],
      ['Catching (ball in the air)', 'Y aggressive catch (wins in traffic, no run after) · X run after catch (turns upfield, riskier) · B possession (sure hands, feet in at the sideline)'],
      ['At the line (defense)', 'X audible · Y hot route (your player) · LB coverage (press/off, shade, disguise) · RB front (pinch, spread, show blitz, crowd the line)'],
      ['Defense', 'B switch player · RT sprint · A swat · Y with the ball in the air: go for the pick · X dive tackle · Y strip · RS ↑ hit stick · RS ←→↑ rush moves when blocked'],
      ['Kicking', 'A start meter · A set power · A set accuracy (near the line) · left stick aims'],
      ['Kick block', 'Beat the protection to a spot just in front of the holder (punter), then A jump / X lay out as the ball comes off the foot'],
      ['Returns', 'Y fair catch (punts) · X kneel in the end zone'],
      ['Instant replay', 'RS click between plays (or pause menu) · A play/pause · X slow-mo · left stick scrub · right stick camera · LT/RT zoom · B exit'],
    ];
    this.$('help').innerHTML = `<h2>Controls</h2>
      <table>${pad.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <h3>Keyboard</h3><table>${KEY_HELP.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
      <p class="tiny">H toggles this panel · \` toggles FPS</p>`;
  }

  /** Halftime: the two teams side by side (yards, passing, rushing, first downs, third downs, turnovers, possession). */
  halfCard(session) {
    const m = session.match, [h, a] = m.teams, S = m.stats.team;
    const top = (t) => clockText(S[t].top || 0);
    const rows = [['Total yards', (s) => Math.round(s.yards)], ['Passing', (s) => `${s.passCmp}/${s.passAtt}, ${Math.round(s.passYds)}`], ['Rushing', (s) => `${s.rushAtt}-${Math.round(s.rushYds)}`],
      ['First downs', (s) => s.firstDowns], ['Third downs', (s) => `${s.thirdConv}/${s.thirdAtt}`], ['Turnovers', (s) => s.turnovers], ['Penalties', (s) => `${s.penalties}-${s.penYds}`]];
    const el = this.$('halfcard');
    el.innerHTML = `<div class="hc-head"><span style="--tc:${a.colors.primary}"><img src="${this.logoFor(a)}">${a.abbr} <b>${m.score[1]}</b></span><em>HALFTIME</em><span style="--tc:${h.colors.primary}"><b>${m.score[0]}</b> ${h.abbr}<img src="${this.logoFor(h)}"></span></div>` +
      rows.map(([l, f]) => `<div class="hc-row"><b>${f(S[1])}</b><span>${l}</span><b>${f(S[0])}</b></div>`).join('') +
      (S[0].top !== undefined ? `<div class="hc-row"><b>${top(1)}</b><span>Possession</span><b>${top(0)}</b></div>` : '');
    el.classList.remove('hidden');
    this.halfT = 7;
  }

  /** Play-by-play strip above the scorebug (tag: PLAY / DRIVE). A drive summary isn't replaced by the next play line. */
  pbp(tag, text, secs = 4, drive = false) {
    if (!drive && this.pbpDrive > 0) return;
    const el = this.$('pbp');
    el.querySelector('.pb-tag').textContent = tag;
    el.querySelector('.pb-text').textContent = text;
    el.classList.toggle('drive', drive);
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    this.pbpT = secs;
    this.pbpDrive = drive ? secs : 0;
  }

  /** Pregame lower-third: matchup, records, league, conditions (null hides it). */
  intro(info) {
    const el = this.$('intro');
    if (!info) { el.classList.add('hidden'); this._lc?.classList.add('hidden'); return; }
    const team = (t, rec) => `<div class="in-team" style="--tc:${t.colors.primary}"><img src="${this.logoFor(t)}"><div><small>${t.city}</small><b>${t.name}</b>${rec ? `<i>${rec}</i>` : ''}</div></div>`;
    el.style.setProperty('--gold', this.pkg?.color || '#ffd34d');
    // Time-slot package (main.js broadcastPackage): a shield badge over the lower third, our own design.
    const pk = this.pkg, words = pk ? pk.label.split(' ') : [];
    const shield = pk ? `<svg class="in-shield" viewBox="0 0 120 140"><defs><linearGradient id="shg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pk.color}"/><stop offset="1" stop-color="#0b0f1c"/></linearGradient></defs>
      <path d="M60 4 L112 20 L106 84 Q98 116 60 136 Q22 116 14 84 L8 20 Z" fill="url(#shg)" stroke="#fff" stroke-width="4"/>
      <path d="M60 16 L100 28 L95 82 Q88 106 60 122 Q32 106 25 82 L20 28 Z" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
      <text x="60" y="${words.length > 1 ? 66 : 78}" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="${words[0]?.length > 8 ? 15 : 19}" fill="#fff" letter-spacing="1">${words[0] || ''}</text>
      ${words.length > 1 ? `<text x="60" y="92" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="${words.slice(1).join(' ').length > 8 ? 15 : 19}" fill="#fff" letter-spacing="1">${words.slice(1).join(' ')}</text>` : ''}</svg>` : '';
    el.innerHTML = `${shield}<div class="in-top">${info.title}</div><div class="in-row">${team(info.away, info.recs?.[1])}<div class="in-at">AT</div>${team(info.home, info.recs?.[0])}</div>
      <div class="in-sub">${info.sub}</div><div class="in-skip"><b class="btn A">A</b> Skip</div>`;
    el.classList.remove('hidden');
  }

  /** Lower-third line during the intro shots (run-out, coach, crowd). */
  introCaption(text) {
    const el = this.$('intro');
    let c = el.querySelector('.in-cap');
    if (!c) { c = document.createElement('div'); c.className = 'in-cap'; el.appendChild(c); }
    c.textContent = text || '';
    c.style.display = text ? 'block' : 'none';
  }

  /** Pregame lower-third cards over the intro shots (Game Play 9 reference, our own design): the home head coach (name,
   *  seasons, record) and the starting quarterback (photo, bio, a few ratings). null hides it. */
  introCard(kind, team, info = {}) {
    const el = this.$('intro');
    let c = el.querySelector('.in-card');
    if (!c) { c = document.createElement('div'); c.className = 'in-card'; el.appendChild(c); }
    el.classList.toggle('carded', !!kind);
    if (!kind) { c.style.display = 'none'; return; }
    c.style.setProperty('--tc', team.colors.primary);
    c.innerHTML = '';
    const logo = document.createElement('img'); logo.src = this.logoFor(team); logo.className = 'ic-logo';
    const txt = document.createElement('div'); txt.className = 'ic-txt';
    const line = (tag, text) => { const e = document.createElement(tag); e.textContent = text; txt.append(e); };
    if (kind === 'coach') {
      line('small', `${team.city} ${team.name} · HEAD COACH`.toUpperCase());
      line('b', (info.name || 'Head Coach').toUpperCase());
      line('span', [info.seasons ? `${ordinal(info.seasons)} season as head coach` : '', info.record ? `Record ${info.record}` : ''].filter(Boolean).join(' · '));
      c.append(logo, txt);
    } else {
      const p = info.p, face = p && faceImg(p, 'ic-face');
      line('small', `${team.name} · STARTING QUARTERBACK`.toUpperCase());
      line('b', p ? `${p.first} ${p.last}`.toUpperCase() : 'QUARTERBACK');
      line('span', p ? [`#${p.number}`, p.age ? `Age ${p.age}` : '', p.college || ''].filter(Boolean).join(' · ') : '');
      const nums = document.createElement('div'); nums.className = 'ic-nums';
      for (const [k, v] of info.nums || []) { const d = document.createElement('div'); d.innerHTML = `<b>${v}</b><small>${k}</small>`; nums.append(d); }
      txt.append(nums);
      const ph = document.createElement('div'); ph.className = 'ic-photo'; if (face) ph.append(face);
      c.append(ph, txt, logo);
    }
    c.style.display = 'flex';
  }

  /** First game in a browser: a small quick-start card (the essentials, controller and keyboard). */
  quickstart(on) {
    const el = this.$('quickstart');
    if (on) el.innerHTML = `<b>QUICK START</b><table>
      <tr><th></th><th>Controller</th><th>Keyboard</th></tr>
      <tr><td>Move</td><td>Left stick</td><td>W A S D</td></tr>
      <tr><td>Sprint</td><td>RT</td><td>Shift</td></tr>
      <tr><td>Pick play / snap</td><td>A</td><td>J or Space</td></tr>
      <tr><td>Throw</td><td>receiver's button</td><td>J K U I O</td></tr>
      <tr><td>Switch defender</td><td>B</td><td>K</td></tr>
      <tr><td>Juke / truck</td><td>Right stick</td><td>Arrows</td></tr>
      <tr><td>Pause</td><td>Menu</td><td>Esc</td></tr></table>
      <small>All controls: H · this card hides after a few plays</small>`;
    el.classList.toggle('hidden', !on);
  }

  toggleHelp(force) { this.$('help').classList.toggle('hidden', force === undefined ? undefined : !force); }
  hideAll() { for (const id of ['scorebug', 'playname', 'hint', 'banner', 'flagbox', 'intro', 'pbp', 'halfcard', 'kickmeter', 'pushmeter', 'celwheel', 'statcard', 'audible', 'penaltybox', 'reviewbox', 'injurybox', 'drillbar', 'noise', 'milestone', 'spotlight', 'drivecard', 'scoreticker']) this.$(id).classList.add('hidden'); for (const i of Object.values(this.icons)) i.style.display = 'none'; for (const t of this.root.querySelectorAll('.tag')) t.style.display = 'none'; this.$('ticker').innerHTML = ''; for (const e of [this._tdt, this._lc]) e?.classList.add('hidden'); }

  leagueLogo() {
    const l = LEAGUE.logo;
    const key = ['league', l.shape, l.text, l.bg, l.fg, l.border, l._img ? l._img.src.length + l._img.src.slice(-16) : ''].join('|');
    if (!this._logos.has(key)) this._logos.set(key, logoDataURL(l, 48, false));
    return this._logos.get(key);
  }

  logoFor(team) {
    const l = team.logo;
    const key = [team.id, l.shape, l.text, l.bg, l.fg, l.border, l._img ? l._img.src.length + l._img.src.slice(-16) : ''].join('|');
    if (!this._logos.has(key)) this._logos.set(key, logoDataURL(team.logo, 64));
    return this._logos.get(key);
  }

  /** Show a match/session message as banner, flag, or ticker line. */
  message(msg, session) {
    const k = msg.kind;
    if (k === 'score') {
      const what = session.match.lastScore?.what || 'Score';
      const big = /touchdown|pick six/i.test(what) ? (/pick six/i.test(what) ? 'PICK SIX!' : 'TOUCHDOWN!') : /field goal/i.test(what) ? 'FIELD GOAL' : /safety/i.test(what) ? 'SAFETY' : /PAT/.test(what) ? 'EXTRA POINT' : /2-point/.test(what) ? 'TWO-POINT CONVERSION' : what.toUpperCase();
      const st0 = session.match.lastScore?.team;
      if (/TOUCHDOWN|PICK SIX/.test(big) && session.teams[st0]) {
        // Game Play 9 reference: a full-screen TOUCHDOWN title, then the scorer's card (sped-up / headless games keep the band).
        const sim = session.sim, c = sim && sim.ball.carrier >= 0 ? sim.players[sim.ball.carrier] : null;
        const rp = c && session.teams[c.team]?.roster?.find((q) => q.id === c.rid);
        if (!session.fast && rp && c.team === st0) this.tdTitle(session.teams[st0], rp, big.replace(/!$/, ''));
        else this.tdBand(session.teams[st0], big.replace(/!$/, ''));
      }
      else this.banner(big, msg.text.replace(/^[^!]*!\s*/, ''), 2.6, 'score');
      // The scorebug's middle turns into the scoring team's TOUCHDOWN / FIELD GOAL bar for a few seconds (slide 6).
      const st = session.match.lastScore?.team;
      if (st !== undefined && !/PAT|2-point/.test(what)) { this.bugTake = { text: big.replace(/!$/, ''), team: st, until: performance.now() + 5000 }; this._bugKey = null; }
    } else if (k === 'turnover' && !this.prefs?.resultText && !/downs/.test(msg.text)) { /* interception / fumble: the freeze, camera swing and crowd show it */ }
    else if (k === 'turnover') this.banner(/Intercept/.test(msg.text) ? 'INTERCEPTED!' : /downs/.test(msg.text) ? 'TURNOVER ON DOWNS' : 'FUMBLE!', msg.text, 2.4, 'turnover');
    else if (k === 'penalty') this.flag(msg.text);
    else if (k === 'miss') this.banner('NO GOOD', msg.text, 2, 'miss');
    else if (k === 'timeout') {
      // Timeouts are loud: a team-colored banner and that team's timeout bars blink on the scorebug.
      const t = session.teams[msg.team];
      this.banner('TIMEOUT', `${t ? `${t.city} ${t.name}` : ''} · ${msg.left} left`, 2.8, 'timeout');
      const b = this.$('banner');
      if (t) b.style.setProperty('--tc', t.colors.primary);
      this.toBlink = { team: msg.team, until: performance.now() + 4000 };
      this._bugKey = null;
    } else if (k === 'injury') this.banner('INJURY', msg.text.replace(/^Injury: /, ''), 2.6, 'miss');
    else if (k === 'final') this.banner('FINAL', msg.text, 99, 'final');
    else if (k === 'half' || k === 'twoMinute') {
      // Halftime: a human game gets the full halftime report screen (main.js); CPU-only games get the quick card.
      if (k === 'half' && /half/i.test(msg.text) && !session.practice) { if (session.humanTeam === null) this.halfCard(session); return; }
      this.banner(k === 'half' ? msg.text.split('!')[0].toUpperCase() : 'TWO-MINUTE WARNING', k === 'half' ? msg.text : '', 2.4, 'info');
    } else if (k !== 'drive') this.ticker(msg.text); // drive summaries live in Pause → Play History
  }

  /** Pre-snap read (offense, while RT play art is up): the QB's guess at the coverage and how sure he is. */
  readout(read) {
    let e = this._read;
    if (!e) { e = this._read = document.createElement('div'); e.id = 'readout'; this.$('hint').parentNode.appendChild(e); }
    if (!read) { e.classList.add('hidden'); return; }
    const pct = Math.round(read.confidence * 100);
    const key = read.text + pct;
    if (e._key !== key) { e._key = key; e.innerHTML = `<small>QB READ</small><b>${read.text}</b><span class="rd-bar"><i style="width:${pct}%"></i></span><em>${pct}% sure</em>`; }
    e.classList.remove('hidden');
  }

  banner(big, small, secs = 2.2, cls = '') {
    const b = this.$('banner');
    b.className = cls;
    b.querySelector('.big').textContent = big;
    b.querySelector('.small').textContent = small || '';
    b.classList.remove('hidden');
    this.bannerT = secs;
  }

  flag(text) {
    // "Holding, offense, #72. 10 yard penalty, repeat 3rd down" → foul name / who + enforcement, read out like the referee.
    const f = this.$('flagbox');
    const [first, ...rest] = text.split('. ');
    const [foul, ...who] = first.split(', ');
    f.querySelector('.fb-foul').textContent = foul;
    f.querySelector('.flagtext').textContent = [who.join(' '), rest.join('. ')].filter(Boolean).join(' · ');
    f.classList.toggle('declined', /declined/.test(text));
    f.classList.remove('hidden');
    f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
    this.flagT = 4.2;
  }

  placeTag(el, p, renderer, session) {
    if (!p) { el.style.display = 'none'; return; }
    const s = renderer.project(p.x, 0, p.z);
    if (!s.visible) { el.style.display = 'none'; return; }
    const text = `#${p.number} ${p.name}`;
    if (el.textContent !== text) el.textContent = text;
    el.style.borderColor = session.teams[p.team].colors.primary;
    el.style.display = 'block';
    // Never under the score bug at the bottom of the screen.
    // The score bug's top is measured once per HUD update (update()), not here: reading layout right after the
    // previous tag's style writes forced a full page layout for every tag, every frame.
    const bugTop = this._bugTop || innerHeight;
    const y = Math.min(s.y + 10, bugTop - 30);
    el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(y)}px) translateX(-50%)`;
  }

  /**
   * Hold-RT play art (slide 4): last names under your eleven and a down & distance / play clock badge by the ball.
   * Elements are pooled; text is only rewritten when it changes (no per-frame layout work).
   */
  artOverlay(sim, renderer, session, names = true) {
    if (!this._art) {
      const box = document.createElement('div');
      box.id = 'artlayer';
      this.root.append(box);
      this._art = { box, names: [], dd: Object.assign(document.createElement('div'), { className: 'art-dd' }) };
      box.append(this._art.dd);
    }
    const A = this._art;
    if (!sim) { A.box.style.display = 'none'; return; }
    A.box.style.display = 'block';
    const team = session.humanTeam;
    // Skill players and the QB (linemen bunch up and their names would pile on each other).
    const mine = names ? sim.players.filter((p) => p.team === team && !['T', 'G', 'C', 'DT'].includes(p.pos)) : [];
    while (A.names.length < mine.length) { const d = document.createElement('div'); d.className = 'art-name'; A.box.append(d); A.names.push(d); }
    const bugTop = this._bugTop || innerHeight;
    A.names.forEach((d, i) => {
      const p = mine[i];
      if (!p) { d.style.display = 'none'; return; }
      const s = p && renderer.project(p.x, 0, p.z);
      if (!p || !s.visible) { d.style.display = 'none'; return; }
      const words = (p.name || '').split(' ').filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w));
      const last = (words.slice(-1)[0] || '').toUpperCase();
      if (d.textContent !== last) d.textContent = last;
      d.style.display = 'block';
      d.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(Math.min(s.y + 8, bugTop - 24))}px) translateX(-50%)`;
    });
    // Badge: just behind the ball on the side away from the camera's center line.
    const m = session.match;
    const ord = ['', 'st', 'nd', 'rd', 'th'][m.down] || 'th';
    const html = `<div class="ad-dd">${m.down}<sup>${ord}</sup><small>&amp;</small>${m.yardLine + m.toGo >= 100 ? 'GOAL' : Math.round(m.toGo)}</div><div class="ad-pc">:${String(Math.ceil(m.playClock)).padStart(2, '0')}</div>`;
    if (A.dd._h !== html) { A.dd._h = html; A.dd.innerHTML = html; }
    const s = renderer.project(sim.losX - sim.dir * 4.5, 0, sim.ballZ - 6);
    A.dd.style.display = s.visible ? 'block' : 'none';
    A.dd.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(Math.min(s.y, bugTop - 90))}px) translate(-100%, -50%) skewX(-12deg)`;
  }

  /**
   * Replay bumper (slide 5): chevron stripes in the two teams' colors sweep in around a GRIDIRON 27 card and out again,
   * covering the cut into and out of an instant replay. Lives on <body> so hideAll() can't cut it short.
   */
  wipe(c1 = '#173a8a', c2 = '#c8102e') {
    let w = document.getElementById('wipe');
    if (!w) {
      w = document.createElement('div');
      w.id = 'wipe';
      w.innerHTML = `<div class="wp-top"></div><div class="wp-bot"></div><div class="wp-card"><span>GRIDIRON</span><img alt=""/><span>27</span></div>`;
      document.body.append(w);
    }
    w.querySelector('img').src = this.leagueLogo();
    w.style.setProperty('--c1', c1);
    w.style.setProperty('--c2', c2);
    w.classList.remove('go'); void w.offsetWidth; w.classList.add('go');
  }

  /** Instant replay overlay (null hides it). */
  replayView(r) {
    const el = this.$('replay');
    if (!r) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.rp-fill').style.width = `${(100 * r.t) / Math.max(0.01, r.duration)}%`;
    const help = r.auto ? `<b class="btn A">A</b> / <b class="btn B">B</b> Skip replay` : `<b class="btn A">A</b> ${r.playing ? 'Pause' : 'Play'} &nbsp; <b class="btn X">X</b> ${r.speed < 1 ? 'Normal speed' : 'Slow-mo'} &nbsp; <b class="btn Y">Y</b> Restart &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> Angle: ${r.angle || 'Broadcast'} &nbsp; Left stick ◀▶ scrub &nbsp; Right stick camera &nbsp; LT/RT zoom &nbsp; <b class="btn B">B</b> Exit`;
    const h = el.querySelector('.rp-help');
    if (h.dataset.v !== help) { h.dataset.v = help; h.innerHTML = help; }
  }

  /** Post-play card: the players who made the play and their totals this game. */
  /** Player spotlight lower third (big plays): photo on the team color, POS #, name, this play's line. ~2.8 s. */
  spotlight(l, teams) {
    const el = this.$('spotlight'), t = teams[l.team];
    const face = faceImg(t.roster?.find((q) => q.id === l.rid));
    el.innerHTML = `<div class="sp-photo" style="--tc:${t.colors.primary}"></div><div class="sp-text"><small>${t.abbr} · ${l.pos} #${l.number}</small><b></b><span></span></div><div class="sp-logo" style="--tc:${t.colors.primary}"><img src="${this.logoFor(t)}" alt=""/></div>`;
    el.querySelector('b').textContent = l.name.toUpperCase();
    el.querySelector('span').textContent = l.line;
    if (face) el.querySelector('.sp-photo').appendChild(face);
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._spT); this._spT = setTimeout(() => el.classList.add('hidden'), 2800);
    this.$('statcard').classList.add('hidden'); // the spotlight carries the line this time
  }

  statCard(lines, teams) {
    const el = this.$('statcard');
    if (!lines?.length || this.prefs?.statCard === false) { el.classList.add('hidden'); return; }
    el.innerHTML = '';
    for (const l of lines) {
      const t = teams[l.team];
      const row = document.createElement('div');
      row.className = 'sc-row';
      row.style.borderLeftColor = t.colors.primary;
      const who = document.createElement('div');
      who.className = 'sc-who';
      who.innerHTML = `<b></b><span></span>`;
      who.querySelector('b').textContent = `#${l.number} ${l.name}`;
      who.querySelector('span').textContent = `${t.abbr} ${l.pos}`;
      const face = faceImg(t.roster?.find((q) => q.id === l.rid));
      if (face) { face.classList.add('sc-face'); row.appendChild(face); }
      const line = document.createElement('div');
      line.className = 'sc-line';
      line.textContent = l.line;
      row.append(who, line);
      el.appendChild(row);
    }
    el.classList.remove('hidden');
    this.statT = 4;
  }

  /** Big quick call-out of what just happened to a pass (CAUGHT / INTERCEPTED / DROPPED / INCOMPLETE ...). */
  callout(word, sub, color = '#ffffff', ms = 1600) {
    const c = this.$('callout');
    c.innerHTML = `<div class="co-word" style="--cc:${color}">${word}</div>${sub ? `<div class="co-sub">${sub}</div>` : ''}`;
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    clearTimeout(this._coT);
    this._coT = setTimeout(() => c.classList.remove('show'), ms);
    this.calloutAt = performance.now();
  }

  /** Touchdown lower third: a full-width band in the scoring team's color, its name over a giant TOUCHDOWN. */
  /**
   * Touchdown cutscene overlay (Game Play 9 reference, our own design): ~2.2 s of a huge chrome TOUCHDOWN title between the team's
   * logos over the darkened celebration, then ~2.6 s of the scorer's card (team-color streaks, first name thin, LAST bold, POS #,
   * photo / drawn portrait). The 3D celebration keeps playing underneath.
   */
  tdTitle(team, p, word = 'TOUCHDOWN') {
    const el = (this._tdt ||= (() => { const d = document.createElement('div'); d.id = 'tdtitle'; d.className = 'hidden'; this.root.append(d); return d; })());
    const logo = this.logoFor(team), tc = team.colors?.primary || '#1f3a8a', tc2 = team.colors?.secondary || '#111';
    const face = faceImg(p, 'tt-face');
    el.style.setProperty('--tc', tc); el.style.setProperty('--tc2', tc2);
    el.innerHTML = `<div class="tt-title"><img src="${logo}" alt=""/><b data-w="${word}">${word}</b><img src="${logo}" alt=""/></div>
      <div class="tt-card"><div class="tt-bg"><img src="${logo}" alt=""/></div><div class="tt-city">${(team.city || '').toUpperCase()} ${(team.name || '').toUpperCase()}</div>
        <div class="tt-id"><small></small><b></b><span>${p.pos} #${p.number}</span></div><div class="tt-photo"></div></div>`;
    el.querySelector('.tt-id small').textContent = (p.first || '').toUpperCase();
    el.querySelector('.tt-id b').textContent = (p.last || '').toUpperCase();
    if (face) el.querySelector('.tt-photo').append(face);
    el.classList.remove('hidden', 'card'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._ttA); clearTimeout(this._ttB);
    this._ttA = setTimeout(() => el.classList.add('card'), 2200);
    this._ttB = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('show', 'card'); }, 4900);
  }

  /** Pregame team card (Game Play 9 reference, our own design): a team-color wipe with the logo and the name, ~1.9 s, as the
   *  home team runs out. */
  logoCard(team) {
    const el = (this._lc ||= (() => { const d = document.createElement('div'); d.id = 'logocard'; d.className = 'hidden'; this.root.append(d); return d; })());
    el.style.setProperty('--tc', team.colors?.primary || '#1f3a8a'); el.style.setProperty('--tc2', team.colors?.secondary || '#111');
    el.innerHTML = `<div class="lc-bg"></div><img src="${this.logoFor(team)}" alt=""/><div class="lc-name"><small></small><b></b></div>`;
    el.querySelector('small').textContent = (team.city || '').toUpperCase();
    el.querySelector('b').textContent = (team.name || '').toUpperCase();
    el.classList.remove('hidden'); void el.offsetWidth;
    clearTimeout(this._lcT); this._lcT = setTimeout(() => el.classList.add('hidden'), 1900);
  }

  tdBand(team, word = 'TOUCHDOWN') {
    const b = this.$('tdband');
    b.style.setProperty('--tc', team.colors?.primary || '#1f3a8a');
    b.innerHTML = `<div class="tdb-team">${(team.city + ' ' + team.name).toUpperCase()}</div><div class="tdb-word">${word}</div>`;
    b.classList.remove('hidden', 'show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this._tdT); this._tdT = setTimeout(() => b.classList.add('hidden'), 3400);
  }

  /** Zone names over the defensive play art (projected to the screen). */
  zoneLabels(zones, renderer) {
    const box = (this._zl ||= (() => { const d = document.createElement('div'); d.id = 'zonelabels'; this.root.append(d); return d; })());
    const list = zones || [];
    while (box.children.length < list.length) box.append(document.createElement('div'));
    [...box.children].forEach((d, i) => {
      const z = list[i];
      const s = z && renderer.project(z.x, 0, z.z);
      if (!z || !z.label || !s.visible) { d.style.display = 'none'; return; }
      if (d.textContent !== z.label) d.textContent = z.label;
      d.style.display = 'block';
      d.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -50%)`;
    });
  }

  /** Top-right callout pill with the button that did it (catch type, going for the pick...). */
  pill(text, btn, color = '#2fbf5a', ms = 1500) {
    const p = this.$('pill');
    p.style.setProperty('--pc', color);
    p.innerHTML = `<span>${text}</span>${btn ? `<b class="btn ${btn}">${btn}</b>` : ''}`;
    p.classList.remove('hidden', 'show'); void p.offsetWidth; p.classList.add('show');
    clearTimeout(this._pillT); this._pillT = setTimeout(() => p.classList.add('hidden'), ms);
  }

  ticker(text) {
    const t = this.$('ticker');
    const d = document.createElement('div');
    d.className = 'tick';
    d.textContent = text;
    t.prepend(d);
    setTimeout(() => d.remove(), 3500);
    while (t.children.length > 3) t.lastChild.remove();
  }

  /** Update everything that depends on the game state. */
  update(session, renderer, dt, frameMs, playcallOpen) {
    // Catch-type / go-for-the-pick confirmation pill (top right).
    const bl = session.sim?.ball;
    const ct = bl && bl.state === 'air' ? (bl.catchType || (bl.pickT ? 'pick' : null)) : null;
    if (ct && ct !== this._ct) {
      const P = { aggressive: ['AGGRESSIVE CATCH!', 'Y', '#e0a01a'], rac: ['RUN AFTER CATCH!', 'X', '#2a7bff'], possession: ['POSSESSION CATCH!', 'B', '#2fbf5a'], pick: ['GOING FOR THE PICK!', 'Y', '#e04a3a'] }[ct];
      if (P) this.pill(P[0], P[1], P[2]);
    }
    this._ct = ct;
    // Field goal chip (bottom left) while lining up a kick: "ABR 42 YARD FG".
    const ks = session.sim;
    const fgOn = ks && ks.state === 'presnap' && session.state === 'presnap' && !playcallOpen && (ks.offPlay?.type === 'fg' || (ks.fakeLook && ks.offPlay?.fake === 'fg'));
    const kc = this.$('kickchip');
    kc.classList.toggle('hidden', !fgOn);
    if (fgOn) {
      const m = session.match, t = session.teams[m.possession];
      // Panel over the chip: kicker and the wind as the kicker sees it (arrow: up = toward the posts).
      const k = ks.players.find((p) => p.team === ks.offIdx && p.slot === 'K');
      const w = ks.wind || { x: 0, z: 0 };
      const mph = Math.round(Math.hypot(w.x, w.z) * 2.045);
      const deg = Math.round(Math.atan2(w.z * ks.dir, w.x * ks.dir) * 180 / Math.PI);
      const wind = mph < 3 ? '<b>CALM</b>' : `<svg class="kc-arrow" viewBox="-10 -10 20 20" style="transform:rotate(${deg}deg)"><path d="M0 -8 L6 0 L2 0 L2 8 L-2 8 L-2 0 L-6 0 Z"/></svg><b>${mph}<small> MPH</small></b>`;
      const html = `<div class="kc-panel"><div class="kc-top">${m.phase === 'try' ? 'EXTRA POINT' : 'FIELD GOAL'}</div>
        <div class="kc-rows"><div><small>KICKER</small><b>${k ? `${k.name}` : '—'}</b></div><div class="kc-wind"><small>WIND</small><span>${wind}</span></div><div class="kc-aim"><small>AIM KICK</small><b class="btn LS">LS</b></div></div></div>
        <div class="kc-chip"><span class="kc-abbr" style="--tc:${t?.colors?.primary || '#333'}">${t?.abbr || ''}</span>${fgDistance(m.phase === 'try' ? 85 : m.yardLine)} YARD ${m.phase === 'try' ? 'PAT' : 'FG'}</div>`;
      if (kc._h !== html) { kc._h = html; kc.innerHTML = html; }
    }
    this._bugTop = this.$('scorebug').getBoundingClientRect().top; // read layout before this frame's writes
    const m = session.match;
    const sim = session.sim;
    this.renderBug(session);
    // Scoring drive card (Game Play 9 reference): after a TD / FG, while the teams set up for the kickoff: team logo,
    // SCORING DRIVE, plays / yards / time, ~5 s.
    const dc = this.$('drivecard');
    if (this.pendingDrive && m.phase === 'kickoff' && (session.state === 'playcall' || session.state === 'presnap')) {
      const d = this.pendingDrive, t = m.teams[d.team];
      this.pendingDrive = null;
      dc.innerHTML = `<div class="dv-logo" style="--tc:${t.colors.primary}"><img src="${this.logoFor(t)}" alt=""/></div><div class="dv-body"><div class="dv-title" style="--tc:${t.colors.primary}">SCORING DRIVE</div>
        <div class="dv-stats"><div><small>PLAYS</small><b>${d.plays}</b></div><div><small>YARDS</small><b>${d.yards}</b></div><div><small>TIME</small><b>${clockText(d.secs)}</b></div></div></div>`;
      dc.classList.remove('hidden'); this.driveT = 5;
    }
    if (this.driveT > 0 && (this.driveT -= dt) <= 0) dc.classList.add('hidden');
    // Milestone watch over the scorebug: at the line on every fourth play (6 s), never with a kick or in practice.
    const ms = this.$('milestone');
    const msOn = session.state === 'presnap' && sim?.state === 'presnap' && !sim.isKick && !session.practice && !playcallOpen
      && (m.playLog?.length || 0) >= 8 && m.playLog.length % 4 === 2 && performance.now() - (this._bugSince || 0) < 6000;
    const mi = msOn ? milestone(m) : null;
    ms.classList.toggle('hidden', !mi);
    if (mi) {
      ms.style.bottom = `${Math.round(innerHeight - (this._bugTop || innerHeight) + 8)}px`;
      const key = `${mi.name}|${mi.label}|${mi.v}`;
      if (ms.dataset.key !== key) {
        ms.dataset.key = key;
        const t = m.teams[mi.team];
        ms.innerHTML = `<span class="ms-tag">MILESTONE WATCH</span><span class="ms-team" style="--tc:${t.colors.primary}">${t.abbr}</span>
          <span class="ms-name">${mi.pos} ${mi.name}</span><span class="ms-what"><b>${mi.v}</b> / ${mi.goal} ${mi.label}</span>
          <span class="ms-bar"><i style="width:${Math.round(mi.k * 100)}%;--tc:${t.colors.primary}"></i></span>`;
      }
    }
    this.renderTicker(session);
    if ((this.bannerT -= dt) <= 0) this.$('banner').classList.add('hidden');
    if ((this.flagT -= dt) <= 0) this.$('flagbox').classList.add('hidden');
    this.pbpDrive = Math.max(0, (this.pbpDrive || 0) - dt);
    if (this.halfT > 0 && (this.halfT -= dt) <= 0) this.$('halfcard').classList.add('hidden');
    if (this.pbpT > 0 && (this.pbpT -= dt) <= 0) this.$('pbp').classList.add('hidden');
    // Hide the stat card once the next play is snapped (or after a few seconds).
    if ((this.statT -= dt) <= 0 || (sim && sim.state === 'live' && session.state === 'live')) this.$('statcard').classList.add('hidden');

    const pre = session.state === 'presnap' && sim && sim.state === 'presnap' && !playcallOpen;
    const pn = this.$('playname');
    // The user's call: the play name isn't shown on screen (it gave the play away and cluttered the broadcast look).
    pn.classList.add('hidden');
    if (false) {
      const human = session.humanSide;
      const play = human === 'offense' ? sim.offPlay : sim.defPlay;
      const hot = play.hot ? Object.entries(play.hot).map(([s, r]) => `${s} ${r.replace('_', ' ')}`).join(', ') : '';
      const html = `<small>${human === 'offense' ? play.concept || 'Offense' : 'Defense'}</small><b>${play.name}</b>${hot ? `<em>Hot: ${hot}</em>` : ''}`;
      if (pn._h !== html) { pn._h = html; pn.innerHTML = html; }
    }
    const hint = this.$('hint');
    let h = '';
    const career = session.lock !== null && session.lock !== undefined && sim && sim.lockId >= 0 && !session.watching;
    if (pre && career && !session.calls(session.humanSide === 'offense' ? session.offTeam : session.defTeam)) {
      const me = sim.players[sim.lockId];
      h = `Career: you're <b>#${me.number} ${me.name || ''}</b> (${me.slot}) &nbsp; the CPU calls and snaps &nbsp; <b class="btn view">View</b> Timeout`;
    } else if (pre && session.humanSide === 'offense') {
      const two = session.twoPlayer; // 2 players on one screen: nothing here may tell the defense run / pass / fake
      const kickLook = sim.isKick || (two && sim.offPlay.fake);
      const mp = sim.meter?.phase;
      if (kickLook && (mp === 'power' || mp === 'accuracy')) h = mp === 'power' ? '<b class="btn A">A</b> Set power at the top' : '<b class="btn A">A</b> Set accuracy at the mark &nbsp; (the snap follows)';
      else h = kickLook ? `${fgTag(session, sim)}<b class="btn A">A</b> Start kick meter &nbsp; Left stick ◀▶: aim${sim.offPlay.type === 'punt' || sim.offPlay.fake === 'punt' ? ` &nbsp; ▲▼ punt: <b>${{ normal: 'Normal', coffin: 'Coffin corner', pooch: 'Pooch' }[sim.kickStyle || 'normal']}</b>` : ''} &nbsp; <b class="btn view">View</b> Timeout${windTag(sim)}`
        : `<b class="btn A">A</b> Snap &nbsp; <b class="btn B">B</b> Spike &nbsp; <b class="btn X">X</b> Audible &nbsp; <b class="btn Y">Y</b> Hot route &nbsp; ${sim.motion ? '' : '<b class="btn RB">RB</b> Motion &nbsp; '}${(sim.offPlay.type === 'pass' || two) && session.match.phase === 'scrimmage' ? `<b class="btn LB">LB</b> Protection${two ? '' : protTag(sim.offPlay)} &nbsp; ` : ''}${session.hardCounted || session.match.phase !== 'scrimmage' ? '' : '<b class="btn LT">LT</b> Hard count &nbsp; '}${session.twoPlayer ? '' : '<b class="btn RT">RT</b> Play art + read &nbsp; '}<b class="btn view">View</b> Timeout`;
    } else if (pre && session.humanSide === 'defense') h = `${fgTag(session, sim)}<b class="btn B">B</b> Switch player &nbsp; ${sim.isKick ? '' : `<b class="btn X">X</b> Audible &nbsp; <b class="btn Y">Y</b> Hot route &nbsp; <b class="btn LB">LB</b> Coverage &nbsp; <b class="btn RB">RB</b> Front &nbsp; ${session.twoPlayer ? '' : '<b class="btn RT">RT</b> Play art &nbsp; '}`}${retTag(sim)}${sim.isKick && sim.offPlay.type !== 'kickoff' ? (sim.offPlay.type === 'fg' ? 'Edge rush: come off the end, <b class="btn X">X</b> dive across the kick as it\'s struck (<b class="btn A">A</b> jump) &nbsp; ' : 'Block: beat the wall, <b class="btn A">A</b> jump / <b class="btn X">X</b> lay out at the kick &nbsp; ') : ''}<b class="btn view">View</b> Timeout${session.twoPlayer ? '' : coverageTag(session.defAdj)}`;
    else if (sim && sim.state === 'live' && sim.kick && session.humanSide === 'defense' && sim.ball.state === 'kick') h = sim.kick.type === 'punt' ? `<b class="btn Y">Y</b> Fair catch &nbsp; <b class="btn X">X</b> Kneel in end zone` : `<b class="btn X">X</b> Kneel in end zone (touchback)`;
    else if (sim && sim.state === 'live' && session.humanSide === 'defense' && sim.players[sim.controlledId]?.engagement?.d === sim.players[sim.controlledId]) h = '<b class="btn A">A</b> Bull rush &nbsp; <b class="btn X">X</b> Swim &nbsp; <b class="btn Y">Y</b> Spin &nbsp; RS ↓ Rip';
    else if (sim && sim.state === 'live' && sim.ball.state === 'air' && !sim.kick && session.humanSide === 'offense' && sim.ball.intended === sim.controlledId) {
      const ct = sim.ball.catchType;
      const o = (btn, k, label) => `<b class="btn ${btn}">${btn}</b> ${ct === k ? `<u>${label}</u>` : label}`;
      h = `${o('Y', 'aggressive', 'Aggressive catch')} &nbsp; ${o('X', 'rac', 'Run after catch')} &nbsp; ${o('B', 'possession', 'Possession')}`;
    } else if (sim && sim.state === 'live' && sim.ball.state === 'air' && !sim.kick && session.humanSide === 'defense') h = '<b class="btn Y">Y</b> Go for the pick &nbsp; <b class="btn A">A</b> Swat';
    else if (sim && sim.meter && sim.state === 'live' && !sim.kick?.launched) h = sim.meter.phase === 'power' ? '<b class="btn A">A</b> Set power' : sim.meter.phase === 'accuracy' ? '<b class="btn A">A</b> Set accuracy — stop at the line!' : '';
    // Audible / hot route menus replace the hint.
    const au = this.$('audible');
    const a = pre ? session.audible : null;
    au.classList.toggle('hidden', !a);
    // 2 players: the menu's choices are covered unless the player holds D-pad ▲ (the other player looks away).
    au.classList.toggle('secret', !!(a && session.twoPlayer && !this.peek));
    if (a) {
      const key = a.mode === 'menu' ? 'm' + a.options.map((o) => o.play.id).join() : a.mode + (a.slot || '');
      if (au.dataset.key !== key) {
        au.dataset.key = key;
        if (a.mode === 'menu') {
          au.innerHTML = `<div class="au-title">${session.humanSide === 'offense' ? 'Audible' : 'Defensive audible'}</div>` +
            a.options.map((o) => `<div class="au-row"><b class="btn ${o.btn}">${o.btn}</b><span>${o.label}</span><small>${o.play.name}</small></div>`).join('') +
            `<div class="au-foot"><b class="btn LB">LB</b> cancel${session.twoPlayer ? ' &nbsp; hold ▲ to see' : ''}</div>`;
        } else if (a.mode === 'dhot') {
          au.innerHTML = `<div class="au-title">Hot route: ${a.name} (${a.slot})</div>` +
            a.options.map((o) => `<div class="au-row"><b class="btn ${o.btn}">${o.btn}</b><span>${o.label}</span></div>`).join('') +
            `<div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (a.mode === 'adjust' || a.mode === 'protect') {
          au.innerHTML = `<div class="au-title">${a.mode === 'protect' ? 'Protection' : a.title || 'Coverage'}</div>` +
            a.options.map((o) => `<div class="au-row"><b class="btn ${o.btn}">${o.btn}</b><span>${o.label}</span></div>`).join('') +
            `<div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (a.mode === 'motion' && !a.slot) {
          au.innerHTML = `<div class="au-title">Motion</div><div class="au-row"><span>Press a receiver's button</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (a.mode === 'motion') {
          au.innerHTML = `<div class="au-title">Motion: ${a.slot}</div><div class="au-row"><b class="key">◀▶</b><span>Toward the ball: across · away: wider</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else if (!a.slot) {
          au.innerHTML = `<div class="au-title">Hot route</div><div class="au-row"><span>Press a receiver's button</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        } else {
          au.innerHTML = `<div class="au-title">Hot route: ${a.slot}</div>` +
            [['▲', 'Go'], ['▼', 'Hitch'], ['◀▶ in', 'Slant'], ['◀▶ out', 'Quick out']].map(([k, v]) => `<div class="au-row"><b class="key">${k}</b><span>${v}</span></div>`).join('') +
            `<div class="au-row"><b class="btn A">A</b><span>Block</span></div><div class="au-foot"><b class="btn LB">LB</b> cancel</div>`;
        }
      }
      h = '';
    } else au.dataset.key = '';
    if (hint._h !== h) { hint._h = h; hint.innerHTML = h; } // unchanged text: no re-parse / relayout every frame
    hint.classList.toggle('hidden', !h || playcallOpen);
    this.$('pbp').style.visibility = playcallOpen ? 'hidden' : '';

    // Accept / decline a penalty against the CPU.
    const pb = this.$('penaltybox');
    const pen = session.state === 'penalty' ? session.pendingPenalty : null;
    pb.classList.toggle('hidden', !pen);
    if (pen && pb.dataset.key !== pen.choice.name + pen.choice.accept) {
      pb.dataset.key = pen.choice.name + pen.choice.accept;
      const c = pen.choice;
      const me = session.teams[session.humanTeam];
      pb.innerHTML = `<div class="pb-head"><span>${c.name}</span><b>${c.yards} YDS</b></div>
        <div class="pb-opt"><b class="btn A">A</b><div><div class="pb-label">Accept${pen.recommend ? ' <small>recommended</small>' : ''}</div><div class="pb-sub">${c.accept}</div></div></div>
        <div class="pb-opt"><b class="btn X">X</b><div><div class="pb-label">Decline${pen.recommend ? '' : ' <small>recommended</small>'}</div><div class="pb-sub">${c.decline}</div></div></div>
        <div class="pb-foot"><span>Choose</span><img src="${this.logoFor(me)}" alt=""/></div>`;
    } else if (!pen) pb.dataset.key = '';

    // A questionable player cleared to return: put him back in or not (shown with the re-injury risk).
    const ib = this.$('injurybox');
    const pi = session.state === 'injury' ? session.pendingInjury : null;
    ib.classList.toggle('hidden', !pi);
    if (pi && ib.dataset.key !== String(pi.rid)) {
      ib.dataset.key = String(pi.rid);
      const risk = (pi.risk || 'low').toUpperCase();
      ib.innerHTML = `<div class="pb-head"><span>${pi.pos} #${pi.number} ${pi.name}</span><b>${pi.part || 'injury'}</b></div>
        <div class="ib-risk">Questionable · cleared to return · re-injury risk <b class="risk-${pi.risk || 'low'}">${risk}</b></div>
        <div class="pb-opt"><b class="btn A">A</b><div><div class="pb-label">Put him back in</div><div class="pb-sub">Back on the field next snap</div></div></div>
        <div class="pb-opt"><b class="btn X">X</b><div><div class="pb-label">Keep him out</div><div class="pb-sub">His backup plays the rest of the game</div></div></div>`;
    } else if (!pi) ib.dataset.key = '';

    // Crowd noise meter (the visitors at the line on a big down): a teal box top-left, big "dB" read-out over a
    // segmented bar. The dB number is display only (level 0.5..1 -> ~96..115 dB) with a small flicker.
    const nz = this.$('noise');
    const level = pre && !session.practice ? crowdNoise(session.match) : 0;
    const cardUp = !this.$('statcard').classList.contains('hidden');
    nz.classList.toggle('hidden', level < 0.5 || playcallOpen || cardUp);
    if (level >= 0.5) {
      this.nzT = (this.nzT || 0) + dt;
      if (this.nzT > 0.18 || !nz.firstChild) {
        this.nzT = 0;
        const db = Math.round(77 + level * 38 + (Math.sin(performance.now() * 0.011) + Math.sin(performance.now() * 0.0047)) * 1.2);
        const segs = 20, lit = Math.round(Math.min(1, (db - 70) / 45) * segs);
        const key = `${db}`;
        if (nz.dataset.key !== key) {
          nz.dataset.key = key;
          nz.innerHTML = `<small>CROWD NOISE</small><div class="nz-db"><b>${db}</b><span>dB</span></div>
            <div class="nz-bar">${Array.from({ length: segs }, (_, i) => `<i class="${i < lit ? (i >= segs - 4 ? 'on hot' : 'on') : ''}"></i>`).join('')}</div>`;
        }
      }
    }

    // Skills drill: name, rep and score.
    const db = this.$('drillbar');
    const dr = session.drill;
    db.classList.toggle('hidden', !dr || playcallOpen);
    if (dr) {
      const key = `${dr.rep}:${dr.score}`;
      if (db.dataset.key !== key) {
        db.dataset.key = key;
        const D = DRILLS[dr.id];
        const last = dr.log[dr.log.length - 1];
        db.innerHTML = `<span>${D.name}</span><small>Rep ${Math.min(dr.rep + 1, D.reps)}/${D.reps}</small><b>${dr.score}</b>${last ? `<small>${last.text} (${last.pts > 0 ? '+' : ''}${last.pts})</small>` : ''}`;
      }
    }

    // Close call: challenge window for the human it went against, then "under review".
    const rb = this.$('reviewbox');
    const rv = session.state === 'review' ? session.review : null;
    rb.classList.toggle('hidden', !rv);
    if (rv) {
      const key = rv.phase + rv.booth + rv.by;
      if (rb.dataset.key !== key) {
        rb.dataset.key = key;
        const m = session.match;
        const left = (m.challenges || [2, 2])[rv.hurt];
        const head = rv.phase === 'call' ? 'Close call' : rv.booth ? 'Booth review' : `${session.teams[rv.by].abbr} challenge`;
        rb.innerHTML = `<div class="pb-head"><span>${head}</span><b>${rv.phase === 'call' ? '' : 'UNDER REVIEW'}</b></div>
          <div class="pb-opt"><div><div class="pb-label">${rv.text}</div>${rv.phase === 'call' ? `<div class="pb-sub">${left} challenge${left === 1 ? '' : 's'} left · a lost challenge costs a timeout</div>` : ''}</div></div>
          ${rv.phase === 'call' ? `<div class="pb-opt"><b class="btn Y">Y</b><div class="pb-label">Challenge</div><b class="btn A" style="margin-left:18px">A</b><div class="pb-label">Play on</div></div>` : ''}
          <div class="rb-bar"><i></i></div>`;
      }
      const T = rv.phase === 'call' ? 3.5 : 3.2;
      rb.querySelector('.rb-bar i').style.width = `${Math.min(100, (rv.t / T) * 100)}%`;
    } else rb.dataset.key = '';

    // Name tags under the player you control and, if it's someone else, the ball carrier.
    const [tagMe, tagOther] = this.root.querySelectorAll('.tag');
    const showTags = sim && !this.artOn && this.prefs?.nameTags !== false && session.humanTeam !== null && !playcallOpen && session.state !== 'playcall';
    const me = showTags ? sim.players[sim.controlledId] : null;
    const carrier = showTags && sim.state !== 'presnap' ? sim.carrier() : null;
    this.placeTag(tagMe, me && me.team === session.humanTeam ? me : null, renderer, session);
    this.placeTag(tagOther, carrier && carrier !== me ? carrier : null, renderer, session);

    // The slanted down & distance tag sits on the turf beside the ball before every scrimmage snap; holding RT adds the names.
    const tagOn = sim && !playcallOpen && sim.state === 'presnap' && session.state === 'presnap' && session.match.phase === 'scrimmage' && !sim.isKick && !sim.offPlay.fake; // (fakes stay off it: a real punt shows none)
    this.artOverlay((this.artOn || tagOn) && !playcallOpen ? sim : null, renderer, session, !!this.artOn);

    // Receiver icons while the human QB can still throw.
    // 2 players: every eligible man keeps a button before the snap and, on a run, until the handoff (play action / draws
    // look like passes); the buttons are the same ones a pass play gives (sim.computeIcons, 2P).
    const qbHas = sim && sim.ball.carrier >= 0 && sim.players[sim.ball.carrier]?.slot === 'QB' && sim.ball.state === 'held';
    const two = session.twoPlayer && sim && !sim.isKick && !sim.offPlay.fake && (sim.state === 'presnap' || (sim.offPlay.type !== 'pass' && qbHas && sim.t < 2.5));
    const showIcons = sim && !playcallOpen && (two || (sim.humanTeam === sim.offIdx && sim.offPlay.type === 'pass')) && !sim.passThrown && !sim.qbCrossed && sim.state !== 'dead';
    if (two && (!sim._allIcons || sim._allIconsKey !== sim.offPlay)) { sim._allIcons = sim.iconMap(true); sim._allIconsKey = sim.offPlay; }
    const iconSet = two ? sim._allIcons : sim?.icons;
    for (const [btn, elx] of Object.entries(this.icons)) {
      const id = iconSet?.[btn];
      if (!showIcons || id === undefined) { elx.style.display = 'none'; continue; }
      const p = sim.players[id];
      const s = renderer.project(p.x, p.height + 0.25, p.z);
      elx.style.display = s.visible ? 'flex' : 'none';
      elx.style.transform = `translate(${s.x - 14}px, ${s.y - 30}px)`;
    }
    // Tush push timing bar.
    const pm = this.$('pushmeter');
    // At the line before the snap (the reference video): over the middle of the line, the needle sweeping; the old in-play window too.
    const pushPre = sim?.offPlay?.push && sim.state === 'presnap' && session.state === 'presnap' && !playcallOpen && session.isHuman?.(sim.offIdx) && session.calls?.(sim.offIdx) !== false;
    const pushOn = pushPre || (sim?.offPlay?.push && sim.state === 'live' && sim.push && sim.push.quality === null && session.isHuman?.(sim.offIdx));
    pm.classList.toggle('hidden', !pushOn);
    if (pushOn) {
      pm.querySelector('.pm-needle').style.left = `${sim.pushNeedle() * 100}%`;
      const sp = renderer.project(sim.losX + sim.dir * 2, 1.9, sim.ballZ);
      if (sp.visible) { pm.style.left = `${Math.round(sp.x)}px`; pm.style.top = `${Math.round(sp.y)}px`; pm.style.bottom = 'auto'; }
    }
    // Kick meter.
    const km = this.$('kickmeter');
    const meter = sim?.meter;
    const fakeMeter = !meter && sim?.fakeLook && !playcallOpen; // 2P: a fake shows the meter at rest, like the kick
    const showMeter = (meter && sim.isKick && (sim.state === 'presnap' || !sim.kick?.launched) && !playcallOpen) || fakeMeter;
    km.classList.toggle('hidden', !showMeter);
    if (showMeter) {
      // On the turf just right of the ball (the holder's spot / the tee / the punter), like the reference; else the right side.
      const kp = sim.offPlay.type === 'punt' ? sim.players.find((p) => p.team === sim.offIdx && p.slot === 'P') : null;
      const fgSpot = sim.offPlay.type === 'fg' || sim.offPlay.fake === 'fg' ? { x: sim.losX - sim.dir * 7, z: sim.ballZ } : null; // the holder's spot (before the snap the ball is at the center)
      const at = kp || fgSpot || sim.ball;
      const sp = at && renderer.project(at.x, 0, at.z);
      const near = sp && sp.visible && sp.x > 40 && sp.x < innerWidth - 240 && sp.y > 150 && sp.y < innerHeight - 40;
      km.classList.toggle('near', !!near);
      if (near) { km.style.left = `${Math.round(sp.x + 32 - 24)}px`; km.style.top = `${Math.round(sp.y + 4 - 124)}px`; } else { km.style.left = ''; km.style.top = ''; }
      setTick(km.querySelector('.km-zone'), meterU(METER.accLine), 15);
      setTick(km.querySelector('.km-top'), 0.955, 15);
      const ph = fakeMeter ? 'idle' : meter.phase;
      const needle = fakeMeter ? -9 : ph === 'power' ? meter.value : ph === 'accuracy' ? meter.needle : ph === 'done' ? meter.accuracy + METER.accLine : -9;
      const nd = km.querySelector('.km-needle'), st = km.querySelector('.km-set');
      nd.style.display = needle > -1 ? '' : 'none';
      if (needle > -1) setTick(nd, meterU(needle), 17);
      st.style.display = ph === 'accuracy' || ph === 'done' ? '' : 'none';
      if (st.style.display === '') setTick(st, meterU(meter.power), 15);
      // The button sits where the next press belongs: the start to begin, the top while power rises, the start for accuracy.
      const btn = km.querySelector('.km-btn');
      btn.style.display = ph === 'done' ? 'none' : '';
      setAt(btn, ph === 'power' ? 1 : ph === 'accuracy' ? meterU(METER.accLine) : 0);
      const fgYds = `FG ${Math.ceil(Math.abs(60 * sim.dir - sim.losX) + 7 - 1e-6)} yd`;
      km.querySelector('.km-label').textContent = fakeMeter ? (sim.offPlay.fake === 'fg' ? fgYds : 'PUNT') : sim.offPlay.type === 'fg' ? fgYds : sim.offPlay.name.toUpperCase();
    }
    // FPS
    this.fpsAcc += frameMs; this.fpsN++;
    if (this.fpsAcc > 500) {
      const fps = 1000 / (this.fpsAcc / this.fpsN);
      this.$('fps').textContent = this.fpsShow ? `${fps.toFixed(0)} fps · ${renderer.renderer.info.render.calls} draws · px ${renderer.pixelRatio.toFixed(2)}` : '';
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }

  /**
   * Scores from around the league (franchise games): the other games this week, revealed quarter by quarter as yours
   * goes on (session.ticker = [{ away, home, q: [[a1..a4], [h1..h4]], final }]).
   */
  /** The touchdown celebration wheel (see main.js). */
  /** Touchdown celebration picker: a list bottom-left (RS direction per row), a draining time bar, the pick lit. */
  celWheel(on, left = 1, picked = null) {
    const el = this.$('celwheel');
    el.classList.toggle('hidden', !on);
    if (!on) { el.dataset.key = ''; return; }
    const key = String(picked);
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      const rows = [['dance', '▲', 'Dance'], ['flex', '◀', 'Flex'], ['spike', '▶', 'Spike'], ['team', '▼', 'Team celebration']];
      el.innerHTML = `<div class="cl-head"><span>CELEBRATE</span><b class="btn RS">RS</b></div>
        ${rows.map(([k, a, n]) => `<div class="cl-row${picked === k ? ' on' : picked ? ' off' : ''}"><i>${a}</i><span>${n}</span></div>`).join('')}
        <div class="cl-time"><i></i></div>`;
    }
    el.querySelector('.cl-time i').style.width = `${Math.max(0, left) * 100}%`;
  }

  renderTicker(session) {
    const tk = this.$('scoreticker');
    const list = session.ticker;
    const show = !!list?.length && !session.practice;
    tk.classList.toggle('hidden', !show);
    this.root.classList.toggle('with-ticker', show);
    if (!show) return;
    const m = session.match;
    const q = m.over ? 5 : Math.min(5, m.quarter);
    const key = `${q}`;
    if (tk.dataset.key === key) return;
    tk.dataset.key = key;
    const sum = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0);
    const items = list.map((g) => {
      const done = q >= 5;
      const a = done ? g.final[1] : sum(g.q[0], q - 1), h = done ? g.final[0] : sum(g.q[1], q - 1);
      const st = done ? 'FINAL' : q === 1 ? 'Q1' : `END Q${q - 1}`;
      return `<span class="stk-g"><b>${g.away}</b> ${a} <b>${g.home}</b> ${h} <em>${st}</em></span>`;
    }).join('');
    tk.querySelector('.stk-run').innerHTML = items + items; // twice for a seamless loop
    tk.querySelector('.stk-run').style.animationDuration = `${Math.max(20, list.length * 5)}s`;
  }

  /** Short scorebug note in the down & distance cell ("PLAY FLIPPED", "HOT ROUTE"...), in the team's color. */
  note(text, team, secs = 2.6) { this.bugNote = { text, team, until: performance.now() + secs * 1000 }; this._bugKey = null; }

  renderBug(session) {
    const m = session.match;
    const bug = this.$('scorebug');
    bug.classList.remove('hidden');
    // A foul on the field shows right away (free play!); the call is explained after the whistle.
    const sim = session.sim;
    const flag = !m.over && (session.state === 'penalty' || ((session.state === 'live') && sim?.fouls?.length > 0));
    const recs = session.records || ['0-0', '0-0'];
    const blink = this.toBlink && performance.now() < this.toBlink.until ? this.toBlink.team : -1;
    const take = this.bugTake && performance.now() < this.bugTake.until ? this.bugTake : null;
    const note = this.bugNote && performance.now() < this.bugNote.until && !m.over ? this.bugNote : null;
    // Between plays the middle of the bar sometimes swaps to a stat comparison (every third play call, 6 s).
    if (session.state !== this._bugState) { this._bugState = session.state; this._bugSince = performance.now(); }
    const stat = !m.over && !take && (session.state === 'playcall' || session.state === 'post') && performance.now() - this._bugSince < 6000 && (m.playLog?.length || 0) >= 6
      && m.playLog.length % 3 === 0 ? bugStat(m) : null;
    const key = [stat?.label, m.score, m.quarter, Math.ceil(m.clock), Math.ceil(m.playClock), m.down, Math.round(m.toGo), Math.round(m.yardLine), m.timeouts, m.possession, m.phase, m.over, m.kicker, flag, recs, blink, take?.text, note?.text, this.pkg?.id].join('|');
    if (key === this._bugKey) return;
    this._bugKey = key;
    // Full-width bar: brand | away logo | (rec) AWY • 0 × 0 HOM (rec) | home logo | quarter, clock, play clock | down & distance.
    const hasBall = (i) => (m.phase === 'kickoff' ? m.kicker !== i : m.possession === i) && !m.over;
    const logo = (i) => `<div class="sb3-logo" style="--tc:${m.teams[i].colors.primary};--tc2:${m.teams[i].colors.secondary}"><img src="${this.logoFor(m.teams[i])}" alt=""/></div>`;
    const name = (i, side) => {
      // The bar that was just used blinks for a few seconds after a timeout.
      const bars = [0, 1, 2].map((k) => `<i class="${k < m.timeouts[i] ? 'on' : blink === i && k === m.timeouts[i] ? 'used' : ''}"></i>`).join('');
      const rec = `<small>(${recs[i]})</small>`;
      const ab = `<span class="sb3-ab">${m.teams[i].abbr}<span class="sb3-to${blink === i ? ' blink' : ''}">${bars}</span></span>`;
      const dot = `<span class="sb3-dot${hasBall(i) ? ' on' : ''}">•</span>`;
      return side === 'away' ? `${rec}${ab}${dot}` : `${dot}${ab}${rec}`;
    };
    const ord = (q) => (q > 4 ? 'OT' : `${q}<sup>${['', 'st', 'nd', 'rd', 'th'][q]}</sup>`);
    const dd = m.over ? 'FINAL' : m.phase === 'scrimmage' ? downText(m).toUpperCase().replace(/(\d)(ST|ND|RD|TH)/, '$1<sup>$2</sup>') : downText(m).toUpperCase();
    const pc = m.over || m.phase !== 'scrimmage' ? '' : `<span class="sb3-pc${m.playClock <= 10 ? ' low' : ''}">:${String(Math.ceil(m.playClock)).padStart(2, '0')}</span>`;
    const pk = this.pkg;
    // Prime-time slots get their own layout (the user's reference pictures; our own badges): boxed (Sunday night and the
    // big games), a slim slanted bar (Monday night), a centered box with a shield (Thursday night, openers, international).
    const lay = pk && !take ? ({ sun: 'box', night: 'box', title: 'box', holiday: 'box', mon: 'slim', thu: 'shield', open: 'shield', intl: 'shield' })[pk.id] : null;
    if (lay) {
      bug.innerHTML = primeBug(lay, pk, { m, recs, flag, stat, note, blink, hasBall, logo: (i) => this.logoFor(m.teams[i]) });
      bug.classList.add('pkg-bug');
      return;
    }
    bug.classList.remove('pkg-bug');
    bug.innerHTML = `<div class="sb3${pk ? ` pkg pkg-${pk.id}` : ''}"${pk ? ` style="--pk:${pk.color}"` : ''}>
      <div class="sb3-brand">GRIDIRON<img class="sb3-lg" src="${this.leagueLogo()}" alt=""/>27</div>
      ${take ? `<div class="sb3-take" style="--tc:${m.teams[take.team].colors.primary}"><img src="${this.logoFor(m.teams[take.team])}" alt=""/><b>${take.text}</b></div>` : `${logo(1)}
      ${stat ? `<div class="sb3-mid sb3-stat"><b>${m.teams[1].abbr}</b><b class="sb3-sv">${stat.v[1]}</b><span>${stat.label}</span><b class="sb3-sv">${stat.v[0]}</b><b>${m.teams[0].abbr}</b></div>`
        : `<div class="sb3-mid">${name(1, 'away')}<b class="sb3-sc">${m.score[1]}</b><span class="sb3-x">×</span><b class="sb3-sc">${m.score[0]}</b>${name(0, 'home')}</div>`}
      ${logo(0)}`}
      <div class="sb3-clock">${m.over ? '' : `<span class="sb3-q">${ord(m.quarter)}</span><b>${clockText(m.clock)}</b>`}${pc}</div>
      <div class="sb3-dd${flag ? ' flag' : note ? ' note' : ''}"${note && !flag ? ` style="--tc:${m.teams[note.team].colors.primary}"` : ''}>${flag ? 'FLAG' : note ? note.text : dd}</div>
    </div>`;
  }
}

/** Small note of the defense's current coverage call, e.g. " · Press, inside". */
function protTag(play) {
  const k = play.prot || play.protKey;
  return k ? ` <small>(${{ left: 'slide left', right: 'slide right', max: 'max', out: 'all out' }[k]})</small>` : '';
}

function coverageTag(adj) {
  if (!adj) return '';
  const parts = [adj.cover === 'press' ? 'Press' : adj.cover === 'off' ? 'Off' : '', adj.shade === 'in' ? 'inside' : adj.shade === 'out' ? 'outside' : '', adj.disguise ? 'disguised' : '',
    adj.front ? `${adj.front} line` : '', adj.show === 'blitz' ? 'showing blitz' : adj.show === 'crowd' ? 'crowding the line' : ''].filter(Boolean);
  return parts.length ? ` &nbsp; <small>${parts.join(', ')}</small>` : '';
}

/** Wind for the kicker: speed and an arrow as seen from the camera. */
/** "53-yard attempt" before a field goal (whole yards, rounded up). */
/** Receiving a kickoff / punt: the return call buttons and what's called now. */
function retTag(sim) {
  if (!sim.isKick || sim.offPlay.type === 'fg') return '';
  if (sim.offPlay.type === 'punt') {
    const s = sim.returnScheme || 'return';
    const b = (btn, key, label) => `<b class="btn ${btn}">${btn}</b> ${s === key ? `<u>${label}</u>` : label}`;
    return `${b('X', 'block', 'Block')} &nbsp; ${b('Y', 'return', 'Return')} &nbsp; ${b('B', 'safe', 'Safe')} &nbsp; `;
  }
  if (sim.offPlay.kick === 'onside') return '';
  const side = sim.returnSide ? (sim.returnSide === -sim.camDir ? 'left' : 'right') : 'middle';
  const b = (btn, key, label) => `<b class="btn ${btn}">${btn}</b> ${side === key ? `<u>${label}</u>` : label}`;
  return `Return: ${b('X', 'left', 'Left')} &nbsp; ${b('Y', 'middle', 'Middle')} &nbsp; ${b('B', 'right', 'Right')} &nbsp; `;
}

function fgTag(session, sim) {
  if (!(sim.isKick && sim.offPlay.type === 'fg') && !(sim.fakeLook && sim.offPlay.fake === 'fg')) return '';
  const m = session.match;
  return `<b class="fg-att">${fgDistance(m.phase === 'try' ? 85 : m.yardLine)}-YARD ATTEMPT</b> &nbsp; `;
}

function windTag(sim) {
  const w = sim.wind;
  const mph = Math.round(Math.hypot(w.x, w.z) * 2.045);
  if (mph < 3) return '';
  const right = w.z * sim.camDir, up = w.x * sim.camDir;
  const arrows = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  const a = arrows[(Math.round(Math.atan2(up, right) / (Math.PI / 4)) + 8) % 8];
  return ` &nbsp; <b class="key">${a}</b> Wind ${mph} mph`;
}
