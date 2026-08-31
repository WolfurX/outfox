import { describe, it, expect } from 'vitest';

// Regression for deploy/README gap #1: without per-IP limits, /api/session/bootstrap
// mints unbounded player+session rows and the nonce/register/link routes are free to
// brute-force. Limits here are the spec numbers (30/min bootstrap, 10/min auth
// class), asserted independently — not read back from the server config.
//
// Env must be pinned BEFORE the app module loads (NODE_ENV=test from vitest
// suppresses listen()). OUTFOX_TRUST_PROXY stays unset so forged X-Forwarded-For
// headers must be ignored; the trusted-proxy path lives in rate-limit-proxy.test.ts.
process.env.OUTFOX_DB = ':memory:';
delete process.env.OUTFOX_TRUST_PROXY;
delete process.env.OUTFOX_DEV_AUTH;
const { app } = await import('../src/index.js');

const BOOTSTRAP_MAX = 30;
const AUTH_MAX = 10;

const boot = (ip: string) =>
  app.inject({ method: 'POST', url: '/api/session/bootstrap', remoteAddress: ip });

describe('per-IP rate limits (deploy gap #1)', () => {
  it('bootstrap allows the budget then 429s, with the client error shape', async () => {
    const ip = '10.1.0.1';
    for (let i = 0; i < BOOTSTRAP_MAX; i++) {
      const r = await boot(ip);
      expect(r.statusCode, `request ${i + 1} within budget`).toBe(200);
    }
    const over = await boot(ip);
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('a different IP is unaffected by an exhausted one', async () => {
    const r = await boot('10.1.0.2');
    expect(r.statusCode).toBe(200);
  });

  it('forged X-Forwarded-For does not reset the bucket when no proxy is trusted', async () => {
    const ip = '10.1.0.3';
    for (let i = 0; i < BOOTSTRAP_MAX; i++) {
      const r = await app.inject({
        method: 'POST', url: '/api/session/bootstrap', remoteAddress: ip,
        headers: { 'x-forwarded-for': `203.0.113.${i}` },
      });
      expect(r.statusCode).toBe(200);
    }
    const over = await app.inject({
      method: 'POST', url: '/api/session/bootstrap', remoteAddress: ip,
      headers: { 'x-forwarded-for': '198.51.100.99' },
    });
    expect(over.statusCode, 'spoofed header must not evade the limit').toBe(429);
  });

  it('the nonce route has its own, tighter budget', async () => {
    const ip = '10.1.0.4';
    const session = await boot(ip);
    const cookie = String(session.headers['set-cookie'] ?? '').split(';')[0];
    expect(cookie).toContain('fox_session=');
    for (let i = 0; i < AUTH_MAX; i++) {
      const r = await app.inject({
        method: 'POST', url: '/api/register/siws/nonce', remoteAddress: ip,
        headers: { cookie },
      });
      expect(r.statusCode, `nonce ${i + 1} within budget`).toBe(200);
    }
    const over = await app.inject({
      method: 'POST', url: '/api/register/siws/nonce', remoteAddress: ip,
      headers: { cookie },
    });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ code: 'rate_limited' });
  });

  // Table-driven: a route silently dropped from the limited set fails here by name.
  // Unauthenticated/chainless requests still burn budget (the limiter hook runs
  // before the handler), so per-request statuses are 4xx — never 429 within budget.
  const LIMITED = [
    '/api/register/start', '/api/register/verify', '/api/register/adopt',
    '/api/register/privy', '/api/register/siws/nonce', '/api/register/siws',
    '/api/wallet/nonce', '/api/wallet/link', '/api/verify/dev',
    '/api/withdraw/request', '/api/withdraw/claim', '/api/deposit/prepare',
  ];
  for (const [i, url] of LIMITED.entries()) {
    it(`${url} 429s past the auth budget`, async () => {
      const ip = `10.2.0.${i + 1}`;
      for (let n = 0; n < AUTH_MAX; n++) {
        const r = await app.inject({ method: 'POST', url, remoteAddress: ip });
        expect(r.statusCode, `${url} request ${n + 1} within budget`).toBeLessThan(429);
      }
      const over = await app.inject({ method: 'POST', url, remoteAddress: ip });
      expect(over.statusCode).toBe(429);
    });
  }

  it('gameplay routes are not IP-limited (they are session-gated and priced)', async () => {
    const ip = '10.1.0.5';
    for (let n = 0; n < AUTH_MAX + 5; n++) {
      const r = await app.inject({ method: 'POST', url: '/api/actions/call', remoteAddress: ip });
      expect(r.statusCode, 'no session -> 401, never 429').toBe(401);
    }
  });

  it('healthz is never limited (uptime monitor)', async () => {
    const ip = '10.1.0.6';
    for (let i = 0; i < BOOTSTRAP_MAX + 10; i++) {
      const r = await app.inject({ method: 'GET', url: '/healthz', remoteAddress: ip });
      expect(r.statusCode).toBe(200);
    }
  });
});
