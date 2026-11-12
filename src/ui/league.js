import { el } from './nav.js';
import { ICONS } from './screens.js';
import { serializeLeague, deserializeLeague } from '../data/league.js';
import { LEAGUE, setLeagueInfo } from '../data/leagueInfo.js';
import { defaultTeams } from '../data/teams.js';
import { generateLeagueRosters } from '../data/generator.js';
import { writeSave, readSave, deleteSave, listSaves, activeSlot, setActiveSlot, downloadFile, pickFile, loadImage } from '../data/storage.js';

/** Where a patch image comes from: a web link / data URL as it is, or a file name in /local/logos/. */
export const patchSrc = (img) => (/^(https?:|data:)/i.test(img) ? img : `/local/logos/${img}`);

/** Attach logo images (uploaded data URLs or files in public/local/logos) to teams, and the images of uniform patches. */
export async function attachLogos(teams) {
  // Uniform patches written as an image link (uniforms.csv): the loaded image rides on the patch as a hidden `_img`
  // (not enumerable, so it never ends up in a save file).
  const patchLoads = [];
  for (const t of teams) for (const u of Object.values(t.uniforms || {})) for (const p of Object.values(u?.patches || {})) {
    if (p?.image) patchLoads.push(loadImage(patchSrc(p.image)).then((img) => Object.defineProperty(p, '_img', { value: img, enumerable: false, writable: true, configurable: true })));
  }
  await Promise.all([...patchLoads, ...teams.map(async (t) => {
    const src = t.logo?.dataUrl || (t.logo?.image ? (/^(https?:|data:)/i.test(t.logo.image) ? t.logo.image : `/local/logos/${t.logo.image}`) : null);
    t.logo._img = src ? await loadImage(src) : null;
  }), (async () => { const s = logoSrc(LEAGUE.logo); LEAGUE.logo._img = s ? await loadImage(s) : null; })(),
    ...(LEAGUE.confLogos || []).map(async (c) => { const s = logoSrc(c); if (s) c._img = await loadImage(s); })]);
}

/** Where a logo's image comes from: an uploaded data URL, a web link, or a file name in /local/logos/. */
export function logoSrc(l) {
  if (l?.dataUrl) return l.dataUrl;
  if (!l?.image) return null;
  return /^(https?:|data:)/i.test(l.image) ? l.image : `/local/logos/${l.image}`;
}

/**
 * League management (Phase 4): saves, rosters, teams/logos, depth charts, spreadsheets.
 * Owns the autosave: editors call `changed()` after every edit.
 */
export class LeagueUI {
  constructor({ teams, prefs, screens, onExit, onLeagueReplaced, loadDefault }) {
    this.loadDefault = loadDefault; // () => { teams, name }: the default league (+ public/local spreadsheets)
    this.teams = teams;
    this.prefs = prefs;
    this.screens = screens;
    this.onExit = onExit;
    this.onLeagueReplaced = onLeagueReplaced || (() => {});
    this.name = 'My League';
    this.slot = activeSlot();
    this.saveT = null;
    this.status = '';
    this.franchise = null; // franchise mode state saved with this league (src/franchise)
  }

  /** Something in the league changed: save it a moment later (creating a save slot the first time). */
  changed() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => this.saveNow(), 800);
  }

  async saveNow(slot = this.slot) {
    if (!slot) { slot = await this.newSlotName(); this.slot = slot; setActiveSlot(slot); }
    await writeSave(slot, serializeLeague(this.teams, { name: this.name, playAs: this.prefs.home, franchise: this.franchise }));
    this.status = `Saved "${this.name}" ${new Date().toLocaleTimeString()}`;
  }

  async newSlotName() {
    const taken = new Set((await listSaves()).map((s) => s.slot));
    let i = 1;
    while (taken.has(`league-${i}`)) i++;
    return `league-${i}`;
  }

  /**
   * Back to the real league after franchise mode. A franchise is fictional: its trades, signings, drafts and career
   * player live only in its own save, so Play Now / Practice / the editors go back to the league it started from
   * (`franchise.baseSlot`; older franchises: the newest save without a franchise; else the default league).
   */
  async leaveFranchise() {
    if (!this.franchise) return;
    clearTimeout(this.saveT);
    if (this.slot) await this.saveNow(); // keep the franchise's progress in its own slot
    const slot = await baseLeagueSlot(this.franchise.baseSlot);
    this.franchise = null;
    let L = null;
    if (slot) { try { L = deserializeLeague(await readSave(slot)); } catch { L = null; } }
    if (!L || L.franchise) L = null;
    this.slot = L ? slot : null;
    setActiveSlot(this.slot);
    if (L) await this.replaceLeague(L.teams, L.name);
    else { const d = await this.loadDefault(); await this.replaceLeague(d.teams, d.name); }
  }

  /** Replace the whole league in place (keeps every reference to `teams` valid). */
  async replaceLeague(newTeams, name) {
    this.teams.splice(0, this.teams.length, ...newTeams);
    this.name = name;
    await attachLogos(this.teams);
    this.onLeagueReplaced();
  }

  // ---------- screens ----------
  menu(focus = 0) {
    const S = this.screens;
    this.savesBack = null;
    S.extraButtons = null;
    // Tiles like the Rosters hub (title top-left, line icon bottom-right, focused one white).
    const item = (label, sub, icon, fn) => {
      const t = el('div.rx-tile', {}, el('div.rx-title', { text: label }), el('div.rx-sub', { text: sub }), el('div.rx-ico', { html: ICONS[icon] || '' }));
      t.activate = fn;
      return t;
    };
    const items = [
      item('Rosters', 'Players and ratings: edit, create, trade, release', 'people', () => this.onRosters?.()),
      item('Teams & Logos', 'Names, colors, conference, logo builder', 'shield', () => this.onTeams?.()),
      item('Depth Charts', 'Starters and rotation for any team', 'list', () => this.onDepth?.()),
      item('Playbook', 'Design your own plays (My Plays)', 'clipboard', () => this.onPlaybook?.()),
      item('Spreadsheets', 'Export or import teams, rosters and depth charts', 'chart', () => this.onSpreadsheets?.()),
      item('Saves & Files', 'Save slots, back up to a file, start over', 'disk', () => this.saves()),
    ];
    S.frame('mono-screen rx-screen', el('h1', { text: 'Edit League' }),
      el('div.rx-status', { text: `${this.name}${this.slot ? '' : ' (not saved yet)'}${this.status ? ' · ' + this.status : ''}` }),
      el('div.rx-grid', {}, items),
      el('div.mm2-bar', { html: '<span><b class="btn A">A</b> SELECT</span><span><b class="btn B">B</b> BACK</span>' }));
    S.nav.set(items, { spatial: true, onBack: this.onExit, index: focus });
  }

  async saves(focus = 0, back = null) {
    const S = this.screens;
    if (back) this.savesBack = back; // opened from the main menu: B goes back there
    const list = await listSaves();
    const rows = [];
    const add = (label, sub, fn) => { const it = S.menuItem(label, sub, fn); rows.push(it); return it; };
    add('Save now', this.slot ? `Overwrite "${this.name}"` : 'Create a save for this league', async () => { await this.saveNow(); this.saves(0); });
    add('Save as new…', 'Copy this league into a new slot', async () => {
      const name = window.prompt('Name for the new save:', `${this.name} copy`);
      if (!name) return;
      this.name = name.slice(0, 40);
      this.slot = await this.newSlotName();
      setActiveSlot(this.slot);
      await this.saveNow();
      this.saves(1);
    });
    add('Rename league…', `Currently "${this.name}"`, async () => {
      const name = window.prompt('League name:', this.name);
      if (!name) return;
      this.name = name.slice(0, 40);
      await this.saveNow();
      this.saves(2);
    });
    for (const s of list) {
      const active = s.slot === this.slot;
      const it = add(`${active ? '● ' : ''}${s.name}`, `${active ? 'Current league · ' : 'A to load · '}X to delete · saved ${s.savedAt ? new Date(s.savedAt).toLocaleString() : '?'}`, async () => {
        if (active) return;
        if (!window.confirm(`Load "${s.name}"? Unsaved changes to the current league are already autosaved.`)) return;
        const data = await readSave(s.slot);
        try {
          const L = deserializeLeague(data);
          this.slot = s.slot; setActiveSlot(s.slot);
          if (L.playAs !== null) this.prefs.home = L.playAs;
          this.franchise = L.franchise;
          await this.replaceLeague(L.teams, L.name);
          this.status = `Loaded "${L.name}"`;
        } catch (e) { window.alert(`Couldn't load that save: ${e.message}`); }
        this.saves(0);
      });
      it.deleteSave = async () => {
        if (!window.confirm(`Delete the save "${s.name}"? This can't be undone.`)) return;
        await deleteSave(s.slot);
        if (active) this.slot = null;
        this.saves(0);
      };
    }
    add('Export league file', 'Download the whole league as a .json backup', () => {
      const data = serializeLeague(this.teams, { name: this.name, playAs: this.prefs.home, franchise: this.franchise });
      downloadFile(`${this.name.replace(/[^\w-]+/g, '_')}.g27.json`, JSON.stringify(data));
    });
    add('Import league file…', 'Load a .json league backup (becomes a new save)', async () => {
      const f = await pickFile('.json,application/json');
      if (!f) return;
      try {
        const L = deserializeLeague(JSON.parse(f.data));
        if (L.playAs !== null) this.prefs.home = L.playAs;
        this.franchise = L.franchise;
        await this.replaceLeague(L.teams, L.name);
        this.slot = await this.newSlotName(); setActiveSlot(this.slot);
        await this.saveNow();
        this.status = `Imported "${L.name}"`;
      } catch (e) { window.alert(`That file couldn't be imported: ${e.message}`); }
      this.saves(0);
    });
    add('Start over with the default league', 'Fresh generated teams (your saves stay in the list)', async () => {
      if (!window.confirm('Switch to a fresh default league? Your current league stays in its save slot.')) return;
      this.slot = null; setActiveSlot(null);
      this.franchise = null;
      setLeagueInfo(null);
      await this.replaceLeague(generateLeagueRosters(defaultTeams(), 2027), 'My League');
      this.status = 'Default league';
      this.saves(0);
    });
    S.frame('menu-screen', el('div.logo-small', { html: 'SAVES' }),
      el('div.league-status', { text: this.status || (this.slot ? `Autosaving to "${this.name}"` : 'Not saved yet: edits will create a save') }),
      el('div.menu-list', {}, rows),
      el('div.setup-help', { html: '<b class="btn A">A</b> select &nbsp; <b class="btn X">X</b> delete save &nbsp; <b class="btn B">B</b> back' }));
    S.nav.set(rows, { onBack: () => (this.savesBack ? this.savesBack() : this.menu(5)), index: Math.min(focus, rows.length - 1) });
    S.extraButtons = (f) => { if (f.pressed.X) S.nav.current?.deleteSave?.(); };
  }
}

/** The save slot holding the league a franchise started from: `wanted` if it still exists without a franchise,
 * otherwise (older franchises: `wanted` undefined) the newest save without one; null = the default league. */
export async function baseLeagueSlot(wanted) {
  const saves = await listSaves();
  if (wanted === null) return null;
  const hit = wanted !== undefined && saves.find((s) => s.slot === wanted && !s.franchise);
  if (hit) return hit.slot;
  return saves.find((s) => !s.franchise)?.slot ?? null;
}
