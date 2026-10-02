/**
 * Read-only view of the $ALPHA launch on Meteora (docs/LAUNCH.md): the bonding-curve
 * pool while it is open, the graduated DAMM v2 pool afterwards. Public chain data only;
 * nothing here moves value or touches the ledger.
 *
 * The accounts are decoded by field offset from the raw bytes. The Meteora SDK is a
 * scripts-only dev dependency and never loads in this process, which holds the voucher
 * key (test/launch-guard.test.ts). test/launch.test.ts pins every offset against the
 * programs' IDLs and against real devnet accounts. Fail closed: a wrong owner,
 * discriminator, length, decimals, or a launch whose mint is not the game's own token
 * throws, and the route answers "no view" rather than a wrong one.
 */
import type { FastifyInstance } from 'fastify';
import { Connection, PublicKey, type AccountInfo } from '@solana/web3.js';
import type { LaunchView } from '@outfox/shared';
import { ALPHA_DECIMALS } from '@outfox/shared';
import type { Ctx } from '../core/ctx.js';
import { parseSettlementState, statePda } from './adapter.js';

export const DBC_PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
export const DAMM_V2_PROGRAM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
const QUOTE_DECIMALS = 6; // USDC

/**
 * DAMM v2 configs a DBC launch can graduate into, indexed by the launch config's
 * migration fee option (0..5 fixed fee tiers, 6 customizable). The graduated pool's
 * address is a PDA of one of these and the two mints, so it is derived here, never
 * configured: a pool that merely pairs the same mints is not this launch's pool.
 */
const DAMM_MIGRATION_CONFIGS = [
  '7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd', '2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k',
  'Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp', '2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq',
  'AkmQWebAwFvWk55wBoCr5D62C6VVDTzi84NJuD9H7cFD', 'DbCRBj8McvPYHJG1ukj8RE15h2dCNUdTAESG49XpQ44u',
  'A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck',
].map((a) => new PublicKey(a));

/** Account shapes: Anchor discriminator (first 8 bytes), size, and the field offsets read. */
export const LAYOUT = {
  curveConfig: {
    disc: '1a6c0e7b74e6812b', len: 1048,
    quoteMint: 8, tokenDecimal: 235, migrationFeeOption: 243,
    migrationQuoteThreshold: 264, migrationSqrtPrice: 280, sqrtStartPrice: 392,
  },
  // VirtualPool wraps one pool_state struct at offset 8; these are absolute offsets
  curvePool: {
    disc: 'd5e005d16245775c', len: 424,
    config: 72, baseMint: 136, quoteReserve: 240, sqrtPrice: 280, migrationProgress: 308,
  },
  dammPool: {
    disc: 'f19a6d0411b16dbc', len: 1112,
    tokenAMint: 168, tokenBMint: 200, liquidity: 360, sqrtPrice: 456,
    permanentLockLiquidity: 552, tokenAAmount: 680, tokenBAmount: 688,
  },
} as const;

export interface LaunchConfig {
  /** The Dynamic Bonding Curve pool created by scripts/launch.ts. */
  curvePool: PublicKey;
}

/** A malformed address disables the view; it must not take the game server down. */
export function launchConfigFromEnv(): LaunchConfig | null {
  const { OUTFOX_LAUNCH_POOL } = process.env;
  if (!OUTFOX_LAUNCH_POOL) return null;
  try {
    return { curvePool: new PublicKey(OUTFOX_LAUNCH_POOL) };
  } catch {
    console.warn('[launch] OUTFOX_LAUNCH_POOL is not a valid address; the launch view is off');
    return null;
  }
}

type Raw = Pick<AccountInfo<Buffer>, 'data' | 'owner'>;

function expect(acc: Raw | null, owner: PublicKey, shape: { disc: string; len: number }, what: string): Buffer {
  if (!acc) throw new Error(`${what}: account not found`);
  if (!acc.owner.equals(owner)) throw new Error(`${what}: unexpected owner ${acc.owner.toBase58()}`);
  if (acc.data.length !== shape.len || acc.data.subarray(0, 8).toString('hex') !== shape.disc) {
    throw new Error(`${what}: unexpected account layout`);
  }
  return acc.data;
}
const pk = (d: Buffer, o: number) => new PublicKey(d.subarray(o, o + 32));
const u64 = (d: Buffer, o: number) => d.readBigUInt64LE(o);
const u128 = (d: Buffer, o: number) => d.readBigUInt64LE(o) | (d.readBigUInt64LE(o + 8) << 64n);

/** USDC per whole ALPHA from a Q64.64 sqrt price. */
export function priceFromSqrt(sqrtPrice: bigint): number {
  const s = Number(sqrtPrice) / 2 ** 64;
  return s * s * 10 ** (ALPHA_DECIMALS - QUOTE_DECIMALS);
}

export function decodeCurveConfig(acc: Raw | null) {
  const L = LAYOUT.curveConfig;
  const d = expect(acc, DBC_PROGRAM, L, 'launch config');
  return {
    quoteMint: pk(d, L.quoteMint),
    tokenDecimal: d[L.tokenDecimal],
    migrationFeeOption: d[L.migrationFeeOption],
    migrationQuoteThreshold: u64(d, L.migrationQuoteThreshold),
    migrationSqrtPrice: u128(d, L.migrationSqrtPrice),
    sqrtStartPrice: u128(d, L.sqrtStartPrice),
  };
}

export function decodeCurvePool(acc: Raw | null) {
  const L = LAYOUT.curvePool;
  const d = expect(acc, DBC_PROGRAM, L, 'launch curve pool');
  return {
    config: pk(d, L.config),
    baseMint: pk(d, L.baseMint),
    quoteReserve: u64(d, L.quoteReserve),
    sqrtPrice: u128(d, L.sqrtPrice),
    /** 0 curve open · 1 complete · 2 locker ready · 3 graduated (DAMM v2 pool created) */
    migrationProgress: d[L.migrationProgress],
  };
}

export function decodeDammPool(acc: Raw | null) {
  const L = LAYOUT.dammPool;
  const d = expect(acc, DAMM_V2_PROGRAM, L, 'launch DAMM v2 pool');
  return {
    tokenAMint: pk(d, L.tokenAMint),
    tokenBMint: pk(d, L.tokenBMint),
    liquidity: u128(d, L.liquidity),
    sqrtPrice: u128(d, L.sqrtPrice),
    permanentLockLiquidity: u128(d, L.permanentLockLiquidity),
    /** The pool's own reserve accounting (excludes fees waiting to be claimed). */
    tokenAAmount: u64(d, L.tokenAAmount),
    tokenBAmount: u64(d, L.tokenBAmount),
  };
}

/** The DAMM v2 pool a launch graduates into: PDA of ["pool", config, larger mint, smaller mint]. */
export function dammPoolFor(migrationFeeOption: number, baseMint: PublicKey, quoteMint: PublicKey): PublicKey {
  const config = DAMM_MIGRATION_CONFIGS[migrationFeeOption];
  if (!config) throw new Error(`launch config: unknown migration fee option ${migrationFeeOption}`);
  const [a, b] = [baseMint.toBuffer(), quoteMint.toBuffer()];
  const [first, second] = Buffer.compare(a, b) > 0 ? [a, b] : [b, a];
  return PublicKey.findProgramAddressSync([Buffer.from('pool'), config.toBuffer(), first, second], DAMM_V2_PROGRAM)[0];
}

export async function readLaunch(conn: Connection, cfg: LaunchConfig): Promise<LaunchView> {
  const curve = decodeCurvePool(await conn.getAccountInfo(cfg.curvePool, 'confirmed'));
  const config = decodeCurveConfig(await conn.getAccountInfo(curve.config, 'confirmed'));
  if (config.tokenDecimal !== ALPHA_DECIMALS) throw new Error('launch config: the launched token is not 9-decimal');
  const dammPool = dammPoolFor(config.migrationFeeOption, curve.baseMint, config.quoteMint);
  const view: LaunchView = {
    asOf: Date.now(),
    phase: curve.migrationProgress === 0 ? 'curve' : curve.migrationProgress === 3 ? 'pool' : 'graduating',
    price: priceFromSqrt(curve.sqrtPrice),
    startPrice: priceFromSqrt(config.sqrtStartPrice),
    migrationPrice: priceFromSqrt(config.migrationSqrtPrice),
    raised: curve.quoteReserve.toString(),
    threshold: config.migrationQuoteThreshold.toString(),
    addresses: {
      mint: curve.baseMint.toBase58(), quoteMint: config.quoteMint.toBase58(),
      curve: cfg.curvePool.toBase58(), pool: dammPool.toBase58(),
    },
  };
  if (view.phase !== 'pool') return view;

  const damm = decodeDammPool(await conn.getAccountInfo(dammPool, 'confirmed'));
  if (!damm.tokenAMint.equals(curve.baseMint) || !damm.tokenBMint.equals(config.quoteMint)) {
    throw new Error('launch DAMM v2 pool does not pair the launch mint with its quote mint');
  }
  view.price = priceFromSqrt(damm.sqrtPrice);
  view.pool = {
    alpha: damm.tokenAAmount.toString(),
    quote: damm.tokenBAmount.toString(),
    lockedBps: damm.liquidity === 0n ? 0 : Number(damm.permanentLockLiquidity * 10_000n / damm.liquidity),
  };
  return view;
}

const CACHE_MS = 30_000; // one upstream read per window, success or not
const READ_TIMEOUT_MS = 8_000; // a hung RPC never holds a request longer than this
const MAX_AGE_MS = 10 * 60_000; // a view older than this is withdrawn, not served

/**
 * The reader the server runs: one read is bounded as a whole, and it is only ever the
 * view of the game's own token. Every HTTP request of a read shares one abort signal that
 * fires READ_TIMEOUT_MS after the read began, and rate-limit retries are off, so a read
 * that the route gave up on is really over and can never run beside the next one.
 */
export function gameLaunchReader(
  ctx: Ctx, readView: typeof readLaunch = readLaunch, timeoutMs = READ_TIMEOUT_MS,
): (cfg: LaunchConfig) => Promise<LaunchView> {
  let conn: Connection | null = null;
  let signal: AbortSignal;
  let settlementMint: string | null = null; // set at initialize, fixed for the process lifetime
  return async (cfg) => {
    const chain = ctx.chain!;
    signal = AbortSignal.timeout(timeoutMs);
    conn ??= new Connection(chain.rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      fetch: (input, init) => fetch(input, { ...init, signal }),
    });
    const view = await readView(conn, cfg);
    // the mint the Clearinghouse accepts is the settlement state's; a launch of any
    // other token must never be shown as the $ALPHA market
    if (!settlementMint) {
      const state = await conn.getAccountInfo(statePda(chain), 'confirmed');
      if (!state) throw new Error('settlement state account not found: the game has no token yet');
      settlementMint = parseSettlementState(state.data).alphaMint.toBase58();
    }
    if (settlementMint !== view.addresses.mint) {
      throw new Error('the configured launch pool is not the settlement mint\'s launch');
    }
    return view;
  };
}

/**
 * GET /api/launch is public, no session: the same numbers anyone can read from the chain.
 * At most one upstream read per CACHE_MS and never two at once. A request waits for the
 * upstream only when there is no view yet, and then at most READ_TIMEOUT_MS; otherwise
 * the last good view is served at once (its `asOf` says how old it is) until it passes
 * MAX_AGE_MS. `launch: null` means not configured, never read, or too stale to show.
 */
export function registerLaunchRoutes(
  app: FastifyInstance, ctx: Ctx,
  read: (cfg: LaunchConfig) => Promise<LaunchView> = gameLaunchReader(ctx),
  now: () => number = () => performance.now(), // monotonic: a wall-clock step cannot stall refresh
): void {
  let view: LaunchView | null = null;
  let viewAt = 0;
  let lastTry = -Infinity;
  let inflight: Promise<void> | null = null;
  app.get('/api/launch', { config: ctx.rl.public }, async () => {
    const cfg = ctx.launch;
    if (!cfg || !ctx.chain) return { launch: null };
    if (!inflight && now() - lastTry >= CACHE_MS) {
      lastTry = now();
      let timer: NodeJS.Timeout;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('launch view read timed out')), READ_TIMEOUT_MS);
      });
      inflight = Promise.race([Promise.resolve().then(() => read(cfg)), timeout])
        .then((v) => { view = v; viewAt = now(); })
        .catch((e) => { app.log.warn({ err: String(e) }, 'launch view read failed'); })
        .finally(() => { clearTimeout(timer); inflight = null; });
    }
    if (!view && inflight) await inflight;
    if (view && now() - viewAt > MAX_AGE_MS) view = null;
    return { launch: view };
  });
}
