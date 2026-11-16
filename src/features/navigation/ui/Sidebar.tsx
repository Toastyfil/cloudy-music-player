import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { bridge } from '@/shared/api/bridge';
import type { LibraryPlaylist } from '@/shared/api/contracts';
import { useUiStore } from '../store/uiStore';
import { useT } from '@/shared/lib/i18n';
import type { TranslationKey } from '@/shared/config/locales';
import { Heart, House, Library, ListMusic, Rows3, Search, type LucideIcon } from 'lucide-react';
import { CloudPlaylist, CloudPlus } from '@/shared/ui/CloudyIcons';

type NavIcon = LucideIcon;

// Outline glyphs on the same 24px grid and 1.75 stroke, in the order Riff keeps
// them, so the rail reads as one family instead of a cloud-shaped set.
const NAV: { to: string; key: TranslationKey; Icon: NavIcon; end?: boolean }[] = [
  { to: '/', key: 'home', Icon: House, end: true },
  { to: '/search', key: 'search', Icon: Search },
  { to: '/favorites', key: 'favorites', Icon: Heart },
  { to: '/library', key: 'library', Icon: Library },
  { to: '/playlists', key: 'playlists', Icon: ListMusic },
];

const ITEM =
  'group relative flex h-10 w-10 items-center justify-center rounded-[var(--icon-radius,0.75rem)] transition-colors duration-200 focus-ring [&>svg]:transition-transform [&>svg]:duration-150 hover:[&>svg]:scale-105 active:[&>svg]:scale-95';

/** Hover label that opens to the right of the rail. */
function Tip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] font-medium text-text opacity-0 shadow-[var(--shadow)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
      {children}
    </span>
  );
}

export function Sidebar() {
  const t = useT();
  const queueOpen = useUiStore((s) => s.queueOpen);
  const toggleQueue = useUiStore((s) => s.toggleQueue);
  const setImportOpen = useUiStore((s) => s.setImportOpen);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [covers, setCovers] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = (await bridge().playlists.all()) as LibraryPlaylist[];
        if (alive) setPlaylists(list);
      } catch {
        /* ignore */
      }
    };
    void load();
    const interval = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  // Cover art only changes when the set of playlists does, so it is not part of
  // the poll above.
  const signature = playlists.map((playlist) => playlist.id).join('|');
  useEffect(() => {
    if (!playlists.length) return;
    let alive = true;
    void Promise.all(
      playlists.map(
        async (playlist) => [playlist.id, await bridge().playlists.cover(playlist.id).catch(() => null)] as const,
      ),
    ).then((entries) => {
      if (alive) setCovers(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <nav className="relative z-20 flex w-14 shrink-0 flex-col items-center gap-1 pb-2 pt-1">
      {NAV.map(({ to, key, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={t(key)}
          className={({ isActive }) =>
            cn(
              ITEM,
              isActive
                ? 'bg-surface/80 text-accent shadow-[0_0_16px_-6px_var(--accent)]'
                : 'text-muted hover:bg-surface/50 hover:text-text/90',
            )
          }
        >
          {() => (
            <>
              <Icon size={19} strokeWidth={1.75} />
              <Tip>{t(key)}</Tip>
            </>
          )}
        </NavLink>
      ))}

      <button
        onClick={() => toggleQueue()}
        aria-label={t('queue')}
        className={cn(
          ITEM,
          queueOpen
            ? 'bg-surface/80 text-accent shadow-[0_0_16px_-6px_var(--accent)]'
            : 'text-muted hover:bg-surface/50 hover:text-text/90',
        )}
      >
        <Rows3 size={19} strokeWidth={1.75} className={queueOpen ? 'text-accent' : undefined} />
        <Tip>{t('queue')}</Tip>
      </button>

      <div className="my-2 h-px w-6 shrink-0 bg-line" />

      <button
        onClick={() => setImportOpen(true)}
        aria-label="Import playlist"
        className={cn(ITEM, 'h-8 w-8 text-faint hover:bg-surface hover:text-text')}
      >
        <CloudPlus size={16} />
        <Tip>Import playlist</Tip>
      </button>

      <div className="mt-1 flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {playlists.map((playlist) => {
          const cover = covers[playlist.id];
          return (
            <NavLink
              key={playlist.id}
              to={`/playlist/${playlist.id}`}
              aria-label={playlist.name}
              className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md focus-ring"
            >
              {({ isActive }) => (
                <>
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      draggable={false}
                      className="h-8 w-8 rounded-md object-cover transition-opacity duration-200 group-hover:opacity-85"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-faint transition-colors group-hover:text-text/80">
                      <CloudPlaylist size={14} />
                    </span>
                  )}
                  <span
                    className={cn(
                      'pointer-events-none absolute inset-0 rounded-md ring-2 ring-accent transition-opacity duration-200',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Tip>{playlist.name}</Tip>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
