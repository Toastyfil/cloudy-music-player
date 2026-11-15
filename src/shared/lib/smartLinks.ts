// Cloudy smart links.
//
// Every entity gets a short, stable id: cloudy.app/t/… for a track, /a/… artist,
// /al/… album, /pl/… playlist. The same slug is used by the cloudy:// protocol so
// an in-app click can navigate without a round trip.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type LinkKind = 'track' | 'artist' | 'album' | 'playlist';

const PREFIX: Record<LinkKind, string> = {
  track: 't',
  artist: 'a',
  album: 'al',
  playlist: 'pl',
};

/** YouTube-style ids are already url-safe; keep them readable when they are. */
export function encodeId(id: string): string {
  if (/^[A-Za-z0-9_-]{4,40}$/.test(id)) return id;
  let n = BigInt('0x' + Buffer.from(id).toString('hex') || '0');
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out || '0';
}

export function decodeId(slug: string): string {
  if (/^[A-Za-z0-9_-]{4,40}$/.test(slug)) return slug;
  let n = 0n;
  for (const ch of slug) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    n = n * 62n + BigInt(idx);
  }
  const hex = n.toString(16);
  return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex').toString();
}

export function smartLink(kind: LinkKind, id: string) {
  return `https://cloudy.app/${PREFIX[kind]}/${encodeId(id)}`;
}

export function deepLink(kind: LinkKind, id: string) {
  return `cloudy://${PREFIX[kind]}/${encodeId(id)}`;
}

const ROUTE_PREFIX: Record<LinkKind, string> = {
  track: 'track',
  artist: 'artist',
  album: 'album',
  playlist: 'playlist',
};

/** Map a cloudy:// or cloudy.app URL onto an in-app route. */
export function routeForLink(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const [prefix, slug] = segments;
  const kind = (Object.keys(PREFIX) as LinkKind[]).find((k) => PREFIX[k] === prefix);
  if (!kind) return null;
  const id = decodeId(slug);
  if (kind === 'track') return `/track/${id}`;
  return `/${ROUTE_PREFIX[kind]}/${id}`;
}
