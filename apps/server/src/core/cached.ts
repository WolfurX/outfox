/**
 * A cached upstream read for the public routes anyone can hit without a session.
 *
 * At most one read per window and never two at once, whatever the request rate and
 * whether or not reads succeed. A caller waits only when there is nothing to serve yet,
 * and then at most `timeoutMs`; otherwise the last good value is served at once, until
 * it has gone `maxAgeMs` without being refreshed, after which null is served rather
 * than something stale. A read that lost to the timeout can never overwrite a newer
 * value. The clock is monotonic so a wall-clock step cannot stall refresh.
 */
export function cachedRead<T>(read: () => Promise<T>, o: {
  windowMs: number; timeoutMs: number; maxAgeMs: number;
  onError: (e: unknown) => void;
  now?: () => number;
}): () => Promise<T | null> {
  const now = o.now ?? (() => performance.now());
  let value: T | null = null;
  let valueAt = 0;
  let lastTry = -Infinity;
  let inflight: Promise<void> | null = null;
  return async () => {
    if (!inflight && now() - lastTry >= o.windowMs) {
      lastTry = now();
      inflight = withTimeout(Promise.resolve().then(read), o.timeoutMs)
        .then((v) => { value = v; valueAt = now(); })
        .catch(o.onError)
        .finally(() => { inflight = null; });
    }
    // Drop a stale value BEFORE deciding whether to wait: after a quiet spell past maxAge
    // the caller must wait for the refresh just started, not be answered null.
    if (value !== null && now() - valueAt > o.maxAgeMs) value = null;
    if (value === null && inflight) await inflight;
    return value;
  };
}

/** Reject after `ms` unless `p` settles first. The loser's eventual result is dropped. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
