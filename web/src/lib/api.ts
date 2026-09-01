/**
 * API client with an offline-first cache.
 *
 * Every successful GET is mirrored into localStorage. When the network is gone -
 * the normal state in much of the region this platform is for - reads fall back
 * to the last good copy and the UI says so rather than showing an error page.
 */
const BASE = '/api';
const CACHE_PREFIX = 'ner-cache:';

export type CacheState = 'live' | 'cached' | 'error';

export interface Fetched<T> {
  data: T | null;
  state: CacheState;
  cachedAt: string | null;
  error: string | null;
}

function readCache<T>(key: string): { data: T; at: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, at: new Date().toISOString() }));
  } catch {
    /* quota or private mode - the cache is a convenience, never a requirement */
  }
}

export async function getJson<T>(path: string): Promise<Fetched<T>> {
  try {
    const res = await fetch(BASE + path);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as T;
    writeCache(path, data);
    return { data, state: 'live', cachedAt: null, error: null };
  } catch (err) {
    const cached = readCache<T>(path);
    if (cached) {
      return { data: cached.data, state: 'cached', cachedAt: cached.at, error: (err as Error).message };
    }
    return { data: null, state: 'error', cachedAt: null, error: (err as Error).message };
  }
}

export async function postJson<T>(path: string, body: unknown): Promise<Fetched<T>> {
  const key = `${path}:${JSON.stringify(body)}`;
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(parsed.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as T;
    writeCache(key, data);
    return { data, state: 'live', cachedAt: null, error: null };
  } catch (err) {
    const cached = readCache<T>(key);
    if (cached) {
      return { data: cached.data, state: 'cached', cachedAt: cached.at, error: (err as Error).message };
    }
    return { data: null, state: 'error', cachedAt: null, error: (err as Error).message };
  }
}

export const cachedPlanCount = () => {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX + '/plan')).length;
  } catch {
    return 0;
  }
};
