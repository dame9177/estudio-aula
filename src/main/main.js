// Electron main process: window, media permissions, file system and ffmpeg via IPC.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const store = require('./project-store');
const exporter = require('./exporter');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');

if (process.env.ESTUDIO_USER_DATA) app.setPath('userData', process.env.ESTUDIO_USER_DATA);
app.setName('Estúdio de Aula');
// Matches the .desktop file so GNOME shows our icon on Wayland.
app.setDesktopName('estudio-aula.desktop');

function dataDir() {
  return process.env.ESTUDIO_DATA_DIR || path.join(app.getPath('videos'), 'Estúdio de Aula');
}

function ffmpegPath() {
  return require('ffmpeg-static');
}

// ---------- preferences (devices, bubble layout) ----------
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const DEFAULT_PREFS = { video: null, audio: null, bubble: { corner: 'br', size: 'm', mirror: true }, penColor: 'clay' };

function readPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    return { ...DEFAULT_PREFS, ...saved, bubble: { ...DEFAULT_PREFS.bubble, ...saved.bubble } };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  const tmp = `${prefsFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, prefsFile());
  return next;
}

// ---------- PDFs passed on the command line ("Abrir com…" in the file manager) ----------
function pdfFromArgv(argv) {
  return argv.slice(1).find((a) => /\.pdf$/i.test(a) && fs.existsSync(a)) || null;
}
let pendingPdf = pdfFromArgv(process.argv);

// ---------- window ----------
let win = null;

function isOurPage(url) {
  return typeof url === 'string' && url.startsWith(pathToFileURL(RENDERER_DIR).href);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'Estúdio de Aula',
    backgroundColor: '#F0EEE6',
    icon: path.join(ROOT, 'packaging', 'estudio-aula.png'),
    show: process.env.ESTUDIO_HIDDEN !== '1',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep the compositor and recorder running when the window is covered or minimized.
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(RENDERER_DIR, 'index.html'));
  // Never navigate away from the app (e.g. a PDF dropped outside the drop zone).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    win = null;
  });
}

function grantMediaToOurPage() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = isOurPage(details?.requestingUrl || wc.getURL());
    callback(ok && (permission === 'media' || permission === 'speaker-selection'));
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    const url = details?.requestingUrl || wc?.getURL();
    return isOurPage(url) && (permission === 'media' || permission === 'speaker-selection');
  });
  ses.setDevicePermissionHandler(() => false);
}

// ---------- IPC ----------
const openTakes = new Map(); // token -> { dir, index, part, fd }
let nextToken = 1;
let exportJob = null;

function registerIpc() {
  ipcMain.handle('app:info', () => ({ dataDir: dataDir(), version: app.getVersion() }));
  ipcMain.handle('app:pending-pdf', () => {
    const p = pendingPdf;
    pendingPdf = null;
    return p;
  });
  ipcMain.handle('prefs:get', () => readPrefs());
  ipcMain.handle('prefs:set', (_e, patch) => writePrefs(patch));

  ipcMain.handle('pdf:choose', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Escolha o PDF da aula',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf', 'PDF'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('project:open', (_e, pdfPath) => {
    if (!pdfPath || !/\.pdf$/i.test(pdfPath)) throw new Error('Esse arquivo não é um PDF.');
    const existing = store.projectDirForPdf(pdfPath);
    fs.mkdirSync(dataDir(), { recursive: true });
    const opened = existing ? store.resumeProject(existing) : store.openProject(dataDir(), pdfPath);
    const pdfBytes = fs.readFileSync(path.join(opened.dir, store.PDF_FILE));
    return { ...opened, pdfBytes };
  });

  ipcMain.handle('project:recent', () => store.listRecent(dataDir()));
  ipcMain.handle('project:set-page-count', (_e, dir, n) => store.setPageCount(dir, n));
  ipcMain.handle('project:camera-hidden', (_e, dir, index, hidden) => store.setCameraHidden(dir, index, hidden));
  ipcMain.handle('take:delete', (_e, dir, index) => store.deleteTake(dir, index));
  ipcMain.handle('take:url', (_e, dir, file) => pathToFileURL(path.join(dir, file)).href);

  // Takes are streamed to disk chunk by chunk while recording.
  ipcMain.handle('take:begin', (_e, dir, index) => {
    const part = store.partialTakePath(dir, index);
    const fd = fs.openSync(part, 'w');
    const token = nextToken++;
    openTakes.set(token, { dir, index, part, fd });
    return token;
  });
  ipcMain.handle('take:chunk', (_e, token, data) => {
    const t = openTakes.get(token);
    if (t) fs.writeSync(t.fd, Buffer.from(data));
  });
  ipcMain.handle('take:finish', (_e, token, durationMs) => {
    const t = openTakes.get(token);
    if (!t) throw new Error('take desconhecido');
    openTakes.delete(token);
    fs.fsyncSync(t.fd);
    fs.closeSync(t.fd);
    return store.commitTake(t.dir, t.index, t.part, durationMs);
  });
  ipcMain.handle('take:abort', (_e, token) => {
    const t = openTakes.get(token);
    if (!t) return;
    openTakes.delete(token);
    fs.closeSync(t.fd);
    fs.rmSync(t.part, { force: true });
  });

  ipcMain.handle('export:plan', (_e, dir) => {
    const project = store.readProject(dir);
    const { inputs, missing } = exporter.collectTakes(dir, project);
    const output = exporter.outputPathFor(dir, project);
    return { inputs, missing, output, exists: fs.existsSync(output) };
  });
  ipcMain.handle('export:start', async (e, dir) => {
    if (exportJob) throw new Error('Já existe um vídeo sendo gerado.');
    const project = store.readProject(dir);
    const { inputs } = exporter.collectTakes(dir, project);
    const output = exporter.outputPathFor(dir, project);
    exportJob = exporter.runExport({
      ffmpegPath: ffmpegPath(),
      inputs,
      output,
      onProgress: (p) => e.sender.send('export:progress', p),
    });
    try {
      return await exportJob.promise;
    } finally {
      exportJob = null;
    }
  });
  ipcMain.handle('export:cancel', () => exportJob?.cancel());

  ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:show', (_e, p) => shell.showItemInFolder(p));
}

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const pdf = pdfFromArgv(argv);
    if (pdf && win) win.webContents.send('open-pdf', pdf);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    grantMediaToOurPage();
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => {
    for (const t of openTakes.values()) {
      try {
        fs.closeSync(t.fd);
      } catch {
        /* ignore */
      }
    }
    exportJob?.cancel();
    app.quit();
  });
}
