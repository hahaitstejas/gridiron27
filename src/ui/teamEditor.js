import { el } from './nav.js';
import { logoCanvas, drawLogo, LOGO_SHAPES } from '../render/logo.js';
import { CONFERENCES, DIVISIONS } from '../data/teams.js';
import { pickFile, loadImage } from '../data/storage.js';
import { LEAGUE } from '../data/leagueInfo.js';

// Colors to cycle through with left/right (A types any hex color).
const PALETTE = ['#0b162a', '#1d2f5c', '#002244', '#003594', '#0076b6', '#4b92db', '#008e97', '#006778', '#125740', '#203731',
  '#4f2683', '#5a1414', '#97233f', '#a71930', '#c8102e', '#e31837', '#fb4f14', '#c83803', '#ffb612', '#ffc20e', '#d7a22a',
  '#b3995d', '#a5acaf', '#b0b7bc', '#ffffff', '#101820', '#000000', '#311d00', '#69be28', '#869397'];
const HEX = /^#?[0-9a-f]{6}$/i;

/**
 * League → Teams & Logos: city, name, abbreviation, colors, conference/division, play-as, and the logo
 * builder (shape, letters, colors, or an uploaded image) with a live preview.
 * ctx = { screens, teams, prefs, onBack, onChange, pickTeam }.
 */
export function teamEditor(ctx, ti, focus = 0) {
  const { screens, teams, prefs } = ctx;
  const t = teams[ti];
  screens.extraButtons = null;
  const preview = document.createElement('canvas');
  preview.width = preview.height = 150;
  const title = el('h1');
  const bugPreview = el('div.te-bug');
  const redraw = () => {
    const g = preview.getContext('2d');
    g.clearRect(0, 0, 150, 150);
    drawLogo(g, t.logo, 75, 75, 69);
    title.textContent = `${t.city} ${t.name}`;
    bugPreview.innerHTML = '';
    bugPreview.style.background = t.colors.primary;
    bugPreview.style.borderColor = t.colors.accent;
    bugPreview.append(logoCanvas(t.logo, 28), el('b', { text: t.abbr, style: { color: t.colors.secondary } }));
  };
  const changed = () => { redraw(); ctx.onChange(); };

  const { row, textRow, colorRow, choice } = rowKit(changed);

  const rows = [
    textRow('City', t, 'city', 24),
    textRow('Team name', t, 'name', 24),
    row('Abbreviation', () => t.abbr, () => {}, () => {
      const v = window.prompt('Abbreviation (2–4 letters):', t.abbr);
      if (!v || !/^[a-z0-9]{2,4}$/i.test(v.trim())) return false;
      const abbr = v.trim().toUpperCase();
      if (teams.some((o) => o !== t && o.abbr === abbr)) { window.alert(`${abbr} is already used by another team.`); return false; }
      if (t.logo.text === t.abbr) t.logo.text = abbr; // the default logo letters follow the abbreviation
      t.abbr = abbr;
      return true;
    }),
    choice('Conference', CONFERENCES, () => CONFERENCES[t.conference], (v) => { t.conference = CONFERENCES.indexOf(v); }),
    choice('Division', DIVISIONS, () => DIVISIONS[t.division], (v) => { t.division = DIVISIONS.indexOf(v); }),
    colorRow('Primary color', t.colors, 'primary'),
    colorRow('Secondary color', t.colors, 'secondary'),
    colorRow('Accent color', t.colors, 'accent'),
    el('div.dc-head', { text: 'Logo builder' }),
    choice('Logo shape', LOGO_SHAPES, () => t.logo.shape, (v) => { t.logo.shape = v; }),
    textRow('Logo letters', t.logo, 'text', 4),
    colorRow('Logo background', t.logo, 'bg'),
    colorRow('Logo letters color', t.logo, 'fg'),
    colorRow('Logo border', t.logo, 'border'),
  ];
  const action = (label, fn) => { const a = el('div.opt-row.action', {}, el('span.opt-label', { text: label })); a.activate = fn; return a; };
  rows.push(
    action('Use team colors for the logo', () => {
      Object.assign(t.logo, { bg: t.colors.primary, fg: t.colors.secondary, border: t.colors.accent });
      teamEditor(ctx, ti, rows.length);
      ctx.onChange();
    }),
    action(t.logo.dataUrl ? 'Replace logo image…' : 'Upload a logo image…', async () => {
      const f = await pickFile('image/*', true);
      if (!f) return;
      const img = await loadImage(f.data);
      if (!img) { window.alert("That file couldn't be read as an image."); return; }
      t.logo.dataUrl = await shrinkImage(img, 256);
      t.logo._img = await loadImage(t.logo.dataUrl);
      changed();
      teamEditor(ctx, ti, rows.length);
    }),
  );
  if (t.logo.dataUrl || t.logo._img) rows.push(action('Remove logo image (use the built logo)', () => {
    delete t.logo.dataUrl; delete t.logo.image; t.logo._img = null;
    changed();
    teamEditor(ctx, ti, rows.length);
  }));
  rows.push(action(prefs.home === ti ? '★ This is your team' : 'Make this my team', () => { prefs.home = ti; if (prefs.away === ti) prefs.away = (ti + 1) % teams.length; ctx.onChange(); teamEditor(ctx, ti, focus); }));
  const done = el('div.start-btn', { text: 'Done' });
  done.activate = ctx.onBack;
  const items = [...rows.filter((r) => r.activate), done];
  redraw();
  screens.frame('depth-screen', title,
    el('div.te-layout', {}, el('div.te-preview', {}, preview, bugPreview), el('div.setup-opts.card-opts', {}, rows, done)),
    el('div.setup-help', { html: '◀▶ change &nbsp; <b class="btn A">A</b> type / choose &nbsp; <b class="btn LB">LB</b>/<b class="btn RB">RB</b> team &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { columns: 1, index: Math.min(focus, items.length - 1), onBack: ctx.onBack, onTab: (d) => teamEditor(ctx, (ti + d + teams.length) % teams.length) });
}

/**
 * League → Teams & Logos → League & Conferences: league name, championship game name, the two conference
 * names and the league logo (painted at both 25-yard lines, and at midfield in the championship game).
 * ctx = the team editor's ctx (onBack returns to the team list, onChange autosaves).
 */
export function leagueEditor(ctx, focus = 0) {
  const { screens } = ctx;
  screens.extraButtons = null;
  const preview = document.createElement('canvas');
  preview.width = preview.height = 150;
  const title = el('h1', { text: 'League & Conferences' });
  const redraw = () => {
    const g = preview.getContext('2d');
    g.clearRect(0, 0, 150, 150);
    drawLogo(g, LEAGUE.logo, 75, 75, 69);
  };
  const changed = () => { redraw(); ctx.onChange(); };
  const { row, textRow, colorRow, choice } = rowKit(changed);
  const confRow = (i) => row(`Conference ${i + 1} name`, () => CONFERENCES[i], () => {}, () => {
    const v = window.prompt(`Conference ${i + 1} name:`, CONFERENCES[i]);
    if (!v || !v.trim()) return false;
    CONFERENCES[i] = v.trim().slice(0, 20);
    return true;
  });
  const action = (label, fn) => { const a = el('div.opt-row.action', {}, el('span.opt-label', { text: label })); a.activate = fn; return a; };
  const rows = [
    textRow('League name', LEAGUE, 'name', 30),
    textRow('Championship game', LEAGUE, 'championship', 30),
    confRow(0),
    confRow(1),
    el('div.dc-head', { text: 'League logo (25-yard lines; midfield in the championship)' }),
    choice('Logo shape', LOGO_SHAPES, () => LEAGUE.logo.shape, (v) => { LEAGUE.logo.shape = v; }),
    textRow('Logo letters', LEAGUE.logo, 'text', 4),
    colorRow('Logo background', LEAGUE.logo, 'bg'),
    colorRow('Logo letters color', LEAGUE.logo, 'fg'),
    colorRow('Logo border', LEAGUE.logo, 'border'),
    action(LEAGUE.logo.dataUrl ? 'Replace logo image…' : 'Upload a logo image…', async () => {
      const f = await pickFile('image/*', true);
      if (!f) return;
      const img = await loadImage(f.data);
      if (!img) { window.alert("That file couldn't be read as an image."); return; }
      LEAGUE.logo.dataUrl = await shrinkImage(img, 256);
      LEAGUE.logo._img = await loadImage(LEAGUE.logo.dataUrl);
      changed();
      leagueEditor(ctx, rows.length);
    }),
  ];
  if (LEAGUE.logo.dataUrl) rows.push(action('Remove logo image (use the built logo)', () => {
    delete LEAGUE.logo.dataUrl; LEAGUE.logo._img = null;
    changed();
    leagueEditor(ctx, rows.length);
  }));
  const done = el('div.start-btn', { text: 'Done' });
  done.activate = ctx.onBack;
  const items = [...rows.filter((r) => r.activate), done];
  redraw();
  screens.frame('depth-screen', title,
    el('div.te-layout', {}, el('div.te-preview', {}, preview), el('div.setup-opts.card-opts', {}, rows, done)),
    el('div.setup-help', { html: '◀▶ change &nbsp; <b class="btn A">A</b> type / choose &nbsp; <b class="btn B">B</b> back' }));
  screens.nav.set(items, { columns: 1, index: Math.min(focus, items.length - 1), onBack: ctx.onBack });
}

/** Option-row builders shared by the team and league editors (◀▶ change, A types / chooses). */
function rowKit(changed) {
  const row = (label, get, spin, onType) => {
    const val = el('span.opt-val');
    const r = el('div.opt-row', {}, el('span.opt-label', { text: label }), val);
    const draw = () => { val.innerHTML = `◀ ${get()} ▶`; };
    r.spin = (d) => { spin(d); draw(); changed(); };
    r.activate = async () => { if (await onType()) { draw(); changed(); } };
    draw();
    return r;
  };
  const textRow = (label, obj, key, max) => row(label, () => obj[key] || '—', () => {}, () => {
    const v = window.prompt(`${label}:`, obj[key] || '');
    if (v === null || !v.trim()) return false;
    obj[key] = v.trim().slice(0, max);
    return true;
  });
  const pick = (list, cur, d) => list[(Math.max(0, list.indexOf(cur)) + d + list.length) % list.length];
  const swatch = (c) => `<i class="te-swatch" style="background:${c}"></i>${c}`;
  const colorRow = (label, obj, key, after = () => {}) => row(label, () => swatch(obj[key]), (d) => { obj[key] = pick(PALETTE, obj[key], d); after(); }, () => {
    const v = window.prompt(`${label} (hex color like #c83803):`, obj[key]);
    if (!v || !HEX.test(v.trim())) return false;
    obj[key] = (v.trim().startsWith('#') ? '' : '#') + v.trim().toLowerCase();
    after();
    return true;
  });
  const choice = (label, list, get, set) => row(label, () => get(), (d) => set(pick(list, get(), d)), () => { set(pick(list, get(), 1)); return true; });

  return { row, textRow, colorRow, choice };
}

/** Downscale an uploaded image so saves stay small (PNG data URL, longest side <= max). */
async function shrinkImage(img, max) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
