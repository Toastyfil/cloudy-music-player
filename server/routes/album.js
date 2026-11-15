import { Router } from 'express';
import { getAlbumPage } from '../lib/youtube.js';

const router = Router();

router.get('/:id', async (req, res, next) => {
  try {
    const album = await getAlbumPage(req.params.id);
    res.json(album);
  } catch (err) {
    next(err);
  }
});

export default router;
