import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * In-app updates.
 *
 * Cloudy asks GitHub for the newest published release, downloads the right
 * installer in the background and only then shows the prompt. Installing hands
 * off to that installer in silent mode and quits, so the next launch is the new
 * version — the user never visits the releases page or re-downloads anything by
 * hand. Library, playlists and settings live outside the install directory and
 * survive the swap.
 */

const REPO = 'Toastyfil/cloudy-music-player';
const CHECK_INTERVAL = 1000 * 60 * 60 * 6;
const FIRST_CHECK_DELAY = 6000;

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error' | 'current';

export interface UpdateState {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  progress?: number;
  bytes?: number;
  total?: number;
  error?: string;
}

let state: UpdateState = { phase: 'idle' };
let installerPath: string | null = null;
let timer: NodeJS.Timeout | null = null;
let checking = false;

function publish(next: UpdateState) {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:state', state);
}

function parseVersion(value: string) {
  return value.replace(/^v/i, '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `candidate` is a later release than `current`. */
function isNewer(candidate: string, current: string) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

function assetFor(assets: { name: string; browser_download_url: string; size?: number }[]) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const patterns =
    process.platform === 'win32'
      ? [/setup\.exe$/i]
      : process.platform === 'darwin'
        ? [new RegExp(`-${arch}\\.dmg$`, 'i'), /\.dmg$/i]
        : [/\.AppImage$/i];
  for (const pattern of patterns) {
    const match = assets.find((asset) => pattern.test(asset.name));
    if (match) return match;
  }
  return null;
}

async function download(url: string, name: string) {
  const directory = path.join(app.getPath('userData'), 'updates');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  await fs.rm(target, { force: true });

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Cloudy-Updater', Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  let lastEmit = 0;
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastEmit > 200) {
      lastEmit = now;
      publish({
        ...state,
        phase: 'downloading',
        progress: total ? Math.min(0.99, received / total) : undefined,
        bytes: received,
        total: total || undefined,
      });
    }
  });

  await pipeline(body, createWriteStream(target));
  const stat = await fs.stat(target);
  if (stat.size < 1024 * 1024) throw new Error('The downloaded installer looks incomplete');
  return target;
}

export async function checkForUpdates(options: { quiet?: boolean } = {}) {
  if (checking) return state;
  if (!app.isPackaged) return state;
  checking = true;
  if (!options.quiet) publish({ phase: 'checking' });

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'Cloudy-Updater', Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const release = (await response.json()) as {
      tag_name?: string;
      body?: string;
      assets?: { name: string; browser_download_url: string; size?: number }[];
    };
    const latest = (release.tag_name ?? '').replace(/^v/i, '');
    if (!latest) throw new Error('No published release found');

    if (!isNewer(latest, app.getVersion())) {
      publish({ phase: 'current', version: app.getVersion() });
      return state;
    }

    const asset = assetFor(release.assets ?? []);
    if (!asset) throw new Error('This release has no installer for this platform');

    publish({ phase: 'downloading', version: latest, notes: release.body?.slice(0, 600), progress: 0 });
    const file = await download(asset.browser_download_url, asset.name);
    installerPath = file;
    publish({
      phase: 'ready',
      version: latest,
      notes: release.body?.slice(0, 600),
      progress: 1,
      total: Number(asset.size ?? 0) || undefined,
    });
  } catch (error) {
    publish({ phase: 'error', error: error instanceof Error ? error.message : 'Update check failed' });
  } finally {
    checking = false;
  }
  return state;
}

async function install() {
  if (!installerPath) return { ok: false, error: 'No downloaded update' };
  publish({ ...state, phase: 'installing' });
  try {
    if (process.platform === 'win32') {
      // NSIS runs this silently: same install directory, no wizard, no manual
      // download. The app has to go away before the files can be replaced.
      const { spawn } = await import('node:child_process');
      spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 400);
      return { ok: true };
    }
    if (process.platform === 'darwin') {
      // An unsigned DMG cannot self-replace, so mount it and finish in Finder.
      await shell.openPath(installerPath);
      shell.showItemInFolder(installerPath);
      publish({ ...state, phase: 'ready' });
      return { ok: true };
    }
    await shell.openPath(installerPath);
    return { ok: true };
  } catch (error) {
    publish({ ...state, phase: 'error', error: (error as Error).message });
    return { ok: false, error: (error as Error).message };
  }
}

export function registerUpdater() {
  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', (_event, quiet?: boolean) => checkForUpdates({ quiet: Boolean(quiet) }));
  ipcMain.handle('update:install', () => install());

  if (!app.isPackaged) return;
  timer = setTimeout(() => void checkForUpdates({ quiet: true }), FIRST_CHECK_DELAY);
  const interval = setInterval(() => void checkForUpdates({ quiet: true }), CHECK_INTERVAL);
  app.on('before-quit', () => {
    if (timer) clearTimeout(timer);
    clearInterval(interval);
  });
}
