// Contract talks (UPDATE 5.0, pure logic): re-signing is a negotiation instead of "pay the asking price".
// A player opens with a demand (salary for the years he wants: security for the young and the stars, short deals late in a
// career). An offer is judged on money against his ask, how far the years are from what he wants, his morale and whether
// the team wins; he accepts, counters (meeting you part of the way) or, after too many lowballs, walks to free agency.
// State lives in f.offseason.talks[pid] = { salary, years, patience, done?, walked? } (saved with the franchise).
import { RNG } from '../core/rng.js';
import { marketValue, MIN_SALARY } from './contracts.js';
import { teamMode } from './trades.js';
import { moraleOf } from './development.js';

export const PATIENCE = 3;
const round05 = (v) => Math.round(v * 20) / 20;

/** The years a player wants on his next deal. */
export function wantedYears(p) {
  const a = p.age ?? 27;
  if (a <= 26) return p.ovr >= 80 ? 5 : 4;
  if (a <= 29) return p.ovr >= 85 ? 4 : 3;
  if (a <= 32) return 2;
  return 1;
}

/** His opening demand: market value (stars ask a little over it), for the years he wants. */
export function openingDemand(p) {
  const mv = marketValue(p);
  return { salary: Math.max(MIN_SALARY, round05(mv * (p.ovr >= 85 ? 1.06 : 1))), years: wantedYears(p) };
}

/** The talks with a player (created on first look). */
export function talksWith(f, p) {
  const T = (f.offseason ||= {}).talks ||= {};
  return (T[p.id] ||= { ...openingDemand(p), patience: PATIENCE });
}

/**
 * Make an offer { salary, years }. Returns { result: 'accept' | 'counter' | 'walk', text, talks }.
 * On 'accept' the deal is stored (talks.done) and the caller re-signs him at those terms.
 */
export function makeOffer(f, teams, team, p, offer) {
  const t = talksWith(f, p);
  if (t.walked) return { result: 'walk', text: `${p.last} has moved on: he's testing free agency.`, talks: t };
  const ti = teams.indexOf(team);
  const mode = ti >= 0 ? teamMode(f, teams, ti) : 'middle';
  const rng = new RNG((f.seed || 1) * 7919 + (p.id || 0) * 31 + (f.year || 0) + (PATIENCE - t.patience) * 101);
  // What the offer is worth to him: the money against his ask, minus each year away from what he wants.
  const yearsOff = Math.abs(offer.years - t.years) * (offer.years < t.years && (p.age ?? 27) <= 29 ? 0.05 : 0.03);
  const mood = (moraleOf(p) - 70) * 0.0015 + (mode === 'contend' ? 0.03 : mode === 'rebuild' ? -0.03 : 0);
  const v = offer.salary / t.salary - yearsOff + mood + rng.range(-0.015, 0.015);
  if (v >= 0.985) {
    t.done = { salary: round05(offer.salary), years: offer.years };
    return { result: 'accept', text: `${p.first} ${p.last} agrees: ${offer.years} yr${offer.years > 1 ? 's' : ''} at $${t.done.salary.toFixed(2)}M a year.`, talks: t };
  }
  // A lowball costs more patience than a near miss.
  t.patience -= v < 0.86 ? 2 : 1;
  if (t.patience <= 0) {
    t.walked = true;
    return { result: 'walk', text: `${p.first} ${p.last} is done talking: he'll test free agency.`, talks: t };
  }
  // Counter: he comes part of the way toward the offer on money, and meets you halfway on years.
  t.salary = round05(Math.max(offer.salary, t.salary - (t.salary - offer.salary) * 0.3));
  t.years = Math.round((t.years + offer.years) / 2);
  const tone = v < 0.86 ? 'That offer insulted him.' : 'Close.';
  return { result: 'counter', text: `${tone} He'd take ${t.years} yr${t.years > 1 ? 's' : ''} at $${t.salary.toFixed(2)}M.`, talks: t };
}
