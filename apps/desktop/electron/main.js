const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { createHub } = require('./hub.js');

const QUICK_ADD_SHORTCUT = 'CommandOrControl+Alt+A';
const SHOW_SHORTCUT = 'CommandOrControl+Alt+T';
const ICON = path.join(__dirname, 'icon.png');

let mainWin = null;
let quickWin = null;
let tray = null;
let quitting = false;
let hub = null;

// ---------- window state ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const visible = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    return visible ? b : null;
  } catch (_) { return null; }
}
function saveBounds() {
  if (!mainWin || mainWin.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...mainWin.getNormalBounds(), maximized: mainWin.isMaximized() })); } catch (_) {}
}

const secure = { contextIsolation: true, nodeIntegration: false, sandbox: true };

// ---------- main window ----------
function createMainWindow() {
  const b = loadBounds() || { width: 1100, height: 760 };
  mainWin = new BrowserWindow({
    ...b,
    minWidth: 380, minHeight: 400,
    title: 'Tasklist',
    icon: ICON,
    show: false,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: { ...secure, preload: path.join(__dirname, 'preload.js') },
  });
  if (b.maximized) mainWin.maximize();
  mainWin.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());

  // Open external links in the default browser, never inside the app.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWin.on('close', (e) => {
    saveBounds();
    if (!quitting) { e.preventDefault(); mainWin.hide(); }
  });
}

function showMain() {
  if (!mainWin) return createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

// ---------- quick add window ----------
function createQuickWindow() {
  quickWin = new BrowserWindow({
    width: 580, height: 170,
    frame: false, resizable: false, show: false,
    skipTaskbar: true, alwaysOnTop: true, transparent: true,
    icon: ICON,
    webPreferences: { ...secure, preload: path.join(__dirname, 'preload.js') },
  });
  quickWin.loadFile(path.join(__dirname, 'quickadd.html'));
  quickWin.on('blur', () => quickWin.hide());
  quickWin.on('close', (e) => { if (!quitting) { e.preventDefault(); quickWin.hide(); } });
}

function showQuickAdd() {
  if (!quickWin) createQuickWindow();
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w] = quickWin.getSize();
  quickWin.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + workArea.height * 0.22));
  quickWin.show();
  quickWin.focus();
  quickWin.webContents.send('quickadd:reset');
}

// ---------- tray ----------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Tasklist');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Tasklist', accelerator: SHOW_SHORTCUT, click: showMain },
    { label: 'Quick add task', accelerator: QUICK_ADD_SHORTCUT, click: showQuickAdd },
    { type: 'separator' },
    {
      label: 'Start at login', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showMain);
}

// ---------- IPC ----------
ipcMain.on('quickadd:submit', (e, text) => {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) return;
  if (!quickWin || e.sender !== quickWin.webContents) return; // only the quick-add window may submit
  quickWin.hide();
  if (!mainWin) createMainWindow();
  const send = () => mainWin.webContents.send('task:add', text.trim());
  mainWin.webContents.isLoading() ? mainWin.webContents.once('did-finish-load', send) : send();
});
ipcMain.on('quickadd:close', (e) => { if (quickWin && e.sender === quickWin.webContents) quickWin.hide(); });
ipcMain.handle('app:shortcuts', () => ({ quickAdd: QUICK_ADD_SHORTCUT, show: SHOW_SHORTCUT }));

// ---------- AI requests ----------
// The renderer runs from file://, where provider APIs reject cross-origin calls, so the main process makes them.
ipcMain.handle('ai:request', async (e, req) => {
  if (!fromMain(e) || !req || typeof req.url !== 'string' || !/^https?:\/\//i.test(req.url)) return { error: 'Invalid request' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.min(Number(req.timeoutMs) || 90000, 180000));
  try {
    const res = await fetch(req.url, {
      method: req.method === 'GET' ? 'GET' : 'POST',
      headers: req.headers && typeof req.headers === 'object' ? req.headers : {},
      body: req.method === 'GET' ? undefined : req.body,
      signal: ctl.signal,
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'The AI provider took too long to answer.' : 'Couldn’t reach the AI provider. Check the API address and your connection.' };
  } finally {
    clearTimeout(timer);
  }
});

// ---------- phone sync ----------
const fromMain = (e) => mainWin && e.sender === mainWin.webContents;
ipcMain.handle('sync:exchange', (e, state) => (fromMain(e) && hub ? hub.sync(state, false) : null));
async function pairPayload(info) {
  return { ...info, qr: info.url ? await QRCode.toDataURL(info.url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) : null };
}
ipcMain.handle('sync:pair-info', (e) => (fromMain(e) && hub ? pairPayload(hub.pairInfo()) : null));
ipcMain.handle('sync:reset-pairing', (e) => (fromMain(e) && hub ? pairPayload(hub.resetToken()) : null));

async function startHub() {
  hub = createHub({
    dataDir: app.getPath('userData'),
    onRemoteChange: () => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('sync:changed'); },
  });
  const port = await hub.listen(5180);
  if (!port) console.warn('Phone sync is unavailable: no free port between 5180 and 5190');
}

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMain);
  app.setAppUserModelId('com.tasklist.desktop');

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    startHub();
    createMainWindow();
    if (process.argv.includes('--hidden')) mainWin.once('ready-to-show', () => mainWin.hide());
    createQuickWindow();
    createTray();
    if (!globalShortcut.register(QUICK_ADD_SHORTCUT, showQuickAdd)) console.warn(`Could not register ${QUICK_ADD_SHORTCUT}`);
    if (!globalShortcut.register(SHOW_SHORTCUT, showMain)) console.warn(`Could not register ${SHOW_SHORTCUT}`);
  });

  app.on('before-quit', () => { quitting = true; saveBounds(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('activate', showMain);
  app.on('window-all-closed', () => { /* stay in tray */ });
}
