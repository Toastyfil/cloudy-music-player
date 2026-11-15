import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('./.tools/node_modules/playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const failed = [];
page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`);
});

await page.goto('http://127.0.0.1:3000/#/search', { waitUntil: 'networkidle' });
const input = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
await input.fill('the weeknd');
await page.keyboard.press('Enter');
await page.waitForTimeout(7000);
const imgs = await page.evaluate(() =>
  [...document.querySelectorAll('img')].slice(0, 8).map((i) => ({ src: i.currentSrc.slice(0, 90), w: i.naturalWidth })),
);
console.log(JSON.stringify({ imgs, failed: failed.slice(0, 10) }, null, 1));
await browser.close();
