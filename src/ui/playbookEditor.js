import { el } from './nav.js';
import { offenseArt } from './playart.js';
import { getOffFormation, getDefFormation, listOffPlays, listDefPlays } from '../data/playbook.js';
import { setAudiblePackages, audiblePackages, defaultPackage } from '../game/audibles.js';
import {
  routeChoices, RUN_GAPS, customFormations, eligibleSlots, newSpec, changeFormation, buildPlay, registerCustomPlays, loadSpecs, saveSpecs,
} from '../data/customPlays.js';
import { testPlay } from '../game/playtest.js';
import { validateMod, applyMod, removeMod, loadMods, saveMods, exampleMod } from '../data/mods.js';
import { pickFile, downloadFile } from '../data/storage.js';
import { defenseArt } from './playart.js';
import { ROUTES } from '../data/routes.js';
import {
  registerCustomRoutes, loadRoutes, saveRoutes, DEF_ASSIGN_CHOICES, defFormations, newDefSpec, changeDefFormation, buildDefPlay,
  registerCustomDefPlays, loadDefSpecs, saveDefSpecs, shareCode, readShareCode,
} from '../data/customDesign.js';

// Playbook editor (League → Playbook): build "My Plays" — pick a formation, give each receiver a route (or a
// block), the primary read, drop, play action / bootleg; or a run (carrier, side, gap, scheme). They show up in
// the play-call screen's "My Plays" tab. ctx = { screens, teams, onBack }.

const label = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function playbookScreen(ctx, focus = 0) {
  const { screens } = ctx;
  const specs = loadSpecs();
  screens.extraButtons = null;
  const rows = specs.map((sp, i) => {
    const f = getOffFormation(sp.formation);
    const r = screens.menuItem(sp.name, `${f?.name || sp.formation} · ${sp.type === 'run' ? `run ${sp.run.side > 0 ? 'right' : 'left'}, ${sp.run.gap}` : 'pass'}`, () => editor(ctx, { ...sp }, i));
    r.del = () => {
      if (!window.confirm(`Delete "${sp.name}"?`)) return;
      specs.splice(i, 1);
      saveSpecs(specs);
      registerCustomPlays(specs);
      playbookScreen(ctx, Math.max(0, i - 1));
    };
    return r;
  });
  const add = screens.menuItem('New Play', 'Start from a formation', () => {
    const id = `my_${Date.now().toString(36)}`;
    editor(ctx, newSpec(id), -1);
  });
  const aud = screens.menuItem('Audibles', 'Pick the four audibles (A / B / X / Y) for each formation, offense and defense', () => audibleScreen(ctx));
  const routes = screens.menuItem('Route Drawer', `Draw your own routes on a grid (${loadRoutes().length} saved); every play can use them`, () => routeList(ctx));
  const defs = screens.menuItem('Defensive Plays', `Build your own defenses (${loadDefSpecs().length} saved): formation + a job for every player`, () => defList(ctx));
  const mods = screens.menuItem('Mod Packs', `Add formations, plays and routes from a .json pack (${loadMods().filter((m) => m.enabled).length} on)`, () => modScreen(ctx));
  const imp = screens.menuItem('Import a share code…', 'Paste a code from someone else (a play, a defense or a route)', () => importCode(ctx));
  for (const [i, r] of rows.entries()) r.share = () => showCode(shareCode('off', specs[i], loadRoutes()));
  const items = [aud, routes, defs, mods, imp, ...rows, add];
  screens.frame('menu-screen', el('div.logo-small', { html: 'MY PLAYS' }),
    el('div.league-status', { text: specs.length ? `${specs.length} custom play${specs.length > 1 ? 's' : ''} · they show up in the "My Plays" tab when you call a play` : 'Design your own plays: they show up in the "My Plays" tab when you call a play' }),
    el('div.menu-list', {}, items),
    el('div.setup-help', { html: '<b class="btn A">A</b> edit &nbsp; <b class="btn X">X</b> delete &nbsp; <b class="btn Y">Y</b> share code &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { onBack: ctx.onBack, index: Math.min(focus, items.length - 1) });
  screens.extraButtons = (fr) => { if (fr.pressed.X) screens.nav.items[screens.nav.index]?.del?.(); if (fr.pressed.Y) screens.nav.items[screens.nav.index]?.share?.(); };
}

function editor(ctx, spec, index, focus = 0) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const redraw = (f = focus) => editor(ctx, spec, index, f);
  const rows = [];
  // A row with ◀▶ choices.
  const option = (name, values, get, set, fmt = (v) => String(v)) => {
    const row = el('div.opt-row');
    const i = Math.max(0, values.indexOf(get()));
    row.append(el('span.opt-label', { text: name }), el('span.opt-val', { html: `◀ ${fmt(values[i])} ▶` }));
    row.spin = (d) => { set(values[(i + d + values.length) % values.length]); redraw(rows.indexOf(row)); };
    row.activate = () => row.spin(1);
    rows.push(row);
    return row;
  };
  const nameRow = el('div.opt-row', {}, el('span.opt-label', { text: 'Name' }), el('span.opt-val', { text: spec.name }));
  nameRow.activate = () => { const v = window.prompt('Play name', spec.name); if (v && v.trim()) { spec.name = v.trim().slice(0, 28); redraw(0); } };
  rows.push(nameRow);
  const forms = customFormations();
  option('Formation', forms, () => spec.formation, (v) => Object.assign(spec, changeFormation(spec, v)), (v) => getOffFormation(v)?.name || v);
  option('Type', ['pass', 'run'], () => spec.type, (v) => { spec.type = v; }, label);
  const elig = eligibleSlots(spec.formation);
  if (spec.type === 'pass') {
    for (const e of elig) option(`${e.slot} (${e.pos})`, routeChoices(), () => spec.routes[e.slot], (v) => { spec.routes[e.slot] = v; }, label);
    const runners = elig.filter((e) => spec.routes[e.slot] !== 'block').map((e) => e.slot);
    if (runners.length) option('Primary read', runners, () => spec.primary, (v) => { spec.primary = v; });
    option('QB drop', [3, 5, 7], () => spec.dropback, (v) => { spec.dropback = v; }, (v) => `${v}-step`);
    option('Play action', [false, true], () => !!spec.pa, (v) => { spec.pa = v; }, (v) => (v ? 'Yes' : 'No'));
    option('Bootleg', [0, -1, 1], () => spec.boot || 0, (v) => { spec.boot = v; }, (v) => (v ? (v > 0 ? 'Right' : 'Left') : 'No'));
  } else {
    option('Ball carrier', ['QB', ...elig.map((e) => e.slot)], () => spec.run.carrier, (v) => { spec.run.carrier = v; }, (v) => (v === 'QB' ? 'QB (keeper)' : `${v} (${elig.find((e) => e.slot === v)?.pos})`));
    option('Direction', [-1, 1], () => spec.run.side, (v) => { spec.run.side = v; }, (v) => (v > 0 ? 'Right' : 'Left'));
    option('Hole', Object.keys(RUN_GAPS), () => spec.run.gap, (v) => { spec.run.gap = v; }, label);
    option('Blocking', ['zone', 'gap'], () => spec.run.scheme, (v) => { spec.run.scheme = v; }, (v) => (v === 'gap' ? 'Gap / power' : 'Zone'));
  }
  spec.rev = (spec.rev || 0) + 1; // new diagram after every change
  const play = buildPlay(spec);
  const result = el('div.pb-test', { text: 'Test runs the play 12 times against CPU defenses.' });
  const test = el('div.start-btn.secondary', { text: 'Test play' });
  test.activate = () => {
    const r = testPlay(play, ctx.teams);
    result.textContent = r.ok ? `Avg ${r.avgYds.toFixed(1)} yds/play${r.cmpPct !== null ? ` · ${Math.round(r.cmpPct * 100)}% completions` : ''} over ${r.reps} reps` : `Problem: ${r.error}`;
  };
  const save = el('div.start-btn', { text: 'Save play' });
  save.activate = () => {
    const r = testPlay(play, ctx.teams, 2);
    if (!r.ok) { window.alert(`This play doesn't work: ${r.error}`); return; }
    const specs = loadSpecs();
    if (index >= 0) specs[index] = spec; else specs.push(spec);
    saveSpecs(specs);
    registerCustomPlays(specs);
    playbookScreen(ctx, index >= 0 ? index : specs.length - 1);
  };
  const cancel = el('div.start-btn.secondary', { text: 'Cancel' });
  cancel.activate = () => playbookScreen(ctx);
  const art = offenseArt(play, 460, 260);
  screens.frame('setup-screen', el('h1', { text: index >= 0 ? 'Edit Play' : 'New Play' }),
    el('div.pb-edit', {}, el('div.pb-art', {}, art, result), el('div.setup-opts.pb-opts', {}, ...rows)),
    el('div.over-buttons', {}, save, test, cancel),
    el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; ▲▼ move &nbsp; <b class="btn B">B</b> cancel' }));
  screens.nav.set([...rows, save, test, cancel], { columns: 1, onBack: () => playbookScreen(ctx), index: Math.min(focus, rows.length + 2) });
}

// ---------------------------------------------------------------------------------------------------------------
// Audibles (Playbook → Audibles): choose the four audibles (A / B / X / Y) for every formation, offense and
// defense. Saved in this browser (localStorage `g27.audibles`) and used by the audible menu at the line (X).
const AUD_KEY = 'g27.audibles';
export function loadAudiblePackages() {
  try { const p = JSON.parse(localStorage.getItem(AUD_KEY) || 'null'); setAudiblePackages(p || {}); } catch { setAudiblePackages({}); }
}
function saveAudiblePackages() {
  try { localStorage.setItem(AUD_KEY, JSON.stringify(audiblePackages())); } catch { /* storage blocked: this session only */ }
}

function audibleScreen(ctx, side = 'off', fi = 0, focus = 0) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const plays = side === 'off' ? listOffPlays().filter((p) => !p.trick && !p.hail) : listDefPlays();
  const forms = [...new Set(plays.map((p) => p.formation))];
  fi = (fi + forms.length) % forms.length;
  const form = forms[fi];
  const fname = (side === 'off' ? getOffFormation(form) : getDefFormation(form))?.name || form;
  const inForm = plays.filter((p) => p.formation === form);
  const pk = audiblePackages()[side];
  const cur = pk[form] || defaultPackage(side, form);
  const set = (btn, id) => { pk[form] = { ...cur, [btn]: id }; saveAudiblePackages(); };
  const rows = ['A', 'B', 'X', 'Y'].map((btn, i) => {
    const p = inForm.find((x) => x.id === cur[btn]);
    const r = screens.menuItem(`${btn}  ·  ${p ? p.name : '—'}`, p ? `${p.type || p.coverage || ''}${p.concept ? ' · ' + p.concept : ''} · ◀▶ change` : '◀▶ choose a play', () => {});
    r.spin = (d) => {
      const k = inForm.findIndex((x) => x.id === cur[btn]);
      const next = inForm[(k + d + inForm.length) % inForm.length];
      set(btn, next.id);
      audibleScreen(ctx, side, fi, i);
    };
    return r;
  });
  screens.frame('menu-screen', el('div.logo-small', { html: 'AUDIBLES' }),
    el('div.league-status', { text: `${side === 'off' ? 'Offense' : 'Defense'} · ${fname} (${fi + 1}/${forms.length})${pk[form] ? ' · your package' : ' · default picks'}` }),
    el('div.menu-list', {}, rows),
    el('div.setup-help', { html: '◀▶ change the play &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> formation &nbsp; <b class="btn X">X</b> offense / defense &nbsp; <b class="btn Y">Y</b> back to the default &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(rows, { index: focus, onBack: () => playbookScreen(ctx), onTab: (d) => audibleScreen(ctx, side, fi + d, focus) });
  screens.extraButtons = (fr) => {
    if (fr.pressed.X) audibleScreen(ctx, side === 'off' ? 'def' : 'off', 0, 0);
    else if (fr.pressed.Y) { delete pk[form]; saveAudiblePackages(); audibleScreen(ctx, side, fi, screens.nav.index); }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Share codes: one line of text for a play / defense / route (and the custom routes a play uses).
function showCode(code) {
  try { navigator.clipboard?.writeText(code); } catch { /* no clipboard: the prompt shows it to copy */ }
  window.prompt('Share code (copied to the clipboard if allowed):', code);
}

function importCode(ctx) {
  const code = window.prompt('Paste a share code:');
  if (!code) return;
  let o;
  try { o = readShareCode(code); } catch (e) { window.alert(e.message); return; }
  // Custom routes first (a play may use them), under fresh ids if they clash with yours.
  const routes = loadRoutes();
  for (const r of o.routes || []) if (!routes.some((x) => x.id === r.id)) routes.push(r);
  saveRoutes(routes);
  registerCustomRoutes(routes);
  const id = (p) => `${p}_${Date.now().toString(36)}`;
  if (o.kind === 'off') {
    const specs = loadSpecs();
    specs.push({ ...o.spec, id: id('my') });
    saveSpecs(specs); registerCustomPlays(specs);
    window.alert(`Added "${o.spec.name}" to My Plays.`);
  } else if (o.kind === 'def') {
    const specs = loadDefSpecs();
    specs.push({ ...o.spec, id: id('mydef') });
    saveDefSpecs(specs); registerCustomDefPlays(specs);
    window.alert(`Added "${o.spec.name}" to your defensive plays.`);
  } else window.alert(`Added the route "${o.spec.name}".`);
  playbookScreen(ctx);
}

// ---------------------------------------------------------------------------------------------------------------
// Route Drawer: draw a route point by point on a grid (yards downfield × yards toward the sideline from where the
// receiver lines up). D-pad / stick moves the cursor, A drops a point, X takes the last one back, Y switches the end
// (keep running / settle in the open), mouse clicks drop points too. Saved routes show up in every route list.
function routeList(ctx, focus = 0) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const list = loadRoutes();
  const rows = list.map((r, i) => {
    const it = screens.menuItem(r.name, `${r.pts.length} point${r.pts.length === 1 ? '' : 's'} · ${r.end === 'settle' ? 'settles' : 'keeps running'}`, () => routeDrawer(ctx, { ...r, pts: r.pts.map((p) => [...p]) }, i));
    it.del = () => { if (!window.confirm(`Delete the route "${r.name}"? Plays using it go back to blocking.`)) return; list.splice(i, 1); saveRoutes(list); registerCustomRoutes(list); routeList(ctx, Math.max(0, i - 1)); };
    it.share = () => showCode(shareCode('route', r));
    return it;
  });
  const add = screens.menuItem('New Route', 'Draw one', () => routeDrawer(ctx, { id: `cr_${Date.now().toString(36)}`, name: 'My Route', pts: [], end: 'continue' }, -1));
  const items = [...rows, add];
  screens.frame('menu-screen', el('div.logo-small', { html: 'ROUTE DRAWER' }),
    el('div.league-status', { text: 'Your routes appear in every route list (My Plays, hot routes for custom plays) as cr_… names.' }),
    el('div.menu-list', {}, items),
    el('div.setup-help', { html: '<b class="btn A">A</b> edit &nbsp; <b class="btn X">X</b> delete &nbsp; <b class="btn Y">Y</b> share code &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { onBack: () => playbookScreen(ctx), index: Math.min(focus, items.length - 1) });
  screens.extraButtons = (fr) => { if (fr.pressed.X) screens.nav.items[screens.nav.index]?.del?.(); if (fr.pressed.Y) screens.nav.items[screens.nav.index]?.share?.(); };
}

function routeDrawer(ctx, route, index) {
  const { screens } = ctx;
  const W = 520, H = 420, DOWN = [-3, 30], OUT = [-15, 12]; // grid range in yards
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.className = 'rd-canvas';
  const X = (o) => ((o - OUT[0]) / (OUT[1] - OUT[0])) * W, Y = (d) => H - ((d - DOWN[0]) / (DOWN[1] - DOWN[0])) * H;
  const cur = route.pts.length ? [...route.pts[route.pts.length - 1]] : [2, 0];
  const info = el('div.league-status');
  const draw = () => {
    const g = cv.getContext('2d');
    g.fillStyle = '#0d2a12'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    for (let d = DOWN[0]; d <= DOWN[1]; d++) { g.beginPath(); g.moveTo(0, Y(d)); g.lineTo(W, Y(d)); g.lineWidth = d % 5 ? 1 : 2; g.stroke(); }
    for (let o = OUT[0]; o <= OUT[1]; o++) { g.beginPath(); g.moveTo(X(o), 0); g.lineTo(X(o), H); g.lineWidth = o === 0 ? 2 : 1; g.stroke(); }
    g.fillStyle = '#aaa'; g.font = '13px "Saira Condensed", sans-serif';
    g.fillText('← inside', 6, H - 6); g.fillText('outside →', W - 64, H - 6); g.fillText('line of scrimmage', 6, Y(0) - 4);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke();
    // The route so far (from the receiver, at 0,0), the cursor, and where it goes after the last point.
    g.strokeStyle = '#ffd23a'; g.lineWidth = 4; g.beginPath(); g.moveTo(X(0), Y(0));
    for (const [d, o] of route.pts) g.lineTo(X(o), Y(d));
    g.stroke();
    if (route.end === 'continue' && route.pts.length) {
      const a = route.pts.length > 1 ? route.pts[route.pts.length - 2] : [0, 0], b = route.pts[route.pts.length - 1];
      g.setLineDash([6, 6]); g.beginPath(); g.moveTo(X(b[1]), Y(b[0])); g.lineTo(X(b[1] + (b[1] - a[1]) * 2), Y(b[0] + (b[0] - a[0]) * 2)); g.stroke(); g.setLineDash([]);
    }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Y(0), 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ff5050'; g.lineWidth = 2; g.beginPath(); g.arc(X(cur[1]), Y(cur[0]), 7, 0, Math.PI * 2); g.stroke();
    info.textContent = `${route.name} · cursor ${cur[0]} yds downfield, ${cur[1] > 0 ? cur[1] + ' outside' : cur[1] < 0 ? -cur[1] + ' inside' : 'straight'} · ${route.pts.length}/6 points · ends: ${route.end === 'settle' ? 'settles in the open' : 'keeps running'}`;
  };
  cv.onclick = (e) => {
    const r = cv.getBoundingClientRect();
    const o = Math.round(OUT[0] + ((e.clientX - r.left) / r.width) * (OUT[1] - OUT[0]));
    const d = Math.round(DOWN[0] + (1 - (e.clientY - r.top) / r.height) * (DOWN[1] - DOWN[0]));
    cur[0] = d; cur[1] = o;
    if (route.pts.length < 6) route.pts.push([d, o]);
    draw();
  };
  const save = el('div.start-btn', { text: 'Save route' });
  save.activate = () => {
    if (!route.pts.length) { window.alert('Drop at least one point (A).'); return; }
    if (index < 0) { const v = window.prompt('Route name:', route.name); if (v && v.trim()) route.name = v.trim().slice(0, 20); }
    const list = loadRoutes();
    if (index >= 0) list[index] = route; else list.push(route);
    saveRoutes(list); registerCustomRoutes(list);
    routeList(ctx, index >= 0 ? index : list.length - 1);
  };
  const rename = el('div.start-btn.secondary', { text: 'Rename' });
  rename.activate = () => { const v = window.prompt('Route name:', route.name); if (v && v.trim()) { route.name = v.trim().slice(0, 20); draw(); } };
  const cancel = el('div.start-btn.secondary', { text: 'Cancel' });
  cancel.activate = () => routeList(ctx);
  screens.frame('setup-screen', el('h1', { text: index >= 0 ? 'Edit Route' : 'Draw a Route' }), info, el('div.rd-wrap', {}, cv),
    el('div.over-buttons', {}, save, rename, cancel),
    el('div.setup-help', { html: 'D-pad move the cursor (or click) &nbsp; <b class="btn A">A</b> drop a point &nbsp; <b class="btn X">X</b> undo &nbsp; <b class="btn Y">Y</b> end: run on / settle &nbsp; <b class="btn RB">RB</b> save &nbsp; <b class="btn B">B</b> cancel' }));
  screens.nav.set([], { onBack: () => routeList(ctx) });
  screens.extraButtons = (fr) => {
    const step = (dd, oo) => { cur[0] = Math.max(DOWN[0], Math.min(DOWN[1], cur[0] + dd)); cur[1] = Math.max(OUT[0], Math.min(OUT[1], cur[1] + oo)); draw(); };
    if (fr.pressed.Up) step(1, 0); if (fr.pressed.Down) step(-1, 0); if (fr.pressed.Left) step(0, -1); if (fr.pressed.Right) step(0, 1);
    if (fr.flick?.up) step(3, 0); if (fr.flick?.down) step(-3, 0); if (fr.flick?.left) step(0, -3); if (fr.flick?.right) step(0, 3);
    if (fr.pressed.A && route.pts.length < 6) { route.pts.push([...cur]); draw(); }
    if (fr.pressed.X && route.pts.length) { route.pts.pop(); draw(); }
    if (fr.pressed.Y) { route.end = route.end === 'settle' ? 'continue' : 'settle'; draw(); }
    if (fr.pressed.RB) save.activate();
  };
  draw();
}

// ---------------------------------------------------------------------------------------------------------------
// Defensive Plays: a formation and one job per player (rush, blitz, spy, a zone, or man on a receiver).
function defList(ctx, focus = 0) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const specs = loadDefSpecs();
  const rows = specs.map((sp, i) => {
    const it = screens.menuItem(sp.name, `${getDefFormation(sp.formation)?.name || sp.formation} · ${buildDefPlay(sp).coverage}`, () => defEditor(ctx, JSON.parse(JSON.stringify(sp)), i));
    it.del = () => { if (!window.confirm(`Delete "${sp.name}"?`)) return; specs.splice(i, 1); saveDefSpecs(specs); registerCustomDefPlays(specs); defList(ctx, Math.max(0, i - 1)); };
    it.share = () => showCode(shareCode('def', sp));
    return it;
  });
  const add = screens.menuItem('New Defense', 'Start from a formation', () => defEditor(ctx, newDefSpec(`mydef_${Date.now().toString(36)}`), -1));
  const items = [...rows, add];
  screens.frame('menu-screen', el('div.logo-small', { html: 'DEFENSIVE PLAYS' }),
    el('div.league-status', { text: 'Your defenses show up in the "My Plays" tab when you call a defense (the CPU never uses them).' }),
    el('div.menu-list', {}, items),
    el('div.setup-help', { html: '<b class="btn A">A</b> edit &nbsp; <b class="btn X">X</b> delete &nbsp; <b class="btn Y">Y</b> share code &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { onBack: () => playbookScreen(ctx), index: Math.min(focus, items.length - 1) });
  screens.extraButtons = (fr) => { if (fr.pressed.X) screens.nav.items[screens.nav.index]?.del?.(); if (fr.pressed.Y) screens.nav.items[screens.nav.index]?.share?.(); };
}

const jobName = (a) => (a.startsWith('zone:') ? `Zone: ${label(a.slice(5))}` : a.startsWith('man:') ? `Man on ${a.slice(4)}` : label(a));

function defEditor(ctx, spec, index, focus = 0) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const redraw = (f = focus) => defEditor(ctx, spec, index, f);
  const rows = [];
  const option = (name, values, get, set, fmt = (v) => String(v)) => {
    const row = el('div.opt-row');
    const i = Math.max(0, values.indexOf(get()));
    row.append(el('span.opt-label', { text: name }), el('span.opt-val', { html: `◀ ${fmt(values[i])} ▶` }));
    row.spin = (d) => { set(values[(i + d + values.length) % values.length]); redraw(rows.indexOf(row)); };
    row.activate = () => row.spin(1);
    rows.push(row);
  };
  const nameRow = el('div.opt-row', {}, el('span.opt-label', { text: 'Name' }), el('span.opt-val', { text: spec.name }));
  nameRow.activate = () => { const v = window.prompt('Defense name', spec.name); if (v && v.trim()) { spec.name = v.trim().slice(0, 28); redraw(0); } };
  rows.push(nameRow);
  option('Formation', defFormations(), () => spec.formation, (v) => Object.assign(spec, changeDefFormation(spec, v)), (v) => getDefFormation(v)?.name || v);
  const jobs = DEF_ASSIGN_CHOICES();
  for (const p of getDefFormation(spec.formation).players) option(`${p.s} (${p.p})`, jobs, () => spec.assign[p.s], (v) => { spec.assign[p.s] = v; }, jobName);
  spec.rev = (spec.rev || 0) + 1;
  const play = buildDefPlay(spec);
  const rushers = Object.values(play.assign).filter((a) => a === 'rush' || a === 'blitz').length;
  const save = el('div.start-btn', { text: 'Save defense' });
  save.activate = () => {
    const specs = loadDefSpecs();
    if (index >= 0) specs[index] = spec; else specs.push(spec);
    saveDefSpecs(specs); registerCustomDefPlays(specs);
    defList(ctx, index >= 0 ? index : specs.length - 1);
  };
  const cancel = el('div.start-btn.secondary', { text: 'Cancel' });
  cancel.activate = () => defList(ctx);
  screens.frame('setup-screen', el('h1', { text: index >= 0 ? 'Edit Defense' : 'New Defense' }),
    el('div.pb-edit', {}, el('div.pb-art', {}, defenseArt(play, 460, 260), el('div.pb-test', { text: `${play.coverage === 'man' ? 'Man' : 'Zone'} coverage · ${rushers} rusher${rushers === 1 ? '' : 's'}` })),
      el('div.setup-opts.pb-opts', {}, ...rows)),
    el('div.over-buttons', {}, save, cancel),
    el('div.setup-help', { html: '<b class="btn A">A</b>/◀▶ change &nbsp; ▲▼ move &nbsp; <b class="btn B">B</b> cancel' }));
  screens.nav.set([...rows, save, cancel], { columns: 1, onBack: () => defList(ctx), index: Math.min(focus, rows.length + 1) });
}

// ---------------------------------------------------------------------------------------------------------------
// Mod packs: .json files with formations / plays / routes (data/mods.js). A toggles a pack, X removes it.
function modScreen(ctx, focus = 0, report = null) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const list = loadMods();
  const rows = list.map((m, i) => {
    const v = validateMod(m.json);
    const it = screens.menuItem(`${m.enabled ? '● ' : '○ '}${m.json.name || 'Mod pack'}`, `${v.pack?.offense.length || 0} offensive · ${v.pack?.defense.length || 0} defensive plays · ${Object.keys(v.pack?.routes || {}).length} routes${m.enabled ? ' · ON' : ' · off'}`, () => {
      m.enabled = !m.enabled;
      if (m.enabled && v.ok) applyMod(v.pack); else if (v.pack) removeMod(v.pack.id);
      saveMods(list); modScreen(ctx, i);
    });
    it.del = () => { if (!window.confirm(`Remove "${m.json.name}"?`)) return; if (v.pack) removeMod(v.pack.id); list.splice(i, 1); saveMods(list); modScreen(ctx, Math.max(0, i - 1)); };
    return it;
  });
  const imp = screens.menuItem('Import a mod pack…', 'A .json file (see the example for the format)', async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    let json;
    try { json = JSON.parse(f.data); } catch (e) { modScreen(ctx, 0, [`${f.name}: not valid JSON (${e.message})`]); return; }
    const v = validateMod(json);
    if (!v.ok) { modScreen(ctx, 0, [`${f.name}: nothing usable`, ...v.errors.slice(0, 8)]); return; }
    const all = loadMods().filter((m) => validateMod(m.json).pack?.id !== v.pack.id);
    all.push({ json, enabled: true });
    saveMods(all); applyMod(v.pack);
    modScreen(ctx, all.length - 1, [`Installed "${v.pack.name}": ${v.pack.offense.length} offensive, ${v.pack.defense.length} defensive plays, ${Object.keys(v.pack.routes).length} routes`, ...(v.errors.length ? [`${v.errors.length} skipped:`, ...v.errors.slice(0, 6)] : [])]);
  });
  const ex = screens.menuItem('Download an example pack', 'example.g27mod.json: one formation, two plays and a custom route', () => downloadFile('example.g27mod.json', JSON.stringify(exampleMod(), null, 1), 'application/json'));
  const items = [...rows, imp, ex];
  screens.frame('menu-screen', el('div.logo-small', { html: 'MOD PACKS' }),
    report ? el('div.ss-report', {}, report.map((l) => el('div', { text: l }))) : el('div.league-status', { text: 'Plays from packs that are on show up in their formation families; the CPU calls them too.' }),
    el('div.menu-list', {}, items),
    el('div.setup-help', { html: '<b class="btn A">A</b> on / off &nbsp; <b class="btn X">X</b> remove &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { onBack: () => playbookScreen(ctx), index: Math.min(focus, items.length - 1) });
  screens.extraButtons = (fr) => { if (fr.pressed.X) screens.nav.items[screens.nav.index]?.del?.(); };
}
