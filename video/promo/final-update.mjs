import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../.tools/node_modules/playwright');
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
let p;
for (let i = 0; i < 20; i++) { p = b.contexts()[0]?.pages()?.[0]; if (p) break; await new Promise((r) => setTimeout(r, 1000)); }
console.log('running:', (await p.evaluate(() => navigator.userAgent)).match(/Cloudy\/[\d.]+/)?.[0]);
await p.evaluate(() => window.cloudy.updates.check(true));
let state;
for (let i = 0; i < 100; i++) {
  state = await p.evaluate(() => window.cloudy.updates.state()).catch(() => null);
  if (!state) break;
  if (i % 10 === 0) console.log(state.phase, state.version ?? '', Math.round((state.progress ?? 0) * 100) + '%');
  if (state.phase === 'ready' || state.phase === 'error') break;
  await new Promise((r) => setTimeout(r, 2500));
}
console.log('state:', JSON.stringify(state));
const dialog = p.locator('[role="dialog"]');
await dialog.waitFor({ state: 'visible', timeout: 8000 });
await dialog.getByRole('button', { name: 'Restart now' }).click();
console.log('clicked Restart now');
await new Promise((r) => setTimeout(r, 1500));
await b.close().catch(() => {});
