// Sortable tables: a column cursor (◀▶) and X to sort by that column (X again flips the order). Used by the stat
// screens, league leaders, rosters, free agents, the trade screen and the draft board.
import { el } from './nav.js';

/** Header cells for `labels`; `sort` = { col, asc, cur } (cur = the column the cursor is on). */
export function sortHead(labels, sort, tag = 'span') {
  return labels.map((c, i) => el(`${tag}.sort-h${i === sort.cur ? '.cur' : ''}${i === sort.col ? '.sorted' : ''}`,
    { text: `${c}${i === sort.col ? (sort.asc ? ' ▲' : ' ▼') : ''}` }));
}

/**
 * Wire ◀▶ / X on a screen: `n` columns, `redraw()` re-renders with the same `sort` object. Returns true when it
 * handled the frame. Pass `lr = false` where ◀▶ already mean something (then LT/RT move the cursor).
 */
export function sortKeys(f, sort, n, redraw, lr = true) {
  // D-pad, or a fresh push of the left stick (keyboard: A/D).
  const sx = Math.abs(f.lx) > 0.6 ? Math.sign(f.lx) : 0;
  const stick = sx !== (sort._sx || 0) ? sx : 0;
  sort._sx = sx;
  const left = lr ? f.pressed.Left || stick < 0 : f.pressed.LT, right = lr ? f.pressed.Right || stick > 0 : f.pressed.RT;
  if (left || right) { sort.cur = ((sort.cur ?? 0) + (right ? 1 : -1) + n) % n; redraw(); return true; }
  if (f.pressed.X) {
    if (sort.col === sort.cur) sort.asc = !sort.asc; else { sort.col = sort.cur ?? 0; sort.asc = false; }
    redraw(); return true;
  }
  return false;
}

/** Sort rows by a getter list (numbers or strings). */
export function sortRows(rows, sort, getters) {
  if (sort.col === null || sort.col === undefined) return rows;
  const g = getters[sort.col];
  return [...rows].sort((a, b) => {
    const x = g(a), y = g(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : (x ?? 0) - (y ?? 0);
    return sort.asc ? c : -c;
  });
}
