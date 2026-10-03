import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  createDammV2Program, createDbcProgram, DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDammV2PoolAddress,
  DynamicBondingCurveIdl,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { LAUNCH, type LaunchView } from '@outfox/shared';
import {
  DAMM_V2_PROGRAM, DBC_PROGRAM, dammPoolFor, decodeCurveConfig, decodeCurvePool, decodeDammPool,
  gameLaunchReader, LAYOUT, priceFromSqrt, readLaunch, registerLaunchRoutes, type LaunchConfig,
} from '../src/chain/launch.js';
import type { Ctx } from '../src/core/ctx.js';

// The launch view decodes Meteora accounts by byte offset (chain/launch.ts). The offsets
// are pinned three independent ways, none of them the code under test:
//   1. the programs' IDLs, as bundled in the Meteora SDK (field order and sizes);
//   2. the SDK's own account decoder, run here on the same bytes;
//   3. literal values the SDK printed when it read these accounts on devnet (2026-10-02).
// The fixtures are raw devnet accounts:
//   spike-*      a launch run to graduation (0.50 -> 1.00, threshold 82,842.712474)
//   rehearsal-*  a launch built from the published LAUNCH rules: `rehearsal-pool` while the
//                curve was open, `rehearsal-pool-graduated` and `rehearsal-damm` after
//                graduation AND after an outside holder added liquidity to the pool, so
//                total liquidity and permanently locked liquidity differ.
const fx = (name: string, owner: PublicKey) => ({
  owner,
  data: Buffer.from(readFileSync(join(__dirname, 'fixtures', 'launch', `${name}.b64`), 'utf8'), 'base64'),
});
const SPIKE = {
  config: 'BftDiGCh6t5sPorixN8nBK8tiw9fEHmXgYRKobEjZocq',
  pool: '5i5YUoQN7R9eAxXMZGKPQ6uNDHmJgtAfV42qSCBhKT2f',
  damm: 'Ae5wdHZ3rhNhz7s3KFhqLK8KG89aVw3eRxcFTXhuL2QN',
  mint: 'JBEV5kHjctYNLPqSHScngFFJ86Bnin3UdBC3qxH2FYaA',
  quote: 'BMaBdtMZqCZnCcu3tFi8pCDSroryHsbeAUbmixPdcqhR',
};
const REHEARSAL = {
  config: '8LLMWukhw8ZpNjtnmTpSSy6J3QHYVYSMxf51duG6PXV3',
  pool: 'TcCuTa8oh61J2ChwugzdPopCg2Zpv8GXHNnb3rK7kYt',
  damm: '9MKjydp1q9FThUyQ63PxDuhdZHZYccrutJuHVKVxrYmd',
  mint: 'A93g9PNLzxhwB5K7aZvALUavkpFK7AgvTVR1sNAM72tV',
  quote: '8e8BQDLoP9ikezYzGMXjZYGjb517jKagTxPrs7eGAMGN',
};
const offline = new Connection('http://offline.invalid'); // the SDK's program objects never use it here

describe('launch account layout against the program IDLs', () => {
  const PRIMS: Record<string, number> = { u8: 1, i8: 1, bool: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32 };
  const lc = (s: string) => s.replace(/_/g, '').toLowerCase();
  function sizeOf(types: any[], t: any): number {
    if (typeof t === 'string') return PRIMS[t] ?? NaN;
    if (t.array) return sizeOf(types, t.array[0]) * t.array[1];
    const def = types.find((x) => lc(x.name) === lc(t.defined.name ?? t.defined));
    return def.type.fields.reduce((n: number, f: any) => n + sizeOf(types, f.type), 0);
  }
  /** Absolute offsets of every field of a struct, descending into nested structs. */
  function offsets(types: any[], name: string, base = 8, out: Record<string, number> = {}) {
    let o = base;
    for (const f of types.find((x) => lc(x.name) === lc(name)).type.fields) {
      out[lc(f.name)] = o;
      o += sizeOf(types, f.type);
    }
    return { out, end: o };
  }
  const dbc = (DynamicBondingCurveIdl as any).types;
  const damm = (createDammV2Program(offline, 'confirmed') as any).idl.types;

  it('curve config', () => {
    const { out, end } = offsets(dbc, 'PoolConfig');
    const { disc, len, ...fields } = LAYOUT.curveConfig;
    expect(end).toBe(len);
    for (const [k, v] of Object.entries(fields)) expect(out[lc(k)], k).toBe(v);
  });
  it('curve pool (VirtualPool wraps PoolState at offset 8)', () => {
    const vp = dbc.find((x: any) => lc(x.name) === 'virtualpool').type.fields;
    expect(vp.map((f: any) => lc(f.name))).toEqual(['poolstate']);
    const { out, end } = offsets(dbc, vp[0].type.defined.name ?? vp[0].type.defined);
    const { disc, len, ...fields } = LAYOUT.curvePool;
    expect(end).toBe(len);
    for (const [k, v] of Object.entries(fields)) expect(out[lc(k)], k).toBe(v);
  });
  it('DAMM v2 pool', () => {
    const { out, end } = offsets(damm, 'Pool');
    const { disc, len, ...fields } = LAYOUT.dammPool;
    expect(end).toBe(len);
    for (const [k, v] of Object.entries(fields)) expect(out[lc(k)], k).toBe(v);
  });
});

describe('launch account decoding', () => {
  it('agrees with the SDK decoder on every fixture and field', () => {
    const dbcCoder = (createDbcProgram(offline, 'confirmed').program as any).coder.accounts;
    const dammCoder = (createDammV2Program(offline, 'confirmed') as any).coder.accounts;
    for (const name of ['spike-config', 'rehearsal-config']) {
      const raw = fx(name, DBC_PROGRAM);
      const sdk = dbcCoder.decode('poolConfig', raw.data);
      const got = decodeCurveConfig(raw);
      expect(got.quoteMint.equals(sdk.quoteMint)).toBe(true);
      expect(got.tokenDecimal).toBe(sdk.tokenDecimal);
      expect(got.migrationFeeOption).toBe(sdk.migrationFeeOption);
      expect(got.migrationQuoteThreshold.toString()).toBe(sdk.migrationQuoteThreshold.toString());
      expect(got.migrationSqrtPrice.toString()).toBe(sdk.migrationSqrtPrice.toString());
      expect(got.sqrtStartPrice.toString()).toBe(sdk.sqrtStartPrice.toString());
    }
    for (const name of ['spike-pool', 'rehearsal-pool', 'rehearsal-pool-graduated']) {
      const raw = fx(name, DBC_PROGRAM);
      const sdk = dbcCoder.decode('virtualPool', raw.data).poolState;
      const got = decodeCurvePool(raw);
      expect(got.config.equals(sdk.config)).toBe(true);
      expect(got.baseMint.equals(sdk.baseMint)).toBe(true);
      expect(got.quoteReserve.toString()).toBe(sdk.quoteReserve.toString());
      expect(got.sqrtPrice.toString()).toBe(sdk.sqrtPrice.toString());
      expect(got.migrationProgress).toBe(sdk.migrationProgress);
    }
    for (const name of ['spike-damm', 'rehearsal-damm']) {
      const raw = fx(name, DAMM_V2_PROGRAM);
      const sdk = dammCoder.decode('pool', raw.data);
      const got = decodeDammPool(raw);
      expect(got.tokenAMint.equals(sdk.tokenAMint)).toBe(true);
      expect(got.tokenBMint.equals(sdk.tokenBMint)).toBe(true);
      expect(got.liquidity.toString()).toBe(sdk.liquidity.toString());
      expect(got.permanentLockLiquidity.toString()).toBe(sdk.permanentLockLiquidity.toString());
      expect(got.sqrtPrice.toString()).toBe(sdk.sqrtPrice.toString());
      expect(got.tokenAAmount.toString()).toBe(sdk.tokenAAmount.toString());
      expect(got.tokenBAmount.toString()).toBe(sdk.tokenBAmount.toString());
    }
  });

  it('decodes the values the SDK reported from chain', () => {
    const c = decodeCurveConfig(fx('spike-config', DBC_PROGRAM));
    expect(c.quoteMint.toBase58()).toBe(SPIKE.quote);
    expect(c.migrationQuoteThreshold).toBe(82842712474n);
    expect(c.migrationSqrtPrice).toBe(583337266871351588n);
    expect(c.sqrtStartPrice).toBe(412481742297696715n);
    const r = decodeCurveConfig(fx('rehearsal-config', DBC_PROGRAM));
    expect(r.quoteMint.toBase58()).toBe(REHEARSAL.quote);
    expect(r.migrationQuoteThreshold).toBe(12426406871n);
    expect(r.tokenDecimal).toBe(9);
    expect(r.migrationFeeOption).toBe(6); // Customizable, as scripts/launch.ts sets it

    const open = decodeCurvePool(fx('rehearsal-pool', DBC_PROGRAM));
    expect(open.config.toBase58()).toBe(REHEARSAL.config);
    expect(open.baseMint.toBase58()).toBe(REHEARSAL.mint);
    expect(open.quoteReserve).toBe(265775000n);
    expect(open.migrationProgress).toBe(0);
    const done = decodeCurvePool(fx('spike-pool', DBC_PROGRAM));
    expect(done.quoteReserve).toBe(82842712475n);
    expect(done.migrationProgress).toBe(3);

    const d = decodeDammPool(fx('spike-damm', DAMM_V2_PROGRAM));
    expect(d.tokenAMint.toBase58()).toBe(SPIKE.mint);
    expect(d.tokenBMint.toBase58()).toBe(SPIKE.quote);
    expect(d.liquidity).toBe(48228591347497607805920847317502n);
    expect(d.permanentLockLiquidity).toBe(48228591347497607805920847317502n);
    // after an outside holder added liquidity the two differ, which tells the offsets apart
    const o = decodeDammPool(fx('rehearsal-damm', DAMM_V2_PROGRAM));
    expect(o.liquidity).toBe(20564779103905602448793110232437n);
    expect(o.permanentLockLiquidity).toBe(20461658669624444139292109533653n);
    expect(o.tokenAAmount).toBe(99712434529881n);
    expect(o.tokenBAmount).toBe(12464054057n);
  });

  it('prices match the SDK and the published launch rules', () => {
    expect(priceFromSqrt(412481742297696715n)).toBeCloseTo(0.500000013, 8); // SDK getPriceFromSqrtPrice
    expect(priceFromSqrt(583337266871351588n)).toBeCloseTo(1.0, 8);
    const r = decodeCurveConfig(fx('rehearsal-config', DBC_PROGRAM));
    expect(priceFromSqrt(r.sqrtStartPrice)).toBeCloseTo(LAUNCH.startPrice, 7);
    expect(priceFromSqrt(r.migrationSqrtPrice)).toBeCloseTo(LAUNCH.migrationPrice, 7);
  });

  it('derives the graduated pool address the chain actually used', () => {
    expect(dammPoolFor(6, new PublicKey(SPIKE.mint), new PublicKey(SPIKE.quote)).toBase58()).toBe(SPIKE.damm);
    expect(dammPoolFor(6, new PublicKey(REHEARSAL.mint), new PublicKey(REHEARSAL.quote)).toBase58()).toBe(REHEARSAL.damm);
    expect(() => dammPoolFor(7, new PublicKey(SPIKE.mint), new PublicKey(SPIKE.quote))).toThrow(/unknown migration fee option/);
  });

  it('derives the same address as the SDK for every migration fee option and either mint order', () => {
    expect(DAMM_V2_MIGRATION_FEE_ADDRESS).toHaveLength(7);
    const mints = [SPIKE.mint, SPIKE.quote, REHEARSAL.mint, REHEARSAL.quote].map((m) => new PublicKey(m));
    for (let option = 0; option < 7; option++) {
      for (const a of mints) for (const b of mints) {
        if (a.equals(b)) continue;
        expect(dammPoolFor(option, a, b).toBase58(), `option ${option}`)
          .toBe(deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[option], a, b).toBase58());
      }
    }
  });

  it('fails closed on anything that is not the expected account', () => {
    const pool = fx('spike-pool', DBC_PROGRAM);
    expect(() => decodeCurvePool(null)).toThrow(/not found/);
    expect(() => decodeCurvePool({ ...pool, owner: DAMM_V2_PROGRAM })).toThrow(/unexpected owner/);
    expect(() => decodeCurvePool({ ...pool, data: pool.data.subarray(0, 400) })).toThrow(/layout/);
    expect(() => decodeCurvePool(fx('spike-config', DBC_PROGRAM))).toThrow(/layout/); // another account type
    expect(() => decodeCurveConfig(pool)).toThrow(/layout/);
    expect(() => decodeDammPool(pool)).toThrow(/unexpected owner/);
    const bad = Buffer.from(pool.data); bad[0] ^= 1;
    expect(() => decodeCurvePool({ ...pool, data: bad })).toThrow(/layout/);
  });
});

/** A Connection that serves fixtures by address. */
function fakeConn(accounts: Record<string, { owner: PublicKey; data: Buffer }>): Connection {
  return { getAccountInfo: async (k: PublicKey) => accounts[k.toBase58()] ?? null } as unknown as Connection;
}
const cfgOf = (pool: string): LaunchConfig => ({ curvePool: new PublicKey(pool) });
/** A real fixture with one byte or key overwritten at an IDL-pinned offset. */
function edited(f: { owner: PublicKey; data: Buffer }, at: number, value: Buffer | number) {
  const data = Buffer.from(f.data);
  if (typeof value === 'number') data[at] = value; else value.copy(data, at);
  return { ...f, data };
}
const graduated = () => ({
  [REHEARSAL.pool]: fx('rehearsal-pool-graduated', DBC_PROGRAM),
  [REHEARSAL.config]: fx('rehearsal-config', DBC_PROGRAM),
  [REHEARSAL.damm]: fx('rehearsal-damm', DAMM_V2_PROGRAM),
});

describe('readLaunch', () => {
  it('reports an open curve', async () => {
    const v = await readLaunch(fakeConn({
      [REHEARSAL.pool]: fx('rehearsal-pool', DBC_PROGRAM),
      [REHEARSAL.config]: fx('rehearsal-config', DBC_PROGRAM),
    }), cfgOf(REHEARSAL.pool));
    expect(v.phase).toBe('curve');
    expect(v.raised).toBe('265775000');
    expect(v.threshold).toBe('12426406871');
    expect(v.startPrice).toBeCloseTo(0.0625, 7);
    expect(v.migrationPrice).toBeCloseTo(0.125, 7);
    expect(v.price).toBeGreaterThan(v.startPrice);
    expect(v.price).toBeLessThan(v.migrationPrice);
    expect(v.pool).toBeUndefined();
    expect(v.addresses).toEqual({ mint: REHEARSAL.mint, quoteMint: REHEARSAL.quote, curve: REHEARSAL.pool, pool: REHEARSAL.damm });
  });

  it('reports a graduated pool: reserves, and the locked share once others add liquidity', async () => {
    const v = await readLaunch(fakeConn(graduated()), cfgOf(REHEARSAL.pool));
    expect(v.phase).toBe('pool');
    // 20461658669624444139292109533653 locked of 20564779103905602448793110232437 total = 99.4985%
    expect(v.pool).toEqual({ alpha: '99712434529881', quote: '12464054057', lockedBps: 9949 });
    expect(v.raised).toBe('12426406872');
    expect(v.price).toBeCloseTo(0.125, 4); // the pool price, read from the DAMM pool
    const all = await readLaunch(fakeConn({
      [SPIKE.pool]: fx('spike-pool', DBC_PROGRAM), [SPIKE.config]: fx('spike-config', DBC_PROGRAM),
      [SPIKE.damm]: fx('spike-damm', DAMM_V2_PROGRAM),
    }), cfgOf(SPIKE.pool));
    expect(all.pool!.lockedBps).toBe(10_000);
  });

  it('a completed curve that has not migrated yet is "graduating"', async () => {
    for (const progress of [1, 2]) {
      const v = await readLaunch(fakeConn({
        ...graduated(),
        [REHEARSAL.pool]: edited(fx('rehearsal-pool-graduated', DBC_PROGRAM), LAYOUT.curvePool.migrationProgress, progress),
      }), cfgOf(REHEARSAL.pool));
      expect(v.phase).toBe('graduating');
      expect(v.pool).toBeUndefined();
    }
  });

  it('refuses a pool at the derived address that pairs other mints, on either side', async () => {
    const other = new PublicKey(SPIKE.mint).toBuffer();
    for (const at of [LAYOUT.dammPool.tokenAMint, LAYOUT.dammPool.tokenBMint]) {
      const conn = fakeConn({ ...graduated(), [REHEARSAL.damm]: edited(fx('rehearsal-damm', DAMM_V2_PROGRAM), at, other) });
      await expect(readLaunch(conn, cfgOf(REHEARSAL.pool))).rejects.toThrow(/does not pair/);
    }
  });

  it('refuses a launch whose token is not 9-decimal, and a missing graduated pool', async () => {
    const six = fakeConn({ ...graduated(), [REHEARSAL.config]: edited(fx('rehearsal-config', DBC_PROGRAM), LAYOUT.curveConfig.tokenDecimal, 6) });
    await expect(readLaunch(six, cfgOf(REHEARSAL.pool))).rejects.toThrow(/9-decimal/);
    const { [REHEARSAL.damm]: _gone, ...rest } = graduated();
    await expect(readLaunch(fakeConn(rest), cfgOf(REHEARSAL.pool))).rejects.toThrow(/not found/);
  });
});

describe('the reader the server runs', () => {
  // A local JSON-RPC endpoint, so the real Connection (abort signal, no rate-limit
  // retries) is what gets exercised. `mode` decides how it answers.
  const PROGRAM = new PublicKey('FFNwC5HX9jzjnNrLiUkJ3y6uovVCGCpms5jo9R2Yn9o1');
  const STATE = PublicKey.findProgramAddressSync([Buffer.from('settlement')], PROGRAM)[0].toBase58();
  /** A settlement state account naming `mint` (layout: programs/settlement, parsed by chain/adapter). */
  const stateWith = (mint: string) => {
    const data = Buffer.alloc(8 + 32 + 1 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1);
    new PublicKey(mint).toBuffer().copy(data, 8 + 32 + 1 + 32);
    return { owner: PROGRAM, data };
  };
  async function rpcServer(accounts: Record<string, { owner: PublicKey; data: Buffer }>, mode: 'ok' | 'hang' | '429' = 'ok') {
    const s = { hits: 0, url: '', close: async () => {} };
    const server = createServer((req, res) => {
      s.hits++;
      if (mode === 'hang') return; // accept, never answer
      if (mode === '429') { res.writeHead(429).end('Too Many Requests'); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { id, params } = JSON.parse(body);
        const acc = accounts[params[0]];
        const value = acc ? { data: [acc.data.toString('base64'), 'base64'], executable: false, lamports: 1, owner: acc.owner.toBase58(), rentEpoch: 0 } : null;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    s.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    s.close = async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); };
    return s;
  }
  // chain id 0: the fixture state carries zeros where the program writes chain id, cap and clocks
  const ctxFor = (url: string) => ({ chain: { rpcUrl: url, programId: PROGRAM, chainId: 0 } } as unknown as Ctx);
  const open = {
    [REHEARSAL.pool]: fx('rehearsal-pool', DBC_PROGRAM),
    [REHEARSAL.config]: fx('rehearsal-config', DBC_PROGRAM),
  };

  it('serves the launch of the settlement mint', async () => {
    const rpc = await rpcServer({ ...open, [STATE]: stateWith(REHEARSAL.mint) });
    try {
      const read = gameLaunchReader(ctxFor(rpc.url));
      const v = await read(cfgOf(REHEARSAL.pool));
      expect(v.phase).toBe('curve');
      expect(v.addresses.mint).toBe(REHEARSAL.mint);
      await read(cfgOf(REHEARSAL.pool));
      expect(rpc.hits).toBe(5); // pool + config + state, then pool + config: the mint is read once
    } finally { await rpc.close(); }
  });

  it('refuses a launch of any other token: the game would not accept its deposits', async () => {
    const rpc = await rpcServer({ ...open, [STATE]: stateWith(SPIKE.mint) });
    try {
      await expect(gameLaunchReader(ctxFor(rpc.url))(cfgOf(REHEARSAL.pool))).rejects.toThrow(/not the settlement mint/);
    } finally { await rpc.close(); }
  });

  it('refuses a state someone else initialized, like the money paths do', async () => {
    const rpc = await rpcServer({ ...open, [STATE]: stateWith(REHEARSAL.mint) });
    try {
      const ctx = { chain: { rpcUrl: rpc.url, programId: PROGRAM, chainId: 0, admin: Keypair.generate().publicKey } } as unknown as Ctx;
      await expect(gameLaunchReader(ctx)(cfgOf(REHEARSAL.pool))).rejects.toThrow(/not this deployment's.*admin/);
    } finally { await rpc.close(); }
  });

  it('refuses while settlement is not initialized', async () => {
    const rpc = await rpcServer(open);
    try {
      await expect(gameLaunchReader(ctxFor(rpc.url))(cfgOf(REHEARSAL.pool))).rejects.toThrow(/no token yet/);
    } finally { await rpc.close(); }
  });

  it('a hung RPC ends the whole read at the timeout, and nothing is left running', async () => {
    const rpc = await rpcServer({}, 'hang');
    try {
      const t0 = Date.now();
      await expect(gameLaunchReader(ctxFor(rpc.url), readLaunch, 300)(cfgOf(REHEARSAL.pool))).rejects.toThrow();
      expect(Date.now() - t0).toBeLessThan(2_000);
      expect(rpc.hits).toBe(1);
    } finally { await rpc.close(); }
  });

  it('reads a graduated launch through the real connection: pool, config, graduated pool, state', async () => {
    const rpc = await rpcServer({ ...graduated(), [STATE]: stateWith(REHEARSAL.mint) });
    try {
      const v = await gameLaunchReader(ctxFor(rpc.url))(cfgOf(REHEARSAL.pool));
      expect(v.phase).toBe('pool');
      expect(v.pool!.lockedBps).toBe(9949);
      expect(rpc.hits).toBe(4);
    } finally { await rpc.close(); }
  });

  it('settlement appearing later is picked up; a refusal is not remembered', async () => {
    const accounts: Record<string, { owner: PublicKey; data: Buffer }> = { ...open };
    const rpc = await rpcServer(accounts);
    try {
      const read = gameLaunchReader(ctxFor(rpc.url));
      await expect(read(cfgOf(REHEARSAL.pool))).rejects.toThrow(/no token yet/);
      accounts[STATE] = { owner: DBC_PROGRAM, data: stateWith(REHEARSAL.mint).data }; // lamports or a foreign account there is not a state
      await expect(read(cfgOf(REHEARSAL.pool))).rejects.toThrow(/no token yet/);
      accounts[STATE] = stateWith(REHEARSAL.mint);
      expect((await read(cfgOf(REHEARSAL.pool))).addresses.mint).toBe(REHEARSAL.mint);
    } finally { await rpc.close(); }
  });

  it('each read keeps its own deadline when two overlap', async () => {
    const rpc = await rpcServer({}, 'hang');
    try {
      const read = gameLaunchReader(ctxFor(rpc.url), readLaunch, 300);
      const t0 = Date.now();
      const a = read(cfgOf(REHEARSAL.pool)).catch(() => Date.now() - t0);
      await new Promise((r) => setTimeout(r, 200));
      const b = read(cfgOf(REHEARSAL.pool)).catch(() => Date.now() - t0);
      expect(await a).toBeLessThan(450); // not extended by the later read
      expect(await b).toBeGreaterThanOrEqual(480);
    } finally { await rpc.close(); }
  });

  it('a rate-limited RPC is not retried inside one read', async () => {
    const rpc = await rpcServer({}, '429');
    try {
      await expect(gameLaunchReader(ctxFor(rpc.url))(cfgOf(REHEARSAL.pool))).rejects.toThrow();
      expect(rpc.hits).toBe(1);
    } finally { await rpc.close(); }
  });
});

describe('GET /api/launch', () => {
  afterEach(() => { vi.useRealTimers(); });
  const WINDOW = 30_000;
  const view = (asOf: number) => ({ asOf, phase: 'curve' } as LaunchView);
  function server(launch: LaunchConfig | null, read: () => Promise<LaunchView>, chain: unknown = { rpcUrl: 'http://unused.invalid' }) {
    const app = Fastify();
    const ctx = { chain, launch, rl: { public: { rateLimit: { max: 60, timeWindow: 60_000 } } } } as unknown as Ctx;
    const s = { app, reads: 0, t: 0 };
    registerLaunchRoutes(app, ctx, () => { s.reads++; return read(); }, () => s.t);
    return s;
  }
  const get = async (app: ReturnType<typeof Fastify>) => {
    const body = (await app.inject({ method: 'GET', url: '/api/launch' })).json();
    return { launch: body.launch };
  };
  const cfg = cfgOf(SPIKE.pool);

  it('names the cluster next to the view', async () => {
    const s = server(cfg, async () => view(1), { rpcUrl: 'http://unused.invalid', chainId: 1 });
    expect((await s.app.inject({ method: 'GET', url: '/api/launch' })).json()).toEqual({ launch: view(1), chainId: 1 });
    const off = server(cfg, async () => view(1), null);
    expect((await off.app.inject({ method: 'GET', url: '/api/launch' })).json()).toEqual({ launch: null, chainId: null });
  });

  it('answers null and reads nothing without a configured launch, or without a chain', async () => {
    const a = server(null, async () => view(1));
    expect(await get(a.app)).toEqual({ launch: null });
    const b = server(cfg, async () => view(1), null);
    expect(await get(b.app)).toEqual({ launch: null });
    expect(a.reads + b.reads).toBe(0);
  });

  it('reads upstream once per window, however many requests arrive', async () => {
    const s = server(cfg, async () => view(1));
    for (const r of await Promise.all([get(s.app), get(s.app), get(s.app)])) expect(r).toEqual({ launch: view(1) });
    s.t = WINDOW - 1;
    expect(await get(s.app)).toEqual({ launch: view(1) });
    expect(s.reads).toBe(1);
    s.t = WINDOW;
    await get(s.app);
    expect(s.reads).toBe(2);
  });

  it('a failing upstream answers null and is not retried inside the window', async () => {
    const s = server(cfg, async () => { throw new Error('rpc down'); });
    expect(await get(s.app)).toEqual({ launch: null });
    expect(await get(s.app)).toEqual({ launch: null });
    expect(s.reads).toBe(1);
  });

  it('keeps serving the last good view when a later read fails', async () => {
    let n = 0;
    const s = server(cfg, async () => { if (n++ === 0) return view(1); throw new Error('rpc down'); });
    expect(await get(s.app)).toEqual({ launch: view(1) });
    s.t = WINDOW;
    expect(await get(s.app)).toEqual({ launch: view(1) });
    expect(s.reads).toBe(2);
  });

  it('never makes a request wait on a hung upstream once it has a view, and never stacks reads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let n = 0;
    const s = server(cfg, () => (n++ === 0 ? Promise.resolve(view(1)) : new Promise<LaunchView>(() => {})));
    expect(await get(s.app)).toEqual({ launch: view(1) });
    s.t = WINDOW;
    expect(await get(s.app)).toEqual({ launch: view(1) }); // answered at once; the hung read is in flight
    s.t = 2 * WINDOW;
    expect(await get(s.app)).toEqual({ launch: view(1) });
    expect(s.reads).toBe(2); // the pending read blocks a third
  });

  it('a first read that hangs is cut off by the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = server(cfg, () => new Promise<LaunchView>(() => {}));
    const pending = get(s.app);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toEqual({ launch: null });
  });

  it('a slow read that lost to the timeout cannot overwrite a newer view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let release!: (v: LaunchView) => void;
    let n = 0;
    const s = server(cfg, () => (n++ === 0 ? new Promise<LaunchView>((r) => { release = r; }) : Promise.resolve(view(2))));
    const first = get(s.app);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await first).toEqual({ launch: null });
    s.t = WINDOW;
    expect(await get(s.app)).toEqual({ launch: view(2) });
    release(view(1)); // the old read finally resolves
    await vi.advanceTimersByTimeAsync(0);
    expect(await get(s.app)).toEqual({ launch: view(2) });
  });

  it('withdraws a view that has gone ten minutes without a successful read', async () => {
    let n = 0;
    const s = server(cfg, async () => { if (n++ === 0) return view(1); throw new Error('rpc down'); });
    expect(await get(s.app)).toEqual({ launch: view(1) });
    s.t = 10 * 60_000;
    expect(await get(s.app)).toEqual({ launch: view(1) });
    s.t = 10 * 60_000 + 1;
    expect(await get(s.app)).toEqual({ launch: null });
  });
});
