/**
 * The chain edge: Settlement indexer + voucher signer.
 *
 * The server is the custodian of game state; the chain is the value boundary. This module
 * is the ONLY place that talks to it:
 *   - indexOnce()  — pulls Deposited/Withdrawn logs and folds them into the game ledger.
 *   - signVoucher() — signs an EIP-712 withdrawal voucher with the server's hot key AFTER
 *     the §9 gates have already passed in settlement.ts. The contract enforces only what
 *     the chain must (single-use nonce, expiry, signature, pause, rolling cap).
 *
 * Every credited deposit is keyed by (tx_hash, log_index), so re-indexing — after a crash,
 * a restart, or a reorg replay — can never double-credit.
 */
import {
  createPublicClient, http, parseAbi, parseAbiItem, getAddress,
  encodeFunctionData, verifyMessage, type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { DB } from './db.js';
import { creditDeposit, markWithdrawalConfirmed } from './settlement.js';

export const DEPOSITED = parseAbiItem('event Deposited(address indexed from, uint256 amount)');
export const WITHDRAWN = parseAbiItem('event Withdrawn(address indexed to, uint256 amount, uint256 indexed nonce)');

export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
  settlement: Address;
  /** block the Settlement contract was deployed in — never index below it */
  startBlock: bigint;
  /** the game server's hot signing key (NOT the owner key) */
  signerKey?: Hex;
  /** logs are pulled in windows; public RPCs cap the span */
  windowSize?: bigint;
}

export function chainConfigFromEnv(): ChainConfig | null {
  const { OUTFOX_RPC_URL, OUTFOX_CHAIN_ID, OUTFOX_SETTLEMENT, OUTFOX_START_BLOCK, OUTFOX_SIGNER_KEY } = process.env;
  if (!OUTFOX_RPC_URL || !OUTFOX_CHAIN_ID || !OUTFOX_SETTLEMENT) return null;
  return {
    rpcUrl: OUTFOX_RPC_URL,
    chainId: Number(OUTFOX_CHAIN_ID),
    settlement: getAddress(OUTFOX_SETTLEMENT),
    startBlock: BigInt(OUTFOX_START_BLOCK ?? '0'),
    signerKey: OUTFOX_SIGNER_KEY as Hex | undefined,
    windowSize: 5_000n,
  };
}

export function publicClientFor(cfg: ChainConfig) {
  return createPublicClient({ transport: http(cfg.rpcUrl) });
}

// ----- EIP-712 voucher -------------------------------------------------------

/** Must match Settlement.sol's EIP712("OutfoxSettlement", "1") + WITHDRAWAL_TYPEHASH. */
export const VOUCHER_TYPES = {
  Withdrawal: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export async function signVoucher(
  cfg: ChainConfig,
  v: { to: Address; amount: bigint; nonce: bigint; deadline: bigint },
): Promise<Hex> {
  if (!cfg.signerKey) throw new Error('OUTFOX_SIGNER_KEY not configured — cannot sign vouchers');
  const account = privateKeyToAccount(cfg.signerKey);
  return account.signTypedData({
    domain: {
      name: 'OutfoxSettlement',
      version: '1',
      chainId: cfg.chainId,
      verifyingContract: cfg.settlement,
    },
    types: VOUCHER_TYPES,
    primaryType: 'Withdrawal',
    message: { to: v.to, amount: v.amount, nonce: v.nonce, deadline: v.deadline },
  });
}

// ----- client transaction calldata -------------------------------------------
// The web app carries NO ABI code: every transaction it asks a wallet to send is
// encoded HERE and shipped down the wire. One encoder, one source of truth.

const SETTLEMENT_ABI = parseAbi([
  'function alpha() view returns (address)',
  'function deposit(uint256 amount)',
  'function withdraw(address to, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
]);
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 value) returns (bool)']);

let alphaAddrCache: { settlement: Address; alpha: Address } | null = null;

/** The ALPHA token address, read from the Settlement contract itself (immutable there,
 * so cached for the process lifetime — no separate env var to drift). */
export async function alphaAddressFor(cfg: ChainConfig): Promise<Address> {
  if (alphaAddrCache && alphaAddrCache.settlement === cfg.settlement) return alphaAddrCache.alpha;
  const alpha = await publicClientFor(cfg).readContract({
    address: cfg.settlement, abi: SETTLEMENT_ABI, functionName: 'alpha',
  });
  alphaAddrCache = { settlement: cfg.settlement, alpha };
  return alpha;
}

export function approveCalldata(settlement: Address, amountWei: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [settlement, amountWei] });
}

export function depositCalldata(amountWei: bigint): Hex {
  return encodeFunctionData({ abi: SETTLEMENT_ABI, functionName: 'deposit', args: [amountWei] });
}

export function redeemCalldata(
  v: { to: Address; amount: bigint; nonce: bigint; deadline: bigint; signature: Hex },
): Hex {
  return encodeFunctionData({
    abi: SETTLEMENT_ABI, functionName: 'withdraw',
    args: [v.to, v.amount, v.nonce, v.deadline, v.signature],
  });
}

// ----- R2 wallet link (SIWE-lite) --------------------------------------------

/** The message the wallet signs to prove control. Domain-bound and nonce-bound, so a
 * signature harvested elsewhere cannot link a wallet here. */
export function linkMessage(nonce: string, origin: string): string {
  return [
    `${origin} wants to link this wallet to your Outfox account.`,
    '',
    'Signing this proves you control the wallet. It does not move any funds.',
    '',
    `Nonce: ${nonce}`,
  ].join('\n');
}

export async function verifyLinkSignature(
  address: Address, message: string, signature: Hex,
): Promise<boolean> {
  try {
    return await verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

// ----- the indexer -----------------------------------------------------------

function getCursor(db: DB, cfg: ChainConfig): bigint {
  const row = db.prepare(`SELECT last_block FROM chain_cursor WHERE id = 1`).get() as
    { last_block: number } | undefined;
  return row ? BigInt(row.last_block) : cfg.startBlock - 1n;
}

function setCursor(db: DB, block: bigint): void {
  db.prepare(
    `INSERT INTO chain_cursor (id, last_block) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET last_block = excluded.last_block`
  ).run(Number(block));
}

/** Records the raw event. Returns false if we have already seen it (idempotency). */
function recordEvent(
  db: DB, txHash: string, logIndex: number, block: bigint, kind: string, payload: unknown,
): boolean {
  const existing = db.prepare(
    `SELECT 1 FROM chain_events WHERE tx_hash = ? AND log_index = ?`
  ).get(txHash, logIndex);
  if (existing) return false;
  db.prepare(
    `INSERT INTO chain_events (tx_hash, log_index, block, kind, payload, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(txHash, logIndex, Number(block), kind, JSON.stringify(payload), Date.now());
  return true;
}

/**
 * Pull one batch of logs and fold them in. Safe to call repeatedly; safe to crash between
 * calls. Confirmations lag the head so a shallow reorg cannot strand a credit.
 */
export async function indexOnce(
  db: DB, cfg: ChainConfig, confirmations = 2n,
): Promise<{ from: bigint; to: bigint; deposits: number; withdrawals: number }> {
  const client = publicClientFor(cfg);
  const head = await client.getBlockNumber();
  const safeHead = head > confirmations ? head - confirmations : 0n;
  const from = getCursor(db, cfg) + 1n;
  if (from > safeHead) return { from, to: safeHead, deposits: 0, withdrawals: 0 };
  const to = safeHead - from > (cfg.windowSize ?? 5_000n)
    ? from + (cfg.windowSize ?? 5_000n)
    : safeHead;

  const [deps, wds] = await Promise.all([
    client.getLogs({ address: cfg.settlement, event: DEPOSITED, fromBlock: from, toBlock: to }),
    client.getLogs({ address: cfg.settlement, event: WITHDRAWN, fromBlock: from, toBlock: to }),
  ]);

  // A seasoning lot's clock must start when the deposit LANDED ON CHAIN, not when the
  // indexer happened to see it: otherwise catching up after downtime (or replaying
  // history) silently restarts every affected player's 60-day seasoning. The block
  // timestamp is the only replay-stable answer. (Caught by the M4 harness.)
  const blockTimes = new Map<bigint, number>();
  for (const bn of new Set(deps.map((l) => l.blockNumber!))) {
    blockTimes.set(bn, Number((await client.getBlock({ blockNumber: bn })).timestamp) * 1000);
  }

  let deposits = 0;
  for (const log of deps) {
    const address = getAddress(log.args.from!).toLowerCase();
    const amount = log.args.amount!;
    const fresh = recordEvent(db, log.transactionHash!, log.logIndex!, log.blockNumber!,
      'Deposited', { address, amount: amount.toString() });
    if (!fresh) continue;
    creditDeposit(db, address, amount, log.transactionHash!, log.logIndex!,
      blockTimes.get(log.blockNumber!));
    deposits++;
  }

  let withdrawals = 0;
  for (const log of wds) {
    const nonce = log.args.nonce!;
    const fresh = recordEvent(db, log.transactionHash!, log.logIndex!, log.blockNumber!,
      'Withdrawn', { to: log.args.to, amount: log.args.amount!.toString(), nonce: nonce.toString() });
    if (!fresh) continue;
    markWithdrawalConfirmed(db, nonce.toString(), log.transactionHash!);
    withdrawals++;
  }

  setCursor(db, to);
  return { from, to, deposits, withdrawals };
}

/** Background loop. Errors are logged, never fatal — the cursor only advances on success,
 * so a transient RPC failure just retries the same window. */
export function startIndexer(
  db: DB, cfg: ChainConfig, intervalMs = 5_000,
  log: (msg: string) => void = () => {},
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const r = await indexOnce(db, cfg);
      if (r.deposits || r.withdrawals) {
        log(`indexed ${r.from}-${r.to}: ${r.deposits} deposit(s), ${r.withdrawals} withdrawal(s)`);
      }
    } catch (e) {
      log(`indexer error (will retry): ${(e as Error).message}`);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  void tick();
  return () => { stopped = true; };
}
