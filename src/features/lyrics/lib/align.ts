import type { Track } from '@/shared/api/contracts';
import { catalogApi, resolveApi } from '@/shared/api/client';
import { useLyricsStore } from '../store/lyricsStore';

/**
 * Automatic lyric alignment.
 *
 * The idea is simple: a lyric line marks where the voice is, and the voice is
 * what dominates the 250–3600 Hz band. Decode the track, isolate that band,
 * reduce it to a 50 ms loudness envelope, then slide the lyric windows along the
 * envelope and keep the shift where the most energy falls inside them. If the
 * LRC was authored for a cut with a different intro, that peak is exactly the
 * correction — no manual tapping needed.
 */

const FRAME = 0.05; // 50 ms resolution
const MAX_SHIFT = 45; // seconds, matches the per-track offset clamp
const MIN_CONFIDENCE = 0.03;

export interface AlignResult {
  /** Seconds to apply as the lyric offset: positive shows lyrics earlier. */
  offset: number;
  confidence: number;
}

/** Frames where a lyric line is being sung, at FRAME resolution. */
function buildMask(lineTimes: number[], frames: number) {
  const mask = new Uint8Array(frames);
  const sorted = [...lineTimes].filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index++) {
    const start = Math.round(sorted[index] / FRAME);
    const next = sorted[index + 1] ?? sorted[index] + 6;
    // A line ends a little before the next starts, so held notes and gaps do not
    // count as "should be loud".
    const end = Math.round(Math.min(next - 0.35, sorted[index] + 6) / FRAME);
    for (let frame = Math.max(0, start); frame < Math.min(frames, end); frame++) mask[frame] = 1;
  }
  return { mask, count: mask.reduce((sum, value) => sum + value, 0) };
}

async function vocalEnvelope(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`stream ${response.status}`);
  const bytes = await response.arrayBuffer();

  const Ctx = window.AudioContext;
  const decodeContext = new Ctx();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(bytes.slice(0));
  } finally {
    void decodeContext.close();
  }

  // Render through the vocal band at a low rate: 8 kHz is plenty for a 50 ms
  // envelope and keeps the offline render quick.
  const rate = 8000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  const high = offline.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 250;
  const low = offline.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 3600;
  source.connect(high);
  high.connect(low);
  low.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

export async function estimateLyricOffset(
  streamUrl: string,
  lineTimes: number[],
  signal?: AbortSignal,
): Promise<AlignResult | null> {
  if (!lineTimes.length) return null;

  const rendered = await vocalEnvelope(streamUrl, signal);
  const data = rendered.getChannelData(0);
  const frameSize = Math.round(rendered.sampleRate * FRAME);
  const frames = Math.floor(data.length / frameSize);
  if (frames < 40) return null;

  const energy = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    const offset = frame * frameSize;
    for (let sample = 0; sample < frameSize; sample++) {
      const value = data[offset + sample];
      sum += value * value;
    }
    energy[frame] = Math.sqrt(sum / frameSize);
  }

  // One frame of smoothing tames syllable-level flicker without blurring phrases.
  const smooth = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    smooth[frame] = (energy[frame] + (energy[frame - 1] ?? 0) + (energy[frame + 1] ?? 0)) / 3;
  }

  const { mask, count } = buildMask(lineTimes, frames);
  if (count < 20) return null;

  let total = 0;
  for (let frame = 0; frame < frames; frame++) total += smooth[frame];
  if (total <= 0) return null;

  const maxLag = Math.round(MAX_SHIFT / FRAME);
  const scores = new Float32Array(maxLag * 2 + 1);
  let bestLag = 0;
  let bestScore = -1;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let inside = 0;
    let seen = 0;
    for (let frame = 0; frame < frames; frame++) {
      if (!mask[frame]) continue;
      const shifted = frame + lag;
      if (shifted < 0 || shifted >= frames) continue;
      inside += smooth[shifted];
      seen += 1;
    }
    // Fraction of the track's vocal-band energy that lands on lyric windows.
    const score = seen ? inside / total : 0;
    scores[lag + maxLag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const sortedScores = Array.from(scores).sort((a, b) => a - b);
  const median = sortedScores[Math.floor(sortedScores.length / 2)];
  const confidence = bestScore - median;
  if (confidence < MIN_CONFIDENCE) return null;

  // The mask had to move *later* by bestLag to line up with the audio, so the
  // lyrics are that far ahead of the recording's actual timing.
  const offset = -(bestLag * FRAME);
  return { offset: Math.round(offset * 100) / 100, confidence: Math.round(confidence * 1000) / 1000 };
}

/** Resolve the playing recording, align against it, and optionally store it. */
export async function autoAlignTrack(
  track: Track,
  { apply = true }: { apply?: boolean } = {},
): Promise<AlignResult | null> {
  const state = useLyricsStore.getState();
  const { lines } = state;
  if (!lines.length) return null;

  const playableId = await resolveApi.playableId(track);
  const result = await estimateLyricOffset(
    catalogApi.stream(playableId),
    lines.map((line) => line.time),
  );
  if (!result) return null;

  const offset = Math.abs(result.offset) < 0.15 ? 0 : result.offset;
  if (apply) useLyricsStore.getState().setTrackOffset(track.id, offset);
  return { ...result, offset };
}
