// Capture fresh Cloudy screenshots for the README.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('./.tools/node_modules/playwright');

const out = path.join(process.cwd(), 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const BASE = 'http://127.0.0.1:3000/#/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text().slice(0, 120));
});

const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('saved', name);
};
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(2500);

// Keep the background lyric-alignment decode off the CPU while we shoot.
await page.evaluate(async () => {
  const { useSettingsStore } = await import('/src/features/settings/store/settingsStore.ts');
  useSettingsStore.getState().setPerformanceMode?.(true);
});

// Search across catalogs.
await page.goto(`${BASE}search`, { waitUntil: 'networkidle' });
await wait(800);
const input = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
await input.click();
await input.fill('the weeknd');
await page.keyboard.press('Enter');
await wait(7000);
await shot('search');

const ids = await page.evaluate(async () => {
  const response = await fetch('http://127.0.0.1:3456/search/all?q=the%20weeknd');
  const data = await response.json();
  return {
    artist: data.artists?.[0]?.id ?? null,
    album: data.albums?.[0]?.id ?? null,
    song: data.songs?.[0]?.id ?? null,
  };
});
console.log('ids', JSON.stringify(ids));

// Artist page and its releases.
if (ids.artist) {
  await page.goto(`${BASE}artist/${encodeURIComponent(ids.artist)}`, { waitUntil: 'networkidle' });
  await wait(4000);
  await shot('artist');
  await page.mouse.wheel(0, 700);
  await wait(2000);
  await shot('artist-albums');
}

// Album page, then play it so the player bar and history are real.
if (ids.album) {
  await page.goto(`${BASE}album/${encodeURIComponent(ids.album)}`, { waitUntil: 'networkidle' });
  await wait(3500);
  const playAll = page.getByRole('button', { name: /Play All/i }).first();
  if (await playAll.count()) await playAll.click();
  await wait(6000);
  // Save the album and a couple of tracks so the Library shot has content.
  const saveAlbum = page.getByRole('button', { name: /Save album/i }).first();
  if (await saveAlbum.count()) await saveAlbum.click();
  const hearts = page.locator('button[aria-label="Add to favorites"]');
  for (let i = 0; i < Math.min(3, await hearts.count()); i++) await hearts.nth(i).click();
  await wait(2500);
  await shot('album');
}

// Second play so Home has real history to show.
await page.evaluate(async () => {
  const { usePlayerStore } = await import('/src/features/player/store/playerStore.ts');
  const player = usePlayerStore.getState();
  await player.next();
});
await wait(7000);

await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(4000);
await shot('home');

// Library after those plays.
await page.goto(`${BASE}library`, { waitUntil: 'networkidle' });
await wait(3000);
await shot('library');

// Lyrics panel.
await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(1500);
const lineAt = await page.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  const { usePlayerStore } = await import('/src/features/player/store/playerStore.ts');
  const { useLyricsStore } = await import('/src/features/lyrics/store/lyricsStore.ts');
  useUiStore.getState().toggleLyrics(true);
  const lines = useLyricsStore.getState().lines;
  if (!lines.length) return null;
  const line = lines[Math.floor(lines.length / 2)];
  const target = Math.max(0, line.time + 0.9);
  usePlayerStore.getState().seek(target);
  return { time: target, text: line.text.slice(0, 40) };
});
console.log('lyric line', JSON.stringify(lineAt));
await wait(5500);
await shot('lyrics');

// Fullscreen lyrics.
await page.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  useUiStore.getState().toggleFullscreenLyrics(true);
});
await wait(3000);
await shot('fullscreen');
await page.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  useUiStore.getState().toggleFullscreenLyrics(false);
  useUiStore.getState().toggleQueue(true);
});
await wait(2500);
await shot('queue');

// Settings.
await page.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  useUiStore.getState().toggleQueue(false);
  useUiStore.getState().setSettingsOpen(true);
});
await wait(2500);
await shot('appearance');
const playback = page.getByRole('button', { name: 'Playback' }).first();
if (await playback.count()) {
  await playback.click();
  await wait(1800);
  await shot('settings-playback');
}

await browser.close();
console.log('done');
