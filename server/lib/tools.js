// Locating yt-dlp.
//
// The app ships its own copy inside the bundle (resources/bin), which is the
// only thing that works on a Mac without Homebrew. A local bin/ folder is used
// during development, and PATH stays as the last resort so an existing install
// keeps working.
import fs from 'node:fs';
import path from 'node:path';

const EXE = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
let resolved = null;

function usable(candidate) {
  if (!candidate) return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function ytDlpPath() {
  if (resolved) return resolved;

  const candidates = [
    process.env.CLOUDY_YTDLP,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', EXE) : null,
    path.join(process.cwd(), 'bin', EXE),
    path.join(path.dirname(process.execPath), 'bin', EXE),
  ];

  resolved = candidates.find(usable) ?? 'yt-dlp';
  console.log(`[cloudy] yt-dlp: ${resolved}`);
  return resolved;
}
