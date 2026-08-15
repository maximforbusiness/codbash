'use strict';

// Minimal, safe bridge exposed to the loaded dashboard page. contextIsolation
// is on and nodeIntegration off, so the renderer only sees exactly what we
// expose here — a single method that opens the native folder picker.
const { contextBridge, ipcRenderer, webUtils, clipboard } = require('electron');

// webUtils.getPathForFile resolves an absolute filesystem path for a dropped
// File object. In Electron 33 the File object in a sandboxed renderer no longer
// carries its path on the deprecated `.path` property (it is `undefined`), so
// drag&drop onto the in-app terminal would only ever see the bare filename —
// the agent then can't find the file. webUtils is the officially-blessed path
// resolver for this. We expose it as a plain function so the renderer can pass a
// live File object and get back a string path; contextBridge passes function
// arguments by reference (not serialized), so the File's identity is preserved.
function _getPathForFile(file) {
  try { return webUtils.getPathForFile(file) || ''; } catch (_e) { return ''; }
}

// Read the absolute filesystem path(s) of file(s) currently in the system
// clipboard — Finder's ⌘C writes a `public.file-url` (UTI 'furl') slot, plus a
// lossy filename string. The renderer can't see this from a sandboxed /
// contextIsolated renderer (browser Clipboard API strips the file:// URL); the
// clipboard module is fully available in the MAIN process, so we IPC there and
// return the resolved POSIX paths. Powers the in-app terminal's ⌘V → path
// behaviour: user copies a file in Finder, focuses the pane, presses ⌘V and
// the terminal types the quoted absolute path instead of the bare filename.
// Returns [] for plain-text clipboards so the caller falls back to text paste.
function _readClipboardFilePathsSync() {
  // Synchronous wrapper for ⌘V interception — ipcRenderer.sendSync keeps the
  // keyboard handler synchronous, which xterm requires (see attachCustomKey-
  // EventHandler contract: an async return false would not block the paste).
  try { return ipcRenderer.sendSync('codbash:read-clipboard-files-sync') || []; }
  catch (_e) { return []; }
}

// Async variant for the Resolve button / non-key paths.
function _readClipboardFilePaths() {
  return ipcRenderer.invoke('codbash:read-clipboard-files');
}

contextBridge.exposeInMainWorld('codbashDesktop', {
  isDesktop: true,
  // Resolve absolute filesystem path for a File obtained from a drop event —
  // returns '' if unavailable (e.g. running outside Electron).
  getPathForFile: _getPathForFile,
  // Synchronous resolver — for xterm's attachCustomKeyEventHandler (⌘V).
  readClipboardFilePathsSync: _readClipboardFilePathsSync,
  // Async resolver — for non-key-press use cases.
  readClipboardFilePaths: _readClipboardFilePaths,
  // Resolves to the chosen absolute folder path, or null if the user cancels.
  pickFolder: () => ipcRenderer.invoke('codbash:pick-folder'),
  // Keyboard shortcuts the native menu would otherwise swallow (e.g. Cmd+W
  // closing the whole window). Main intercepts them and forwards the name here
  // so the page can act (close a tab instead). cb receives the shortcut name.
  onShortcut: (cb) => ipcRenderer.on('codbash:shortcut', (_e, name) => cb(name)),
  // Ask main to close the window (used when a shortcut has no in-page meaning).
  closeWindow: () => ipcRenderer.send('codbash:close-window'),
  // In-app updater (electron-updater). The dashboard's update banner drives this:
  //   onState(cb) → receives {state, version?, percent?, message?} pushes
  //   download() → start downloading the available update
  //   install()  → relaunch onto the downloaded update
  //   check()    → force a check now
  //   openReleases() → fallback: open the GitHub releases page in the browser
  updater: {
    onState: (cb) => ipcRenderer.on('codbash:update-state', (_e, s) => cb(s)),
    check: () => ipcRenderer.invoke('codbash:update-check'),
    download: () => ipcRenderer.invoke('codbash:update-download'),
    install: () => ipcRenderer.invoke('codbash:update-install'),
    openReleases: () => ipcRenderer.send('codbash:open-releases'),
  },
});
