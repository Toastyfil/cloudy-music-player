import { Router } from 'express';

const router = Router();

/**
 * Catalog art hosts send no CORS headers for some of their edge nodes, which
 * taints the canvas and makes colour extraction impossible from the renderer.
 * Everything here is public album art, so a tiny same-origin proxy keeps the
 * allowlist explicit instead of opening a general fetch-anything endpoint.
 */
const ALLOWED_HOSTS = [
  /(^|\.)ytimg\.com$/,
  /(^|\.)googleusercontent\.com$/,
  /(^|\.)ggpht\.com$/,
  /(^|\.)mzstatic\.com$/,
  /(^|\.)dzcdn\.net$/,
  /(^|\.)sndcdn\.com$/,
  /(^|\.)scdn\.co$/,
];

router.get('/', async (req, res, next) => {
  const raw = String(req.query.url ?? '').trim();
  let target;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.some((pattern) => pattern.test(target.hostname))) {
    return res.status(400).json({ error: 'Host not allowed' });
  }

  try {
    const upstream = await fetch(target, {
      headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (compatible; Cloudy/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: `Artwork ${upstream.status}` });

    const type = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return res.status(415).json({ error: 'Not an image' });

    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(bytes);
  } catch (error) {
    next(error);
  }
});

export default router;
