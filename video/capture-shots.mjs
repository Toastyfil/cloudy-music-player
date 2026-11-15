// Capture real Cloudy UI screenshots for the promo video.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('./.tools/node_modules/playwright');

const out = path.join(process.cwd(), 'video', 'shots');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text().slice(0, 160));
});

const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('saved', name);
};

await page.goto('http://127.0.0.1:3000/#/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await shot('home');

// Start a track so the player bar, lyrics and history are populated.
await page.evaluate(async () => {
  const { usePlayerStore } = await import('/src/features/player/store/playerStore.ts');
  const player = usePlayerStore.getState();
  const queue = player.queue;
  const target = queue.find((t) => /Save Your Tears|Blinding|Get Lucky/i.test(t.title)) ?? queue[0];
  const index = target ? queue.indexOf(target) : 0;
  if (index >= 0) await player.playAt(index);
});
await page.waitForTimeout(6000);
await shot('home-playing');

// Lyrics panel.
await page.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  const { usePlayerStore } = await import('/src/features/player/store/playerStore.ts');
  useUiStore.getState().toggleLyrics(true);
  const audio = document.querySelector('audio');
  const player = usePlayerStore.getState();
  player.seek(58);
  if (audio) audio.currentTime = 58;
});
await page.waitForTimeout(4500);
await shot('lyrics');

await page.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  useUiStore.getState().toggleFullscreenLyrics(true);
});
await page.waitForTimeout(2500);
await shot('lyrics-fullscreen');
await page.evaluate(async () => {
  const { useUiStore } = await import('/src/features/navigation/store/uiStore.ts');
  useUiStore.getState().toggleFullscreenLyrics(false);
  useUiStore.getState().toggleLyrics(false);
});
await page.waitForTimeout(800);

// Search across catalogs.
await page.goto('http://127.0.0.1:3000/#/search', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const input = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
if (await input.count()) {
  await input.click();
  await input.fill('the weeknd');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  await shot('search');
  await input.fill('daft punk');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
  await shot('search-2');
} else {
  console.log('no search input found');
}

// Settings / audio flavour.
await page.goto('http://127.0.0.1:3000/#/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('home-final');

await browser.close();
console.log('done');
