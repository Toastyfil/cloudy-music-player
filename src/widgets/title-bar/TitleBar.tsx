import { Minus, Square, X, Copy, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { bridge, isElectron } from '@/shared/api/bridge';
import { Wordmark } from '@/shared/ui/Logo';
import { useUiStore } from '@/features/navigation/store/uiStore';
import { useSettingsStore } from '@/features/settings/store/settingsStore';
import { CloudSettings } from '@/shared/ui/CloudyIcons';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [platform, setPlatform] = useState('win32');
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const transparent = useSettingsStore((s) => s.windowTransparent);
  const autoHide = useSettingsStore((s) => s.titleBarAutoHide);

  useEffect(() => {
    void bridge()
      .app.info()
      .then((info) => setPlatform(info.platform))
      .catch(() => undefined);
    const off = bridge().window.onState(({ maximized: value }) => setMaximized(value));
    return off;
  }, []);

  const isMac = platform === 'darwin';
  const electron = isElectron();
  // A normal macOS window shows the real traffic lights under the hidden title
  // bar, so the bar just reserves their space. Transparency removes the title
  // bar entirely, so draw the same three lights ourselves.
  const nativeLights = isMac && !transparent;
  const customLights = isMac && transparent && electron;

  return (
    <header
      data-autohide={autoHide ? 'on' : 'off'}
      className="drag relative z-30 flex h-10 shrink-0 items-center justify-between px-3"
    >
      <div className={`flex items-center gap-3 ${nativeLights ? 'pl-[78px]' : ''}`}>
        {customLights ? (
          <div className="no-drag flex items-center gap-2">
            <button
              onClick={() => void bridge().window.close()}
              aria-label="Close"
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] ring-1 ring-black/10"
            >
              <X size={7} className="text-black/60 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <button
              onClick={() => void bridge().window.minimize()}
              aria-label="Minimize"
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] ring-1 ring-black/10"
            >
              <Minus size={7} className="text-black/60 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <button
              onClick={() => void bridge().window.toggleMaximize().then(setMaximized)}
              aria-label={maximized ? 'Restore' : 'Zoom'}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] ring-1 ring-black/10"
            >
              <Square size={5} className="text-black/60 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </div>
        ) : null}
        <Wordmark className="text-[13px] text-text/90" />
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setSettingsOpen(true)}
          className="no-drag mr-1.5 flex h-7 w-7 items-center justify-center rounded-[7px] bg-white/8 text-white/85 transition-colors duration-150 hover:bg-white/14 hover:text-white focus-ring"
          aria-label="Settings"
          title="Settings (Ctrl+,)"
        >
          <CloudSettings size={16} />
        </button>

        {electron && !isMac ? (
          <>
            <button
              className="no-drag flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
              onClick={() => void bridge().window.minimize()}
              aria-label="Minimize"
            >
              <Minus size={15} />
            </button>
            <button
              className="no-drag flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
              onClick={() => void bridge().window.toggleMaximize().then(setMaximized)}
              aria-label={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <Copy size={13} /> : <Square size={12} />}
            </button>
            <button
              className="no-drag flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-red-500/90 hover:text-white"
              onClick={() => void bridge().window.close()}
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </>
        ) : null}

        {electron ? (
          <button
            className="no-drag ml-1 flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text"
            onClick={() => void bridge().window.quit()}
            aria-label="Quit Cloudy"
            title="Quit Cloudy"
          >
            <LogOut size={14} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
