// League identity (pure data): the league's name, its two conference names and its logo (same shape as a team
// logo: { shape, bg, fg, border, text } or an uploaded image as dataUrl). Saved with the league (`info`).
// CONFERENCES is changed in place so every screen that shows conference names picks up the new ones.
import { CONFERENCES } from './teams.js';
import { PLAYOFF_ROUND_NAMES } from '../franchise/season.js';

const DEFAULT_CONFERENCES = [...CONFERENCES];
const defaults = () => ({ name: 'Gridiron League', championship: 'Gridiron Championship', logo: { shape: 'shield', bg: '#10224a', fg: '#ffffff', border: '#c9a64b', text: 'GL' } });

export const LEAGUE = defaults();

/** Apply a saved info block (or null for the defaults). */
export function setLeagueInfo(info) {
  const d = defaults();
  LEAGUE.name = info?.name || d.name;
  LEAGUE.championship = info?.championship || d.championship;
  PLAYOFF_ROUND_NAMES[PLAYOFF_ROUND_NAMES.length - 1] = LEAGUE.championship;
  LEAGUE.logo = { ...d.logo, ...(info?.logo || {}) };
  delete LEAGUE.logo._img;
  const conf = info?.conferences || DEFAULT_CONFERENCES;
  for (let i = 0; i < CONFERENCES.length; i++) CONFERENCES[i] = conf[i] || DEFAULT_CONFERENCES[i];
}

/** Plain JSON for the save file. */
export function leagueInfoJSON() {
  const { _img, ...logo } = LEAGUE.logo;
  return { name: LEAGUE.name, championship: LEAGUE.championship, conferences: [...CONFERENCES], logo };
}
