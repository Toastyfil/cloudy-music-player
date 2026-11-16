import { motion } from 'framer-motion';
import { Maximize2, Minus, Plus, Sparkles, X } from 'lucide-react';
import { autoAlignTrack } from '../lib/align';
import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { usePlayerStore, selectCurrentTrack } from '@/features/player/store/playerStore';
import { audioEngine } from '@/features/player/engine/audioEngine';
import { useLyricsStore } from '../store/lyricsStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { findActiveLine, type LyricLine } from '../lib/lrc';
import { IconButton } from '@/shared/ui/Button';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { CloudyMark } from '@/shared/ui/Logo';
import { Visualizer } from '@/shared/ui/Visualizer';
import { useT } from '@/shared/lib/i18n';

/** Instrumental markers have no words; keep the last sung line highlighted. */
function lastSungIndex(lines: LyricLine[], index: number) {
  let cursor = index;
  while (cursor >= 0 && !lines[cursor]?.text) cursor -= 1;
  return cursor >= 0 ? cursor : index;
}

/**
 * The active line runs on its own animation frame clock instead of the store's
 * ~12 Hz position updates. That is the difference between a word lighting up on
 * the beat and it arriving a beat late — and because only this component
 * re-renders per frame, the rest of the panel stays still.
 */
const ActiveSyllables = memo(function ActiveSyllables({
  line,
  sync,
  onDark,
}: {
  line: LyricLine;
  sync: number;
  onDark: boolean;
}) {
  const playing = usePlayerStore((s) => s.playing);
  const storedPosition = usePlayerStore((s) => s.position);
  const performanceMode = useSettingsStore((s) => s.performanceMode);
  const tightness = useSettingsStore((s) => s.gradientTightness);
  const karaokeEnabled = useSettingsStore((s) => s.lyricsKaraoke);
  // Start from the audio clock, never the ~12 Hz store position: seeding from a
  // stale value made the sweep jump backwards on the first frame of a new line.
  const [position, setPosition] = useState(() => {
    const state = usePlayerStore.getState();
    const live = state.playing ? audioEngine.currentTime : state.position;
    return (Number.isFinite(live) ? live : state.position) + sync;
  });

  useEffect(() => {
    if (!playing) {
      setPosition(storedPosition + sync);
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Nothing is visible in a hidden window, so don't burn frames on it.
      if (document.hidden) return;
      // Performance mode caps the karaoke clock at 30fps instead of 60.
      if (performanceMode && now - last < 33) return;
      last = now;
      setPosition(audioEngine.currentTime + sync);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, storedPosition, sync, performanceMode]);

  const upcoming = onDark ? 'rgba(255,255,255,0.42)' : 'color-mix(in srgb, var(--text) 45%, transparent)';
  // The line breathes very slightly with the bass, so it feels sung rather than
  // printed. Off in performance mode, where nothing animates on the beat.
  const energy = playing && !performanceMode ? audioEngine.getBassEnergy() : 0;

  return (
    <span
      className="inline-block transition-transform duration-100 ease-out"
      style={{ transform: `scale(${(1 + energy * 0.012).toFixed(3)})` }}
    >
      {line.syllables.map((syllable, index) => {
        const key = `${index}-${syllable.time}`;
        // Whitespace has to sit outside the syllable span. An inline-block trims
        // its own leading/trailing space, which welded "roll and get" together.
        const lead = syllable.text.match(/^\s+/)?.[0] ?? '';
        const tail = syllable.text.match(/\s+$/)?.[0] ?? '';
        const core = syllable.text.slice(lead.length, syllable.text.length - tail.length);
        if (!core) return <span key={key}>{syllable.text}</span>;

        const next = line.syllables[index + 1]?.time ?? line.end;
        const span = Math.max(0.08, next - syllable.time);
        const local = Math.max(0, Math.min(1, (position - syllable.time) / span));

        // Ad-libs stay quiet and are never swept: they are not the lead vocal.
        if (syllable.backing) {
          return (
            <span key={key}>
              {lead}
              <span className={cn('text-[0.9em] italic', onDark ? 'text-white/35' : 'text-muted/70')}>{core}</span>
              {tail}
            </span>
          );
        }

        // Performance mode and "karaoke word highlighting" off both trade the
        // sweep for a flat two-tone fill.
        if (performanceMode || !karaokeEnabled) {
          return (
            <span key={key}>
              {lead}
              <span
                className={cn(
                  'transition-colors duration-150 ease-linear',
                  local >= 0.999 ? 'text-accent' : onDark ? 'text-white/42' : 'text-text/45',
                )}
              >
                {core}
              </span>
              {tail}
            </span>
          );
        }

        // Karaoke sweep: the accent fills each word left→right at its own pace,
        // with a soft gradient edge instead of a hard wipe. A finished syllable
        // stays on the same span at 100%, so the word never flips between two
        // elements — that swap was what made the line flicker.
        const percent = Math.round(local * 100);
        const edge = Math.min(100, percent + tightness);
        const singing = local > 0 && local < 1;
        return (
          <span key={key}>
            {lead}
            <span
              className={cn(
                'inline-block will-change-transform',
                singing ? 'scale-[1.03]' : 'scale-100',
                'transition-transform duration-150 ease-out',
              )}
              style={{
                backgroundImage: `linear-gradient(90deg, var(--accent) ${percent}%, ${upcoming} ${edge}%)`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {core}
            </span>
            {tail}
          </span>
        );
      })}
    </span>
  );
});

export function LyricsBody({ fullscreen = false, onDark = false }: { fullscreen?: boolean; onDark?: boolean }) {
  const status = useLyricsStore((s) => s.status);
  const lines = useLyricsStore((s) => s.lines);
  const plain = useLyricsStore((s) => s.plain);
  const lrcOffset = useLyricsStore((s) => s.offset);
  // The user's own nudge (Settings → Playback, or the ± buttons in the header)
  // rides on top of the offset baked into the LRC file.
  const userOffset = useSettingsStore((s) => s.lyricsOffset);
  const lyricsSpeed = useSettingsStore((s) => s.lyricsSpeed);
  const trackId = usePlayerStore((s) => (s.index >= 0 ? (s.queue[s.index]?.id ?? null) : null));
  const trackOffset = useLyricsStore((s) => (trackId ? (s.trackOffsets[trackId] ?? 0) : 0));
  const sync = lrcOffset + userOffset + trackOffset;
  // Some uploads simply do not share the intro of the recording the LRC was
  // authored against. Picking the line you can hear and pinning it to the
  // playhead solves that exactly, and the offset is remembered per track.
  const [selected, setSelected] = useState<number | null>(null);
  const syncSelected = () => {
    if (selected == null || !trackId) return;
    const line = lines[selected];
    if (!line) return;
    const position = audioEngine.currentTime;
    const next = line.time - position - (lrcOffset + userOffset);
    useLyricsStore.getState().setTrackOffset(trackId, Math.round(next * 100) / 100);
    setSelected(null);
  };

  const playing = usePlayerStore((s) => s.playing);
  const storedPosition = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);

  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());
  const [shift, setShift] = useState(0);
  const [instantScroll, setInstantScroll] = useState(false);
  const previousActive = useRef(-1);
  // Dragging to read ahead parks auto-scroll; it resumes 3.5s after the last
  // interaction, so the lyrics never yank out from under a reader mid-line.
  const [manual, setManual] = useState(false);
  const autoScroll = useSettingsStore((s) => s.lyricsAutoScroll);
  const showWarnings = useSettingsStore((s) => s.showLyricsWarnings);
  const [resumeNonce, setResumeNonce] = useState(0);
  const autoShift = useRef(0);
  const drag = useRef<{ y: number; base: number } | null>(null);
  const resumeTimer = useRef(0);

  // Advance the highlighted line on the frame clock while playing; when paused,
  // follow the stored position so seeking still moves it.
  useEffect(() => {
    const apply = (raw: number) => {
      const index = lastSungIndex(lines, findActiveLine(lines, raw + sync));
      if (index === activeRef.current) return;
      activeRef.current = index;
      setActive(index);
    };

    if (!playing) {
      apply(storedPosition);
      return;
    }
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (document.hidden) return;
      apply(audioEngine.currentTime);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lines, sync, playing, storedPosition]);

  // Scroll by translating the whole column instead of setting scrollTop: one
  // composite-only property, so the browser never re-lays-out mid-song and the
  // motion can be eased properly. The active line settles at 38% height.
  useEffect(() => {
    if (manual || !autoScroll) return;
    const viewport = containerRef.current;
    if (!viewport || !viewport.clientHeight) return;
    if (active < 0) {
      setShift(0);
      return;
    }
    const element = lineRefs.current.get(active);
    if (!element) return;
    const centre = viewport.clientHeight * 0.38;
    const next = centre - (element.offsetTop + element.offsetHeight / 2);
    const jumped = previousActive.current >= 0 && Math.abs(active - previousActive.current) > 1;
    previousActive.current = active;
    setInstantScroll(jumped || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    autoShift.current = next;
    setShift(next);
  }, [active, autoScroll, fullscreen, lines.length, manual, resumeNonce]);

  // Keep the column inside its content when dragged, and never let it travel so
  // far that the lyrics leave the viewport.
  const clampShift = (value: number) => {
    const viewport = containerRef.current;
    const inner = innerRef.current;
    if (!viewport || !inner) return value;
    const min = Math.min(0, viewport.clientHeight * 0.35 - inner.scrollHeight);
    const max = viewport.clientHeight * 0.65;
    return Math.max(min, Math.min(max, value));
  };

  const holdAutoScroll = () => {
    setManual(true);
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      setManual(false);
      setResumeNonce((n) => n + 1);
    }, 3500);
  };

  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  // React's wheel listener is passive, so the preventDefault that keeps the
  // page from scrolling has to be attached natively.
  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      holdAutoScroll();
      autoShift.current = clampShift(autoShift.current - event.deltaY);
      setShift(autoShift.current);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, manual]);

  if (status === 'loading') {
    return (
      <div className={cn('space-y-3', fullscreen ? 'px-2 pt-[26vh]' : 'px-2 pt-[12vh]')} aria-busy>
        {[92, 74, 84, 58].map((width, index) => (
          <div
            key={width}
            className="h-[15px] animate-pulse rounded-full bg-surface"
            style={{ width: `${width}%`, animationDelay: `${index * 90}ms` }}
          />
        ))}
        <p className="pt-3 text-[10.5px] uppercase tracking-[0.16em] text-faint">Finding lyrics…</p>
      </div>
    );
  }

  if (status === 'instrumental') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <CloudyMark size={40} animated />
        <p className={cn('text-[15px] font-medium', onDark && 'text-white')}>Instrumental</p>
        {showWarnings ? (
          <p className={cn('max-w-[240px] text-[13px] leading-relaxed', onDark ? 'text-white/55' : 'text-muted')}>
            No words in this one — just let it play.
          </p>
        ) : null}
      </div>
    );
  }

  if (status === 'empty' || status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <CloudyMark size={40} />
        <p className={cn('text-[15px] font-medium', onDark && 'text-white')}>No lyrics yet</p>
        {showWarnings ? (
          <p className={cn('max-w-[250px] text-[13px] leading-relaxed', onDark ? 'text-white/55' : 'text-muted')}>
            {status === 'error'
              ? 'Lyrics could not be reached. They will be retried next time this track plays.'
              : 'Nothing matched for this track. Synced lyrics come from LRCLIB.'}
          </p>
        ) : null}
      </div>
    );
  }

  if (status === 'plain' && plain) {
    const progress = duration ? Math.min(1, Math.max(0, storedPosition / duration)) : 0;
    return (
      <div className={cn('pb-24', fullscreen ? 'px-2 pt-[22vh]' : 'px-2 pt-[8vh]')}>
        <div className="mb-5 flex items-center gap-2">
          <span className="h-[2px] w-16 overflow-hidden rounded-full bg-surface">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </span>
          <span className={cn('text-[10.5px] uppercase tracking-[0.16em]', onDark ? 'text-white/40' : 'text-faint')}>
            Not synced
          </span>
        </div>
        <div
          className={cn(
            'whitespace-pre-wrap font-medium',
            onDark ? 'text-white/80' : 'text-text/80',
            fullscreen ? 'text-[20px] leading-[1.85]' : 'text-[14px] leading-[1.9]',
          )}
        >
          {plain}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {selected != null && lines[selected] ? (
        <div className="absolute inset-x-1 top-1 z-10 flex items-center gap-2 rounded-lg border border-line bg-surface/95 px-2.5 py-2 shadow-[var(--shadow)] backdrop-blur">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
            Sync “{lines[selected].text.slice(0, 26)}” to the playhead?
          </span>
          <button
            onClick={syncSelected}
            className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11.5px] font-medium text-black transition-opacity hover:opacity-90"
          >
            Sync
          </button>
          <button
            onClick={() => setSelected(null)}
            aria-label="Cancel lyric sync"
            className="shrink-0 rounded-full px-1.5 py-1 text-[12px] text-muted transition-colors hover:text-text"
          >
            ✕
          </button>
        </div>
      ) : null}
    <div
      ref={containerRef}
      className={cn(
        // h-full keeps the list inside its flex slot instead of sliding under the
        // transport controls.
        'lyrics-fade relative h-full touch-pan-x select-none overflow-hidden',
        manual ? 'cursor-grabbing' : 'cursor-grab',
        fullscreen ? 'px-2' : 'px-1.5',
      )}
      onPointerDown={(event) => {
        holdAutoScroll();
        drag.current = { y: event.clientY, base: autoShift.current };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        autoShift.current = clampShift(drag.current.base + (event.clientY - drag.current.y));
        setShift(autoShift.current);
      }}
      onPointerUp={() => {
        drag.current = null;
        holdAutoScroll();
      }}
      onPointerCancel={() => {
        drag.current = null;
        holdAutoScroll();
      }}
    >
      <div
        ref={innerRef}
        className={cn('will-change-transform', fullscreen ? 'pt-[34vh] pb-[46vh]' : 'pt-[16vh] pb-[46vh]')}
        style={{
          transform: `translate3d(0, ${shift}px, 0)`,
          transition:
            manual || instantScroll
              ? 'none'
              : `transform ${Math.round(240 / lyricsSpeed)}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          willChange: 'transform',
        }}
      >
      {lines.map((line, index) => {
        const isActive = index === active;
        // Typography follows distance from the line being sung: the active line
        // is the biggest and brightest, then the one just sung, then upcoming,
        // then everything further away recedes to a whisper.
        const distance = active < 0 ? 99 : index - active;
        const steps = Math.abs(distance);
        const sizeClass = fullscreen
          ? steps === 0
            ? 'text-[34px] leading-[1.3]'
            : steps === 1
              ? 'text-[26px] leading-[1.4]'
              : steps <= 3
                ? 'text-[21px] leading-[1.45]'
                : 'text-[18px] leading-[1.5]'
          : steps === 0
            ? 'text-[20px] leading-[1.45]'
            : steps === 1
              ? 'text-[17px] leading-[1.5]'
              : steps <= 3
                ? 'text-[15px] leading-[1.55]'
                : 'text-[13.5px] leading-[1.6]';
        const toneClass =
          steps === 0
            ? onDark
              ? 'text-white'
              : 'text-text'
            : steps === 1
              ? onDark
                ? 'text-white/70'
                : 'text-text/70'
              : steps <= 3
                ? onDark
                  ? 'text-white/38 hover:text-white/65'
                  : 'text-text/40 hover:text-text/70'
                : onDark
                  ? 'text-white/15'
                  : 'text-text/15';
        return (
          <p
            key={`${line.time}-${index}`}
            ref={(node) => {
              if (node) lineRefs.current.set(index, node);
              else lineRefs.current.delete(index);
            }}
            onClick={() => line.text && setSelected(selected === index ? null : index)}
            className={cn(
              'origin-left cursor-pointer tracking-[-0.01em] transition-[color,opacity,transform,filter] duration-200 ease-out',
              isActive ? 'font-semibold lyric-active' : 'font-normal',
              sizeClass,
              toneClass,
              isActive ? 'scale-100' : 'scale-[0.97]',
              selected === index && 'underline decoration-accent decoration-2 underline-offset-4',
              fullscreen ? 'mb-[0.42em]' : 'mb-[0.62em]',
            )}
          >
            {line.text ? (
              isActive ? (
                <ActiveSyllables line={line} sync={sync} onDark={onDark} />
              ) : (
                line.text
              )
            ) : (
              <span className="text-faint">♪</span>
            )}
          </p>
        );
      })}
      </div>
    </div>
    </div>
  );
}

export function LyricsPanel({ onClose, onFullscreen }: { onClose: () => void; onFullscreen: () => void }) {
  const t = useT();
  const track = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((s) => s.playing);
  const nowPlayingBanner = useSettingsStore((s) => s.nowPlayingBanner);
  const titleAlign = useSettingsStore((s) => s.nowPlayingTitleAlign);
  const showNowPlayingVisualizer = useSettingsStore((s) => s.showNowPlayingVisualizer);
  const status = useLyricsStore((s) => s.status);
  // A nudge belongs to this song, not to every song: a live cut can be half a
  // second off while the studio version is perfect.
  const offset = useLyricsStore((s) => (track ? (s.trackOffsets[track.id] ?? 0) : 0));
  const nudge = (delta: number) => {
    if (!track) return;
    const state = useLyricsStore.getState();
    const next = (state.trackOffsets[track.id] ?? 0) + delta;
    state.setTrackOffset(track.id, Math.round(next * 100) / 100);
  };

  // Automatic alignment decodes the track once and finds the shift where the
  // lyric windows cover the most vocal energy.
  const [aligning, setAligning] = useState(false);
  const [alignNote, setAlignNote] = useState<string | null>(null);
  const autoAlign = async () => {
    if (!track || aligning) return;
    setAligning(true);
    setAlignNote(null);
    try {
      const result = await autoAlignTrack(track);
      setAlignNote(
        result
          ? `Aligned ${result.offset > 0 ? '+' : ''}${result.offset.toFixed(2)}s`
          : 'No clear match — adjust by hand',
      );
    } catch {
      setAlignNote('Couldn’t analyse this track');
    } finally {
      setAligning(false);
    }
  };

  const badge = status === 'synced' ? 'Synced' : status === 'plain' ? 'Plain' : null;

  return (
    <motion.aside
      initial={{ x: 360, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 360, opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-20 flex w-[350px] shrink-0 flex-col border-l border-line bg-[color:var(--bg)]/85 backdrop-blur-[var(--panel-blur)]"
    >
      {nowPlayingBanner && track?.thumbnail ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden">
          <div
            className="h-full w-full bg-cover bg-center opacity-30 blur-2xl"
            style={{ backgroundImage: `url(${track.thumbnail})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[color:var(--bg)]" />
        </div>
      ) : null}
      <header className={cn('relative px-4 pb-1 pt-4', titleAlign === 'center' && 'text-center')}>
        <div className={cn('flex items-center gap-2.5', titleAlign === 'center' && 'justify-center')}>
          <AlbumArt src={track?.thumbnail} alt={track?.title ?? ''} size={40} rounded="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{track?.title ?? 'Nothing playing'}</p>
            <p className="truncate text-[11.5px] text-muted">{track?.artist ?? 'Pick something to play'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Fullscreen lyrics" onClick={onFullscreen}>
              <Maximize2 size={16} />
            </IconButton>
            <IconButton label="Close lyrics" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        </div>
        {showNowPlayingVisualizer ? (
          <div className="mt-3 flex justify-center">
            <Visualizer playing={playing} bars={26} className="h-8 w-full max-w-[240px]" />
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between border-b border-line pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">{t('lyrics')}</h3>
            {badge ? (
              <span className="rounded-full bg-surface px-2 py-[1px] text-[9px] font-medium uppercase tracking-[0.12em] text-muted">
                {badge}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => void autoAlign()}
              disabled={aligning || !track || status !== 'synced'}
              title="Estimate the lyric offset from the audio"
              className="mr-1.5 flex items-center gap-1 rounded-full border border-line px-2 py-[3px] text-[10.5px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-text disabled:opacity-40"
            >
              <Sparkles size={11} className={aligning ? 'animate-pulse text-accent' : ''} />
              {aligning ? 'Aligning' : 'Auto'}
            </button>
            <IconButton label="Lyrics 0.25s earlier" onClick={() => nudge(-0.25)}>
              <Minus size={13} />
            </IconButton>
            <span className="w-9 text-center text-[10.5px] tabular-nums text-faint" title="Offset for this track">
              {offset === 0 ? 'sync' : `${offset > 0 ? '+' : ''}${offset.toFixed(2)}`}
            </span>
            <IconButton label="Lyrics 0.25s later" onClick={() => nudge(0.25)}>
              <Plus size={13} />
            </IconButton>
          </div>
        </div>
        {alignNote ? <p className="pt-1.5 text-[10.5px] text-faint">{alignNote}</p> : null}
      </header>
      <div className="min-h-0 flex-1">
        <LyricsBody />
      </div>
    </motion.aside>
  );
}
