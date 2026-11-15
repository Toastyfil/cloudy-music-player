// Records real Cloudy UI footage for the promo. Each clip gets its own
// browser context so Playwright writes a separate video file.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('../.tools/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, 'clips-raw');
await fs.rm(rawDir, { recursive: true, force: true });
await fs.mkdir(rawDir, { recursive: true });

const BASE = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const errors = [];

async function record(name, run) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  try {
    await run(page);
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      const src = await video.path();
      await fs.rename(src, path.join(rawDir, `${name}.webm`));
      console.log('recorded', name);
    }
  }
}

const withUiArg = (page, call, value) =>
  page.evaluate(async ({ call, value }) => {
    const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
    useUiStore.getState()[call](value);
  }, { call, value });

const setTheme = (page, id) =>
  page.evaluate(async (id) => {
    const { useSettingsStore } = await import('/src/features/settings/store/settingsStore.ts');
    useSettingsStore.getState().setTheme(id);
  }, id);

const lyricsReady = (page) =>
  page.evaluate(async () => {
    const { useLyricsStore } = await import('/src/features/lyrics/store/lyricsStore.ts');
    return useLyricsStore.getState().lines.length > 0;
  });

async function searchFor(page, query) {
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const find = page.getByRole('button', { name: /Find music/i });
  if (await find.count()) {
    await find.click();
    await page.waitForTimeout(650);
  }
  await page.locator('input').first().click();
  await page.keyboard.type(query, { delay: 70 });
  await page.waitForTimeout(4200);
}

// 1 — typing a search, then the merged multi-catalog results
await record('search', async (page) => {
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Find music/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input').first().click();
  await page.keyboard.type('the weeknd', { delay: 85 });
  await page.waitForTimeout(3600);
  await page.mouse.move(760, 470, { steps: 22 });
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, 220);
  await page.waitForTimeout(1400);
});

// 2 — artist page: searching, opening the artist, scanning the catalog
await record('artist', async (page) => {
  await searchFor(page, 'the weeknd');
  await page.getByRole('button', { name: /The Weeknd\s*Artist/i }).first().click();
  await page.waitForTimeout(4200);
  await page.mouse.move(700, 420, { steps: 24 });
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(1800);
});

// 3 — playing a track, then the fullscreen karaoke view
await record('lyrics', async (page) => {
  await searchFor(page, 'the weeknd');
  await page.getByText('Blinding Lights', { exact: false }).first().click();
  await page.waitForTimeout(3000);
  await withUiArg(page, 'toggleFullscreenLyrics', true);
  // wait for the lyric file and let the sweep run through a few lines
  for (let i = 0; i < 20; i++) {
    if (await lyricsReady(page)) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(11000);
});

// 4 — queue panel with the album queued up
await record('queue', async (page) => {
  await searchFor(page, 'the weeknd');
  await page.getByText('Blinding Lights', { exact: false }).first().click();
  await page.waitForTimeout(4500);
  await withUiArg(page, 'toggleQueue', true);
  await page.waitForTimeout(1600);
  await page.mouse.move(1180, 430, { steps: 22 });
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(1600);
  await page.mouse.move(1180, 500, { steps: 16 });
  await page.waitForTimeout(1200);
});

// 5 — settings, appearance, live theme switching
await record('themes', async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await withUiArg(page, 'setSettingsOpen', true);
  await page.waitForTimeout(1500);
  const appearance = page.getByText('Appearance', { exact: true }).first();
  if (await appearance.count()) await appearance.click();
  await page.waitForTimeout(1200);
  for (const theme of ['ocean', 'ember', 'violet', 'graphite']) {
    await setTheme(page, theme);
    await page.waitForTimeout(1100);
  }
  await page.waitForTimeout(600);
});

// 6 — import dialog with a playlist link typed in
await record('import', async (page) => {
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await withUiArg(page, 'setImportOpen', true);
  await page.waitForTimeout(1600);
  const input = page.locator('input').first();
  if (await input.count()) {
    await input.click();
    await page.keyboard.type('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', { delay: 16 });
  }
  await page.waitForTimeout(2200);
});

if (errors.length) console.log('ERRORS', errors.slice(0, 6));
await browser.close();
console.log('done');
