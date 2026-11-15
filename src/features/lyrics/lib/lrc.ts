// LRC parsing, including the enhanced word-level variant:
//   [00:12.34]<00:12.34>Never <00:12.80>gonna <00:13.20>give
// Plain LRC is upgraded to syllable timing by weighting each syllable by its
// letter count across the line's known duration.

export interface LyricSyllable {
  text: string;
  time: number;
  /** Parentheses and brackets are ad-libs: dimmed, never karaoke-swept. */
  backing?: boolean;
}

export interface LyricLine {
  time: number;
  end: number;
  text: string;
  syllables: LyricSyllable[];
}

export interface ParsedLyrics {
  lines: LyricLine[];
  synced: boolean;
  offset: number;
  instrumental: boolean;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function toSeconds(minutes: string, seconds: string, fraction?: string) {
  let ms = 0;
  if (fraction) ms = Number(fraction.padEnd(3, '0').slice(0, 3)) / 1000;
  return Number(minutes) * 60 + Number(seconds) + ms;
}

const VOWEL_GROUP = /[aeiouyàáâäãåèéêëìíîïòóôöõùúûü]+/gi;

/** Split a word into syllable-ish chunks for the highlight animation. */
export function syllabify(word: string): string[] {
  if (word.length <= 3) return [word];
  const parts: string[] = [];
  let lastIndex = 0;
  const matches = [...word.matchAll(VOWEL_GROUP)];
  for (let i = 0; i < matches.length - 1; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const nextStart = matches[i + 1].index ?? word.length;
    // Keep the consonant cluster that opens the next syllable with it.
    const cut = start + Math.max(1, Math.round((nextStart - start) / 2));
    if (cut <= lastIndex) continue;
    parts.push(word.slice(lastIndex, cut));
    lastIndex = cut;
  }
  parts.push(word.slice(lastIndex));
  return parts.filter(Boolean);
}

function syllablesFromWords(text: string, wordTimes: { text: string; time: number }[], end: number): LyricSyllable[] {
  const out: LyricSyllable[] = [];
  let depth = 0;
  wordTimes.forEach((word, index) => {
    const next = wordTimes[index + 1]?.time ?? end;
    const span = Math.max(0.12, next - word.time);
    // A timed chunk can hold both lead and ad-lib text ("world (echo)"), so
    // split by brackets first and give each side its own share of the time.
    const parts = word.text.split(/(\([^)]*\)|\[[^\]]*\])/).filter(Boolean);
    const totalChars = word.text.replace(/\s/g, '').length || 1;
    let cursor = word.time;
    for (const part of parts) {
      const opens = /^[\(\[]/.test(part);
      const backing = depth > 0 || opens;
      if (opens) depth += 1;
      const partChars = part.replace(/\s/g, '').length || 1;
      const partSpan = (partChars / totalChars) * span;
      const chunks = syllabify(part);
      const chunkChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
      for (const chunk of chunks) {
        out.push({ text: chunk, time: cursor, backing });
        cursor += (chunk.length / chunkChars) * partSpan;
      }
      if (opens && /[\)\]]$/.test(part)) depth = Math.max(0, depth - 1);
    }
  });
  if (!out.length && text) out.push({ text, time: wordTimes[0]?.time ?? 0 });
  return out;
}

function syllablesFromText(text: string, start: number, end: number): LyricSyllable[] {
  const words = text.split(/(\s+)/).filter(Boolean);
  const syllables: LyricSyllable[] = [];
  const span = Math.max(0.3, end - start);
  const totalChars = text.replace(/\s/g, '').length || 1;
  let cursor = start;
  let depth = 0;
  for (const word of words) {
    if (/^\s+$/.test(word)) {
      cursor += (word.length / totalChars) * span;
      syllables.push({ text: word, time: cursor, backing: depth > 0 });
      continue;
    }
    const opens = (word.match(/[\(\[]/g) ?? []).length;
    const closes = (word.match(/[\)\]]/g) ?? []).length;
    const backing = depth > 0 || opens > 0 || /^[\(\[]/.test(word);
    depth = Math.max(0, depth + opens - closes);
    for (const chunk of syllabify(word)) {
      syllables.push({ text: chunk, time: cursor, backing });
      cursor += (chunk.length / totalChars) * span;
    }
  }
  return syllables;
}

export function parseLrc(raw: string): ParsedLyrics {
  if (!raw?.trim()) return { lines: [], synced: false, offset: 0, instrumental: false };

  let offset = 0;
  const parsed: { time: number; text: string; words: { text: string; time: number }[] }[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const offsetMatch = rawLine.match(/^\[offset:([+-]?\d+)\]/i);
    if (offsetMatch) {
      offset = Number(offsetMatch[1]) / 1000;
      continue;
    }
    const tags = [...rawLine.matchAll(TIME_TAG)];
    if (!tags.length) continue;

    let body = rawLine.replace(TIME_TAG, '');
    const wordTimes: { text: string; time: number }[] = [];
    let hasWordTimes = false;
    if (body.includes('<')) {
      hasWordTimes = true;
      let lastTime = 0;
      let lastIndex = 0;
      for (const match of body.matchAll(WORD_TAG)) {
        const time = toSeconds(match[1], match[2], match[3]);
        if (lastIndex > 0) {
          const chunk = body.slice(lastIndex, match.index);
          // Keep the spacing: the words are rendered one span at a time, so a
          // trimmed chunk silently welds "roll and get" into "rollandget".
          if (chunk.trim()) wordTimes.push({ text: chunk.replace(/\s+/g, ' '), time: lastTime });
        }
        lastTime = time;
        lastIndex = (match.index ?? 0) + match[0].length;
      }
      const tail = body.slice(lastIndex);
      if (tail.trim()) wordTimes.push({ text: tail.replace(/\s+/g, ' '), time: lastTime });
      body = body.replace(WORD_TAG, '');
    }

    const text = body.replace(/\s+/g, ' ').trim();
    for (const tag of tags) {
      const time = toSeconds(tag[1], tag[2], tag[3]);
      parsed.push({ time, text, words: hasWordTimes ? wordTimes : [] });
    }
  }

  parsed.sort((a, b) => a.time - b.time);

  const instrumental = parsed.length > 0 && parsed.every((line) => !line.text);
  const lines: LyricLine[] = parsed.map((line, index) => {
    const next = parsed[index + 1]?.time;
    const end = next ?? line.time + Math.max(2, line.text.length / 14);
    return {
      time: line.time,
      end,
      text: line.text,
      syllables:
        line.words.length > 0
          ? syllablesFromWords(line.text, line.words, end)
          : syllablesFromText(line.text, line.time, end),
    };
  });

  return { lines, synced: lines.some((l) => l.time > 0), offset, instrumental };
}

export function findActiveLine(lines: LyricLine[], position: number): number {
  if (!lines.length) return -1;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= position) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/** How far through the active line we are, 0..1. */
export function lineProgress(line: LyricLine | undefined, position: number) {
  if (!line) return 0;
  const span = line.end - line.time;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (position - line.time) / span));
}
