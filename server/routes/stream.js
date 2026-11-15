// Audio delivery.
//
// The renderer only ever talks to `/stream/:id`. Behind it, Cloudy keeps a real
// audio file per track and serves it with byte-range support, which is what
// gives instant playback, gapless seeks and offline replay.
import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureTrack, contentTypeFor, trackPath, findPartial } from '../lib/tracks.js';

const router = Router();

function setAudioHeaders(res, ext, size) {
  res.setHeader('Content-Type', contentTypeFor(ext));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  if (size != null) res.setHeader('Content-Length', String(size));
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!match) return null;
  const start = match[1] === '' ? null : Number(match[1]);
  const end = match[2] === '' ? null : Number(match[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    const from = Math.max(0, size - end);
    return { start: from, end: size - 1 };
  }
  const finish = end === null ? size - 1 : Math.min(end, size - 1);
  if (start >= size) return { invalid: true };
  return { start, end: Math.max(start, finish) };
}

/** Stream a file that is still being written, until the download completes. */
async function streamGrowingFile(file, req, res, isComplete) {
  let position = 0;
  let contentTypeSet = false;
  let done = false;

  res.status(200);
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const stop = () => {
    done = true;
  };
  req.on('close', stop);
  res.on('close', stop);

  while (!done) {
    let chunk = null;
    try {
      const handle = await fsp.open(file, 'r');
      try {
        const stat = await handle.stat();
        const available = stat.size - position;
        if (available > 0) {
          const length = Math.min(available, 256 * 1024);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, position);
          chunk = buffer.subarray(0, bytesRead);
        }
      } finally {
        await handle.close();
      }
    } catch {
      break;
    }

    if (chunk?.length) {
      if (!contentTypeSet) {
        // Sniff the container so the browser decodes it on the first bytes.
        const head = chunk.subarray(0, 64);
        const isMp4 = head.length > 8 && head.subarray(4, 8).toString('latin1') === 'ftyp';
        res.setHeader('Content-Type', isMp4 ? 'audio/mp4' : 'audio/webm');
        contentTypeSet = true;
      }
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
      position += chunk.length;
      continue;
    }
    if (isComplete()) {
      // Drain anything written after the last read, then finish cleanly.
      const final = await fsp.stat(file).catch(() => null);
      if (!final || final.size <= position) break;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  if (!contentTypeSet) res.setHeader('Content-Type', 'audio/webm');
  res.end();
}

router.get('/:id', async (req, res, next) => {
  const videoId = req.params.id;
  const ready = trackPath(videoId);

  try {
    if (ready) {
      const size = ready.size;
      const range = parseRange(req.headers.range, size);
      if (range?.invalid) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      if (range) {
        res.status(206);
        setAudioHeaders(res, ready.ext, range.end - range.start + 1);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        fs.createReadStream(ready.file, { start: range.start, end: range.end }).pipe(res);
        return;
      }
      setAudioHeaders(res, ready.ext, size);
      res.status(200);
      fs.createReadStream(ready.file).pipe(res);
      return;
    }

    // Not cached yet. Start the download, then hand back a progressive
    // response from the growing file so audio begins before it is complete.
    const download = ensureTrack(videoId).catch(() => null);

    let partial = findPartial(videoId);
    const deadline = Date.now() + 8_000;
    while (!partial && Date.now() < deadline) {
      const finished = trackPath(videoId);
      if (finished) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
      partial = findPartial(videoId);
    }

    const finished = trackPath(videoId);
    if (!finished && partial) {
      await streamGrowingFile(partial.file, req, res, () => Boolean(trackPath(videoId)) || false);
      return;
    }

    const readyNow = finished ?? (await download);
    if (!readyNow) {
      res.status(503).json({ error: 'Audio is still being prepared' });
      return;
    }

    const stat = await fsp.stat(readyNow.file);
    const ext = path.extname(readyNow.file);
    const range = parseRange(req.headers.range, stat.size);
    if (range && !range.invalid) {
      res.status(206);
      setAudioHeaders(res, ext, range.end - range.start + 1);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      fs.createReadStream(readyNow.file, { start: range.start, end: range.end }).pipe(res);
      return;
    }
    setAudioHeaders(res, ext, stat.size);
    res.status(200);
    fs.createReadStream(readyNow.file).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/info', async (req, res, next) => {
  try {
    const ready = trackPath(req.params.id);
    if (ready) {
      res.json({ cached: true, ext: ready.ext, size: ready.size, contentType: contentTypeFor(ready.ext) });
      return;
    }
    res.json({ cached: false, contentType: 'audio/webm' });
    void ensureTrack(req.params.id);
  } catch (err) {
    next(err);
  }
});

export default router;
