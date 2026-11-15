// Captures documentation screenshots from the running app over CDP.
// usage: node scripts/capture-docs.mjs [outDir]
// Requires the app started with --remote-debugging-port=9222.
import { writeFile, mkdir } from 'node:fs/promises';

const API = 'http://127.0.0.1:3456';
const outDir = process.argv[2] ?? 'docs/screenshots';
await mkdir(outDir, { recursive: true });

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target on :9222');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result);
});
await new Promise((resolve) => ws.addEventListener('open', resolve));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed');
  return result.result?.value;
}

async function waitFor(expression, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true;
    await sleep(250);
  }
  return false;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  saved ${name}.png`);
}

const click = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
const clickText = (pattern, scope = 'button') =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(scope)})]
      .find((b) => new RegExp(${JSON.stringify(pattern)}, 'i').test(b.textContent || ''));
    if (!el) return false;
    el.click();
    return true;
  })()`);
const key = (code, k) =>
  evaluate(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(code)}, bubbles: true })); return true; })()`);

const goto = async (hash) => {
  await evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(900);
};

const playFirstRow = () =>
  evaluate(`(() => {
    const row = [...document.querySelectorAll('[role="button"]')]
      .find((el) => /\\d+:\\d\\d/.test(el.textContent || ''));
    if (row) { row.click(); return 'row'; }
    const btn = [...document.querySelectorAll('button')].find((b) => /Play All/i.test(b.textContent || ''));
    if (btn) { btn.click(); return 'play-all'; }
    return false;
  })()`);

const seek = (seconds) =>
  evaluate(`(() => {
    const audio = document.querySelector('audio');
    if (!audio || !Number.isFinite(audio.duration)) return false;
    audio.currentTime = Math.min(${seconds}, audio.duration - 5);
    return true;
  })()`);

// Resolve catalog ids over the local API so navigation never depends on markup.
async function firstId(kind, q) {
  const data = await (await fetch(`${API}/search?q=${encodeURIComponent(q)}&type=${kind}`)).json();
  const list = data.results ?? [];
  const pick = kind === 'albums' ? list.find((a) => /after hours/i.test(a.title)) ?? list[0] : list[0];
  if (!pick) throw new Error(`no ${kind} for ${q}`);
  return pick.id;
}

// The app is captured in English and on the shipped default palette; the
// previous preferences are restored at the end so this changes nothing.
const original = await evaluate(`window.cloudy.settings.all()`);
await evaluate(`(async () => {
  await window.cloudy.settings.set('locale', 'en');
  await window.cloudy.settings.set('themeId', 'graphite');
  return true;
})()`);
await evaluate('location.reload()');
await sleep(5000);

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('home', async () => {
  await goto('#/');
  await sleep(1200);
  await shot('home');
});

step('search', async () => {
  await goto('#/search');
  await evaluate(`(() => {
    const input = document.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'the weeknd');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // Results are real network data; wait for a duration to appear in the list.
  const ready = await waitFor(`/\\d+:\\d\\d/.test(document.querySelector('main')?.innerText ?? '')`);
  if (!ready) throw new Error('search results never rendered');
  await sleep(1200);
  await shot('search');
});

step('artist', async () => {
  const artistId = await firstId('artists', 'the weeknd');
  await goto(`#/artist/${artistId}`);
  await waitFor(`/Popular|Albums/i.test(document.querySelector('main')?.innerText ?? '')`);
  await sleep(2500);
  await shot('artist');
  await evaluate(`(() => {
    const main = document.querySelector('main');
    const heading = [...(main?.querySelectorAll('h2, h3') ?? [])]
      .find((el) => /^Albums$/i.test((el.textContent || '').trim()));
    if (!heading) return false;
    main.scrollTop = heading.offsetTop - 24;
    return true;
  })()`);
  await sleep(1200);
  await shot('artist-albums');
});

step('album', async () => {
  const albumId = await firstId('albums', 'after hours');
  await goto(`#/album/${albumId}`);
  await waitFor(`/\\d+:\\d\\d/.test(document.querySelector('main')?.innerText ?? '')`);
  await sleep(2000);
  await shot('album');
});

step('lyrics', async () => {
  if (!(await playFirstRow())) throw new Error('no track row on album page');
  await sleep(4500);
  await seek(52);
  await sleep(1500);
  await key('KeyL', 'l');
  await sleep(2500);
  await shot('lyrics');
});

step('queue', async () => {
  await key('KeyL', 'l');
  await sleep(700);
  await key('KeyQ', 'q');
  await sleep(1200);
  await shot('queue');
  await key('KeyQ', 'q');
  await sleep(700);
});

step('appearance', async () => {
  await click('button[aria-label="Settings"]');
  await sleep(1400);
  // The palette grid lives below the language list; scroll it into view.
  await evaluate(`(() => {
    const heading = [...document.querySelectorAll('h3, h2, div')].find((el) => /^Design$/i.test((el.textContent || '').trim()));
    heading?.scrollIntoView({ block: 'center' });
    return !!heading;
  })()`);
  await sleep(1000);
  await shot('appearance');
});

step('settings-playback', async () => {
  await clickText('^Playback$', 'button');
  await sleep(1000);
  await shot('settings-playback');
});

step('fullscreen-lyrics', async () => {
  await key('Escape', 'Escape');
  await sleep(900);
  await key('KeyL', 'l');
  await sleep(1200);
  await seek(70);
  await key('KeyF', 'f');
  await sleep(2600);
  await shot('fullscreen');
  await key('KeyF', 'f');
  await sleep(600);
});

for (const { name, fn } of steps) {
  try {
    await fn();
  } catch (error) {
    console.log(`  !! ${name}: ${error.message}`);
  }
}

// Put the user's own language and palette back.
await evaluate(`(async () => {
  await window.cloudy.settings.set('locale', ${JSON.stringify(original.locale ?? 'en')});
  await window.cloudy.settings.set('themeId', ${JSON.stringify(original.themeId ?? 'graphite')});
  return true;
})()`);
await evaluate('location.reload()');

ws.close();
console.log('done');
