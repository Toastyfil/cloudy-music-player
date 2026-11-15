import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Loader2, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ImportResult } from '@/shared/api/contracts';
import { importApi } from '@/shared/api/client';
import { bridge } from '@/shared/api/bridge';
import { Button } from '@/shared/ui/Button';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { cn } from '@/shared/lib/cn';

const EXAMPLES = [
  'https://open.spotify.com/playlist/…',
  'https://music.apple.com/us/playlist/…',
  'https://music.youtube.com/playlist?list=…',
  'https://soundcloud.com/artist/sets/…',
  'https://www.deezer.com/playlist/…',
];

export function ImportDialog() {
  const open = useUiStore((s) => s.importOpen);
  const setOpen = useUiStore((s) => s.setImportOpen);
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setUrl('');
    setResult(null);
    setError(null);
    setBusy(false);
    setSaving(false);
  };

  const resolve = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await importApi.resolve(url.trim());
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that link');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    const entries = (result.tracks ?? result.resolved ?? []).filter((entry) => entry.matched);
    if (!entries.length) return;
    setSaving(true);
    try {
      const playlist = await bridge().playlists.create(result.name || 'Imported playlist', `Imported from ${result.source}`, result.source);
      for (const entry of entries) {
        if (entry.matched) await bridge().playlists.addTrack(playlist.id, entry.matched);
      }
      setOpen(false);
      reset();
      navigate(`/playlist/${playlist.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the playlist');
    } finally {
      setSaving(false);
    }
  };

  const entries = result?.tracks ?? result?.resolved ?? [];
  const matched = entries.filter((entry) => entry.matched);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-sm"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="w-[560px] overflow-hidden rounded-2xl border border-line bg-[color:var(--bg-elevated)] shadow-[var(--shadow)]"
          >
            <header className="flex items-start justify-between px-6 pb-2 pt-5">
              <div>
                <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Import a playlist</h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  Paste a public link. Cloudy matches every track against the catalog.
                </p>
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-text"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </header>

            <div className="px-6 pb-5">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void resolve();
                  }}
                  placeholder="https://open.spotify.com/playlist/…"
                  className="h-10 flex-1 rounded-lg bg-surface px-3 text-[13px] outline-none ring-1 ring-transparent transition-all placeholder:text-faint focus:ring-accent/40"
                />
                <Button onClick={() => void resolve()} disabled={busy || !url.trim()}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {busy ? 'Reading' : 'Import'}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <span key={example} className="rounded-full bg-surface px-2 py-1 text-[10.5px] text-faint">
                    {example}
                  </span>
                ))}
              </div>

              {error ? <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">{error}</p> : null}

              {result ? (
                <div className="mt-5">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-[13.5px] font-medium">{result.name}</p>
                      <p className="text-[11.5px] text-muted">
                        {result.source} · {matched.length}/{entries.length} tracks matched
                      </p>
                    </div>
                    <Button size="sm" onClick={() => void save()} disabled={!matched.length || saving}>
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      Save {matched.length} tracks
                    </Button>
                  </div>
                  <div className="mt-3 max-h-[240px] overflow-y-auto rounded-lg bg-surface/50 p-1.5">
                    {entries.map((entry, index) => (
                      <div key={`${entry.title}-${index}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', entry.matched ? 'bg-accent' : 'bg-red-400/70')} />
                        <span className="min-w-0 flex-1 truncate text-text/80">{entry.title}</span>
                        <span className="truncate text-faint">{entry.artist}</span>
                        <ArrowRight size={11} className="shrink-0 text-faint" />
                        <span className={cn('min-w-0 flex-1 truncate text-right', entry.matched ? 'text-muted' : 'text-red-300/80')}>
                          {entry.matched ? entry.matched.title : 'not found'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
