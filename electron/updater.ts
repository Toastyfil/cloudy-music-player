import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
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
/** The hand-off to the installer already happened; never start a second one. */
let installing = false;
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

function assetFor(assets: { name: string; browser_download_url: string; size?: number; digest?: string }[]) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const patterns =
    process.platform === 'win32'
      ? [
          // A zip is unpacked next to the running app and launched, so the
          // update never has to overwrite the executable that Windows (or an
          // antivirus file filter) is holding open.
          /-win-x64\.zip$/i,
          /-win-[\w-]+\.zip$/i,
          /setup\.exe$/i,
        ]
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

/** SHA-256 of a finished download, so a tampered or corrupted file is never run. */
async function sha256(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function download(url: string, name: string, expected?: number, digest?: string) {
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
  if (digest?.startsWith('sha256:')) {
    const expectedHash = digest.slice('sha256:'.length).toLowerCase();
    const actual = await sha256(target);
    if (actual !== expectedHash) {
      await fs.rm(target, { force: true });
      throw new Error('The update download did not match its published checksum');
    }
  }
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
      assets?: { name: string; browser_download_url: string; size?: number; digest?: string }[];
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
    const file = await download(
      asset.browser_download_url,
      asset.name,
      asset.size ? Number(asset.size) : undefined,
      asset.digest,
    );
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

/**
 * The folder holding the install: versioned copies live beside it, so an app-*
 * copy resolves to its parent rather than nesting deeper on every update.
 */
function windowsInstallRoot() {
  const dir = path.dirname(process.execPath);
  return path.basename(dir).startsWith('app-') ? path.dirname(dir) : dir;
}

/**
 * Switches a launch from an outdated copy to the newest versioned one.
 *
 * Shortcuts, taskbar pins and Explorer's history can all keep pointing at the
 * executable that existed before an update. Without this, opening Cloudy from
 * such a shortcut runs the old build again, which checks GitHub, sees a newer
 * release and offers the update the user just installed — over and over.
 */
export async function adoptNewerInstall(): Promise<boolean> {
  if (process.platform !== 'win32' || !app.isPackaged) return false;
  const dir = path.dirname(process.execPath);
  if (path.basename(dir).startsWith('app-')) return false;
  const root = dir;
  let best: { version: string; exe: string } | null = null;
  for (const entry of await fs.readdir(root).catch(() => [] as string[])) {
    if (!entry.startsWith('app-')) continue;
    const candidate = entry.slice('app-'.length);
    if (!isNewer(candidate, app.getVersion())) continue;
    const exe = path.join(root, entry, 'cloudy.exe');
    const exists = await fs
      .stat(exe)
      .then((stat) => stat.isFile())
      .catch(() => false);
    if (!exists) continue;
    if (!best || isNewer(candidate, best.version)) best = { version: candidate, exe };
  }
  if (!best) return false;
  await logInstall(`adopting ${best.version} from ${best.exe} (running ${app.getVersion()})`);
  const { spawn } = await import('node:child_process');
  spawn(best.exe, [...process.argv.slice(1), '--after-update'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
  return true;
}

/** A PowerShell single-quoted literal (paths never contain a quote we can't escape). */
function psLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

const SHORTCUT_SCRIPT = `param([string]$OldExe, [string]$NewExe)
$shell = New-Object -ComObject WScript.Shell
$old = [IO.Path]::GetFullPath($OldExe)
$roots = @(
  Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu',
  Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar',
  Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu',
  Join-Path $env:USERPROFILE 'Desktop',
  Join-Path $env:PUBLIC 'Desktop'
)
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $shortcut = $shell.CreateShortcut($_.FullName)
      if ($shortcut.TargetPath -and ([IO.Path]::GetFullPath($shortcut.TargetPath) -ieq $old)) {
        $shortcut.TargetPath = $NewExe
        $shortcut.WorkingDirectory = Split-Path -Parent $NewExe
        $shortcut.Save()
      }
    } catch { }
  }
}
`;

/** Points Start Menu, desktop and startup shortcuts at the freshly installed copy. */
async function repointShortcuts(oldExe: string, newExe: string) {
  const script = path.join(os.tmpdir(), `cloudy-shortcuts-${Date.now()}.ps1`);
  await fs.writeFile(script, SHORTCUT_SCRIPT, 'utf8');
  await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, oldExe, newExe],
    { windowsHide: true },
  ).catch(() => undefined);
  await fs.rm(script, { force: true }).catch(() => undefined);
}

/** Keeps "Apps & features" describing the folder that actually runs. */
async function repointUninstallEntry(newRoot: string, version: string) {
  const uninstaller = path.join(newRoot, 'Uninstall Cloudy.exe');
  const hasUninstaller = await fs
    .access(uninstaller)
    .then(() => true)
    .catch(() => false);
  const script = `param([string]$Root, [string]$Version, [string]$Uninstaller)
$key = Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue |
  Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -like 'Cloudy*' } |
  Select-Object -First 1
if (-not $key) { return }
Set-ItemProperty $key.PSPath -Name InstallLocation -Value $Root
Set-ItemProperty $key.PSPath -Name DisplayVersion -Value $Version
if ($Uninstaller) { Set-ItemProperty $key.PSPath -Name UninstallString -Value ('"' + $Uninstaller + '" /currentuser') }
`;
  const file = path.join(os.tmpdir(), `cloudy-uninstall-${Date.now()}.ps1`);
  await fs.writeFile(file, script, 'utf8');
  await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, newRoot, version, hasUninstaller ? uninstaller : ''],
    { windowsHide: true },
  ).catch(() => undefined);
  await fs.rm(file, { force: true }).catch(() => undefined);
}

/**
 * Windows update that cannot be blocked by a locked executable.
 *
 * The NSIS installer has to delete `cloudy.exe` before it can replace it, which
 * antivirus file filters refuse while the running app is still holding the file
 * — the install then aborts with "old application files could not be
 * uninstalled". Extracting the release zip into a sibling folder touches nothing
 * that is in use: the new copy is started from there, the shortcuts start
 * pointing at it, and the old folder is left to be cleaned up later.
 */
async function installWindowsZip(zip: string) {
  const version = state.version ?? 'latest';
  const currentExe = process.execPath;
  const destination = path.join(windowsInstallRoot(), `app-${version}`);
  await logInstall(`install start zip=${zip} dest=${destination}`);
  const newExe = await expandWindowsZip(zip, destination);
  await logInstall(`expanded exe=${newExe}`);
  await repointShortcuts(currentExe, newExe);
  await logInstall('shortcuts repointed');
  await repointUninstallEntry(destination, version);
  await logInstall('uninstall entry updated');
  // A marker from an earlier NSIS attempt would otherwise report a block that
  // this install just resolved.
  await fs.rm(path.join(app.getPath('userData'), 'updates', 'pending.json'), { force: true }).catch(() => undefined);
  publish({ ...state, phase: 'installing' });
  const { spawn } = await import('node:child_process');
  // Detached, so the new copy survives this process exiting. Arguments are
  // carried over so a launched-with-flags instance (debugging, deep link) stays
  // the same kind of instance.
  const child = spawn(newExe, [...process.argv.slice(1), '--after-update'], { detached: true, stdio: 'ignore' });
  child.on('error', (error) => void logInstall(`spawn failed: ${error.message}`));
  child.unref();
  await logInstall(`spawned pid=${child.pid ?? 'unknown'}`);
  setTimeout(() => app.quit(), 400);
  return { ok: true };
}

/** Diagnostics for the install hand-off: `<userData>/updates/install.log`. */
async function logInstall(line: string) {
  const file = path.join(app.getPath('userData'), 'updates', 'install.log');
  await fs.appendFile(file, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => undefined);
}

/** Unpacks the release zip and returns the executable inside it. */
async function expandWindowsZip(zip: string, destination: string) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  // Windows ships bsdtar, which reads zip archives and is far quicker than
  // Expand-Archive. PowerShell stays as the fallback for the rare machine where
  // tar is missing or blocked.
  const extracted = await run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), [
    '-xf',
    zip,
    '-C',
    destination,
  ], { windowsHide: true }).then(
    () => true,
    () => false,
  );
  if (!extracted) {
    await logInstall('tar extraction failed, falling back to Expand-Archive');
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${psLiteral(zip)} -DestinationPath ${psLiteral(destination)} -Force`,
      ],
      { windowsHide: true },
    );
  }
  const entries = await fs.readdir(destination).catch(() => [] as string[]);
  const exe = path.join(destination, 'cloudy.exe');
  await fs.access(exe).catch(async () => {
    await logInstall(`expand produced ${entries.length} entries: ${entries.slice(0, 5).join(', ')}`);
    throw new Error(`The update archive did not contain cloudy.exe (${entries.length} files extracted)`);
  });
  return exe;
}

async function install() {
  if (!installerPath) return { ok: false, error: 'No downloaded update' };
  if (installing) return { ok: true };
  installing = true;
  publish({ ...state, phase: 'installing' });
  try {
    if (process.platform === 'win32') {
      if (installerPath.endsWith('.zip')) return await installWindowsZip(installerPath);
      // Older releases only carry the NSIS installer. It replaces the running
      // executable, so it must not start until this process is gone: NSIS
      // refuses to remove files held open and aborts with "old application files
      // could not be uninstalled". The detached shell waits for Cloudy to exit,
      // then runs the installer silently.
      await fs
        .writeFile(
          path.join(app.getPath('userData'), 'updates', 'pending.json'),
          JSON.stringify({ version: state.version, at: Date.now() }),
          'utf8',
        )
        .catch(() => undefined);
      const { spawn } = await import('node:child_process');
      spawn('cmd.exe', ['/c', `timeout /t 3 /nobreak >nul & start "" "${installerPath}" /S`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      setTimeout(() => app.quit(), 250);
      return { ok: true };
    }
    if (process.platform === 'darwin') return await installOnMac();
    await shell.openPath(installerPath);
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    await logInstall(`install failed: ${message}`);
    publish({ ...state, phase: 'error', error: message });
    return { ok: false, error: message };
  }
}

/** Removes copies left behind by earlier zip updates (locked ones are skipped). */
async function pruneOldVersions() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const current = path.dirname(process.execPath);
  // Only a copy that lives in a versioned folder may delete its siblings; the
  // original install must never remove the newer copy it has not adopted yet.
  if (!path.basename(current).startsWith('app-')) return;
  const root = windowsInstallRoot();
  for (const entry of await fs.readdir(root).catch(() => [] as string[])) {
    if (!entry.startsWith('app-') || path.join(root, entry) === current) continue;
    await fs.rm(path.join(root, entry), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** An update was started but the running version never changed. */
async function reportBlockedUpdate() {
  if (!app.isPackaged) return;
  const marker = path.join(app.getPath('userData'), 'updates', 'pending.json');
  const raw = await fs.readFile(marker, 'utf8').catch(() => null);
  if (!raw) return;
  await fs.rm(marker, { force: true }).catch(() => undefined);
  let version: string | undefined;
  try {
    version = (JSON.parse(raw) as { version?: string }).version;
  } catch {
    return;
  }
  if (!version || !isNewer(version, app.getVersion())) return;
  publish({
    phase: 'error',
    version,
    error: `Cloudy ${version} could not be installed automatically. Download it from the releases page and run it once.`,
    checkedAt: Date.now(),
  });
}

export function registerUpdater() {
  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', (_event, quiet?: boolean) => checkForUpdates({ quiet: Boolean(quiet) }));
  ipcMain.handle('update:install', () => install());

  if (!app.isPackaged) return;
  void reportBlockedUpdate();
  void pruneOldVersions();
  timer = setTimeout(() => void checkForUpdates({ quiet: true }), FIRST_CHECK_DELAY);
  const interval = setInterval(() => void checkForUpdates({ quiet: true }), CHECK_INTERVAL);
  app.on('before-quit', () => {
    if (timer) clearTimeout(timer);
    clearInterval(interval);
      });
}
