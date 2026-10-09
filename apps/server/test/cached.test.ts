import { describe, it, expect } from 'vitest';
import { cachedRead } from '../src/core/cached.js';

describe('cachedRead', () => {
  const opts = (clock: { t: number }) => ({
    windowMs: 30_000, timeoutMs: 8_000, maxAgeMs: 600_000, onError: () => {}, now: () => clock.t,
  });

  it('serves the first read once it lands', async () => {
    const clock = { t: 0 };
    const get = cachedRead(async () => 'a', opts(clock));
    expect(await get()).toBe('a');
  });

  it('after a quiet spell past maxAge, waits for the refresh instead of answering null', async () => {
    // A low-traffic page: one visit, then nobody for longer than maxAge. The next visitor
    // must get the fresh read, not a blank page while that read is already in flight.
    const clock = { t: 0 };
    let n = 0;
    const get = cachedRead(async () => `v${++n}`, opts(clock));
    expect(await get()).toBe('v1');
    clock.t = 11 * 60_000;
    expect(await get()).toBe('v2');
  });

  it('still answers null rather than a stale value when the refresh fails', async () => {
    const clock = { t: 0 };
    let fail = false;
    const get = cachedRead(async () => { if (fail) throw new Error('rpc down'); return 'v1'; }, opts(clock));
    expect(await get()).toBe('v1');
    fail = true;
    clock.t = 11 * 60_000;
    expect(await get()).toBeNull();
  });

  it('serves the last good value at once while a refresh runs inside maxAge', async () => {
    const clock = { t: 0 };
    let release: (v: string) => void = () => {};
    let n = 0;
    const get = cachedRead(() => (++n === 1 ? Promise.resolve('v1') : new Promise<string>((r) => { release = r; })), opts(clock));
    expect(await get()).toBe('v1');
    clock.t = 60_000;
    expect(await get()).toBe('v1');
    release('v2');
  });
});
