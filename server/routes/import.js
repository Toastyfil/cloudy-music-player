import { Router } from 'express';
import { detectSource, resolveImport, spotifyProfilePlaylists } from '../lib/importers.js';

const router = Router();

router.post('/resolve', async (req, res, next) => {
  const url = String(req.body?.url ?? '').trim();
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const result = await resolveImport(url);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/detect', (req, res) => {
  const url = String(req.query.url ?? '');
  const detected = detectSource(url);
  res.json({ detected });
});

router.get('/spotify/user/:id', async (req, res, next) => {
  try {
    res.json({ playlists: await spotifyProfilePlaylists(req.params.id) });
  } catch (err) {
    next(err);
  }
});

export default router;
