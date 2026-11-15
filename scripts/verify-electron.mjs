// End-to-end check against the running Electron app over CDP:
// proves the preload bridge, the IPC handlers and better-sqlite3 all work.
const PORT = process.env.CDP_PORT ?? '9222';

async function targets() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('No CDP page target');
}

const page = await targets();
console.log('page:', page.title, '|', page.url.replace(/^file:\/\/.*\/dist\//, 'dist/'));

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function evaluate(expression) {
  const callId = ++id;
  return new Promise((resolve) => {
    pending.set(callId, (msg) => resolve(msg.result));
    ws.send(
      JSON.stringify({
        id: callId,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
}

const results = {};
results.bridge = await evaluate(`Boolean(window.cloudy && window.cloudy.isElectron)`);
results.dom = await evaluate(`({
  title: document.title,
  sidebar: Boolean(document.querySelector('nav')),
  player: Boolean(document.querySelector('footer audio, audio')),
  canvas: Boolean(document.querySelector('canvas')),
  bodyBg: getComputedStyle(document.body).backgroundColor,
})`);

const track = {
  id: 'verify-1',
  videoId: 'verify-1',
  title: 'Verification Tone',
  artist: 'Cloudy',
  artists: [{ id: null, name: 'Cloudy' }],
  album: { id: null, name: 'Test Album' },
  duration: 42,
  durationText: '0:42',
  thumbnail: null,
};

results.sqlite = await evaluate(`(async () => {
  const bridge = window.cloudy;
  await bridge.library.remove('verify-1');
  const added = await bridge.library.add(${JSON.stringify(track)});
  const has = await bridge.library.has('verify-1');
  const all = await bridge.library.all('recent');
  await bridge.library.markPlayed('verify-1', 30);
  const again = await bridge.library.all('recent');
  const playlist = await bridge.playlists.create('Verify playlist', 'temporary');
  await bridge.playlists.addTrack(playlist.id, ${JSON.stringify(track)});
  const ptracks = await bridge.playlists.tracks(playlist.id);
  const stats = await bridge.app.dbStats();
  return {
    addedTitle: added.title,
    has,
    allTitles: all.map((t) => t.title),
    playCount: again.find((t) => t.id === 'verify-1')?.playCount,
    playlistTracks: ptracks.length,
    stats,
    playlistId: playlist.id,
  };
})()`);

results.settings = await evaluate(`(async () => {
  await window.cloudy.settings.set('verifyKey', { ok: true });
  const all = await window.cloudy.settings.all();
  return all.verifyKey;
})()`);

results.cache = await evaluate(`window.cloudy.cache.stats()`);
results.mediaSession = await evaluate(`('mediaSession' in navigator)`);

console.log(JSON.stringify(results, null, 2));

// Clean up the verification records so the library stays honest.
await evaluate(`(async () => {
  const b = window.cloudy;
  await b.library.remove('verify-1');
  const lists = await b.playlists.all();
  for (const p of lists) if (p.name === 'Verify playlist') await b.playlists.remove(p.id);
  return true;
})()`);

ws.close();
process.exit(0);
