import { apiOrigin, resolveApi } from '@/shared/api/client';
import { isExternalTrack } from '@/shared/config/sources';
import type { Track } from '@/shared/api/contracts';

/**
 * Audio for a track has to be pulled from YouTube before it can play, which
 * takes a few seconds the first time. Warming the store for whatever the user
 * is looking at (and the next couple of queued tracks) hides that almost
 * entirely — a clicked track is usually already local.
 */
const requested = new Set();
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: string[] = [];

/**
 * Warm both halves of playback for whatever is on screen: external catalog
 * results are matched to an audio id first, then every resulting id is queued
 * for download. By the time a track is clicked it usually starts instantly.
 */
export async function warmTracks(tracks: Track[]) {
  if (!tracks.length) return;
  prefetchTracks(tracks.filter((track) => !isExternalTrack(track)).map((track) => track.videoId ?? track.id));

  const external = tracks.filter(isExternalTrack).slice(0, 4);
  if (!external.length) return;
  const ids = await Promise.all(
    external.map((track) => resolveApi.playableId(track).catch(() => null)),
  );
  prefetchTracks(ids);
}

export function prefetchTracks(ids: (string | null | undefined)[], delay = 900) {
  const fresh = ids.filter((id): id is string => Boolean(id) && !requested.has(id!));
  if (!fresh.length) return;
  for (const id of fresh) requested.add(id);
  pending.push(...fresh);

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const batch = pending.slice(0, 12);
    pending = [];
    void fetch(`${apiOrigin()}/prefetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: batch }),
    }).catch(() => undefined);
  }, delay);
}
