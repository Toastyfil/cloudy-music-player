// Studio-only result hygiene.
//
// YouTube Music returns a genuine music catalog, but a song search can still
// surface live recordings, covers, karaoke tracks, reactions and compilations.
// Everything the player shows goes through these rules first.

// Titles that are never the original studio recording.
const REJECT_PATTERNS = [
  /\blive\b(?!\s*(?:from|at|session))/i,
  /\blive\s+(?:at|from|on|in)\b/i,
  /\bcover(?:ed)?\s+by\b/i,
  /\b(?:a\s+)?cover\b/i,
  /\breaction\b/i,
  /\breacts?\s+to\b/i,
  /\bkaraoke\b/i,
  /\binstrumental\b/i,
  /\bacapella\b|\ba\s+cappella\b/i,
  /\bsped\s*up\b|\bslowed\b|\bnightcore\b/i,
  /\b8d\s+audio\b/i,
  /\btop\s+\d+\b/i,
  /\bcompilation\b/i,
  /\bmegamix\b|\bmashup\b/i,
  /\binterview\b|\bpodcast\b|\bq\s*&\s*a\b/i,
  /\bbehind\s+the\s+scenes\b/i,
  /\bmaking\s+of\b/i,
  /\btutorial\b|\blesson\b|\bhow\s+to\s+play\b/i,
  /\blyric\s+video\b|\bwith\s+lyrics\b/i,
  /\bremix\b/i,
  /\bmedley\b/i,
  /\btribute\b/i,
  /\bfan\s+(?:made|edit)\b/i,
  /\b(?:full\s+)?album\s+review\b/i,
  /\b1\s+hour\b|\b10\s+hours?\b/i,
];

// Albums that only exist to hold someone else's songs, or novelty re-recordings.
const REJECT_ALBUM_PATTERNS = [
  /\bcover(?:s|ed)?\b/i,
  /\btribute\b/i,
  /\bkaraoke\b/i,
  /\bacoustic\s+session/i,
  /\bpunk\s+goes\b/i,
  /\brockabye\s+baby\b/i,
  /\blullaby\s+(?:versions|renditions)\b/i,
  /\bstring\s+quartet\b/i,
  /\b8-?bit\b/i,
  /\bplaylist\b.*\bcover/i,
];

// A "song" from the catalog is a studio recording; a video is usually a music
// video and is only used when nothing better exists.
const STUDIO_ITEM_TYPES = new Set(['song', 'video', 'ep_song']);

/** Strip "(feat. X)", "[Remastered]", " - 2011 Remaster" style noise. */
export function canonicalTitle(title = '') {
  return title
    .replace(/\((?:feat|ft|with)\.?[^)]*\)/gi, ' ')
    .replace(/\[(?:feat|ft|with)\.?[^\]]*\]/gi, ' ')
    .replace(/\((?:official|music|lyric|audio|video|hd|hq)[^)]*\)/gi, ' ')
    .replace(/\[(?:official|music|lyric|audio|video|hd|hq)[^\]]*\]/gi, ' ')
    .replace(/\s*-\s*(?:\d{4}\s*)?(?:remaster(?:ed)?|digital\s+remaster|single\s+version|album\s+version|radio\s+edit)\b.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse a title to the bucket two versions of the same song share. */
export function dedupeKey(title = '', artist = '') {
  const base = canonicalTitle(title)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const who = String(artist).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return `${base}::${who}`;
}

/** True when a title looks like anything other than the studio original. */
export function isStudioTitle(title = '', extra = '') {
  const haystack = `${title} ${extra}`;
  return !REJECT_PATTERNS.some((re) => re.test(haystack));
}

/** True when an album is a covers/tribute/novelty collection. */
export function isStudioAlbum(title = '', artist = '') {
  const haystack = `${title} ${artist}`;
  if (REJECT_ALBUM_PATTERNS.some((re) => re.test(haystack))) return false;
  return isStudioTitle(title);
}

/** Title with every qualifier removed — the identity of the song itself. */
export function pureTitle(title = '') {
  return canonicalTitle(title)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isStudioItem(item) {
  if (!item) return false;
  if (item.item_type && !STUDIO_ITEM_TYPES.has(item.item_type)) return false;
  return isStudioTitle(item.title);
}

/**
 * Ask YouTube's CDN for a square cover at a specific pixel size.
 * Google serves art with a `=w120-h120-l90-rj` style suffix, so the numeric
 * size is what gets swapped — passing "w544" here would produce a broken URL.
 */
export function thumbAt(url, size = 544) {
  if (!url) return null;
  const px = typeof size === 'string' ? Number(String(size).replace(/\D/g, '')) || 544 : size;
  return url
    .replace(/=w\d+-h\d+/, `=w${px}-h${px}`)
    .replace(/=h\d+-w\d+/, `=w${px}-h${px}`)
    .replace(/=s\d+(-c)?/, `=s${px}$1`)
    .replace(/\/w\d+-h\d+\//, `/w${px}-h${px}/`);
}

export { REJECT_PATTERNS, STUDIO_ITEM_TYPES };
