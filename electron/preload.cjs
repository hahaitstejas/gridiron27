// Electron has no window.prompt (the game's text fields use it): forward it to a small dialog window run by main.cjs.
const { ipcRenderer } = require('electron');
window.prompt = (message = '', value = '') => ipcRenderer.sendSync('g27-prompt', { message: String(message), value: value == null ? '' : String(value) });
