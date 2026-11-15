import { memo, useEffect, useRef } from 'react';
import { audioEngine } from '@/features/player/engine/audioEngine';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { cn } from '@/shared/lib/cn';

const BAR_COUNT = 20;

/**
 * A small live spectrum for the player bar. Reads the same analyser the rest of
 * the UI already fills on every frame, so it costs one canvas rather than a
 * second audio tap. Capped at ~30fps and it settles flat when paused.
 */
export const Visualizer = memo(function Visualizer({
  playing,
  bars = BAR_COUNT,
  className,
}: {
  playing: boolean;
  bars?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const performanceMode = useSettingsStore((state) => state.performanceMode);
  const sensitivity = useSettingsStore((state) => state.visualizerSensitivity);
  const smoothness = useSettingsStore((state) => state.visualizerSmoothness);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Performance mode drops the visualiser entirely rather than animating it.
    if (performanceMode) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const levels = new Float32Array(bars);
    let frame = 0;
    let lastPaint = 0;

    const paint = (time: number) => {
      frame = requestAnimationFrame(paint);
      if (time - lastPaint < 32) return;
      lastPaint = time;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const bands = audioEngine.getBands();
      // Log-ish mapping: linear buckets would put everything in the first
      // three bars, which reads as a broken meter rather than a song.
      const accent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffffff';
      context.fillStyle = accent;

      const gap = 2;
      // Smoothness stretches the fall-off: 0 snaps back, 1 leaves long tails.
      const decay = 0.70 + smoothness * 0.27;
      const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
      for (let index = 0; index < bars; index++) {
        const source = Math.floor((index / bars) ** 1.55 * bands.length * 0.72);
        const raw = bands[Math.min(bands.length - 1, source)] ?? 0;
        const target = playingRef.current ? Math.min(1, raw * sensitivity) : 0;
        levels[index] = target > levels[index] ? target : levels[index] * decay;
        const barHeight = Math.max(2, levels[index] * height);
        const x = index * (barWidth + gap);
        context.globalAlpha = playingRef.current ? 0.45 + levels[index] * 0.55 : 0.2;
        context.beginPath();
        context.roundRect(x, height - barHeight, barWidth, barHeight, barWidth / 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [bars, performanceMode, sensitivity, smoothness]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('h-7 w-[92px]', performanceMode && 'hidden', className)}
    />
  );
});
