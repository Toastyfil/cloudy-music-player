import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../.tools/node_modules/playwright');

const exe = process.argv[2];
const port = process.argv[3] ?? '9337';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const started = Date.now();
const child = spawn(exe, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' });
child.unref();

let browser;
for (let i = 0; i < 600; i++) {
  await sleep(100);
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0]?.pages()?.[0];
    if (page) {
      // Wait for the first React render, which is what the user sees.
      await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0, null, { timeout: 30000 });
      console.log(`first paint: ${Date.now() - started}ms`);
      await browser.close().catch(() => {});
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      process.exit(0);
    }
  } catch {}
}
console.log('never started');
process.exit(1);
