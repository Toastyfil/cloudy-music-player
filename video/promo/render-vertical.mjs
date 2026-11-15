import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('../.tools/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.join(here, 'promo-vertical.html')).href;
const FPS = 30;
const DURATION = 32;

const mode = process.argv.includes('--frames') ? 'frames' : 'stills';
const outDir = path.join(here, mode === 'frames' ? 'frames-v' : 'stills-v');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(pageUrl, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
console.log('inter loaded:', await page.evaluate(() => document.fonts.check('700 100px Inter')));

if (mode === 'stills') {
  const times = [1.6, 5.4, 9.2, 13.6, 17.4, 20.8, 24.2, 29.6];
  for (const t of times) {
    await page.evaluate((tt) => window.seek(tt), t);
    await page.screenshot({ path: path.join(outDir, `t${t.toFixed(1)}.png`) });
  }
  console.log('stills written:', times.length);
} else {
  const total = Math.round(DURATION * FPS);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate((tt) => window.seek(tt), i / FPS);
    await page.screenshot({ path: path.join(outDir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94 });
    if (i % 90 === 0) console.log(`frame ${i}/${total} (${((i / total) * 100).toFixed(0)}%) ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  console.log(`rendered ${total} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5));
await browser.close();
