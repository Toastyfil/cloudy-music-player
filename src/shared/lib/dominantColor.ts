import type { AccentPalette } from '@/shared/config/themes';
import { apiOrigin } from '@/shared/api/client';

/**
 * Pulls a single usable accent out of cover art.
 *
 * Art is fetched through the service's `/art` proxy rather than from the cover
 * <img> directly: several catalog hosts omit CORS headers, which would taint the
 * canvas and make `getImageData` throw. A tainted image resolves null and the
 * theme's own accent simply stays in place.
 */
const cache = new Map<string, AccentPalette | null>();
const CACHE_LIMIT = 40;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const light = (max + min) / 2;
  if (max === min) return { hue: 0, sat: 0, light };
  const delta = max - min;
  const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) hue = ((bn - rn) / delta + 2) * 60;
  else hue = ((rn - gn) / delta + 4) * 60;
  return { hue, sat, light };
}

/** Bigger, emptier images still need to decode, so keep the sample tiny. */
async function loadPixels(url: string, size: number) {
  const response = await fetch(`${apiOrigin()}/art?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return context.getImageData(0, 0, size, size).data;
}

export async function accentFromImage(url: string | undefined): Promise<AccentPalette | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;

  let result: AccentPalette | null = null;
  try {
    const size = 28;
    const data = await loadPixels(url, size);
    if (data) {
      // Weighted hue buckets: saturated pixels vote hard, greys barely vote at
      // all, so a photo of a person on a grey sleeve still lands on skin/sky
      // rather than washing out to the background.
      const buckets = new Map<number, { weight: number; r: number; g: number; b: number }>();
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 200) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b) / 255;
        const min = Math.min(r, g, b) / 255;
        const light = (max + min) / 2;
        if (light > 0.94 || light < 0.05) continue;
        const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1) || 1);
        const weight = sat * 2.4 + 0.12;
        const { hue } = rgbToHsl(r, g, b);
        const key = Math.round(hue / 15) % 24;
        const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
        bucket.weight += weight;
        bucket.r += r * weight;
        bucket.g += g * weight;
        bucket.b += b * weight;
        buckets.set(key, bucket);
      }

      let best: { weight: number; r: number; g: number; b: number } | null = null;
      for (const bucket of buckets.values()) {
        if (!best || bucket.weight > best.weight) best = bucket;
      }

      if (best && best.weight > 0) {
        const { hue, sat } = rgbToHsl(best.r / best.weight, best.g / best.weight, best.b / best.weight);
        const accentSat = Math.round(clamp(sat, 0.48, 0.88) * 100);
        const accent = `hsl(${Math.round(hue)} ${accentSat}% 56%)`;
        const strong = `hsl(${Math.round(hue)} ${Math.round(clamp(sat + 0.06, 0.52, 0.92) * 100)}% 68%)`;
        result = {
          accent,
          accentStrong: strong,
          accentSoft: `hsla(${Math.round(hue)}, ${accentSat}%, 56%, 0.18)`,
        };
      }
    }
  } catch {
    result = null;
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(url, result);
  return result;
}
