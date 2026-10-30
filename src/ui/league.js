import { el } from './nav.js';
import { serializeLeague, deserializeLeague } from '../data/league.js';
import { LEAGUE, setLeagueInfo } from '../data/leagueInfo.js';
import { defaultTeams } from '../data/teams.js';
import { generateLeagueRosters } from '../data/generator.js';
import { writeSave, readSave, deleteSave, listSaves, activeSlot, setActiveSlot, downloadFile, pickFile, loadImage } from '../data/storage.js';

/** Attach logo images (uploaded data URLs or files in public/local/logos) to teams. */
export async function attachLogos(teams) {
  await Promise.all([...teams.map(async (t) => {
    const src = t.logo?.dataUrl || (t.logo?.image ? `/local/logos/${t.logo.image}` : null);
    t.logo._img = src ? await loadImage(src) : null;
  }), (async () => { LEAGUE.logo._img = LEAGUE.logo.dataUrl ? await loadImage(LEAGUE.logo.dataUrl) : null; })()]);
}

/**
 * League management (Phase 4): saves, rosters, teams/logos, depth charts, spreadsheets.
 * Owns the autosave: editors call `changed()` after every edit.
 */
export class LeagueUI {
  constructor({ teams, prefs, screens, onExit, onLeagueReplaced }) {
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
    const item = (label, sub, fn) => S.menuItem(label, sub, fn);
    const items = [
      item('Rosters', 'Edit players and ratings, add, release or trade', () => this.onRosters?.()),
      item('Teams & Logos', 'Names, colors, conference, logo builder', () => this.onTeams?.()),
      item('Depth Charts', 'Starters and rotation for any team', () => this.onDepth?.()),
      item('Playbook', 'Design your own plays (My Plays)', () => this.onPlaybook?.()),
      item('Spreadsheets', 'Export or import teams, rosters and depth charts as CSV', () => this.onSpreadsheets?.()),
      item('Saves & Files', 'Save slots, back up to a file, start over', () => this.saves()),
    ];
    S.frame('menu-screen', el('div.logo-small', { html: 'LEAGUE' }),
      el('div.league-status', { text: `${this.name}${this.slot ? '' : ' (not saved yet)'}${this.status ? ' · ' + this.status : ''}` }),
      el('div.menu-list', {}, items));
    S.nav.set(items, { onBack: this.onExit, index: focus });
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
