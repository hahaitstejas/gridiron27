// Weather and time of day (pure logic). A game's conditions: { type: 'clear'|'rain'|'snow', wind: { x, z } in
// yd/s (world frame, so teams trade the wind each quarter), time: 'day'|'dusk'|'night' }.
// Rain makes the ball slick (catching, ball security); snow costs footing; wind pushes kicks and deep balls.

export const WEATHER_TYPES = ['clear', 'rain', 'snow'];
export const TIMES = ['day', 'dusk', 'night'];

// Rating penalties by weather (points off the 0-99 rating, see PlaySim.R).
export const WEATHER_MODS = {
  clear: {},
  rain: { catching: 6, carrying: 8, throwAccuracy: 3, kickAccuracy: 4 },
  snow: { speed: 3, acceleration: 4, agility: 4, catching: 4, carrying: 4, kickPower: 4, throwAccuracy: 2 },
};

/** Wind speed in mph (for display). */
export const windMph = (w) => Math.round(Math.hypot(w?.x || 0, w?.z || 0) * 2.045);

/**
 * Conditions from a Play Now choice: weather 'clear'|'rain'|'snow'|'windy'|'random', time 'day'|'dusk'|'night'|'random'.
 * `late` (0..1) = how late in the season it is (snow only shows up late).
 */
export function makeConditions(rng, weather = 'random', time = 'random', late = 0.5) {
  let type = weather === 'windy' ? 'clear' : weather;
  if (type === 'random') {
    const r = rng.next();
    type = r < 0.12 ? 'rain' : r < 0.12 + 0.1 * Math.max(0, late - 0.4) / 0.6 ? 'snow' : 'clear';
  }
  const mph = weather === 'windy' ? rng.range(14, 24) : rng.next() < 0.25 ? rng.range(8, 18) : rng.range(0, 7);
  const ang = rng.range(0, Math.PI * 2);
  const v = mph / 2.045;
  const t = time === 'random' ? rng.pick(['day', 'day', 'dusk', 'night', 'night']) : time;
  return { type, wind: { x: Math.cos(ang) * v, z: Math.sin(ang) * v }, time: t };
}

/** "Night · Rain · Wind 14 mph" */
export function conditionsText(c) {
  const mph = windMph(c.wind);
  return [c.time[0].toUpperCase() + c.time.slice(1), c.type === 'clear' ? 'Clear' : c.type === 'rain' ? 'Rain' : 'Snow', mph >= 3 ? `Wind ${mph} mph` : 'Calm'].join(' · ');
}
