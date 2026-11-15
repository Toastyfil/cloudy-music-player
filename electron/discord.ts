// Discord Rich Presence. Failures here are never fatal: the player works
// exactly the same with no Discord client running.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type PresencePayload = {
  title: string;
  artist: string;
  album?: string | null;
  thumbnail?: string | null;
  position: number;
  duration: number;
  playing: boolean;
};

const CLIENT_ID = '1211000000000000000'; // Cloudy's own application id

let client: any = null;
let ready = false;
let lastKey = '';
let current: PresencePayload | null = null;
let enabled = true;

function activityFor(payload: PresencePayload) {
  const now = Date.now();
  const start = new Date(now - payload.position * 1000).toISOString();
  const end = new Date(now + Math.max(0, payload.duration - payload.position) * 1000).toISOString();
  return {
    details: payload.title.slice(0, 128),
    state: payload.artist.slice(0, 128),
    largeImageKey: payload.thumbnail ?? 'cloudy',
    largeImageText: payload.album ?? 'Cloudy',
    smallImageKey: payload.playing ? 'play' : 'pause',
    smallImageText: payload.playing ? 'Playing' : 'Paused',
    instance: false,
    startTimestamp: payload.playing ? start : undefined,
    endTimestamp: payload.playing && payload.duration > 0 ? end : undefined,
  };
}

async function ensureClient() {
  if (client) return client;
  try {
    const RPC = require('discord-rpc');
    client = new RPC.Client({ transport: 'ipc' });
    client.on('ready', () => {
      ready = true;
      if (current) void push(current, true);
    });
    client.on('disconnected', () => {
      ready = false;
      client = null;
    });
    await client.login({ clientId: CLIENT_ID }).catch(() => {
      client = null;
      throw new Error('discord unavailable');
    });
  } catch {
    client = null;
  }
  return client;
}

async function push(payload: PresencePayload, force = false) {
  if (!enabled) return { ok: false, reason: 'disabled' };
  current = payload;
  const key = `${payload.title}|${payload.artist}|${payload.playing ? 1 : 0}|${Math.round(payload.position)}`;
  if (!force && key === lastKey) return { ok: true, throttled: true };
  const rpc = await ensureClient();
  if (!rpc || !ready) return { ok: false, reason: 'no-client' };
  try {
    lastKey = key;
    await rpc.setActivity(activityFor(payload));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'set-failed' };
  }
}

export const presence = {
  update(payload: PresencePayload) {
    return push(payload);
  },
  async clear() {
    current = null;
    lastKey = '';
    if (client && ready) await client.clearActivity().catch(() => undefined);
    return { ok: true };
  },
  setEnabled(value: boolean) {
    enabled = value;
    if (!value) void presence.clear();
    return { ok: true, enabled };
  },
  destroy() {
    try {
      client?.destroy?.();
    } catch {
      /* ignore */
    }
    client = null;
    ready = false;
  },
};
