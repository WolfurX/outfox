import { describe, it, expect } from 'vitest';

// Route-level regression for the exchange swap parse (adversarial review of the module
// move, 2026-09-12): a present-but-null `minOut` is a malformed request and must be
// refused as bad_amount, never read as "no slippage floor".
process.env.OUTFOX_DB = ':memory:';
delete process.env.OUTFOX_TRUST_PROXY;
delete process.env.OUTFOX_DEV_AUTH;
const { app } = await import('../src/index.js');

async function session(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/session/bootstrap' });
  expect(r.statusCode).toBe(200);
  return r.cookies.find((c) => c.name === 'fox_session')!.value;
}

describe('POST /api/exchange/swap parsing', () => {
  it('minOut: null is refused as bad_amount before any economic check runs', async () => {
    const tok = await session();
    const r = await app.inject({
      method: 'POST', url: '/api/exchange/swap', cookies: { fox_session: tok },
      payload: { side: 'buy', amount: '100', minOut: null },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('bad_amount');
  });
  it('a well-formed swap from a guest reaches the rung gate (parse is not the blocker)', async () => {
    const tok = await session();
    const r = await app.inject({
      method: 'POST', url: '/api/exchange/swap', cookies: { fox_session: tok },
      payload: { side: 'buy', amount: '100', minOut: '1' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('rung_required');
  });
});
