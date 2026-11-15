// On-disk track store.
//
// YouTube Music's unauthenticated streaming URLs only serve the first chunk of
// a track before returning 403, so Cloudy resolves audio through yt-dlp once and
// keeps the result on disk. Playback then reads a real local file: instant,
// fully seekable, and already offline-cached for the next listen.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ytDlpPath } from './tools.js';

const YTDLP_ARGS = [
  '--no-warnings',
  '--no-playlist',
  '--no-progress',
  '--no-call-home',
  '--no-part',
  '-f',
  'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
];

let cacheDir = path.join(process.cwd(), '.cloudy-audio');

export function initTrackStore(dir) {
  cacheDir = dir;
  fs.mkdirSync(cacheDir, { recursive: true });
}

export function storeDirectory() {
  return cacheDir;
}

const READY_EXT = ['.webm', '.m4a', '.opus', '.mp3', '.ogg', '.aac'];

function findReady(videoId) {
  for (const ext of READY_EXT) {
    const file = path.join(cacheDir, `${videoId}${ext}`);
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      if (stat.size > 1024) return { file, ext, size: stat.size };
    }
  }
  return null;
}

/** The in-progress download. Never served as if it were a finished track. */
export function findPartial(videoId) {
  try {
    const match = fs
      .readdirSync(cacheDir)
      .find((name) => name.startsWith(`${videoId}.part.`));
    if (!match) return null;
    const file = path.join(cacheDir, match);
    const stat = fs.statSync(file);
    if (stat.size > 1024) return { file, size: stat.size };
  } catch {
    /* not started yet */
  }
  return null;
}

function sniffExtension(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    if (head.subarray(4, 8).toString('latin1') === 'ftyp') return '.m4a';
    if (head[0] === 0x1a && head[1] === 0x45) return '.webm';
    if (head.subarray(0, 4).toString('latin1') === 'OggS') return '.opus';
  } catch {
    /* fall through */
  }
  return '.webm';
}

export function contentTypeFor(ext) {
  switch (ext) {
    case '.webm':
      return 'audio/webm';
    case '.m4a':
    case '.aac':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.opus':
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'audio/webm';
  }
}

const jobs = new Map();

/**
 * Start (or join) the download for a video. Resolves when the file is complete.
 * `onReady` is called as soon as a usable file exists on disk.
 */
export function ensureTrack(videoId, { onReady } = {}) {
  const ready = findReady(videoId);
  if (ready) {
    onReady?.(ready);
    return Promise.resolve(ready);
  }

  const existing = jobs.get(videoId);
  if (existing) {
    if (onReady) existing.listeners.push(onReady);
    return existing.promise;
  }

  const job = { listeners: onReady ? [onReady] : [], promise: null };
  jobs.set(videoId, job);

  job.promise = new Promise((resolve, reject) => {
    const args = [
      ...YTDLP_ARGS,
      '-o',
      path.join(cacheDir, `${videoId}.part.%(ext)s`),
      `https://music.youtube.com/watch?v=${videoId}`,
    ];
    const child = spawn(ytDlpPath(), args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const tick = setInterval(() => {
      const found = findReady(videoId);
      if (found) {
        clearInterval(tick);
        for (const listener of job.listeners.splice(0)) listener(found);
        onReady?.(found);
      }
    }, 250);

    /** Only a finished download becomes a playable track. */
    const finalize = () => {
      const partial = findPartial(videoId);
      if (!partial) return findReady(videoId);
      const ext = sniffExtension(partial.file);
      const target = path.join(cacheDir, `${videoId}${ext}`);
      try {
        fs.renameSync(partial.file, target);
      } catch {
        return null;
      }
      return findReady(videoId);
    };

    const timeout = setTimeout(() => {
      clearInterval(tick);
      child.kill();
      jobs.delete(videoId);
      reject(new Error('Audio download timed out'));
    }, 120_000);

    child.on('error', (err) => {
      clearInterval(tick);
      clearTimeout(timeout);
      jobs.delete(videoId);
      reject(err);
    });

    child.on('close', (code) => {
      clearInterval(tick);
      clearTimeout(timeout);
      const found = finalize();
      jobs.delete(videoId);
      if (found) {
        for (const listener of job.listeners.splice(0)) listener(found);
        resolve(found);
      } else {
        reject(new Error(`yt-dlp exited with ${code}: ${stderr.slice(0, 300)}`));
      }
    });
  });

  // Callers that only wait for progress should not crash the process.
  job.promise.catch(() => undefined);
  return job.promise;
}

export function trackPath(videoId) {
  return findReady(videoId);
}

export async function removeTrack(videoId) {
  const ready = findReady(videoId);
  if (ready) await fsp.rm(ready.file, { force: true });
  return true;
}

export async function cacheStats() {
  try {
    const files = await fsp.readdir(cacheDir);
    let bytes = 0;
    for (const file of files) {
      const stat = await fsp.stat(path.join(cacheDir, file)).catch(() => null);
      if (stat?.isFile()) bytes += stat.size;
    }
    return { files: files.filter((f) => READY_EXT.some((ext) => f.endsWith(ext))).length, bytes, directory: cacheDir };
  } catch {
    return { files: 0, bytes: 0, directory: cacheDir };
  }
}

export async function clearAudioCache() {
  await fsp.rm(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheStats();
}
