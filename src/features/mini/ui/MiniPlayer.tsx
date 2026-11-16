import { Heart, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { bridge, type MiniState } from '@/shared/api/bridge';
import { cn } from '@/shared/lib/cn';

/**
 * The floating player shown while the main window is minimized. It holds no
 * state of its own: the main window publishes what is playing, this asks for
 * actions, so both views can never disagree about the track.
 */
export function MiniPlayer() {
  const [state, setState] = useState<MiniState | null>(null);

  // The window is frameless and transparent, so the app's own backdrop has to
  // step aside or it paints a black rectangle behind the rounded card.
  useEffect(() => {
    const html = document.documentElement;
    const previous = { html: html.style.background, body: document.body.style.background };
    html.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      html.style.background = previous.html;
      document.body.style.background = previous.body;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void bridge()
      .mini.ready()
      .then((current) => {
        if (alive && current) setState(current);
      })
      .catch(() => undefined);
    const off = bridge().mini.onState((next) => setState(next));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const command = (action: 'playpause' | 'next' | 'previous' | 'favorite') => {
    void bridge().mini.command(action);
  };
  const restore = () => {
    void bridge().mini.restore();
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-transparent p-2">
      <div className="flex h-full w-full items-center gap-2 rounded-[10px] border border-white/10 bg-[#1b1b1d] px-2.5 text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]">
        <button
          type="button"
          onClick={restore}
          title="Back to Cloudy"
          aria-label="Back to Cloudy"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {state?.thumbnail ? (
            <img
              src={state.thumbnail}
              alt=""
              className="h-[34px] w-[34px] shrink-0 rounded-[6px] object-cover"
              draggable={false}
            />
          ) : (
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[6px] bg-white/10 text-white/50">
              <Play size={12} className="fill-current" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-semibold leading-tight">
              {state?.title || 'Nothing playing'}
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-white/45">
              {state?.artist || 'Cloudy'}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => command('favorite')}
          aria-label={state?.favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={Boolean(state?.favorite)}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10',
            state?.favorite ? 'text-white' : 'text-white/55 hover:text-white',
          )}
        >
          <Heart size={14} className={state?.favorite ? 'fill-current' : ''} />
        </button>

        <span className="h-6 w-px shrink-0 bg-white/12" />

        <button
          type="button"
          onClick={() => command('previous')}
          aria-label="Previous track"
          className="flex h-7 w-6 shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white"
        >
          <SkipBack size={13} className="fill-current" />
        </button>
        <button
          type="button"
          onClick={() => command('playpause')}
          aria-label={state?.playing ? 'Pause' : 'Play'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform active:scale-95"
        >
          {state?.playing ? <Pause size={12} className="fill-current" /> : <Play size={12} className="fill-current" />}
        </button>
        <button
          type="button"
          onClick={() => command('next')}
          aria-label="Next track"
          className="flex h-7 w-6 shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white"
        >
          <SkipForward size={13} className="fill-current" />
        </button>
      </div>
    </div>
  );
}
