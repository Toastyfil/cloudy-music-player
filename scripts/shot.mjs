// Capture a screenshot of the running desktop app over CDP.
// usage: node scripts/shot.mjs out.png [x y width height]
import { writeFile } from 'node:fs/promises';

const [, , out = 'shot.png', x, y, w, h] = process.argv;
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

const params = { format: 'png', captureBeyondViewport: false };
if (x !== undefined) params.clip = { x: +x, y: +y, width: +w, height: +h, scale: 1 };
const { data } = await send('Page.captureScreenshot', params);
await writeFile(out, Buffer.from(data, 'base64'));
console.log(`saved ${out}`);
ws.close();
