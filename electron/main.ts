import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut, protocol, net, dialog } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initDatabase, library, favorites, playlists, settings, queueState, databaseStats, closeDatabase } from './db';
import { initCache, cacheTrack, cacheStats, clearCache, cachedPathFor, removeCached } from './cache';
import { presence } from './discord';
import { adoptNewerInstall, markUpdateStartup, registerUpdater } from './updater';
import { routeForLink } from '../src/shared/lib/smartLinks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

// Keep Cloudy's data in its own folder, separate from anything else on the machine.
app.setName('Cloudy');
app.setPath('userData', path.join(app.getPath('appData'), 'CloudyPlayer'));
const API_ORIGIN = process.env.CLOUDY_API_ORIGIN ?? 'http://127.0.0.1:3456';

let mainWindow: BrowserWindow | null = null;
let windowTransparent = false;
let tray: Tray | null = null;
let quitting = false;
let backend: ChildProcess | null = null;

/**
 * The catalog/streaming service is bundled with the app. If nothing is already
 * listening (for example during development with `npm run server`), start it.
 */
async function ensureBackend() {
  const reachable = await fetch(`${API_ORIGIN}/health`, { signal: AbortSignal.timeout(1500) })
    .then((res) => res.ok)
    .catch(() => false);
  if (reachable) return;

  const entry = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.js')
    : path.join(__dirname, '..', 'server', 'index.js');

  try {
    // Keep the service's own log next to the library so failures are diagnosable.
    const logFile = path.join(app.getPath('userData'), 'backend.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    backend = spawn(process.execPath, [entry], {
      cwd: path.dirname(entry),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CLOUDY_API_PORT: String(new URL(API_ORIGIN).port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    backend.stdout?.pipe(logStream);
    backend.stderr?.pipe(logStream);
    backend.on('error', (error) => {
      console.error('[cloudy] backend failed to start:', error.message);
      logStream.write(`spawn error: ${error.message}\n`);
    });
    logStream.write(`[cloudy] spawning backend: ${entry}\n`);

    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const ok = await fetch(`${API_ORIGIN}/health`, { signal: AbortSignal.timeout(1000) })
        .then((res) => res.ok)
        .catch(() => false);
      if (ok) return;
    }
    console.error('[cloudy] backend did not become ready');
  } catch (error) {
    console.error('[cloudy] could not launch backend:', error);
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'cloudy-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow(bounds?: { x: number; y: number; width: number; height: number }) {
  // `transparent` can only be set when the window is created, so the value is
  // read from the saved preferences here and the window is rebuilt when the
  // setting changes (see the settings IPC below).
  const prefs = settings.all() as Record<string, unknown>;
  const transparent = prefs.windowTransparent === true;
  windowTransparent = transparent;

  const window = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 980,
    minHeight: 620,
    show: false,
    // macOS keeps its native traffic lights under a hidden title bar; a
    // transparent window has no bar to host them, so the renderer draws its own.
    // Windows always uses the fully custom frame.
    frame: process.platform === 'darwin' && !transparent,
    transparent,
    hasShadow: !transparent,
    backgroundColor: transparent ? '#00000000' : '#0a0a0a',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  console.log(`[cloudy] window created (transparent=${transparent})`);
  window.once('ready-to-show', () => window.show());

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.on('maximize', () => window.webContents.send('window:state', { maximized: true }));
  window.on('unmaximize', () => window.webContents.send('window:state', { maximized: false }));
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => {
    mainWindow = null;
  });

  mainWindow = window;
  return window;
}

function sendMediaAction(action: string) {
  mainWindow?.webContents.send('media:action', action);
}

/** Rebuild the window in place, keeping its bounds, so `transparent` can change. */
function recreateWindow() {
  const previous = mainWindow;
  if (!previous || previous.isDestroyed()) {
    createWindow();
    return;
  }
  const bounds = previous.getBounds();
  const maximized = previous.isMaximized();
  previous.destroy();
  const next = createWindow(bounds);
  if (maximized) next.maximize();
}

function buildTray() {
  // The same cloud mark as the app icon, drawn inline so the tray needs no
  // binary asset. macOS wants a 22px template image — monochrome, with the menu
  // bar tinting it for light and dark mode; the Windows tray takes 16px white.
  const isMac = process.platform === 'darwin';
  const size = isMac ? 22 : 16;
  const scale = size / 16;
  const buffer = Buffer.alloc(size * size * 4);
  const channel = isMac ? 0 : 255;

  const inDisc = (px: number, py: number, cx: number, cy: number, r: number) =>
    Math.hypot(px - cx, py - cy) <= r;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Geometry stays in the original 16-unit box and is scaled up for macOS.
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      // Dome, two puffs and a flat base make a cloud that still reads at 16px.
      const filled =
        inDisc(px, py, 7.5, 7, 3.3) ||
        inDisc(px, py, 4.7, 9, 2.5) ||
        inDisc(px, py, 11, 9.2, 2.6) ||
        (px >= 4.7 && px <= 11 && py >= 8.6 && py <= 11.4);
      if (!filled) continue;
      const offset = (y * size + x) * 4;
      buffer[offset] = channel;
      buffer[offset + 1] = channel;
      buffer[offset + 2] = channel;
      buffer[offset + 3] = 255;
    }
  }
  const image = nativeImage.createFromBuffer(buffer, { width: size, height: size });
  if (isMac) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Cloudy — Head in the clouds.');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Cloudy',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      { label: 'Play / Pause', click: () => sendMediaAction('playpause') },
      { label: 'Next', click: () => sendMediaAction('next') },
      { label: 'Previous', click: () => sendMediaAction('previous') },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show();
  });
}

function registerIpc() {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.hide());
  ipcMain.handle('window:quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle('library:all', (_e, sort) => library.all(sort));
  ipcMain.handle('library:search', (_e, q) => library.search(q));
  ipcMain.handle('library:add', (_e, track) => library.add(track));
  ipcMain.handle('library:remove', (_e, id) => library.remove(id));
  ipcMain.handle('library:has', (_e, id) => library.has(id));
  ipcMain.handle('library:markPlayed', (_e, id, seconds) => library.markPlayed(id, seconds));
  ipcMain.handle('library:recent', (_e, limit) => library.recentlyPlayed(limit));
  ipcMain.handle('library:mostPlayed', (_e, limit) => library.mostPlayed(limit));

  ipcMain.handle('favorites:ids', () => favorites.ids());
  ipcMain.handle('favorites:all', () => favorites.all());
  ipcMain.handle('favorites:has', (_e, id) => favorites.has(id));
  ipcMain.handle('favorites:add', (_e, track) => favorites.add(track));
  ipcMain.handle('favorites:remove', (_e, id) => favorites.remove(id));
  ipcMain.handle('favorites:artists', () => favorites.artists());
  ipcMain.handle('favorites:artistIds', () => favorites.artistIds());
  ipcMain.handle('favorites:addArtist', (_e, artist) => favorites.addArtist(artist));
  ipcMain.handle('favorites:removeArtist', (_e, id) => favorites.removeArtist(id));
  ipcMain.handle('favorites:albums', () => favorites.albums());
  ipcMain.handle('favorites:albumIds', () => favorites.albumIds());
  ipcMain.handle('favorites:addAlbum', (_e, album) => favorites.addAlbum(album));
  ipcMain.handle('favorites:removeAlbum', (_e, id) => favorites.removeAlbum(id));

  ipcMain.handle('playlists:all', () => playlists.all());
  ipcMain.handle('playlists:create', (_e, name, description, source) => playlists.create(name, description, source));
  ipcMain.handle('playlists:rename', (_e, id, name) => playlists.rename(id, name));
  ipcMain.handle('playlists:remove', (_e, id) => playlists.remove(id));
  ipcMain.handle('playlists:addTrack', (_e, id, track) => playlists.addTrack(id, track));
  ipcMain.handle('playlists:removeTrack', (_e, id, trackId) => playlists.removeTrack(id, trackId));
  ipcMain.handle('playlists:tracks', (_e, id) => playlists.tracks(id));
  ipcMain.handle('playlists:cover', (_e, id) => playlists.cover(id));

  ipcMain.handle('settings:all', () => settings.all());
  ipcMain.handle('settings:set', (_e, key, value) => {
    settings.set(key, value);
    if (key === 'windowTransparent' && Boolean(value) !== windowTransparent) {
      // Give the renderer its reply before the window is replaced.
      setTimeout(recreateWindow, 120);
    }
    return true;
  });

  ipcMain.handle('queue:save', (_e, payload) => {
    queueState.save(payload);
    return true;
  });
  ipcMain.handle('queue:load', () => queueState.load());

  ipcMain.handle('cache:track', async (_e, videoId, streamUrl) => {
    const file = await cacheTrack(videoId, streamUrl, API_ORIGIN);
    if (file) {
      library.setCachedPath(videoId, file);
      return `cloudy-media://local/${encodeURIComponent(path.basename(file))}`;
    }
    return null;
  });
  ipcMain.handle('cache:path', (_e, videoId) => {
    const file = cachedPathFor(videoId);
    return file ? `cloudy-media://local/${encodeURIComponent(path.basename(file))}` : null;
  });
  ipcMain.handle('cache:stats', () => cacheStats());
  ipcMain.handle('cache:clear', () => clearCache());
  ipcMain.handle('cache:remove', (_e, videoId) => removeCached(videoId));
  ipcMain.handle('db:stats', () => databaseStats());

  ipcMain.handle('presence:update', (_e, payload) => presence.update(payload));
  ipcMain.handle('presence:clear', () => presence.clear());
  ipcMain.handle('presence:enabled', (_e, value) => presence.setEnabled(Boolean(value)));

  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    apiOrigin: API_ORIGIN,
    userData: app.getPath('userData'),
  }));

  // Windows taskbar overlay transport buttons mirror the in-app controls.
  ipcMain.handle('media:thumbar', (_e, playing: boolean) => {
    if (process.platform !== 'win32' || !mainWindow) return false;
    mainWindow.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: nativeImage.createEmpty(),
        click: () => sendMediaAction('previous'),
      },
      {
        tooltip: playing ? 'Pause' : 'Play',
        icon: nativeImage.createEmpty(),
        click: () => sendMediaAction('playpause'),
      },
      {
        tooltip: 'Next',
        icon: nativeImage.createEmpty(),
        click: () => sendMediaAction('next'),
      },
    ]);
    return true;
  });
}

function registerProtocolClient() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('cloudy', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('cloudy');
  }
}

function handleDeepLink(url: string) {
  const route = routeForLink(url);
  if (!route) return;
  mainWindow?.show();
  mainWindow?.webContents.send('deeplink', route);
}

// The updater starts the freshly unpacked copy while this instance is still
// shutting down, so that launch must not be treated as a second instance.
const launchedByUpdater = process.argv.includes('--after-update');
const gotLock = launchedByUpdater || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith('cloudy://'));
    if (link) handleDeepLink(link);
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    // A shortcut or pinned icon can still point at the build from before an
    // update; hand the launch over to the newest copy instead of running it.
    if (await adoptNewerInstall()) return;
    try {
      initDatabase(app.getPath('userData'));
    } catch (error) {
      console.error('[cloudy] database init failed:', error);
      dialog.showErrorBox(
        'Cloudy could not open its library',
        `${(error as Error).message}\n\nCloudy will keep running, but nothing will be saved this session.`,
      );
    }
    initCache(app.getPath('userData'));

    protocol.handle('cloudy-media', (request) => {
      const url = new URL(request.url);
      const file = path.join(app.getPath('userData'), 'audio-cache', decodeURIComponent(url.pathname.replace(/^\//, '')));
      return net.fetch(pathToFileURL(file).toString());
    });

    registerIpc();
    registerUpdater();
    registerProtocolClient();
    // The window comes first: the bundled service can take seconds to answer on
    // a cold start, and waiting for it made the app look like it had not opened.
    // Renderer requests retry while it warms up.
    createWindow();
    void markUpdateStartup();
    buildTray();
    void ensureBackend();

    // Media keys work even when the window is unfocused.
    const bindings: [string, string][] = [
      ['MediaPlayPause', 'playpause'],
      ['MediaNextTrack', 'next'],
      ['MediaPreviousTrack', 'previous'],
      ['MediaStop', 'stop'],
    ];
    for (const [accelerator, action] of bindings) {
      globalShortcut.register(accelerator, () => sendMediaAction(action));
    }

    const initialLink = process.argv.find((arg) => arg.startsWith('cloudy://'));
    if (initialLink) setTimeout(() => handleDeepLink(initialLink), 1200);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // Keep running in the tray, like Liner does.
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    presence.destroy();
    globalShortcut.unregisterAll();
    closeDatabase();
    backend?.kill();
    backend = null;
  });
}
