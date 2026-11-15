import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/format';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { audioEngine } from '../engine/audioEngine';

/**
 * The progress line itself is a wave: two sine harmonics with a bass-driven
 * amplitude, so seeking feels like the track rather than a static rule. The
 * played part and the remaining part are the same curve at different opacity.
 */
function WavyTrack({
  progress,
  hoverProgress,
  playing,
}: {
  progress: number;
  hoverProgress: number | null;
  playing: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const hoverRef = useRef(hoverProgress);
  hoverRef.current = hoverProgress;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const performanceMode = useSettingsStore((state) => state.performanceMode);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let phase = 0;
    let amplitude = 1;
    let lastFrame = performance.now();
    let accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffffff';
    let checkedAt = 0;

    // Size outside the frame loop: a backgrounded tab gets no animation frames,
    // and the canvas would otherwise keep its default 300×150 forever.
    const fit = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const render = (now: number) => {
      const delta = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      fit();
      context.clearRect(0, 0, width, height);

      if (now - checkedAt > 500) {
        accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffffff';
        checkedAt = now;
      }

      const active = playingRef.current && !performanceMode;
      const bass = active ? audioEngine.getBassEnergy() : 0;
      phase += delta * (active ? 2.4 + bass * 5 : 0);
      amplitude += ((active ? 2 + bass * 5.5 : 1.1) - amplitude) * Math.min(1, delta * 5);

      const midpoint = height / 2;
      const curve = (from: number, to: number) => {
        context.beginPath();
        const steps = Math.max(24, Math.round((to - from) * width * 0.5));
        for (let i = 0; i <= steps; i++) {
          const ratio = from + ((to - from) * i) / steps;
          const x = ratio * width;
          const wave =
            0.62 * Math.sin(x * 0.055 + phase) + 0.38 * Math.sin(x * 0.11 - phase * 1.35);
          const y = midpoint + wave * amplitude;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      };

      context.lineWidth = 2.4;
      context.lineJoin = 'round';
      context.strokeStyle = accent;

      const hover = hoverRef.current;
      if (hover != null && hover / 100 > progressRef.current) {
        context.globalAlpha = 0.16;
        context.lineWidth = 5;
        curve(progressRef.current, Math.min(1, hover / 100));
        context.lineWidth = 2.4;
      }

      context.globalAlpha = 0.24;
      curve(0, 1);

      const played = Math.max(0, Math.min(1, progressRef.current));
      if (played > 0.001) {
        context.globalAlpha = 1;
        curve(0, played);
      }
      context.globalAlpha = 1;

      // A small head on the played end makes the exact position unambiguous.
      if (played > 0.001) {
        const x = played * width;
        const wave = 0.62 * Math.sin(x * 0.055 + phase) + 0.38 * Math.sin(x * 0.11 - phase * 1.35);
        context.beginPath();
        context.fillStyle = accent;
        context.arc(x, midpoint + wave * amplitude, 3, 0, Math.PI * 2);
        context.fill();
      }
    };

    const paint = (now: number) => {
      frame = requestAnimationFrame(paint);
      render(now);
    };

    render(performance.now());
    const observer = new ResizeObserver(() => render(performance.now()));
    observer.observe(canvas);
    frame = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [performanceMode]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none h-4 w-full" />;
}

/**
 * Amber scrubber. While dragging it shows the drag position; otherwise it
 * follows the audio element directly via rAF so the fill is perfectly smooth
 * without re-rendering the whole bar.
 */
export function SeekBar({ compact = false, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  const duration = usePlayerStore((s) => s.duration);
  const seek = usePlayerStore((s) => s.seek);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const [position, setPosition] = useState(0);
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const playing = usePlayerStore((s) => s.playing);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (!dragging) setPosition(audioEngine.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const valueFromEvent = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !duration) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => setDragValue(valueFromEvent(event.clientX));
    const up = (event: PointerEvent) => {
      setDragging(false);
      seek(valueFromEvent(event.clientX));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, seek, valueFromEvent]);

  const current = dragging ? dragValue : position;
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  const hoverProgress = hoverValue != null && duration ? Math.min(100, (hoverValue / duration) * 100) : null;

  return (
    <div className={cn('flex w-full items-center gap-2.5', compact && 'gap-2')}>
      <span
        className={cn(
          'w-9 shrink-0 text-right text-[11px] tabular-nums',
          onDark ? 'text-white/55' : 'text-muted',
          compact && 'w-8 text-[10px]',
        )}
      >
        {formatTime(current)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        tabIndex={0}
        onPointerDown={(event) => {
          setDragging(true);
          setDragValue(valueFromEvent(event.clientX));
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragging) setHoverValue(valueFromEvent(event.clientX));
        }}
        onPointerLeave={() => setHoverValue(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') seek(current + 5);
          if (event.key === 'ArrowLeft') seek(current - 5);
        }}
        className="group relative flex h-4 flex-1 cursor-pointer items-center"
      >
        <WavyTrack progress={progress} hoverProgress={hoverProgress} playing={playing} />
      </div>
      <span
        className={cn(
          'w-9 shrink-0 text-[11px] tabular-nums',
          onDark ? 'text-white/40' : 'text-faint',
          compact && 'w-8 text-[10px]',
        )}
      >
        {formatTime(duration)}
      </span>
    </div>
  );
}
