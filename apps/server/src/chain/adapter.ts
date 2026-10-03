/**
 * The chain adapter (Solana): PDAs, state reads, the voucher signer, and the
 * transaction builders the client relays. The indexer half lives in ./indexer.ts.
 *
 * The server is the custodian of game state; the chain is the value boundary. This
 * module and the indexer are the ONLY places that talk to it. signVoucher() ed25519-signs
 * a withdrawal voucher with the server's hot key AFTER the §9 gates have already passed
 * in economy/valve.ts. The program enforces only what the chain must (single-use nonce
 * PDA, expiry, signature, pause, rolling cap).
 *
 * The voucher message layout MUST match `programs/settlement/src/lib.rs::voucher_message`:
 *   "OUTFOX_SETTLEMENT_V1"(20) ++ program_id(32) ++ chain_id u64le ++ to(32)
 *   ++ amount u64le ++ nonce u64le ++ deadline i64le      (116 bytes)
 */
import {
  ComputeBudgetProgram, Connection, Ed25519Program, PublicKey, SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export const VOUCHER_DOMAIN = 'OUTFOX_SETTLEMENT_V1';
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export interface ChainConfig {
  rpcUrl: string;
  /** Voucher domain separator for the cluster (0 localnet, 1 devnet, 2 mainnet). */
  chainId: number;
  /** The settlement program id. */
  programId: PublicKey;
  /** The server's hot ed25519 voucher key: 32-byte seed, base58 or hex. NOT the admin. */
  signerSeed?: Uint8Array;
  /** Max transactions folded per indexOnce batch. */
  batchLimit?: number;
  /** The settlement's CURRENT cold admin (OUTFOX_ADMIN; after a transfer_admin +
   * accept_admin handover it is the new one). A state with any other admin is refused:
   * see settlementProblems. Required whenever the server holds the signer key. */
  admin?: PublicKey;
}

export function chainConfigFromEnv(): ChainConfig | null {
  const { OUTFOX_RPC_URL, OUTFOX_CHAIN_ID, OUTFOX_PROGRAM_ID, OUTFOX_SIGNER_KEY, OUTFOX_ADMIN } = process.env;
  if (!OUTFOX_RPC_URL || OUTFOX_CHAIN_ID === undefined || !OUTFOX_PROGRAM_ID) return null;
  // A server that signs vouchers must also know whose settlement it is signing for:
  // the admin check (settlementProblems) is not optional in that configuration.
  if (OUTFOX_SIGNER_KEY && !OUTFOX_ADMIN) throw new Error('OUTFOX_ADMIN must be set together with OUTFOX_SIGNER_KEY');
  let seed: Uint8Array | undefined;
  if (OUTFOX_SIGNER_KEY) {
    seed = /^[0-9a-fA-Fx]+$/.test(OUTFOX_SIGNER_KEY) && OUTFOX_SIGNER_KEY.length >= 64
      ? Uint8Array.from(Buffer.from(OUTFOX_SIGNER_KEY.replace(/^0x/, ''), 'hex'))
      : bs58.decode(OUTFOX_SIGNER_KEY);
    if (seed.length === 64) seed = seed.slice(0, 32); // accept full keypair bytes too
    if (seed.length !== 32) throw new Error('OUTFOX_SIGNER_KEY must be a 32-byte ed25519 seed');
  }
  return {
    rpcUrl: OUTFOX_RPC_URL,
    chainId: Number(OUTFOX_CHAIN_ID),
    programId: new PublicKey(OUTFOX_PROGRAM_ID),
    signerSeed: seed,
    batchLimit: 100,
    admin: OUTFOX_ADMIN ? new PublicKey(OUTFOX_ADMIN) : undefined,
  };
}

export function connectionFor(cfg: ChainConfig): Connection {
  return new Connection(cfg.rpcUrl, 'confirmed');
}

// ----- PDAs and addresses ----------------------------------------------------

export function statePda(cfg: ChainConfig): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('settlement')], cfg.programId)[0];
}

export function noncePda(cfg: ChainConfig, nonce: bigint): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync([Buffer.from('nonce'), buf], cfg.programId)[0];
}

export function ataFor(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];
}

export interface SettlementStateView {
  admin: PublicKey;
  pendingAdmin: PublicKey | null;
  signer: PublicKey;
  alphaMint: PublicKey;
  windowCap: bigint;
  bucket: bigint;
  lastDrain: bigint;
  chainId: bigint;
  paused: boolean;
}

/** Borsh-decode the settlement state account. `pending_admin` is an Option, so every
 * later field's offset depends on it — never read fixed offsets past byte 40. */
export function parseSettlementState(data: Uint8Array): SettlementStateView {
  const buf = Buffer.from(data);
  let o = 8; // anchor discriminator
  const admin = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  let pendingAdmin: PublicKey | null = null;
  if (buf.readUInt8(o++) === 1) {
    pendingAdmin = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  }
  const signer = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const alphaMint = new PublicKey(buf.subarray(o, o + 32)); o += 32;
  const windowCap = buf.readBigUInt64LE(o); o += 8;
  const bucket = buf.readBigUInt64LE(o); o += 8;
  const lastDrain = buf.readBigInt64LE(o); o += 8;
  const chainId = buf.readBigUInt64LE(o); o += 8;
  const paused = buf.readUInt8(o) === 1;
  return { admin, pendingAdmin, signer, alphaMint, windowCap, bucket, lastDrain, chainId, paused };
}

/**
 * Why the settlement state on chain is not this deployment's, or [] when it is.
 * `initialize` can be called by anyone who gets there first, and it fixes the admin and
 * the voucher signer. A state that names another signer cannot honour this server's
 * vouchers, and one that names another admin can be re-pointed or paused at will: either
 * way players' deposits would sit in an escrow someone else controls. The server refuses
 * to build a deposit or serve a reserve for such a state.
 */
export function settlementProblems(state: SettlementStateView, cfg: ChainConfig): string[] {
  const problems: string[] = [];
  if (cfg.signerSeed && !state.signer.equals(voucherSignerPubkey(cfg))) {
    problems.push('its voucher signer is not this server\'s key');
  }
  if (cfg.admin && !state.admin.equals(cfg.admin)) problems.push('its admin is not the configured admin');
  if (state.chainId !== BigInt(cfg.chainId)) problems.push(`it was initialized for chain id ${state.chainId}`);
  return problems;
}

/** The state is re-read on this cadence so a signer rotation or an admin handover is
 * seen within a minute: a cached verdict must not outlive the keys it vouched for. */
const STATE_RECHECK_MS = 60_000;
let mintCache: { state: string; mint: PublicKey; checkedAt: number } | null = null;

/** The ALPHA mint, read from the on-chain settlement state itself (set at initialize,
 * so cached for the process lifetime — no separate env var to drift). */
export async function alphaMintFor(cfg: ChainConfig): Promise<PublicKey> {
  const state = statePda(cfg);
  if (mintCache && mintCache.state === state.toBase58() && Date.now() - mintCache.checkedAt < STATE_RECHECK_MS) {
    return mintCache.mint;
  }
  const info = await connectionFor(cfg).getAccountInfo(state);
  if (!info) throw new Error('settlement state account not found — program not initialized?');
  if (!info.owner.equals(cfg.programId)) throw new Error('settlement state account is not owned by the program — not initialized');
  const parsed = parseSettlementState(info.data);
  const problems = settlementProblems(parsed, cfg);
  if (problems.length) throw new Error(`the settlement state on chain is not this deployment's: ${problems.join('; ')}`);
  mintCache = { state: state.toBase58(), mint: parsed.alphaMint, checkedAt: Date.now() };
  return parsed.alphaMint;
}

/** Live reserve — the escrow token-account balance, the solvency ceiling every
 * withdrawal request is checked against. Base units (9dp). */
export async function reserveFor(cfg: ChainConfig, conn: Connection = connectionFor(cfg)): Promise<bigint> {
  const mint = await alphaMintFor(cfg);
  const escrow = ataFor(statePda(cfg), mint);
  const bal = await conn.getTokenAccountBalance(escrow);
  return BigInt(bal.value.amount);
}

/** The reserve as the indexer sees it: at `finalized`, the commitment the indexer folds
 * withdrawals at. A redeemed voucher lowers the escrow at `confirmed` seconds before the
 * indexer marks it confirmed, and in that gap a `confirmed` reserve against a ledger
 * that still counts the voucher outstanding reads as a shortfall that is not there.
 * Public and audit views use this; the valve keeps the stricter `confirmed` read. */
export async function finalizedReserveFor(cfg: ChainConfig, conn: Connection = connectionFor(cfg)): Promise<bigint> {
  const mint = await alphaMintFor(cfg);
  const bal = await conn.getTokenAccountBalance(ataFor(statePda(cfg), mint), 'finalized');
  return BigInt(bal.value.amount);
}

// ----- the ed25519 voucher ---------------------------------------------------

export function voucherMessage(
  cfg: ChainConfig,
  v: { to: PublicKey; amount: bigint; nonce: bigint; deadline: bigint },
): Buffer {
  const msg = Buffer.alloc(116);
  msg.write(VOUCHER_DOMAIN, 0, 'ascii');
  cfg.programId.toBuffer().copy(msg, 20);
  msg.writeBigUInt64LE(BigInt(cfg.chainId), 52);
  v.to.toBuffer().copy(msg, 60);
  msg.writeBigUInt64LE(v.amount, 92);
  msg.writeBigUInt64LE(v.nonce, 100);
  msg.writeBigInt64LE(v.deadline, 108);
  return msg;
}

export function voucherSignerPubkey(cfg: ChainConfig): PublicKey {
  if (!cfg.signerSeed) throw new Error('OUTFOX_SIGNER_KEY not configured');
  return new PublicKey(nacl.sign.keyPair.fromSeed(cfg.signerSeed).publicKey);
}

/** Sign a withdrawal voucher. Returns the base58 ed25519 signature (64 bytes). */
export async function signVoucher(
  cfg: ChainConfig,
  v: { to: PublicKey | string; amount: bigint; nonce: bigint; deadline: bigint },
): Promise<string> {
  if (!cfg.signerSeed) throw new Error('OUTFOX_SIGNER_KEY not configured — cannot sign vouchers');
  const to = typeof v.to === 'string' ? new PublicKey(v.to) : v.to;
  const msg = voucherMessage(cfg, { ...v, to });
  const kp = nacl.sign.keyPair.fromSeed(cfg.signerSeed);
  return bs58.encode(nacl.sign.detached(msg, kp.secretKey));
}

// ----- client transactions ---------------------------------------------------
// The web app carries NO chain code: every transaction it asks a wallet to sign is
// built HERE and shipped down the wire as base64. One builder, one source of truth.

function disc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

export function depositIx(cfg: ChainConfig, mint: PublicKey, depositor: PublicKey, amount: bigint): TransactionInstruction {
  const state = statePda(cfg);
  const data = Buffer.alloc(16);
  disc('deposit').copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  return new TransactionInstruction({
    programId: cfg.programId,
    keys: [
      { pubkey: state, isSigner: false, isWritable: false },
      { pubkey: depositor, isSigner: true, isWritable: false },
      { pubkey: ataFor(depositor, mint), isSigner: false, isWritable: true },
      { pubkey: ataFor(state, mint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function withdrawIx(
  cfg: ChainConfig, mint: PublicKey, payer: PublicKey,
  v: { to: PublicKey; amount: bigint; nonce: bigint; deadline: bigint },
  ed25519IxIndex: number,
): TransactionInstruction {
  const state = statePda(cfg);
  const data = Buffer.alloc(33);
  disc('withdraw').copy(data, 0);
  data.writeBigUInt64LE(v.amount, 8);
  data.writeBigUInt64LE(v.nonce, 16);
  data.writeBigInt64LE(v.deadline, 24);
  data.writeUInt8(ed25519IxIndex, 32);
  return new TransactionInstruction({
    programId: cfg.programId,
    keys: [
      { pubkey: state, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: v.to, isSigner: false, isWritable: false },
      { pubkey: noncePda(cfg, v.nonce), isSigner: false, isWritable: true },
      { pubkey: ataFor(state, mint), isSigner: false, isWritable: true },
      { pubkey: ataFor(v.to, mint), isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function toBase64Unsigned(cfg: ChainConfig, feePayer: PublicKey, ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash } = await connectionFor(cfg).getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight: 0 });
  tx.add(...ixs);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

/** One wallet transaction: deposit `amount` base units into the escrow. (No approve
 * step — the depositor signs the transfer authority directly; ERC-2612's job is native.) */
export async function prepareDepositTx(cfg: ChainConfig, depositor: PublicKey | string, amount: bigint): Promise<string> {
  const from = typeof depositor === 'string' ? new PublicKey(depositor) : depositor;
  const mint = await alphaMintFor(cfg);
  return toBase64Unsigned(cfg, from, [depositIx(cfg, mint, from, amount)]);
}

/** One wallet transaction: [ed25519 verify, withdraw] redeeming a signed voucher.
 * Anyone may pay for and submit it; tokens go to the voucher's recipient. */
export async function prepareRedeemTx(
  cfg: ChainConfig, payer: PublicKey | string,
  v: { to: PublicKey | string; amount: bigint; nonce: bigint; deadline: bigint; signature: string },
): Promise<string> {
  const feePayer = typeof payer === 'string' ? new PublicKey(payer) : payer;
  const to = typeof v.to === 'string' ? new PublicKey(v.to) : v.to;
  const mint = await alphaMintFor(cfg);
  const msg = voucherMessage(cfg, { ...v, to });
  const ed = Ed25519Program.createInstructionWithPublicKey({
    publicKey: voucherSignerPubkey(cfg).toBytes(),
    message: msg,
    signature: bs58.decode(v.signature),
  });
  // ed25519 ix at index 1 (after the compute-budget ix), matching the u8 arg below
  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const wd = withdrawIx(cfg, mint, feePayer, { ...v, to }, 1);
  return toBase64Unsigned(cfg, feePayer, [cu, ed, wd]);
}

// ----- R2 wallet link (SIWS-lite) --------------------------------------------

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

/** Verify a wallet's ed25519 signature over the link message. `signature` is base58
 * (wallet-standard signMessage output). */
export async function verifyLinkSignature(
  address: string, message: string, signature: string,
): Promise<boolean> {
  try {
    return nacl.sign.detached.verify(
      Buffer.from(message, 'utf8'),
      bs58.decode(signature),
      new PublicKey(address).toBytes(),
    );
  } catch {
    return false;
  }
}
