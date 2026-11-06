// Gridiron 27 as a Mac app (Electron). The built game (dist-app/, `npm run app:build`) is served from a tiny local web
// server on a fixed port, so the game's saves (IndexedDB / localStorage) live at the same address every launch, and
// your personal league folder (league.csv / roster.csv / faces / logos, the same files as public/local/) is served as
// /local/ — those files stay on your Mac, never inside the app or the repo.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const http = require('node:http');
const { remoteImages } = require('../tools/remote-images.cjs');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 27027;
const GAME_DIR = path.join(__dirname, '..', 'dist-app');
const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.csv': 'text/csv; charset=utf-8', '.ico': 'image/x-icon' };

function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return {}; } }
function writeConfig(c) { fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2)); }

/** The league folder: the one picked in the menu, else ~/Documents/Gridiron27 (created with a short read-me). */
function leagueFolder() {
  const chosen = readConfig().leagueFolder;
  if (chosen && fs.existsSync(chosen)) return chosen;
  const dir = path.join(app.getPath('documents'), 'Gridiron27');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(path.join(dir, 'faces'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'logos'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'READ ME.txt'),
      'Put your league spreadsheets here (league.csv, or teams.csv / roster.csv / depth.csv), with face photos in faces/\n'
      + 'and logo images in logos/ - the same files as public/local/ in the project. The game reads them at startup\n'
      + '(unless a league save is active: League > Saves & Files > Start over with the default league to re-read them).\n'
      + 'Or pick another folder in the app: Gridiron 27 menu > Choose League Folder...\n');
  }
  return dir;
}

function send(res, code, body, type = 'text/plain') { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(body); }

/** Serve a file under root (no path escapes). */
function serveFrom(root, rel, res) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(path.normalize(root))) return send(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const relay = remoteImages(path.join(app.getPath('userData'), 'image-cache'));
    const server = http.createServer((req, res) => {
      if (relay(req, res)) return; // web logos / face photos (tools/remote-images.cjs)
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (url.startsWith('/local/')) return serveFrom(leagueFolder(), url.slice('/local/'.length), res);
      serveFrom(GAME_DIR, url === '/' ? 'index.html' : url.slice(1), res);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

let win;
async function createWindow() {
  // A fixed port keeps the saves at one address; if something else holds it, the next free one (saves would be separate).
  let port = PORT, server;
  for (let k = 0; k < 10 && !server; k++) { try { server = await startServer(port); } catch { port++; } }
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: '#000000', title: 'Gridiron 27', show: false,
    // contextIsolation off so the preload can replace window.prompt (local game only, no Node in the page).
    webPreferences: { backgroundThrottling: false, spellcheck: false, preload: path.join(__dirname, 'preload.cjs'), contextIsolation: false, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${port}/`);
  // Links that open other sites go to the real browser, not the game window.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// window.prompt for the game: a small modal window; the game's call waits (sendSync) until OK / Cancel.
ipcMain.on('g27-prompt', (event, { message, value }) => {
  const dlg = new BrowserWindow({ parent: win, modal: true, width: 440, height: 170, resizable: false, minimizable: false, maximizable: false,
    title: 'Gridiron 27', backgroundColor: '#111111', webPreferences: { nodeIntegration: true, contextIsolation: false } });
  dlg.setMenuBarVisibility(false);
  let answered = false;
  const finish = (r) => { if (answered) return; answered = true; event.returnValue = r; ipcMain.removeListener('g27-prompt-done', onDone); if (!dlg.isDestroyed()) dlg.close(); };
  const onDone = (e, r) => { if (e.sender === dlg.webContents) finish(r); };
  ipcMain.on('g27-prompt-done', onDone);
  dlg.on('closed', () => finish(null));
  dlg.loadFile(path.join(__dirname, 'prompt.html'), { query: { m: message, v: value } });
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: 'Gridiron 27', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Open League Folder', click: () => shell.openPath(leagueFolder()) },
      { label: 'Choose League Folder…', click: async () => {
        const r = await dialog.showOpenDialog(win, { title: 'Folder with league.csv / roster.csv / faces / logos', properties: ['openDirectory'] });
        if (r.canceled || !r.filePaths[0]) return;
        writeConfig({ ...readConfig(), leagueFolder: r.filePaths[0] });
        win.reload();
      } },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { role: 'editMenu' }, // copy / paste in text boxes
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'reload' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on('window-all-closed', () => app.quit());
