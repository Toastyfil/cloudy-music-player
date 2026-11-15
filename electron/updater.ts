import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { constants, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

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
  /** When the last successful or failed check finished. */
  checkedAt?: number;
}

let state: UpdateState = { phase: 'idle' };
let installerPath: string | null = null;
/** macOS only: the new bundle, unpacked from the release zip and ready to swap in. */
let stagedApp: string | null = null;
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
        ? [
            // The zip is the whole .app bundle, which is what lets Cloudy swap
            // itself in place without the user dragging anything.
            new RegExp(`-${arch}\\.zip$`, 'i'),
            /-(arm64|x64)\.zip$/i,
            new RegExp(`-${arch}\\.dmg$`, 'i'),
            /\.dmg$/i,
          ]
        : [/\.AppImage$/i];
  for (const pattern of patterns) {
    const match = assets.find((asset) => pattern.test(asset.name));
    if (match) return match;
  }
  return null;
}

/** Release notes are Markdown; the prompt only needs the opening prose. */
function summarise(body?: string) {
  if (!body) return undefined;
  const text = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[-*_]{3,}$/.test(line) && !/^\|/.test(line) && !/^!\[/.test(line))
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))
    .filter((line) => !/^[\d\s|:-]+$/.test(line));
  return text.slice(0, 3).join(' ').slice(0, 320);
}

async function download(url: string, name: string, expected?: number) {
  const directory = path.join(app.getPath('userData'), 'updates');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  // An earlier session may already hold the finished installer; keep it rather
  // than pulling another 130 MB.
  if (expected) {
    const existing = await fs.stat(target).catch(() => null);
    if (existing && existing.size === expected) return target;
  }
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

/** The .app bundle this process runs from (`…/Cloudy.app`). */
function currentBundle() {
  return path.resolve(process.execPath, '../../..');
}

/** Unzips the release bundle into a staging folder so the swap is just a copy. */
async function unpackMacApp(zip: string) {
  const staging = path.join(app.getPath('userData'), 'updates', 'staging');
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  await run('ditto', ['-x', '-k', zip, staging]);
  const bundle = (await fs.readdir(staging)).find((entry) => entry.endsWith('.app'));
  if (!bundle) throw new Error('The update package has no app bundle');
  return path.join(staging, bundle);
}

const MAC_SWAP_SCRIPT = `#!/bin/sh
PID="$1"; SRC="$2"; DEST="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.4; done
sleep 1
rm -rf "$DEST.cloudy-old"
mv "$DEST" "$DEST.cloudy-old" || exit 1
if ditto "$SRC" "$DEST"; then
  rm -rf "$DEST.cloudy-old"
else
  rm -rf "$DEST"
  mv "$DEST.cloudy-old" "$DEST"
  exit 1
fi
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
open "$DEST"
`;

/** Single-quotes a path for the shell (release paths never contain a quote). */
function shellPath(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * macOS has no silent installer: the only real in-place update is replacing the
 * .app bundle and reopening it. A detached script waits for this process to
 * exit, copies the staged bundle over the old one and relaunches Cloudy. A drag
 * install in /Applications is root-owned, so that case escalates once.
 */
async function installOnMac() {
  const target = currentBundle();
  if (stagedApp) {
    const { spawn } = await import('node:child_process');
    const writable = await fs.access(target, constants.W_OK).then(
      () => true,
      () => false,
    );
    if (writable) {
      const script = path.join(os.tmpdir(), `cloudy-update-${Date.now()}.sh`);
      await fs.writeFile(script, MAC_SWAP_SCRIPT, { mode: 0o755 });
      spawn('/bin/sh', [script, String(process.pid), stagedApp, target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const owner = `${process.getuid?.() ?? 501}:${process.getgid?.() ?? 20}`;
      const commands = [
        `rm -rf ${shellPath(target)}`,
        `ditto ${shellPath(stagedApp)} ${shellPath(target)}`,
        `chown -R ${owner} ${shellPath(target)}`,
        `xattr -dr com.apple.quarantine ${shellPath(target)} 2>/dev/null || true`,
      ].join('; ');
      const apple = `do shell script "${commands.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`;
      spawn('/usr/bin/osascript', ['-e', apple, '-e', `do shell script "open ${shellPath(target)}"`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  }
  // Releases before 1.1.2 shipped only a DMG, so those still open in Finder.
  if (installerPath?.endsWith('.dmg')) {
    await shell.openPath(installerPath);
    shell.showItemInFolder(installerPath);
    publish({ ...state, phase: 'ready' });
    return { ok: true };
  }
  return { ok: false, error: 'No macOS update package was downloaded' };
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
      publish({ phase: 'current', version: app.getVersion(), checkedAt: Date.now() });
      return state;
    }

    const asset = assetFor(release.assets ?? []);
    if (!asset) throw new Error('This release has no installer for this platform');

    const notes = summarise(release.body);
    publish({ phase: 'downloading', version: latest, notes, progress: 0 });
    const file = await download(asset.browser_download_url, asset.name, asset.size ? Number(asset.size) : undefined);
    installerPath = file;
    if (process.platform === 'darwin' && file.endsWith('.zip')) stagedApp = await unpackMacApp(file);
    publish({
      phase: 'ready',
      version: latest,
      notes,
      checkedAt: Date.now(),
      progress: 1,
      total: Number(asset.size ?? 0) || undefined,
    });
  } catch (error) {
    publish({ phase: 'error', error: error instanceof Error ? error.message : 'Update check failed', checkedAt: Date.now() });
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
    if (process.platform === 'darwin') return await installOnMac();
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
