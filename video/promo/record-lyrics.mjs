import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('../.tools/node_modules/playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:3002';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: here, size: { width: 1440, height: 900 } } });
await ctx.addInitScript(() => { try { localStorage.removeItem('cloudy:lyric-offsets:v1'); localStorage.removeItem('cloudy:lyric-align:v1'); } catch {} });
const p = await ctx.newPage();
await p.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const find = p.getByRole('button', { name: /Find music/i });
if (await find.count()) { await find.click(); await p.waitForTimeout(600); }
await p.locator('input').first().click();
await p.keyboard.type('the weeknd', { delay: 70 });
await p.waitForTimeout(4200);
await p.getByText('Blinding Lights', { exact: false }).first().click();
await p.waitForTimeout(3000);
await p.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  const { usePlayerStore } = await import('/src/features/player/store/playerStore.ts');
  usePlayerStore.getState().seek(44);
  useUiStore.getState().toggleFullscreenLyrics(true);
});
for (let i = 0; i < 24; i++) {
  const ready = await p.evaluate(async () => {
    const { useLyricsStore } = await import('/src/features/lyrics/store/lyricsStore.ts');
    return useLyricsStore.getState().lines.length > 0;
  });
  if (ready) break;
  await p.waitForTimeout(500);
}
await p.waitForTimeout(20000);
const v = p.video();
await ctx.close();
const src = await v.path();
await fs.rm(path.join(here, 'clips-raw/lyrics.webm'), { force: true });
await fs.rename(src, path.join(here, 'clips-raw/lyrics.webm'));
console.log('recorded lyrics');
await b.close();
