// In-game soundtrack from a YouTube / YouTube Music playlist (Settings → Soundtrack).
// The playlist plays in a hidden YouTube embed (IFrame Player API). There is no YouTube Music API for third-party
// apps, so the "login" is the browser's own: signed in to YouTube in this browser (or the Mac app's window), the
// embed plays as you (YouTube Premium = no ads). Private playlists can't be embedded; public / unlisted ones can.

let api = null; // Promise<YT>
let player = null, holder = null, chip = null;
let current = { list: null, video: null };
let wanted = false; // should be playing right now (menus / game, per settings)
let prefsRef = null;

/** Playlist (list=…) or single video (v=… / youtu.be/…) from a pasted link; null if it isn't one. */
export function parseMusicLink(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  // A bare playlist id (PL…, OLAK5uy_…, RD…).
  if (/^(PL|OL|RD|UU|FL)[\w-]{10,}$/.test(s)) return { list: s, video: null };
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    const list = u.searchParams.get('list');
    const video = u.hostname.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v');
    if (list) return { list, video: video || null };
    if (video) return { list: null, video };
  } catch { /* not a URL */ }
  return null;
}

function loadApi() {
  if (api) return api;
  api = new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { api = null; reject(new Error('YouTube unavailable (offline?)')); };
    document.head.append(s);
  });
  return api;
}

function ensureChip() {
  if (chip) return chip;
  chip = document.createElement('div');
  chip.id = 'musicchip';
  chip.className = 'hidden';
  chip.onclick = () => { // a click is a user gesture: lets the browser start sound it blocked
    if (!player) return;
    const st = player.getPlayerState?.();
    if (st === 1) player.pauseVideo(); else { player.unMute?.(); player.playVideo(); }
  };
  document.body.append(chip);
  return chip;
}

function showChip(text, on = true) {
  const c = ensureChip();
  c.innerHTML = `<span class="mc-note">♪</span><span class="mc-t">${text}</span>`;
  c.classList.toggle('hidden', !on || inGame); // menus only: nothing over the broadcast
}

function title() { try { return player?.getVideoData?.().title || ''; } catch { return ''; } }

async function build(link) {
  const YT = await loadApi();
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'musicplayer';
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:120px;pointer-events:none;opacity:0';
    holder.append(document.createElement('div'));
    document.body.append(holder);
  }
  if (player) { try { player.destroy(); } catch { /* gone */ } player = null; holder.innerHTML = '<div></div>'; }
  current = link;
  const vars = { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0 };
  if (link.list) { vars.listType = 'playlist'; vars.list = link.list; }
  else { vars.loop = 1; vars.playlist = link.video; }
  return new Promise((resolve) => {
    player = new YT.Player(holder.firstChild, {
      width: 200, height: 120, videoId: link.video || undefined, playerVars: vars,
      events: {
        onReady: () => {
          if (prefsRef?.musicShuffle && link.list) { try { player.setShuffle(true); player.playVideoAt(0); } catch { /* old api */ } }
          setVolume();
          if (wanted) player.playVideo(); else player.pauseVideo();
          resolve(player);
        },
        onStateChange: (e) => {
          // 1 playing, 2 paused, -1 unstarted (autoplay blocked shows up as stuck unstarted)
          if (e.data === 1) showChip(title() || 'Soundtrack', true);
          else if (wanted && (e.data === -1 || e.data === 5)) showChip('Click to start the soundtrack', true);
          else if (e.data === 2) showChip(`${title() || 'Soundtrack'} (paused)`, wanted);
        },
        onError: () => {
          showChip('That playlist can\'t be played here (private or blocked)', true);
          setTimeout(() => chip?.classList.add('hidden'), 5000);
        },
      },
    });
  });
}

function setVolume() {
  if (!player?.setVolume) return;
  player.setVolume(Math.round((prefsRef?.musicVolume ?? 60) * (inGame ? 0.45 : 1)));
}

let inGame = false;

/**
 * Called whenever the app changes state (menu / game / paused…) or settings are saved.
 * prefs.music: 'off' | 'menus' | 'always'; prefs.musicLink; prefs.musicShuffle; prefs.musicVolume (0-100).
 */
export function updateSoundtrack(prefs, appState) {
  prefsRef = prefs;
  const link = parseMusicLink(prefs.musicLink);
  const mode = prefs.music || 'off';
  inGame = appState === 'game' || appState === 'intro' || appState === 'replay';
  wanted = !!link && mode !== 'off' && (mode === 'always' || !inGame);
  if (typeof window === 'undefined') return;
  if (!link || mode === 'off') {
    if (player) { try { player.pauseVideo(); } catch { /* gone */ } }
    chip?.classList.add('hidden');
    return;
  }
  const same = player && current.list === link.list && current.video === link.video;
  if (!same) { if (wanted) build(link).catch((e) => showChip(e.message, true)); return; }
  setVolume();
  try {
    if (wanted && player.getPlayerState?.() !== 1) player.playVideo();
    if (!wanted && player.getPlayerState?.() === 1) player.pauseVideo();
  } catch { /* not ready yet */ }
  if (!wanted) chip?.classList.add('hidden');
  else if (player.getPlayerState?.() === 1) showChip(title() || 'Soundtrack', true);
}

/** Next track (LB/RB on the settings row, or the chip's double click). */
export function skipTrack(d = 1) {
  try { if (d > 0) player?.nextVideo(); else player?.previousVideo(); } catch { /* single video */ }
}
