import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { bridge } from '@/shared/api/bridge';
import type { LibraryPlaylist } from '@/shared/api/contracts';
import { useUiStore } from '../store/uiStore';
import { useT } from '@/shared/lib/i18n';
import type { TranslationKey } from '@/shared/config/locales';
import { Heart, House, Library, ListMusic, Rows3, Search, type LucideIcon } from 'lucide-react';
import { CloudPlaylist, CloudPlus } from '@/shared/ui/CloudyIcons';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useDragOrder } from '@/shared/lib/useDragOrder';

type NavIcon = LucideIcon;

// Outline glyphs on the same 24px grid and 1.75 stroke, in the order Riff keeps
// them, so the rail reads as one family instead of a cloud-shaped set.
const NAV: { id: string; to: string; key: TranslationKey; Icon: NavIcon; end?: boolean }[] = [
  { id: 'home', to: '/', key: 'home', Icon: House, end: true },
  { id: 'search', to: '/search', key: 'search', Icon: Search },
  { id: 'favorites', to: '/favorites', key: 'favorites', Icon: Heart },
  { id: 'library', to: '/library', key: 'library', Icon: Library },
  { id: 'playlists', to: '/playlists', key: 'playlists', Icon: ListMusic },
];

const NAV_BY_ID = Object.fromEntries(NAV.map((entry) => [entry.id, entry]));

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
  const sidebarOrder = useSettingsStore((s) => s.sidebarOrder);
  const setSidebarOrder = useSettingsStore((s) => s.setSidebarOrder);
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

  // The rail is one draggable list: the five pages plus a shortcut for every
  // saved playlist, in the order stored in settings. New items land at the end
  // until the user drags them somewhere.
  const ids = useMemo(() => {
    const available = [...NAV.map((entry) => entry.id), ...playlists.map((playlist) => `pl:${playlist.id}`)];
    const kept = sidebarOrder.filter((id) => available.includes(id));
    return [...kept, ...available.filter((id) => !kept.includes(id))];
  }, [sidebarOrder, playlists]);
  const { order, dragging, bind } = useDragOrder(ids, (next) => setSidebarOrder(next));

  return (
    <nav className="relative z-20 flex w-14 shrink-0 flex-col items-center gap-1 pb-2 pt-1">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {order.map((id) => {
          const nav = NAV_BY_ID[id];
          const draggingThis = dragging === id;
          const wrapper = cn(
            'shrink-0 rounded-[var(--icon-radius,0.75rem)] transition-transform duration-150',
            draggingThis && 'scale-95 opacity-70',
          );

          if (nav) {
            return (
              <div key={id} {...bind(id)} className={wrapper}>
                <NavLink
                  to={nav.to}
                  end={nav.end}
                  draggable={false}
                  aria-label={t(nav.key)}
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
                      <nav.Icon size={19} strokeWidth={1.75} />
                      <Tip>{t(nav.key)}</Tip>
                    </>
                  )}
                </NavLink>
              </div>
            );
          }

          const playlist = id.startsWith('pl:') ? playlists.find((entry) => entry.id === id.slice(3)) : undefined;
          if (!playlist) return null;
          const cover = covers[playlist.id];
          return (
            <div key={id} {...bind(id)} className={wrapper}>
              <NavLink
                to={`/playlist/${playlist.id}`}
                draggable={false}
                aria-label={playlist.name}
                className="group relative flex h-8 w-8 items-center justify-center rounded-md focus-ring"
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
            </div>
          );
        })}
      </div>

      <div className="my-1 h-px w-6 shrink-0 bg-line" />

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

      <button
        onClick={() => setImportOpen(true)}
        aria-label="Import playlist"
        className={cn(ITEM, 'h-8 w-8 text-faint hover:bg-surface hover:text-text')}
      >
        <CloudPlus size={16} />
        <Tip>Import playlist</Tip>
      </button>
    </nav>
  );
}
