import { Router } from 'express';
import { getPlaylistPage } from '../lib/youtube.js';

const router = Router();

router.get('/:id', async (req, res, next) => {
  try {
    const playlist = await getPlaylistPage(req.params.id);
    res.json(playlist);
  } catch (err) {
    next(err);
  }
});

export default router;
