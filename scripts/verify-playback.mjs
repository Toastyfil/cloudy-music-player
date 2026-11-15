// Verifies audio decode + library persistence inside the running Electron app.
const PORT = '9222';
const mode = process.argv[2] ?? 'audio';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
const evaluate = (expression) =>
  new Promise((resolve) => {
    const callId = ++id;
    pending.set(callId, (res) => resolve(res?.result?.value));
    ws.send(JSON.stringify({ id: callId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });

if (mode === 'audio') {
  const result = await evaluate(`(async () => {
    const audio = document.createElement('audio');
    audio.src = 'http://127.0.0.1:3456/stream/H64a2ggVIWc';
    audio.volume = 0;
    document.body.appendChild(audio);
    await new Promise((resolve) => { audio.onloadedmetadata = resolve; audio.onerror = resolve; setTimeout(resolve, 15000); });
    const meta = { duration: audio.duration, readyState: audio.readyState, error: audio.error && audio.error.message };
    try { await audio.play(); } catch (err) { meta.playError = err.message; }
    const t0 = audio.currentTime;
    await new Promise((r) => setTimeout(r, 2500));
    meta.advanced = audio.currentTime > t0 + 0.4;
    meta.t1 = audio.currentTime;
    audio.remove();
    return meta;
  })()`);
  console.log('AUDIO', JSON.stringify(result));
}

if (mode === 'write') {
  const result = await evaluate(`(async () => {
    const track = { id: 'persist-check', videoId: 'persist-check', title: 'Persistence Check', artist: 'Cloudy',
      artists: [{ id: null, name: 'Cloudy' }], album: { id: null, name: 'Restart Test' }, duration: 61,
      durationText: '1:01', thumbnail: null };
    await window.cloudy.library.add(track);
    const stats = await window.cloudy.app.dbStats();
    return stats;
  })()`);
  console.log('WRITE', JSON.stringify(result));
}

if (mode === 'read') {
  const result = await evaluate(`(async () => {
    const all = await window.cloudy.library.all('recent');
    const found = all.find((t) => t.id === 'persist-check');
    const stats = await window.cloudy.app.dbStats();
    return { found: Boolean(found), title: found?.title, album: found?.album?.name, stats };
  })()`);
  console.log('READ', JSON.stringify(result));
}

ws.close();
process.exit(0);
