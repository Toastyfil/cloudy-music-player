import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Cloud, LayoutGrid, Link2, Palette, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { THEMES, type Theme } from '@/shared/config/themes';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { CloudyMark } from '@/shared/ui/Logo';

/**
 * First-run tour.
 *
 * Shown once per install: the completion flag lives in the user's settings, so
 * an update never brings it back and a fresh install always sees it.
 */
const STEPS = ['Welcome', 'Look', 'Yours', 'Launcher', 'Connect'] as const;

const FEATURES = [
  { icon: Cloud, label: '4 catalogs, one search' },
  { icon: Sparkles, label: 'Synced lyrics' },
  { icon: LayoutGrid, label: 'Your library' },
  { icon: Link2, label: 'Playlist import' },
];

function previewCards(): Theme[] {
  const light = THEMES.filter((theme) => theme.mode === 'light').slice(0, 2);
  const dark = THEMES.filter((theme) => theme.mode === 'dark').slice(0, 4);
  return [...dark, ...light];
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3 text-left transition-colors hover:bg-surface"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-faint">{hint}</span> : null}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${value ? 'bg-accent' : 'bg-line'}`}
        aria-hidden
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}

export function OnboardingDialog() {
  const [step, setStep] = useState(0);
  const themeId = useSettingsStore((s) => s.themeId);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const performanceMode = useSettingsStore((s) => s.performanceMode);
  const setPerformanceMode = useSettingsStore((s) => s.setPerformanceMode);
  const dynamicColor = useSettingsStore((s) => s.dynamicColor);
  const setDynamicColor = useSettingsStore((s) => s.setDynamicColor);
  const discordEnabled = useSettingsStore((s) => s.discordEnabled);
  const setDiscord = useSettingsStore((s) => s.setDiscord);
  const complete = useSettingsStore((s) => s.completeOnboarding);

  const last = step === STEPS.length - 1;
  const cards = previewCards();

  return (
    <div className="fixed inset-0 z-[98] flex items-center justify-center bg-black/70 backdrop-blur-[var(--panel-blur)]">
      {/* Diagonal stripes, the same motif as the title screen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, currentColor 0 10px, transparent 10px 34px)',
        }}
      />

      <div className="relative flex w-[min(940px,92vw)] overflow-hidden rounded-2xl border border-line bg-[color:var(--bg)] shadow-[0_50px_140px_rgba(0,0,0,0.65)]">
        <button
          onClick={complete}
          className="absolute right-3 top-3 z-10 rounded-full p-2 text-muted transition-colors hover:bg-surface hover:text-text"
          aria-label="Close"
        >
          <X size={15} />
        </button>

        <aside className="flex w-[240px] shrink-0 flex-col items-center justify-between border-r border-line bg-elevated/40 px-6 py-8">
          <div className="mt-6 flex flex-1 items-center justify-center text-accent">
            <CloudyMark size={104} />
          </div>
          <div className="flex items-center gap-1.5">
            {STEPS.map((name, index) => (
              <span
                key={name}
                className={`h-1.5 rounded-full transition-all ${index === step ? 'w-5 bg-text' : 'w-1.5 bg-faint/40'}`}
              />
            ))}
          </div>
        </aside>

        <section className="flex min-h-[420px] w-full flex-col px-8 py-7">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
              className="flex-1"
            >
              {step === 0 ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                    <Cloud size={13} /> Welcome
                  </div>
                  <h1 className="mt-4 text-[26px] font-semibold tracking-[-0.02em]">Cloudy</h1>
                  <p className="mt-1 text-[12.5px] text-muted">Your music, your library, your light.</p>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {FEATURES.map(({ icon: Icon, label }) => (
                      <div key={label} className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2.5">
                        <Icon size={14} className="text-accent" />
                        <span className="text-[12px]">{label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 max-w-[52ch] text-[11.5px] leading-relaxed text-faint">
                    Everything runs on your machine. No account, no ads, nothing to sign into.
                  </p>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                    <Palette size={13} /> Choose your look
                  </div>
                  <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]">Pick a palette</h2>
                  <p className="mt-1 text-[12px] text-muted">All 21 live in Settings → Appearance.</p>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    {cards.map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => setTheme(theme.id)}
                        className={`rounded-xl border p-2.5 text-left transition-colors ${
                          themeId === theme.id ? 'border-accent' : 'border-line hover:border-muted/40'
                        }`}
                      >
                        <span
                          className="flex h-14 w-full items-end gap-1 overflow-hidden rounded-lg p-2"
                          style={{ background: theme.bg, border: `1px solid ${theme.border}` }}
                        >
                          <span className="h-1.5 w-8 rounded-full" style={{ background: theme.accent }} />
                          <span className="h-1.5 w-4 rounded-full" style={{ background: theme.surface }} />
                        </span>
                        <span className="mt-2 block text-[11.5px] font-medium">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                    <SlidersHorizontal size={13} /> Make it yours
                  </div>
                  <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]">Two switches worth knowing</h2>
                  <p className="mt-1 text-[12px] text-muted">Change any of this later in Settings.</p>
                  <div className="mt-5 space-y-2">
                    <Toggle
                      label="Performance mode"
                      hint="Fewer animations when the machine is busy"
                      value={performanceMode}
                      onChange={setPerformanceMode}
                    />
                    <Toggle
                      label="Colour from the cover"
                      hint="Tint the interface with the current artwork"
                      value={dynamicColor}
                      onChange={setDynamicColor}
                    />
                    <Toggle
                      label="Show what you play on Discord"
                      hint="Only the track and artist, nothing else"
                      value={discordEnabled}
                      onChange={setDiscord}
                    />
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                    <LayoutGrid size={13} /> Add to launcher
                  </div>
                  <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]">You are already set up</h2>
                  <p className="mt-1 text-[12px] text-muted">Search for “Cloudy” in the Start menu any time.</p>
                  <div className="mt-5 space-y-2">
                    {['Start menu shortcut', 'Desktop shortcut'].map((label) => (
                      <div key={label} className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3">
                        <CloudyMark size={18} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium">{label}</span>
                          <span className="text-[11px] text-faint">Added by the installer</span>
                        </span>
                        <Check size={15} className="text-accent" />
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {step === 4 ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                    <Link2 size={13} /> Connect
                  </div>
                  <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]">Bring your playlists</h2>
                  <p className="mt-1 text-[12px] text-muted">Import from Spotify, Apple Music, YouTube, SoundCloud or Deezer.</p>
                  <button
                    onClick={() => {
                      complete();
                      useUiStore.getState().setImportOpen(true);
                    }}
                    className="mt-5 flex w-full items-center gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3 text-left transition-colors hover:bg-surface"
                  >
                    <Link2 size={16} className="text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium">Import a playlist</span>
                      <span className="text-[11px] text-faint">Paste a public playlist link</span>
                    </span>
                    <ArrowRight size={15} className="text-muted" />
                  </button>
                  <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
                    Optional — Cloudy works without importing anything.
                  </p>
                </>
              ) : null}
            </motion.div>
          </AnimatePresence>

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {step > 0 ? (
                <button
                  onClick={() => setStep((value) => value - 1)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-[12.5px] text-muted transition-colors hover:bg-surface hover:text-text"
                >
                  <ArrowLeft size={13} /> Back
                </button>
              ) : (
                <button onClick={complete} className="rounded-full px-3 py-2 text-[12.5px] text-faint transition-colors hover:text-text">
                  Skip
                </button>
              )}
            </div>
            <button
              onClick={() => (last ? complete() : setStep((value) => value + 1))}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-90"
            >
              {last ? 'Start listening' : 'Continue'}
              {last ? <Check size={13} /> : <ArrowRight size={13} />}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
