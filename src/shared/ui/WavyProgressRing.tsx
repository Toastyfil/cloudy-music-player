import { memo, useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/features/player/engine/audioEngine';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { cn } from '@/shared/lib/cn';

export type CoverShape = 'circle' | 'squircle' | 'hexagon';

const SHAPES: CoverShape[] = ['circle', 'squircle', 'hexagon'];
const HEX_CLIP = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';

const RADIUS_BY_SHAPE: Record<CoverShape, string> = {
  circle: '50%',
  squircle: '34%',
  hexagon: '8%',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A progress ring that breathes.
 *
 * The outline is rebuilt every frame from three sine harmonics, with the
 * amplitude taken from the 20–200 Hz band, so the shape is never a perfect
 * circle while music plays. On a detected beat the whole ring gets a spring
 * impulse (roughly 3% and back) rather than a hard scale. Paused, the amplitude
 * interpolates to zero and it settles into a static ring.
 */
export const WavyProgressRing = memo(function WavyProgressRing({
  src,
  alt = '',
  size,
  thickness,
  playing,
  className,
  interactive = true,
}: {
  src?: string | null;
  alt?: string;
  size: number;
  thickness?: number;
  playing: boolean;
  className?: string;
  interactive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const waveEnabled = useSettingsStore((state) => state.waveRing);
  const performanceMode = useSettingsStore((state) => state.performanceMode);

  const [shape, setShape] = useState<CoverShape>('circle');

  const ring = thickness ?? clamp(size * 0.035, 2.5, 12);
  // Wave peaks have to live inside the box, so the base radius gives up room
  // for both the stroke and the maximum displacement.
  // Small rings still get a little life: a 48px cover would otherwise round
  // every displacement down to a sub-pixel that never renders.
  const maxAmplitude = Math.max(2.2, size * 0.032);
  // The artwork has to sit *inside* the ring's innermost wave peak, not just
  // inside its box: a cover that touches the ring hides the very thing that
  // makes this a ring.
  const inset = Math.ceil(ring + maxAmplitude * 1.7 + size * 0.03);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const animate = waveEnabled && !performanceMode;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixels = Math.round(size * dpr);
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const centre = size / 2;
    const radius = Math.max(2, centre - ring / 2 - maxAmplitude - 1);

    let frame = 0;
    let phase = 0;
    let amplitude = 0;
    let level = 0;
    let bassAverage = 0;
    let lastBeat = 0;
    let lastFrame = performance.now();
    let lastProgress = -1;
    let accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffffff';
    let accentChecked = 0;

    // Critically-damped-ish spring for the beat pulse.
    const spring = { value: 1, velocity: 0 };

    const paint = (now: number) => {
      frame = requestAnimationFrame(paint);
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;

      const progress = audioEngine.duration ? clamp(audioEngine.currentTime / audioEngine.duration, 0, 1) : 0;
      const isPlaying = playingRef.current;
      const bass = isPlaying && animate ? audioEngine.getBassEnergy() : 0;
      bassAverage = bassAverage * 0.94 + bass * 0.06;

      // Beat detection: a sharp rise over the local average, with a cooldown so
      // a sustained bass note does not keep the ring permanently inflated.
      if (animate && isPlaying && bass > 0.3 && bass > bassAverage * 1.3 && now - lastBeat > 150) {
        lastBeat = now;
        spring.velocity += 1.1;
      }

      const beatTarget = 1;
      spring.velocity += (beatTarget - spring.value) * 130 * dt - spring.velocity * 13 * dt;
      spring.value += spring.velocity * dt;
      spring.value = clamp(spring.value, 0.97, 1.06);

      level += ((isPlaying && animate ? clamp(0.3 + bass * 1.05, 0, 1) : 0) - level) * Math.min(1, dt * 6);
      amplitude = level * maxAmplitude;
      phase += dt * (isPlaying && animate ? 1.1 + bass * 2.4 : 0);

      // Redraw only what changed: a paused, settled ring at the same progress
      // would be identical pixels every frame.
      const settled = !isPlaying && level < 0.002 && Math.abs(spring.value - 1) < 0.001;
      if (settled && Math.abs(progress - lastProgress) < 0.0002) return;
      lastProgress = progress;

      if (now - accentChecked > 500) {
        accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffffff';
        accentChecked = now;
      }

      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(centre, centre);
      context.scale(spring.value, spring.value);
      context.lineWidth = ring;
      context.lineCap = 'round';

      const steps = 200;
      const outline = (from: number, to: number) => {
        context.beginPath();
        for (let i = 0; i <= steps; i++) {
          const t = from + ((to - from) * i) / steps;
          const angle = -Math.PI / 2 + t;
          const wobble =
            (0.55 * Math.sin(3 * angle + phase) +
              0.3 * Math.sin(5 * angle - phase * 1.4) +
              0.25 * Math.sin(2 * angle + phase * 0.6)) /
            1.1;
          const r = radius + amplitude * wobble;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      };

      context.strokeStyle = accent;
      context.globalAlpha = 0.2;
      outline(0, Math.PI * 2);

      if (progress > 0.0005) {
        context.globalAlpha = 1;
        outline(0, Math.PI * 2 * progress);
      }
      context.globalAlpha = 1;
      context.restore();
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [size, ring, maxAmplitude, waveEnabled, performanceMode]);

  const cycleShape = () => {
    if (!interactive) return;
    setShape((current) => SHAPES[(SHAPES.indexOf(current) + 1) % SHAPES.length]);
  };

    // A slight overscan crops the dark sleeve borders many covers ship with, so
  // the artwork reads as a circle rather than a square sitting inside one.
  const cover = (
    <img
      src={src ?? undefined}
      alt={alt}
      draggable={false}
      className="h-full w-full object-cover"
      style={{ transform: 'scale(1.07)' }}
    />
  );

  // The clip lives on the frame, not the image, and is an explicit clip-path:
  // `border-radius` plus `overflow: hidden` did not clip the cover in Chromium
  // here, which left a square of artwork sitting on top of the ring.
  const frameStyle = {
    inset,
    clipPath:
      shape === 'hexagon' ? HEX_CLIP : shape === 'circle' ? 'circle(50%)' : 'inset(0 round 34%)',
    borderRadius: shape === 'hexagon' ? 0 : RADIUS_BY_SHAPE[shape],
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
    transition: 'border-radius 320ms cubic-bezier(0.22,1,0.36,1), clip-path 320ms',
  } as const;

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ width: size, height: size }}
      />
      <div className="absolute overflow-hidden bg-[color:var(--surface)]" style={frameStyle}>
        {interactive ? (
          <button
            type="button"
            onClick={cycleShape}
            aria-label={`Album cover shape: ${shape}. Click to change.`}
            title="Change cover shape"
            className="block h-full w-full"
          >
            {cover}
          </button>
        ) : (
          <div className="h-full w-full">{cover}</div>
        )}
      </div>
    </div>
  );
});
