import { el } from './nav.js';
import { offenseArt } from './playart.js';
import { getOffFormation } from '../data/playbook.js';
import {
  ROUTE_CHOICES, RUN_GAPS, customFormations, eligibleSlots, newSpec, changeFormation, buildPlay, registerCustomPlays, loadSpecs, saveSpecs,
} from '../data/customPlays.js';
import { testPlay } from '../game/playtest.js';

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
  const items = [...rows, add];
  screens.frame('menu-screen', el('div.logo-small', { html: 'MY PLAYS' }),
    el('div.league-status', { text: specs.length ? `${specs.length} custom play${specs.length > 1 ? 's' : ''} · they show up in the "My Plays" tab when you call a play` : 'Design your own plays: they show up in the "My Plays" tab when you call a play' }),
    el('div.menu-list', {}, items),
    el('div.setup-help', { html: '<b class="btn A">A</b> edit &nbsp; <b class="btn X">X</b> delete &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { onBack: ctx.onBack, index: Math.min(focus, items.length - 1) });
  screens.extraButtons = (fr) => { if (fr.pressed.X) screens.nav.items[screens.nav.index]?.del?.(); };
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
    for (const e of elig) option(`${e.slot} (${e.pos})`, ROUTE_CHOICES, () => spec.routes[e.slot], (v) => { spec.routes[e.slot] = v; }, label);
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
