// Tiny TTL cache. Streaming metadata changes slowly; audio URLs expire on their
// own schedule, so entries are keyed and invalidated independently.
export class TtlCache {
  #store = new Map();

  constructor(defaultTtlMs = 5 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key) {
    const hit = this.#store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.#store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.#store.set(key, { value, expires: Date.now() + ttlMs });
    // Keep the map from growing without bound on long sessions.
    if (this.#store.size > 800) {
      const oldest = this.#store.keys().next().value;
      this.#store.delete(oldest);
    }
    return value;
  }

  delete(key) {
    this.#store.delete(key);
  }

  clear() {
    this.#store.clear();
  }
}
