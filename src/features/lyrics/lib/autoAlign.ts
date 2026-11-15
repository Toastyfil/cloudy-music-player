import type { Track } from '@/shared/api/contracts';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useLyricsStore } from '../store/lyricsStore';
import { autoAlignTrack } from './align';

/**
 * Background alignment.
 *
 * A track is analysed once, the first time it plays, and the decision is
 * remembered either way — including "nothing conclusive here" — so a track is
 * never decoded twice just because it started with a mismatched intro. Any
 * offset already on the track (manual or from the Auto button) wins, and a weak
 * correlation is ignored rather than nudging a song that was already in sync.
 */

const KEY = 'cloudy:lyric-align:v1';
const RECHECK_AFTER = 1000 * 60 * 60 * 24 * 7; // a week
const MIN_CONFIDENCE = 0.06;
const MIN_SHIFT = 0.3;
const RETRIES = 5;

interface Entry {
  at: number;
  offset: number | null;
  confidence: number | null;
}

function read(): Record<string, Entry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, Entry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota — the run still applied its result for this session */
  }
}

const checks = read();
let busy = false;
let timer = 0;
let attempts = 0;
let scheduledTrack: string | null = null;

export function alignmentChecked(trackId: string) {
  const entry = checks[trackId];
  return Boolean(entry) && Date.now() - entry.at < RECHECK_AFTER;
}

export function scheduleAutoAlign(track: Track | null, delay = 8000) {
  window.clearTimeout(timer);
  scheduledTrack = track?.id ?? null;
  attempts = 0;
  if (!track) return;
  timer = window.setTimeout(() => void run(track), delay);
}

async function run(track: Track) {
  if (scheduledTrack !== track.id) return;
  if (busy) return;

  const lyrics = useLyricsStore.getState();
  const player = usePlayerStore.getState();

  // Lyrics can still be arriving when the timer fires; come back for them.
  if (lyrics.status === 'loading' || (lyrics.status === 'idle' && attempts < RETRIES)) {
    attempts += 1;
    if (attempts <= RETRIES) timer = window.setTimeout(() => void run(track), 3000);
    return;
  }

  if (lyrics.status !== 'synced' || lyrics.lines.length < 6) return;
  // Already tuned, by hand or by a previous run.
  if (lyrics.trackOffsets[track.id]) return;
  if (alignmentChecked(track.id)) return;
  if (useSettingsStore.getState().performanceMode) return;
  if (!player.playing || player.buffering || player.error) return;

  busy = true;
  try {
    const result = await autoAlignTrack(track, { apply: false });
    // The user may have moved on while the decode ran; never tune a track they
    // are no longer looking at.
    if (useLyricsStore.getState().trackId !== track.id) return;
    const decisive = result && result.confidence >= MIN_CONFIDENCE && Math.abs(result.offset) >= MIN_SHIFT;
    if (decisive) useLyricsStore.getState().setTrackOffset(track.id, result.offset);
    checks[track.id] = { at: Date.now(), offset: result?.offset ?? null, confidence: result?.confidence ?? null };
    write(checks);
  } catch {
    // Record the attempt so a broken decode is not retried on every play.
    checks[track.id] = { at: Date.now(), offset: null, confidence: null };
    write(checks);
  } finally {
    busy = false;
  }
}
