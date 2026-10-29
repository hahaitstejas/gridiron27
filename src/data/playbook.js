import formationsJson from './playbooks/formations.json' with { type: 'json' };
import offenseJson from './playbooks/offense.json' with { type: 'json' };
import defenseJson from './playbooks/defense.json' with { type: 'json' };
import specialJson from './playbooks/special.json' with { type: 'json' };

const offFormations = { ...formationsJson.offense, ...specialJson.formations.offense };
const defFormations = { ...formationsJson.defense, ...specialJson.formations.defense };
const offPlays = [...offenseJson.plays, ...specialJson.offense];
const defPlays = [...defenseJson.plays, ...specialJson.defense];
const SPECIAL = new Set(['kickoff', 'punt', 'fg', 'kneel', 'spike', 'return', 'block']);
/** Plays a team can pick from the normal play-call list (no special teams). */
export const isScrimmagePlay = (p) => !SPECIAL.has(p.type);

export const getOffFormation = (id) => offFormations[id];
export const getDefFormation = (id) => defFormations[id];
export const listOffPlays = (all = false) => (all ? offPlays : offPlays.filter(isScrimmagePlay));
export const listDefPlays = (all = false) => (all ? defPlays : defPlays.filter(isScrimmagePlay));
export const getOffPlay = (id) => offPlays.find((p) => p.id === id);
export const getDefPlay = (id) => defPlays.find((p) => p.id === id);

/** Register additional plays/formations at runtime (used by playbook packs). */
export function registerPlaybook({ formations = {}, offense = [], defense = [] }) {
  Object.assign(offFormations, formations.offense || {});
  Object.assign(defFormations, formations.defense || {});
  offPlays.push(...offense);
  defPlays.push(...defense);
}

/** Replace the user's custom plays ("My Plays", data/customPlays.js) in the offensive list. */
export function setCustomPlays(plays) {
  for (let i = offPlays.length - 1; i >= 0; i--) if (offPlays[i].custom) offPlays.splice(i, 1);
  offPlays.push(...plays);
}

const swapSide = (r) => (r.endsWith('_l') ? r.slice(0, -2) + '_r' : r.endsWith('_r') ? r.slice(0, -2) + '_l' : r);

/** Mirror an offensive play left/right ("flip" on the play-call screen). */
export function mirrorOffPlay(play) {
  const f = getOffFormation(play.formation);
  const fid = play.formation + '__flip';
  if (!offFormations[fid]) {
    offFormations[fid] = {
      ...f,
      name: f.name + ' (Flip)',
      players: f.players.map((p) => ({ ...p, at: [p.at[0], -p.at[1]] })),
    };
  }
  const routes = {};
  for (const [k, v] of Object.entries(play.routes || {})) routes[k] = swapSide(v);
  const m = { ...play, id: play.id + '__flip', formation: fid, routes, flipped: true };
  if (play.boot) m.boot = -play.boot;
  if (play.run) {
    m.run = {
      ...play.run,
      aim: [play.run.aim[0], -play.run.aim[1]],
      mesh: play.run.mesh ? [play.run.mesh[0], -play.run.mesh[1]] : undefined,
      side: -(play.run.side || 1),
    };
  }
  return m;
}
