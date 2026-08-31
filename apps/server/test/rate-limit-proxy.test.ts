import { describe, it, expect } from 'vitest';

// The production topology: Caddy on loopback, OUTFOX_TRUST_PROXY=1. Fastify must
// trust exactly ONE hop, so req.ip is the address Caddy APPENDED to X-Forwarded-For
// (the real client) — never the leftmost entry, which the client controls (Caddy
// appends to client-supplied XFF; it does not strip it). With `trustProxy: true`
// every forged leftmost entry would mint a fresh rate-limit bucket and the whole
// scheme is bypassable — the adversarial-review headline finding (2026-08-31).
process.env.OUTFOX_DB = ':memory:';
process.env.OUTFOX_TRUST_PROXY = '1';
delete process.env.OUTFOX_DEV_AUTH;
const { app } = await import('../src/index.js');

const BOOTSTRAP_MAX = 30;
const CADDY = '127.0.0.1';

const boot = (xff: string) =>
  app.inject({
    method: 'POST', url: '/api/session/bootstrap', remoteAddress: CADDY,
    headers: { 'x-forwarded-for': xff },
  });

describe('trusted-proxy keying (OUTFOX_TRUST_PROXY=1)', () => {
  it('forged leftmost XFF entries do not mint fresh buckets', async () => {
    // Same real client (rightmost, appended by the trusted hop), a different forged
    // leftmost every request: all must land in the ONE bucket for 203.0.113.7.
    for (let i = 0; i < BOOTSTRAP_MAX; i++) {
      const r = await boot(`66.66.${i}.1, 203.0.113.7`);
      expect(r.statusCode, `request ${i + 1} within budget`).toBe(200);
    }
    const over = await boot('66.66.250.1, 203.0.113.7');
    expect(over.statusCode, 'a forged XFF prefix must not evade the limit').toBe(429);
  });

  it('a different real client (appended by the proxy) gets its own budget', async () => {
    const r = await boot('66.66.0.1, 198.51.100.20');
    expect(r.statusCode).toBe(200);
  });
});
