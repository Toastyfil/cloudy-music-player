// Offline audio cache: pulled from the Cloudy API into userData so a track that
// has been played once keeps working without a network round trip.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

let cacheDir = '';
const inflight = new Map<string, Promise<string | null>>();

export function initCache(userDataPath: string) {
  cacheDir = path.join(userDataPath, 'audio-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

function fileFor(videoId: string) {
  return path.join(cacheDir, `${videoId}.m4a`);
}

export function cachedPathFor(videoId: string) {
  const file = fileFor(videoId);
  return fs.existsSync(file) ? file : null;
}

export function cacheTrack(videoId: string, streamUrl: string, apiOrigin: string): Promise<string | null> {
  const existing = inflight.get(videoId);
  if (existing) return existing;

  const task = (async () => {
    const target = fileFor(videoId);
    const partial = `${target}.part`;
    try {
      const url = streamUrl.startsWith('http') ? streamUrl : `${apiOrigin}${streamUrl}`;
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`cache fetch failed (${res.status})`);
      await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(partial));
      await fsp.rename(partial, target);
      return target;
    } catch {
      await fsp.rm(partial, { force: true }).catch(() => undefined);
      return null;
    } finally {
      inflight.delete(videoId);
    }
  })();

  inflight.set(videoId, task);
  return task;
}

export async function cacheStats() {
  try {
    const files = await fsp.readdir(cacheDir);
    let bytes = 0;
    for (const file of files) {
      const stat = await fsp.stat(path.join(cacheDir, file)).catch(() => null);
      if (stat?.isFile()) bytes += stat.size;
    }
    return { files: files.filter((f) => f.endsWith('.m4a')).length, bytes, directory: cacheDir };
  } catch {
    return { files: 0, bytes: 0, directory: cacheDir };
  }
}

export async function clearCache() {
  await fsp.rm(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheStats();
}

export async function removeCached(videoId: string) {
  await fsp.rm(fileFor(videoId), { force: true });
  return true;
}
