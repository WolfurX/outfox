/**
 * Launch: the $ALPHA mint and its market, created through Meteora (docs/LAUNCH.md).
 *
 * One Dynamic Bonding Curve pool creates the mint with the FIXED 2,000,000 supply and no
 * mint authority, sells a small share along a gentle curve against USDC, and at the
 * threshold graduates into a DAMM v2 pool where that liquidity is permanently locked. The
 * treasury receives the rest of the supply once that pool exists. The on-chain config is
 * built from the published rules in `@outfox/shared` (LAUNCH); `verify` reads the chain
 * back and fails on any difference.
 *
 * For a launch through Meteora this takes the place of the mint half of scripts/genesis.ts
 * (create mint, mint supply, revoke); settlement is then initialized with this mint by
 * `GENESIS_MINT=<mint> scripts/genesis.ts`, which checks the mint before it binds to it.
 * Devnet or a local validator; mainnet only behind the launch gates. The server process
 * never imports the Meteora SDK (test/launch-guard.test.ts); only these scripts do.
 *
 *   OUTFOX_RPC_URL=…  OUTFOX_CHAIN_ID=0|1|2   (2 must be mainnet and only mainnet; checked against the genesis hash)
 *   LAUNCH_PAYER=<keypair.json>      fee payer and pool creator: no fee share, no liquidity. If it
 *                                    runs `complete`, it holds the $ALPHA that purchase bought.
 *   LAUNCH_TREASURY=<pubkey | keypair.json>   fee claimer, leftover receiver, owner of the locked
 *                                    position. A public key is enough for everything except `claim`,
 *                                    so a cold or multisig treasury never has to be on this machine.
 *   LAUNCH_QUOTE_MINT=<pubkey>       USDC; on devnet a stand-in made by `quote`
 *   LAUNCH_URI=<url>                 token metadata JSON, frozen at creation
 *   LAUNCH_DIR=<dir>                 config + mint keypairs and launch.json (default: beside the payer key)
 *   OUTFOX_PROGRAM_ID=<pubkey>       optional off mainnet: `create` refuses when that settlement is
 *                                    already initialized (the game already has its token)
 *   LAUNCH_MAINNET_GATES=audit-and-counsel-passed   required for `create` on mainnet
 *
 *   npx tsx scripts/launch.ts quote                      (not on mainnet) create the stand-in quote mint
 *   npx tsx scripts/launch.ts fund <pubkey> <amount>     (not on mainnet) mint stand-in quote to a wallet
 *   npx tsx scripts/launch.ts create                     config + pool: creates the mint, opens the curve
 *   npx tsx scripts/launch.ts status
 *   npx tsx scripts/launch.ts buy <keypair.json> <quote> | sell <keypair.json> <alpha>   (not on mainnet)
 *   npx tsx scripts/launch.ts complete                   the payer buys whatever the curve still needs
 *   npx tsx scripts/launch.ts migrate                    graduate to DAMM v2, send the leftover to the treasury
 *   npx tsx scripts/launch.ts claim                      treasury claims its curve trading fees
 *   npx tsx scripts/launch.ts verify                     chain state against the published rules; exit 1 on a break
 *
 * `launch.json` is this machine's memory of the launch, not the chain's: a second
 * `create` from an empty LAUNCH_DIR makes a second, unofficial mint. The official mint is
 * the one settlement is initialized with.
 */
import {
  ActivationType, BaseFeeMode, buildCurveWithMarketCap, CollectFeeMode, createDammV2Program,
  DAMM_V2_MIGRATION_FEE_ADDRESS, DammV2DynamicFeeMode, deriveDammV2PoolAddress, deriveDbcPoolAddress,
  deriveMintMetadata, derivePositionAddress, derivePositionNftAccount, DynamicBondingCurveClient,
  getCurrentPoint, MigratedCollectFeeMode, MigrationFeeOption, MigrationOption, SwapMode,
  TokenAuthorityOption, TokenDecimal, TokenType,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {
  createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction,
  createMintToInstruction, getAccount, getAssociatedTokenAddressSync, getMint, MINT_SIZE,
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, type Signer } from '@solana/web3.js';
import BN from 'bn.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ALPHA_BASE_UNITS, ALPHA_DECIMALS, LAUNCH } from '@outfox/shared';

const QUOTE_DECIMALS = 6;
const U64_MAX = new BN('18446744073709551615');
const DAMM_V2_PROGRAM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
const DBC_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_NAME = 'Outfox Alpha';
const TOKEN_SYMBOL = 'ALPHA';

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k}`);
  return v;
};
const loadKp = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Public RPCs rate-limit; retry transport failures with backoff, never a program error. */
async function rpc<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0, delay = 800; ; i++, delay = Math.min(delay * 2, 15_000)) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const transport = /\b429\b|Too Many Requests|\b50[234] (Bad Gateway|Service Unavailable|Gateway Timeout)|timeout|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i;
      if (i >= 7 || !transport.test(msg) || /custom program error|Transaction simulation failed/i.test(msg)) throw e;
      await sleep(delay);
    }
  }
}

const CHAIN_ID = Number(env('OUTFOX_CHAIN_ID'));
const conn = new Connection(env('OUTFOX_RPC_URL'), { commitment: 'confirmed', disableRetryOnRateLimit: true });
// The cluster is what the RPC says it is, not what the env says: chain id 2 and the
// mainnet genesis hash must agree, or nothing runs.
const MAINNET = (await rpc(() => conn.getGenesisHash())) === MAINNET_GENESIS;
if (![0, 1, 2].includes(CHAIN_ID) || (CHAIN_ID === 2) !== MAINNET) {
  throw new Error(`OUTFOX_CHAIN_ID=${process.env.OUTFOX_CHAIN_ID} does not match the cluster behind OUTFOX_RPC_URL (mainnet: ${MAINNET})`);
}
const client = DynamicBondingCurveClient.create(conn, 'confirmed');
const PAYER = loadKp(env('LAUNCH_PAYER'));
const treasuryArg = env('LAUNCH_TREASURY');
const TREASURY_SIGNER = existsSync(treasuryArg) ? loadKp(treasuryArg) : null;
const TREASURY = TREASURY_SIGNER?.publicKey ?? new PublicKey(treasuryArg);
if (TREASURY.equals(PAYER.publicKey)) throw new Error('the treasury must not be the payer');
const DIR = process.env.LAUNCH_DIR ?? dirname(env('LAUNCH_PAYER'));
const RECORD = join(DIR, 'launch.json');

type Rec = { addresses: Record<string, string>; txs: { step: string; sig: string }[] };
const rec: Rec = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : { addresses: {}, txs: [] };
const save = () => writeFileSync(RECORD, JSON.stringify(rec, null, 2) + '\n');

/** A keypair that must exist exactly once per launch (config, mint): generated on first use. */
function launchKey(name: string): Keypair {
  const p = join(DIR, `launch-${name}.json`);
  if (existsSync(p)) return loadKp(p);
  const kp = Keypair.generate();
  writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

async function send(step: string, tx: Transaction, signers: Signer[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await rpc(() => conn.getLatestBlockhash('confirmed'));
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = PAYER.publicKey;
  tx.signatures = [];
  tx.sign(PAYER, ...signers.filter((s) => !s.publicKey.equals(PAYER.publicKey)));
  const sig = await rpc(() => conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' }));
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const v = (await rpc(() => conn.getSignatureStatuses([sig]))).value[0];
    if (v?.err) throw new Error(`${step}: tx ${sig} failed: ${JSON.stringify(v.err)}`);
    if (v?.confirmationStatus === 'confirmed' || v?.confirmationStatus === 'finalized') {
      rec.txs.push({ step, sig });
      save();
      console.log(`  ${step}: ${sig}`);
      return sig;
    }
  }
  throw new Error(`${step}: tx ${sig} not confirmed in time; check it before rerunning`);
}

const fmt = (raw: bigint | BN | string, decimals: number): string => {
  const b = BigInt(raw.toString());
  const base = 10n ** BigInt(decimals);
  return `${(b / base).toLocaleString('en-US')}.${(b % base).toString().padStart(decimals, '0')}`;
};
const quoteUnits = (whole: string) => new BN(Math.round(Number(whole) * 10 ** QUOTE_DECIMALS));
const alphaUnits = (whole: string) => new BN(Math.round(Number(whole) * 1e6)).mul(new BN(1000));
const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

/** USDC per whole ALPHA from a Q64.64 sqrt price, computed here rather than by the SDK that built the curve. */
function priceOf(sqrtPrice: BN | string): number {
  const s = Number(BigInt(sqrtPrice.toString())) / 2 ** 64;
  return s * s * 10 ** (ALPHA_DECIMALS - QUOTE_DECIMALS);
}

const curveConfig = () => buildCurveWithMarketCap({
  token: {
    tokenType: TokenType.SPLToken,
    tokenBaseDecimal: TokenDecimal.NINE,
    tokenQuoteDecimal: QUOTE_DECIMALS,
    tokenAuthorityOption: TokenAuthorityOption.Immutable,
    totalTokenSupply: LAUNCH.totalSupplyAlpha,
    leftover: LAUNCH.treasuryAlpha,
  },
  fee: {
    baseFeeParams: {
      baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
      feeSchedulerParam: {
        startingFeeBps: LAUNCH.curveFee.startBps,
        endingFeeBps: LAUNCH.curveFee.endBps,
        numberOfPeriod: LAUNCH.curveFee.periods,
        totalDuration: LAUNCH.curveFee.durationSec,
      },
    },
    dynamicFeeEnabled: true,
    collectFeeMode: CollectFeeMode.QuoteToken,
    creatorTradingFeePercentage: 0, // every non-protocol fee goes to the fee claimer (the treasury)
    poolCreationFee: 0,
    enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2,
    migrationFeeOption: MigrationFeeOption.Customizable,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    migratedPoolFee: {
      collectFeeMode: MigratedCollectFeeMode.QuoteToken,
      dynamicFee: DammV2DynamicFeeMode.Disabled,
      poolFeeBps: LAUNCH.poolFeeBps,
    },
  },
  liquidityDistribution: {
    partnerPermanentLockedLiquidityPercentage: LAUNCH.lockedLiquidityPct,
    partnerLiquidityPercentage: 100 - LAUNCH.lockedLiquidityPct,
    creatorPermanentLockedLiquidityPercentage: 0,
    creatorLiquidityPercentage: 0,
  },
  lockedVesting: {
    totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0,
    totalVestingDuration: 0, cliffDurationFromMigrationTime: 0,
  },
  activationType: ActivationType.Timestamp,
  initialMarketCap: LAUNCH.startPrice * LAUNCH.totalSupplyAlpha,
  migrationMarketCap: LAUNCH.migrationPrice * LAUNCH.totalSupplyAlpha,
});

const DAMM_CONFIG = DAMM_V2_MIGRATION_FEE_ADDRESS[MigrationFeeOption.Customizable];
const quoteMint = () => new PublicKey(process.env.LAUNCH_QUOTE_MINT ?? rec.addresses.quoteMint ?? env('LAUNCH_QUOTE_MINT'));
const need = (k: string) => {
  const v = rec.addresses[k];
  if (!v) throw new Error(`${RECORD} has no ${k}; run the earlier step first`);
  return new PublicKey(v);
};
const devOnly = (what: string) => {
  if (MAINNET) throw new Error(`${what} is a rehearsal command and is refused on mainnet`);
};

type Check = [what: string, ok: boolean, detail?: unknown];
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * b;
const SUPPLY = BigInt(LAUNCH.totalSupplyAlpha) * ALPHA_BASE_UNITS;

/** The on-chain launch config against the published rules. Used by `create` before the
 * mint exists (a wrong config must never get a pool) and by `verify` afterwards. */
function configChecks(cfg: any, quote: PublicKey): Check[] {
  const fee = cfg.poolFees.baseFee;
  const through = BigInt(cfg.swapBaseAmount.toString()) + BigInt(cfg.migrationBaseThreshold.toString());
  const expected = BigInt(LAUNCH.totalSupplyAlpha - LAUNCH.treasuryAlpha) * ALPHA_BASE_UNITS;
  // exponential schedule: fee_n = cliff * (1 - thirdFactor/10000)^n, resting after `periods` steps
  const restingBps = LAUNCH.curveFee.startBps * (1 - Number(fee.thirdFactor.toString()) / 10_000) ** fee.firstFactor;
  const out: Check[] = [
    ['quote mint', cfg.quoteMint.equals(quote), cfg.quoteMint.toBase58()],
    ['fee claimer is the treasury', cfg.feeClaimer.equals(TREASURY)],
    ['leftover receiver is the treasury', cfg.leftoverReceiver.equals(TREASURY)],
    ['token is 9-decimal classic SPL', cfg.tokenDecimal === ALPHA_DECIMALS && cfg.tokenType === TokenType.SPLToken],
    ['metadata will be immutable', cfg.tokenUpdateAuthority === TokenAuthorityOption.Immutable],
    ['supply fixed before and after graduation',
      BigInt(cfg.preMigrationTokenSupply.toString()) === SUPPLY && BigInt(cfg.postMigrationTokenSupply.toString()) === SUPPLY],
    ['opening price', near(priceOf(cfg.sqrtStartPrice), LAUNCH.startPrice), priceOf(cfg.sqrtStartPrice).toFixed(9)],
    ['graduation price', near(priceOf(cfg.migrationSqrtPrice), LAUNCH.migrationPrice), priceOf(cfg.migrationSqrtPrice).toFixed(9)],
    ['share of supply through the curve and pool', through <= expected && expected - through < ALPHA_BASE_UNITS, fmt(through, ALPHA_DECIMALS)],
    ['graduates to DAMM v2 with the customizable config', cfg.migrationOption === MigrationOption.MET_DAMM_V2 && cfg.migrationFeeOption === MigrationFeeOption.Customizable],
    ['graduated pool fee', cfg.migratedPoolFeeBps === LAUNCH.poolFeeBps, cfg.migratedPoolFeeBps],
    ['all graduated liquidity permanently locked for the treasury',
      cfg.partnerPermanentLockedLiquidityPercentage === LAUNCH.lockedLiquidityPct && cfg.partnerLiquidityPercentage === 0
      && cfg.creatorPermanentLockedLiquidityPercentage === 0 && cfg.creatorLiquidityPercentage === 0],
    ['no vesting allocation', cfg.lockedVestingConfig.amountPerPeriod.isZero() && cfg.lockedVestingConfig.cliffUnlockAmount.isZero()],
    ['no migration fee, for the partner or the creator', cfg.migrationFeePercentage === 0 && cfg.creatorMigrationFeePercentage === 0],
    ['creator takes no trading fee', cfg.creatorTradingFeePercentage === 0],
    ['curve fee is the exponential schedule', fee.baseFeeMode === BaseFeeMode.FeeSchedulerExponential, fee.baseFeeMode],
    ['curve fee opens at the published rate', fee.cliffFeeNumerator.toString() === String(LAUNCH.curveFee.startBps * 100_000), fee.cliffFeeNumerator],
    ['curve fee decays over the published window', fee.firstFactor === LAUNCH.curveFee.periods
      && fee.secondFactor.toString() === String(LAUNCH.curveFee.durationSec / LAUNCH.curveFee.periods)],
    ['curve fee rests at the published rate', Math.abs(restingBps - LAUNCH.curveFee.endBps) <= 5, `${restingBps.toFixed(1)} bps`],
    ['the fee window runs on wall-clock time', cfg.activationType === ActivationType.Timestamp],
    ['fees are collected in USDC, on the curve and in the pool',
      cfg.collectFeeMode === CollectFeeMode.QuoteToken && cfg.migratedCollectFeeMode === MigratedCollectFeeMode.QuoteToken],
    ['threshold is the pooled share at the graduation price',
      near(Number(cfg.migrationQuoteThreshold.toString()) / 10 ** QUOTE_DECIMALS,
        Number(cfg.migrationBaseThreshold.toString()) / Number(ALPHA_BASE_UNITS) * LAUNCH.migrationPrice),
      fmt(cfg.migrationQuoteThreshold, QUOTE_DECIMALS)],
  ];
  if (MAINNET) out.push(['quote mint is USDC', cfg.quoteMint.toBase58() === MAINNET_USDC]);
  return out;
}

async function poolState() {
  const vp: any = await rpc(() => client.state.getPool(need('pool')));
  const cfg: any = await rpc(() => client.state.getPoolConfig(need('config')));
  if (!vp || !cfg) throw new Error('launch pool or config not found on this cluster');
  return { vp, p: vp.poolState, cfg };
}

async function swap(step: string, who: Keypair, buy: boolean, amountIn: BN, mode = SwapMode.ExactIn) {
  const { vp, cfg } = await poolState();
  const currentPoint = await rpc(() => getCurrentPoint(conn, cfg.activationType));
  const quote: any = client.pool.swapQuote2({
    virtualPool: vp, config: cfg, swapBaseForQuote: !buy, swapMode: mode, amountIn,
    slippageBps: 500, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint,
  } as any);
  const tx = await rpc(() => client.pool.swap2({
    owner: who.publicKey, payer: PAYER.publicKey, pool: need('pool'), swapBaseForQuote: !buy,
    swapMode: mode, amountIn, minimumAmountOut: quote.minimumAmountOut, referralTokenAccount: null,
  } as any));
  await send(step, tx, [who]);
}

/**
 * The positions the launch created, read from the migration transaction itself. Nothing a
 * third party later creates in the pool or sends to the treasury can stand in for them:
 * the transaction must have succeeded, must be the curve program's own MigrationDammV2
 * on this curve pool and this DAMM v2 pool, and the position NFT mints are its signers.
 */
async function launchPositions(dammPool: PublicKey): Promise<{ position: PublicKey; nftMint: PublicKey }[]> {
  const curvePool = need('pool');
  const isMigration = async (sig: string) => {
    const tx = await rpc(() => conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }));
    if (!tx || tx.meta?.err) return null;
    const logs = tx.meta?.logMessages ?? [];
    const i = logs.indexOf(`Program ${DBC_PROGRAM} invoke [1]`);
    if (i < 0 || logs[i + 1] !== 'Program log: Instruction: MigrationDammV2') return null;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat();
    const has = new Set(keys.map((k) => k.toBase58()));
    if (!has.has(curvePool.toBase58()) || !has.has(dammPool.toBase58())) return null;
    const signers = keys.slice(0, tx.transaction.message.header.numRequiredSignatures);
    return signers
      .filter((k) => has.has(derivePositionAddress(k).toBase58()))
      .map((nftMint) => ({ position: derivePositionAddress(nftMint), nftMint }));
  };
  const named = process.env.LAUNCH_MIGRATION_TX ?? rec.addresses.migrationTx;
  if (named) {
    const found = await isMigration(named);
    if (!found) throw new Error(`${named} is not this launch's migration transaction`);
    return found;
  }
  // otherwise search the graduated pool's history from its beginning: creation is the first
  // successful migration there (an address can be referenced, and so have history, before it exists)
  const sigs: string[] = [];
  for (let before: string | undefined, page = 0; page < 20; page++) {
    const batch = await rpc(() => conn.getSignaturesForAddress(dammPool, { before, limit: 1000 }, 'confirmed'));
    sigs.push(...batch.filter((x) => !x.err).map((x) => x.signature));
    if (batch.length < 1000) {
      for (const sig of sigs.reverse().slice(0, 50)) {
        const found = await isMigration(sig);
        if (found) return found;
      }
      break;
    }
    before = batch[batch.length - 1].signature;
  }
  throw new Error('could not find the migration transaction in the pool history; set LAUNCH_MIGRATION_TX');
}

// ----- commands ----------------------------------------------------------------

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async quote() {
    devOnly('quote');
    const kp = launchKey('quote-mint');
    const rent = await rpc(() => conn.getMinimumBalanceForRentExemption(MINT_SIZE));
    await send('create stand-in quote mint (6 dp)', new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: PAYER.publicKey, newAccountPubkey: kp.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(kp.publicKey, QUOTE_DECIMALS, PAYER.publicKey, null),
    ), [kp]);
    rec.addresses.quoteMint = kp.publicKey.toBase58();
    save();
    console.log(`stand-in quote mint ${rec.addresses.quoteMint} (mint authority: the payer)`);
  },

  async fund([to, amount]) {
    devOnly('fund');
    const owner = new PublicKey(to);
    const mint = quoteMint();
    await send(`fund ${to} with ${amount} stand-in quote`, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(PAYER.publicKey, ata(mint, owner), owner, mint),
      createMintToInstruction(mint, ata(mint, owner), PAYER.publicKey, BigInt(quoteUnits(amount).toString())),
    ), []);
  },

  async create() {
    if (rec.addresses.pool) throw new Error(`already created: pool ${rec.addresses.pool} (${RECORD})`);
    // everything that can refuse does so before the first transaction
    const uri = env('LAUNCH_URI');
    const quote = quoteMint();
    if (MAINNET) {
      if (process.env.LAUNCH_MAINNET_GATES !== 'audit-and-counsel-passed') {
        throw new Error('mainnet launch is behind the audit and counsel gates (LAUNCH_MAINNET_GATES)');
      }
      if (quote.toBase58() !== MAINNET_USDC) throw new Error('on mainnet the quote mint must be USDC');
      if (!/^https:\/\//.test(uri) || /example\.(com|org)/.test(uri)) throw new Error('LAUNCH_URI must be the final, permanently hosted metadata file');
      env('OUTFOX_PROGRAM_ID');
    }
    if (process.env.OUTFOX_PROGRAM_ID) {
      const [state] = PublicKey.findProgramAddressSync([Buffer.from('settlement')], new PublicKey(process.env.OUTFOX_PROGRAM_ID));
      if (await rpc(() => conn.getAccountInfo(state))) {
        throw new Error(`settlement ${process.env.OUTFOX_PROGRAM_ID} is already initialized on this cluster: the game has its token`);
      }
    }
    // 88% of the supply and the locked position go to this address for good
    if (!(await rpc(() => conn.getAccountInfo(TREASURY)))) {
      throw new Error(`the treasury ${TREASURY.toBase58()} does not exist on this cluster; fund it first so a mistyped address cannot receive the supply`);
    }
    const configKp = launchKey('config');
    const mintKp = launchKey('mint');
    const planned = {
      payer: PAYER.publicKey.toBase58(), treasury: TREASURY.toBase58(),
      quoteMint: quote.toBase58(), config: configKp.publicKey.toBase58(),
      mint: mintKp.publicKey.toBase58(), dammConfig: DAMM_CONFIG.toBase58(),
      dammPool: deriveDammV2PoolAddress(DAMM_CONFIG, mintKp.publicKey, quote).toBase58(),
    };
    for (const [k, v] of Object.entries(planned)) {
      if (rec.addresses[k] && rec.addresses[k] !== v) {
        throw new Error(`${RECORD} says ${k} is ${rec.addresses[k]}, this run says ${v}: an interrupted create is being resumed with different inputs`);
      }
    }
    Object.assign(rec.addresses, planned);
    save(); // `pool` is recorded only once the pool exists on chain
    if (!(await rpc(() => conn.getAccountInfo(configKp.publicKey)))) {
      await send('create config', await rpc(() => client.partner.createConfig({
        config: configKp.publicKey, feeClaimer: TREASURY, leftoverReceiver: TREASURY,
        quoteMint: quote, payer: PAYER.publicKey, ...curveConfig(),
      })), [configKp]);
    }
    // the config is immutable and decides where 88% of the supply goes: read it back and
    // check it against the published rules BEFORE the mint is created on it
    const onChain: any = await rpc(() => client.state.getPoolConfig(configKp.publicKey));
    const broken = configChecks(onChain, quote).filter(([, ok]) => !ok);
    if (broken.length) {
      throw new Error(`the on-chain launch config does not match the published rules; no pool created:\n  ${broken.map(([w, , d]) => `${w}${d === undefined ? '' : `: ${d}`}`).join('\n  ')}`);
    }
    const pool = deriveDbcPoolAddress(quote, mintKp.publicKey, configKp.publicKey);
    // a pool transaction that landed without being seen confirmed must not be sent twice
    if (await rpc(() => conn.getAccountInfo(pool))) {
      console.log('  the pool already exists on chain; recording it');
    } else {
      await send('create pool (creates the mint)', await rpc(() => client.creator.createPool({
        baseMint: mintKp.publicKey, config: configKp.publicKey, name: TOKEN_NAME, symbol: TOKEN_SYMBOL,
        uri, payer: PAYER.publicKey, poolCreator: PAYER.publicKey,
      })), [mintKp]);
    }
    rec.addresses.pool = pool.toBase58();
    rec.addresses.uri = uri;
    save();
    console.log(`$ALPHA mint ${rec.addresses.mint}\ncurve pool  ${rec.addresses.pool}\nrecord      ${RECORD}`);
  },

  async status() {
    const { p, cfg } = await poolState();
    const phase = ['curve open', 'curve complete, not migrated', 'curve complete, locker ready', 'graduated to DAMM v2'][p.migrationProgress];
    console.log(`phase            ${phase}`);
    console.log(`${p.migrationProgress === 3 ? 'curve closed at ' : 'price           '} ${priceOf(p.sqrtPrice).toFixed(6)} USDC  (opens ${priceOf(cfg.sqrtStartPrice).toFixed(6)}, graduates ${priceOf(cfg.migrationSqrtPrice).toFixed(6)}); the pool price is in \`verify\``);
    console.log(`raised           ${fmt(p.quoteReserve, QUOTE_DECIMALS)} of ${fmt(cfg.migrationQuoteThreshold, QUOTE_DECIMALS)} USDC`);
    console.log(`curve fees       ${fmt(p.metrics.totalTradingQuoteFee, QUOTE_DECIMALS)} treasury, ${fmt(p.metrics.totalProtocolQuoteFee, QUOTE_DECIMALS)} protocol`);
  },

  async buy([keyPath, amount]) {
    devOnly('buy');
    await swap(`buy with ${amount} quote`, loadKp(keyPath), true, quoteUnits(amount));
  },

  async sell([keyPath, amount]) {
    devOnly('sell');
    await swap(`sell ${amount} ALPHA`, loadKp(keyPath), false, alphaUnits(amount));
  },

  /** The backstop: whoever launches can always finish the curve. The payer pays what the
   * curve still needs plus the curve fee at that moment, and holds the $ALPHA it bought. */
  async complete() {
    const { p, cfg } = await poolState();
    if (p.migrationProgress !== 0) throw new Error('the curve is already complete');
    const remaining = new BN(cfg.migrationQuoteThreshold).sub(new BN(p.quoteReserve));
    // PartialFill takes only what the curve still needs; the 3x ceiling covers the fee even at the opening rate
    await swap(`complete the curve (${fmt(remaining, QUOTE_DECIMALS)} quote still needed)`, PAYER, true, remaining.muln(3), SwapMode.PartialFill);
  },

  async migrate() {
    let { p } = await poolState();
    if (p.migrationProgress === 0) throw new Error('the curve is not complete yet (run status)');
    if (p.migrationProgress === 1) {
      await send('create locker', await rpc(() => client.migration.createLocker({ payer: PAYER.publicKey, pool: need('pool') })), []);
      ({ p } = await poolState());
    }
    if (p.migrationProgress === 2) {
      const m = await rpc(() => client.migration.migrateToDammV2({ payer: PAYER.publicKey, pool: need('pool'), dammConfig: DAMM_CONFIG }));
      rec.addresses.migrationTx = await send('migrate to DAMM v2', m.transaction, [m.firstPositionNftKeypair, m.secondPositionNftKeypair]);
      rec.addresses.position = derivePositionAddress(m.firstPositionNftKeypair.publicKey).toBase58();
      save();
      ({ p } = await poolState());
    }
    if (!p.isWithdrawLeftover) {
      await send('withdraw leftover to the treasury', await rpc(() => client.migration.withdrawLeftover({ payer: PAYER.publicKey, pool: need('pool') })), []);
    }
  },

  async claim() {
    if (!TREASURY_SIGNER) throw new Error('claim is signed by the treasury: LAUNCH_TREASURY must be its keypair file for this command');
    await send('treasury claims curve trading fees', await rpc(() => client.partner.claimPartnerTradingFee({
      feeClaimer: TREASURY, payer: PAYER.publicKey, pool: need('pool'),
      maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX,
    })), [TREASURY_SIGNER]);
  },

  async verify() {
    let failed = 0;
    const check = (what: string, ok: boolean, detail: unknown = '') => {
      if (!ok) failed++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' || detail === undefined ? '' : `: ${detail}`}`);
    };
    const mintPk = need('mint');
    const { p, cfg } = await poolState();

    console.log('mint');
    const info = await rpc(() => conn.getAccountInfo(mintPk));
    const mint = await rpc(() => getMint(conn, mintPk, 'confirmed', TOKEN_PROGRAM_ID));
    check('classic SPL Token mint', !!info?.owner.equals(TOKEN_PROGRAM_ID));
    check('decimals', mint.decimals === ALPHA_DECIMALS, mint.decimals);
    check('supply is exactly the fixed supply', mint.supply === SUPPLY, mint.supply);
    check('no mint authority', mint.mintAuthority === null);
    check('no freeze authority', mint.freezeAuthority === null);
    const md = await rpc(() => conn.getAccountInfo(deriveMintMetadata(mintPk)));
    if (!md) check('metadata exists', false);
    else {
      // Metaplex Metadata: key(1) updateAuthority(32) mint(32) name symbol uri (borsh strings) fee(2) creators(option) primarySale(1) isMutable(1)
      let o = 65;
      const str = () => { const n = md.data.readUInt32LE(o); const v = md.data.subarray(o + 4, o + 4 + n).toString('utf8').replace(/\0/g, ''); o += 4 + n; return v; };
      const name = str(); const symbol = str(); const uri = str();
      o += 2;
      o += md.data[o] === 1 ? 5 + md.data.readUInt32LE(o + 1) * 34 : 1;
      check('metadata has no update authority', new PublicKey(md.data.subarray(1, 33)).equals(PublicKey.default));
      check('metadata is immutable', md.data[o + 1] === 0);
      check('name and symbol', name === TOKEN_NAME && symbol === TOKEN_SYMBOL, `${name} / ${symbol}`);
      const wantUri = process.env.LAUNCH_URI ?? rec.addresses.uri;
      check('metadata address is the one launched with', wantUri === undefined ? !MAINNET : uri === wantUri, uri);
    }

    console.log('launch config');
    for (const [what, ok, detail] of configChecks(cfg, quoteMint())) check(what, ok, detail);

    console.log(`pool (migration progress ${p.migrationProgress})`);
    check('the pool is built on the recorded config', p.config.equals(need('config')));
    check('the pool launched the recorded mint', p.baseMint.equals(mintPk));
    check('the payer created the pool', p.creator.equals(need('payer')));
    const baseVault = await rpc(() => getAccount(conn, p.baseVault));
    if (p.migrationProgress < 3) {
      check('unsold supply is still in the curve vault', baseVault.amount <= SUPPLY && baseVault.amount >= BigInt(LAUNCH.treasuryAlpha) * ALPHA_BASE_UNITS, fmt(baseVault.amount, ALPHA_DECIMALS));
    } else {
      const damm: any = createDammV2Program(conn, 'confirmed');
      const dammPk = deriveDammV2PoolAddress(DAMM_CONFIG, mintPk, quoteMint());
      const dInfo = await rpc(() => conn.getAccountInfo(dammPk));
      check('graduated pool is the DAMM v2 pool derived from the launch', dInfo?.owner.toBase58() === DAMM_V2_PROGRAM, dammPk.toBase58());
      const dp: any = await rpc(() => damm.account.pool.fetch(dammPk, 'confirmed'));
      check('pool pairs $ALPHA with the quote mint', dp.tokenAMint.equals(mintPk) && dp.tokenBMint.equals(quoteMint()));
      // Anyone may add their own liquidity to the pool, so pool-wide "locked == total" is
      // not an invariant. What must hold is that every position the launch itself created
      // is locked in full, and that the locked launch liquidity belongs to the treasury.
      const created = await launchPositions(dammPk);
      let locked = new BN(0);
      let allLocked = created.length > 0;
      let treasuryOwns = true;
      for (const { position, nftMint } of created) {
        const pos: any = await rpc(() => damm.account.position.fetchNullable(position, 'confirmed'));
        if (!pos) continue; // the migration names a second position that exists only when the creator has a share
        if (!pos.pool.equals(dammPk) || !pos.unlockedLiquidity.isZero() || !pos.vestedLiquidity.isZero()) allLocked = false;
        locked = locked.add(pos.permanentLockedLiquidity);
        const nft = await rpc(() => getAccount(conn, derivePositionNftAccount(nftMint), 'confirmed', TOKEN_2022_PROGRAM_ID));
        if (!nft.owner.equals(TREASURY) || nft.amount !== 1n) treasuryOwns = false;
      }
      check('every position the launch created is permanently locked in full', allLocked && !locked.isZero(), locked);
      check('the treasury owns the launch liquidity', treasuryOwns && !locked.isZero());
      check('the pool counts that liquidity as permanently locked', dp.permanentLockLiquidity.gte(locked));
      const share = Number(dp.permanentLockLiquidity.muln(100_000).div(dp.liquidity).toString()) / 1000;
      console.log(`  permanently locked share of all pool liquidity: ${share.toFixed(2)}%${share < 100 ? ' (others have added liquidity on top)' : ''}`);
      console.log(`  pool price now ${priceOf(dp.sqrtPrice).toFixed(9)} USDC`);
      check('leftover withdrawn', p.isWithdrawLeftover === 1 || p.isWithdrawLeftover === true);
      const treasuryAta = await rpc(() => getAccount(conn, ata(mintPk, TREASURY)));
      check('the treasury holds its share', treasuryAta.amount >= BigInt(LAUNCH.treasuryAlpha) * ALPHA_BASE_UNITS, fmt(treasuryAta.amount, ALPHA_DECIMALS));
      console.log(`  pool reserves ${fmt(dp.tokenAAmount, ALPHA_DECIMALS)} ALPHA and ${fmt(dp.tokenBAmount, QUOTE_DECIMALS)} USDC`);
    }
    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
    if (failed) process.exit(1);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !commands[cmd]) throw new Error(`usage: launch.ts ${Object.keys(commands).join(' | ')}`);
await commands[cmd](args);
