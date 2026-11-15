import { Router } from 'express';
import { findLyrics } from '../lib/lyrics.js';

const router = Router();

/**
 * GET /lyrics?artist=&title=&album=&duration=
 * Always 200: a missing match is a normal answer, not an error, and the client
 * can tell "no lyrics" apart from "the service is down" without guessing.
 */
router.get('/', async (req, res, next) => {
  const title = String(req.query.title ?? '').trim();
  const artist = String(req.query.artist ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Missing title' });

  try {
    const result = await findLyrics({
      title,
      artist,
      album: String(req.query.album ?? '').trim() || null,
      duration: Number(req.query.duration) || null,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

export default router;
