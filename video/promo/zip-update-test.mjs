import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../.tools/node_modules/playwright');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const version = async (page) => (await page.evaluate(() => navigator.userAgent)).match(/Cloudy\/[\d.]+/)?.[0];

let browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
let page;
for (let i = 0; i < 20; i++) {
  page = browser.contexts()[0]?.pages()?.[0];
  if (page) break;
  await sleep(1000);
}
console.log('before:', await version(page));

await page.evaluate(() => window.cloudy.updates.check(true));
let state;
for (let i = 0; i < 160; i++) {
  state = await page.evaluate(() => window.cloudy.updates.state()).catch(() => null);
  if (!state) break;
  if (i % 8 === 0) console.log(' ', state.phase, state.version ?? '', `${Math.round((state.progress ?? 0) * 100)}%`);
  if (state.phase === 'ready' || state.phase === 'error') break;
  await sleep(2500);
}
console.log('state:', JSON.stringify(state));

const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ state: 'visible', timeout: 8000 });
await dialog.getByRole('button', { name: 'Restart now' }).click();
console.log('clicked Restart now');
await browser.close().catch(() => {});

// The updater relaunches the unpacked copy with the same arguments, so the new
// instance exposes the same debugging port.
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  try {
    const next = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const nextPage = next.contexts()[0]?.pages()?.[0];
    if (nextPage) {
      const label = await version(nextPage);
      console.log('after:', label);
      console.log('path:', await nextPage.evaluate(() => window.cloudy.app?.version?.() ?? 'n/a').catch(() => 'n/a'));
      await next.close().catch(() => {});
      if (label && !label.endsWith('1.1.9')) process.exit(0);
    }
  } catch {}
}
console.log('after: never came back');
process.exit(1);
