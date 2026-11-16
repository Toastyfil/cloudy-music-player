import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, RotateCw } from 'lucide-react';
import { bridge } from '@/shared/api/bridge';
import { CloudyMark } from '@/shared/ui/Logo';
import { useUpdatesStore } from '../store/updatesStore';

/**
 * The update prompt. It only appears once an installer is either downloading or
 * already on disk, so "Install now" never means "go and fetch 130 MB yourself".
 * The backdrop blurs the whole player, which keeps the focus on one decision.
 */
/** Closing the prompt sticks for that version, across restarts too. */
const DISMISS_KEY = 'cloudy:update-dismissed';

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function UpdateDialog() {
  const phase = useUpdatesStore((s) => s.phase);
  const version = useUpdatesStore((s) => s.version);
  const progress = useUpdatesStore((s) => s.progress ?? 0);
  const notes = useUpdatesStore((s) => s.notes);
  const dismissed = useUpdatesStore((s) => s.dismissed);
  const installError = useUpdatesStore((s) => s.installError);
  const dismiss = useUpdatesStore((s) => s.dismiss);
  const install = useUpdatesStore((s) => s.install);

  const message = useUpdatesStore((s) => s.error);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(readDismissedVersion);
  const ready = phase === 'ready';
  const failed = phase === 'error' && Boolean(message);
  const closedForThisVersion = version != null && dismissedVersion === version;
  const open =
    !dismissed && !closedForThisVersion && (phase === 'downloading' || ready || phase === 'installing' || failed);

  function close() {
    if (version) {
      try {
        localStorage.setItem(DISMISS_KEY, version);
      } catch {
        /* private mode */
      }
      setDismissedVersion(version);
    }
    dismiss();
  }
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="update"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 backdrop-blur-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-title"
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="w-[404px] rounded-2xl border border-line bg-[color:var(--bg)]/95 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/12 text-accent">
                <CloudyMark size={26} />
              </span>
              <div className="min-w-0">
                <h2 id="update-title" className="text-[15px] font-semibold tracking-[-0.01em]">
                  {failed ? 'Update blocked' : ready ? 'Update ready' : phase === 'installing' ? 'Installing' : 'Downloading update'}
                </h2>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  Cloudy {version ?? ''} {ready ? 'is ready to install' : `· ${percent}%`}
                </p>
              </div>
            </div>

            <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
              {failed
                ? message
                : ready
                  ? 'Restart Cloudy to finish. Your library, playlists, settings and cached audio stay exactly where they are — nothing else to download.'
                  : 'It is downloading in the background. You can keep listening; Cloudy asks again when it is done.'}
            </p>

            {notes ? <p className="mt-3 line-clamp-3 text-[11.5px] leading-relaxed text-faint">{notes}</p> : null}

            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface">
              <motion.span
                className="block h-full rounded-full bg-accent"
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>

            {installError ? <p className="mt-3 text-[11.5px] text-red-400">{installError}</p> : null}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={close}
                className="rounded-full px-3.5 py-2 text-[12.5px] text-muted transition-colors hover:bg-surface hover:text-text"
              >
                {ready || failed ? 'Close' : 'Hide'}
              </button>
              {failed ? (
                <button
                  onClick={() => {
                    void bridge().shell.openExternal('https://github.com/Toastyfil/cloudy-music-player/releases/latest');
                    close();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-90"
                >
                  <Download size={13} /> Open download page
                </button>
              ) : (
                <button
                  onClick={() => {
                    try {
                      localStorage.removeItem(DISMISS_KEY);
                    } catch {
                      /* private mode */
                    }
                    setDismissedVersion(null);
                    void install();
                  }}
                  disabled={!ready}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
                >
                  {ready ? <RotateCw size={13} /> : <Download size={13} />}
                  {ready ? 'Restart now' : 'Installing when ready'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
