import { Router } from 'express';
import { getArtistPage } from '../lib/youtube.js';

const router = Router();

router.get('/:id', async (req, res, next) => {
  try {
    const artist = await getArtistPage(req.params.id);
    res.json(artist);
  } catch (err) {
    next(err);
  }
});

export default router;
