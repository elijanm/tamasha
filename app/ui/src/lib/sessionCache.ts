const PREFIX = "tamasha-qcache:";
const MAX_AGE_MS = 15 * 60 * 1000;

export function cacheGet<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: T };
    if (Date.now() - ts > MAX_AGE_MS) {
      sessionStorage.removeItem(PREFIX + key);
      return undefined;
    }
    return data;
  } catch {
    return undefined;
  }
}

export function cacheSet(key: string, data: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // quota exceeded — ignore
  }
}

export function cacheClear(): void {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}
