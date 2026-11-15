import { Router } from 'express';
import { getTrackInfo, resolveStream } from '../lib/youtube.js';

const router = Router();

router.get('/:id', async (req, res, next) => {
  try {
    const [track, stream] = await Promise.all([
      getTrackInfo(req.params.id),
      resolveStream(req.params.id).catch(() => null),
    ]);
    res.json({
      ...track,
      streamUrl: stream ? `${req.protocol}://${req.get('host')}/stream/${req.params.id}` : null,
      stream: stream
        ? {
            mimeType: stream.mimeType,
            bitrate: stream.bitrate,
            quality: stream.quality,
            proxy: `/stream/${req.params.id}`,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
