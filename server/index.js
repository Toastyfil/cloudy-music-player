import express from 'express';
import cors from 'cors';
import searchRoutes from './routes/search.js';
import artistRoutes from './routes/artist.js';
import albumRoutes from './routes/album.js';
import trackRoutes from './routes/track.js';
import streamRoutes from './routes/stream.js';
import playlistRoutes from './routes/playlist.js';
import importRoutes from './routes/import.js';
import resolveRoutes from './routes/resolve.js';
import lyricsRoutes from './routes/lyrics.js';
import artRoutes from './routes/art.js';
import { getClient } from './lib/youtube.js';
import { initTrackStore, cacheStats, clearAudioCache, ensureTrack } from './lib/tracks.js';
import { initLyricsCache } from './lib/lyrics.js';
import path from 'node:path';
import os from 'node:os';

initTrackStore(process.env.CLOUDY_AUDIO_DIR ?? path.join(os.homedir(), '.cloudy', 'audio'));
initLyricsCache(process.env.CLOUDY_LYRICS_DIR ?? path.join(os.homedir(), '.cloudy', 'lyrics'));

const PORT = Number(process.env.CLOUDY_API_PORT ?? 3456);

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/health', async (_req, res) => {
  let catalog = 'pending';
  try {
    await getClient();
    catalog = 'ready';
  } catch (err) {
    catalog = `error: ${err.message}`;
  }
  res.json({ ok: true, catalog, uptime: process.uptime() });
});

app.use('/search', searchRoutes);
app.use('/artist', artistRoutes);
app.use('/album', albumRoutes);
app.use('/track', trackRoutes);
app.use('/stream', streamRoutes);
app.use('/playlist', playlistRoutes);
app.use('/import', importRoutes);
app.use('/resolve', resolveRoutes);
app.use('/lyrics', lyricsRoutes);
app.use('/art', artRoutes);

app.get('/cache/stats', async (_req, res) => res.json(await cacheStats()));
app.post('/cache/clear', async (_req, res) => res.json(await clearAudioCache()));

// Warm the audio store for tracks the user is likely to click next.
let prefetchQueue = [];
let prefetchRunning = 0;
const prefetched = new Set();

function pumpPrefetch() {
  while (prefetchRunning < 2 && prefetchQueue.length) {
    const id = prefetchQueue.shift();
    if (!id || prefetched.has(id)) continue;
    prefetched.add(id);
    prefetchRunning += 1;
    ensureTrack(id)
      .catch(() => undefined)
      .finally(() => {
        prefetchRunning -= 1;
        pumpPrefetch();
      });
  }
}

app.post('/prefetch', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => typeof id === 'string').slice(0, 12) : [];
  for (const id of ids) if (!prefetched.has(id) && !prefetchQueue.includes(id)) prefetchQueue.push(id);
  pumpPrefetch();
  res.json({ queued: prefetchQueue.length, running: prefetchRunning });
});

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

app.use((err, _req, res, _next) => {
  console.error('[cloudy-api]', err?.stack ?? err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: err?.message ?? 'Internal error' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[cloudy-api] listening on http://127.0.0.1:${PORT}`);
  getClient()
    .then(() => console.log('[cloudy-api] music catalog session ready'))
    .catch((err) => console.error('[cloudy-api] catalog session failed:', err.message));
});
