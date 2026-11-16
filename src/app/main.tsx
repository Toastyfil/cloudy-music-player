import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './globals.css';
import { App } from './App';
import { MiniPlayer } from '@/features/mini/ui/MiniPlayer';
import { audioEngine } from '@/features/player/engine/audioEngine';

// Dev-server only handle so the audio graph can be inspected from the console or
// an automated check. The packaged app loads from file://, so this never runs
// there and the engine stays private in production.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  (window as unknown as { cloudyAudio: typeof audioEngine }).cloudyAudio = audioEngine;
}

// The mini player is the same bundle in a second, tiny window (#/mini), so it
// shares the preload bridge instead of inventing another entry point.
const isMiniWindow = window.location.hash.startsWith('#/mini');

// Hash routing keeps deep links working from a file:// bundle in Electron.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>{isMiniWindow ? <MiniPlayer /> : <App />}</HashRouter>
  </StrictMode>,
);
