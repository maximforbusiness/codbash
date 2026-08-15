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

// Read absolute filesystem paths from the system clipboard when Finder,
// Finder copies a file (⌘C). Finder writes several representations on macOS:
//   • `public.file-url`       — one file:// URL per copied file
//   • `public.file-url` UTI corresponds to NSFilenamesPboardType for legacy
//     code, but the modern slot is the former.
//   • `public.utf8-plain-text` — just the bare filename(s), lossy
// We prefer the file-url wrapper and decode to a POSIX path; if the clipboard
// only has plain text we return [] so the caller falls back to a normal
// text paste. This is what powers the in-app terminal's ⌘V → path behaviour:
// the user copies a file in Finder, focuses the pane, presses ⌘V and the
// terminal types the quoted absolute path instead of doing nothing.
function _fileUrlToPosix(url) {
  // File URLs produced by NSPasteboard look like `file:///Users/me/x.txt`.
  try { return decodeURIComponent(new URL(url).pathname); }
  catch (_e) {
    // Fall back to a manual strip of the `file://` prefix (handles cases where
    // URL() might reject relative-looking file URLs).
    if (typeof url === 'string' && url.indexOf('file://') === 0) return url.slice(7);
    return '';
  }
}

function _readClipboardFilePaths() {
  var out = [];
  try {
    if (!clipboard) return out;
    // Multi-selection: Finder writes one `public.file-url` item per file.
    // Electron's clipboard.readBuffer(format) only returns the first item,
    // but for the common single-file copy we need that one path — good enough
    // for now. (A truly multi-file path would iterate NSPasteboard items, but
    // Electron's clipboard module exposes only 'the' contents.)
    // Try the macOS UTI formats in two separators Electron accepts.
    var formats = ['public/file-url', 'public.file-url', 'NSFilenamesPboardType'];
    var urlBuf = null, usedFormat = null;
    for (var i = 0; i < formats.length; i++) {
      try {
        if (clipboard.has(formats[i])) { urlBuf = clipboard.readBuffer(formats[i]); usedFormat = formats[i]; break; }
      } catch (_e) {}
    }
    if (urlBuf && urlBuf.length > 0) {
      var raw = urlBuf.toString('utf8');
      if (usedFormat === 'NSFilenamesPboardType') {
        // NeXT-style NSArray of NSString paths encoded as UTF-8:
        // `<array><string>/path1</string>…</array>` — parse coarsely.
        var pathMatches = raw.match(/<string>([^<]+)<\/string>/g) || [];
        for (var j = 0; j < pathMatches.length; j++) {
          var m = pathMatches[j].match(/^<string>([^<]+)<\/string>$/);
          if (m) out.push(m[1]);
        }
        if (out.length === 0 && raw.trim()) {
          // Single-string fallback.
          out.push(raw.trim());
        }
      } else {
        // file:// URL — can be either one, or several separated by newlines.
        var lines = raw.split(/[\r\n]+/);
        for (var k = 0; k < lines.length; k++) {
          var line = lines[k].trim();
          if (!line) continue;
          var p = _fileUrlToPosix(line);
          if (p) out.push(p);
        }
      }
    }
  } catch (_e) { out = []; }
  return out;
}

contextBridge.exposeInMainWorld('codbashDesktop', {
  isDesktop: true,
  // Resolve absolute filesystem path for a File obtained from a drop event —
  // returns '' if unavailable (e.g. running outside Electron).
  getPathForFile: _getPathForFile,
  // Resolve filesystem paths from the system clipboard (macOS: Finder ⌘C → file(s)).
  // Returns [] for text/image-only clipboards so callers fall back to plain text.
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
