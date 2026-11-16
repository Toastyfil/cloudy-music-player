import { GripVertical, Shuffle, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { AlbumArt } from '@/shared/ui/AlbumArt';
import { IconButton } from '@/shared/ui/Button';
import { usePlayerStore } from '@/features/player/store/playerStore';
import { formatTime } from '@/shared/lib/format';
import { useUiStore } from '@/features/navigation/store/uiStore';

export function QueuePanel() {
  const open = useUiStore((s) => s.queueOpen);
  const toggleQueue = useUiStore((s) => s.toggleQueue);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playing = usePlayerStore((s) => s.playing);
  const playAt = usePlayerStore((s) => s.playAt);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const shuffle = usePlayerStore((s) => s.shuffle);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          initial={{ x: 340, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 340, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-20 flex w-[330px] shrink-0 flex-col border-l border-line bg-[color:var(--bg)]/88 backdrop-blur-[var(--panel-blur)]"
        >
          <header className="flex items-center justify-between px-5 pb-3 pt-5">
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Queue</h3>
              <p className="mt-1 text-[11.5px] text-faint">{queue.length} tracks</p>
            </div>
            <div className="flex items-center gap-1">
              <IconButton label="Shuffle queue" onClick={toggleShuffle} className={shuffle ? 'text-accent' : undefined}>
                <Shuffle size={15} />
              </IconButton>
              <IconButton label="Clear queue" onClick={() => void clearQueue()}>
                <Trash2 size={15} />
              </IconButton>
              <IconButton label="Close queue" onClick={() => toggleQueue(false)}>
                <X size={16} />
              </IconButton>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {queue.length === 0 ? (
              <p className="px-3 py-10 text-center text-[13px] text-faint">The queue is empty.</p>
            ) : (
              queue.map((track, i) => (
                <div
                  key={`${track.id}-${i}`}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOverIndex(i);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex != null) moveInQueue(dragIndex, i);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onClick={() => void playAt(i)}
                  className={cn(
                    'group flex h-14 cursor-pointer items-center gap-2 rounded-lg px-2 transition-colors',
                    i === index ? 'bg-accent-soft' : 'hover:bg-surface/60',
                    overIndex === i && dragIndex !== null && 'ring-1 ring-accent/50',
                  )}
                >
                  <span className="cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100">
                    <GripVertical size={13} />
                  </span>
                  <AlbumArt src={track.thumbnail} alt={track.title} size={36} rounded="md" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13px]', i === index ? 'font-semibold text-accent' : 'font-medium')}>
                      {track.title}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted">{track.artist}</span>
                  </span>
                  <span className="text-[11px] tabular-nums text-faint">
                    {i === index && playing ? 'Playing' : formatTime(track.duration)}
                  </span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFromQueue(i);
                    }}
                    aria-label="Remove from queue"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-faint opacity-0 transition-opacity hover:bg-surface hover:text-text group-hover:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
