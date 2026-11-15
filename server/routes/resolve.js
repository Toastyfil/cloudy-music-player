import { Router } from 'express';
import { findAlternatives, resolveToPlayable } from '../lib/sources.js';

const router = Router();

/**
 * POST /resolve { id, source, title, artist, duration }
 * Maps a SoundCloud / Deezer / Apple Music result onto a playable audio id.
 * The renderer calls this right before playback, and again in the background
 * for the top of every result list so the click itself is already warm.
 */
router.post('/', async (req, res, next) => {
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim();
  const artist = String(body.artist ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Missing title' });

  try {
    const resolved = await resolveToPlayable({
      id: body.id ?? `${body.source ?? 'external'}:${title}`,
      source: body.source ?? null,
      title,
      artist,
      duration: Number(body.duration) || null,
    });
    if (!resolved?.videoId) {
      return res.status(404).json({ error: 'Not available in the catalog Cloudy plays from' });
    }
    res.json(resolved);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /resolve/fallback { title, artist, exclude }
 * A second recording to try when the first one refuses to deliver audio.
 */
router.post('/fallback', async (req, res, next) => {
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Missing title' });

  try {
    const alternatives = await findAlternatives(
      { title, artist: String(body.artist ?? '').trim(), duration: Number(body.duration) || null },
      { exclude: body.exclude ?? null, limit: 3 },
    );
    if (!alternatives.length) return res.status(404).json({ error: 'No alternative source' });
    res.json(alternatives[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
