// Browser storage for league saves: IndexedDB (room for rosters and logo images), falling back to
// localStorage. Slots are named; the active slot loads at startup. Browser-only.
const DB = 'gridiron27';
const STORE = 'saves';
const ACTIVE_KEY = 'g27.activeSave';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

const lsKey = (slot) => `g27.save.${slot}`;

export async function writeSave(slot, data) {
  try { await tx('readwrite', (s) => s.put(data, slot)); }
  catch { localStorage.setItem(lsKey(slot), JSON.stringify(data)); }
}

export async function readSave(slot) {
  try {
    const v = await tx('readonly', (s) => s.get(slot));
    if (v) return v;
  } catch { /* fall through */ }
  try { return JSON.parse(localStorage.getItem(lsKey(slot)) || 'null'); } catch { return null; }
}

export async function deleteSave(slot) {
  try { await tx('readwrite', (s) => s.delete(slot)); } catch { /* ignore */ }
  try { localStorage.removeItem(lsKey(slot)); } catch { /* ignore */ }
  if (activeSlot() === slot) setActiveSlot(null);
}

/** Short description of a save's franchise (or null). */
function franchiseInfo(v) {
  const f = v?.franchise;
  if (!f) return null;
  const t = v.teams?.[f.userTeam];
  const when = f.phase === 'regular' ? `Week ${f.week + 1}` : f.phase === 'playoffs' ? 'Playoffs' : 'Offseason';
  return { team: t ? `${t.city} ${t.name}` : '?', year: f.year, when };
}

/** [{ slot, name, savedAt, franchise }] newest first. */
export async function listSaves() {
  const out = new Map();
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { resolve(); return; }
        out.set(c.key, { slot: c.key, name: c.value?.name || c.key, savedAt: c.value?.savedAt || '', franchise: franchiseInfo(c.value) });
        c.continue();
      };
      req.onerror = () => resolve();
    });
  } catch { /* no indexedDB */ }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith('g27.save.')) continue;
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      const slot = k.slice('g27.save.'.length);
      if (!out.has(slot)) out.set(slot, { slot, name: v?.name || slot, savedAt: v?.savedAt || '', franchise: franchiseInfo(v) });
    }
  } catch { /* no localStorage */ }
  return [...out.values()].sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
}

export function activeSlot() { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } }
export function setActiveSlot(slot) {
  try { if (slot) localStorage.setItem(ACTIVE_KEY, slot); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
}

/** Offer a download of `text` as a file. */
export function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ask for a file and resolve with its text (or null if cancelled). */
export function pickFile(accept = '.json', asDataUrl = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { resolve(null); return; }
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, data: r.result });
      r.onerror = () => resolve(null);
      if (asDataUrl) r.readAsDataURL(f); else r.readAsText(f);
    };
    input.click();
  });
}

/** Load an image (data URL or path) as an HTMLImageElement, or null. */
export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
