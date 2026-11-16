import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../.tools/node_modules/playwright');

const port = process.argv[2] ?? '9400';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20000 });
const page = browser.contexts()[0].pages()[0];
await page.waitForTimeout(2500);

const visible = async () => page.evaluate(() => document.body.innerText.includes('Start listening'));
const stepText = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 220);

console.log('tour visible:', await visible());
console.log('step 1:', await stepText());

if (process.argv.includes('--walk')) {
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Continue' }).click();
    await sleep(350);
    console.log(`step ${i + 2}:`, (await stepText()).slice(0, 120));
  }
  await page.getByRole('button', { name: 'Start listening' }).click();
  await sleep(600);
  console.log('after finish, tour visible:', await visible());
  const saved = await page.evaluate(async () => {
    const all = await window.cloudy.settings.all();
    return all.onboardingComplete === true;
  });
  console.log('saved flag:', saved);
}

await browser.close();
