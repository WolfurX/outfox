/**
 * `initialize` can be called by whoever gets there first, and it fixes the admin and the
 * voucher signer for good. The server must never treat a settlement state someone else
 * initialized as its own (chain/adapter.ts settlementProblems, enforced in alphaMintFor,
 * which every deposit, reserve and redeem path goes through).
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { alphaMintFor, parseSettlementState, settlementProblems, statePda, type ChainConfig } from '../src/chain/adapter.js';

const SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const OUR_SIGNER = new PublicKey(nacl.sign.keyPair.fromSeed(SEED).publicKey);
const OUR_ADMIN = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const cfg = (over: Partial<ChainConfig> = {}): ChainConfig => ({
  rpcUrl: 'http://unused.invalid', chainId: 1, programId: Keypair.generate().publicKey,
  signerSeed: SEED, admin: OUR_ADMIN, ...over,
});

/** A settlement state account as the program writes it (programs/settlement SettlementState). */
function stateBytes(o: { admin?: PublicKey; signer?: PublicKey; chainId?: bigint; pending?: PublicKey } = {}) {
  const parts = [
    Buffer.alloc(8), // discriminator
    (o.admin ?? OUR_ADMIN).toBuffer(),
    o.pending ? Buffer.concat([Buffer.from([1]), o.pending.toBuffer()]) : Buffer.from([0]),
    (o.signer ?? OUR_SIGNER).toBuffer(),
    MINT.toBuffer(),
    Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8), // window cap, bucket, last drain
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(o.chainId ?? 1n); return b; })(),
    Buffer.from([0, 255]), // paused, bump
  ];
  return Buffer.concat(parts);
}
const state = (o: Parameters<typeof stateBytes>[0] = {}) => parseSettlementState(stateBytes(o));

describe('settlementProblems', () => {
  it('accepts the state this deployment initialized', () => {
    expect(settlementProblems(state(), cfg())).toEqual([]);
    expect(state().alphaMint.equals(MINT)).toBe(true);
  });
  it('refuses a state whose voucher signer is someone else\'s', () => {
    expect(settlementProblems(state({ signer: Keypair.generate().publicKey }), cfg())).toEqual([
      'its voucher signer is not this server\'s key',
    ]);
  });
  it('refuses a state whose admin is not the configured admin, even with our signer', () => {
    // the front-run that survives a signer check: our public signer key, their admin
    expect(settlementProblems(state({ admin: Keypair.generate().publicKey }), cfg())).toEqual([
      'its admin is not the configured admin',
    ]);
  });
  it('refuses a state initialized for another cluster', () => {
    expect(settlementProblems(state({ chainId: 2n }), cfg())).toEqual(['it was initialized for chain id 2']);
  });
  it('a pending admin transfer shifts the layout and is still read correctly', () => {
    expect(settlementProblems(state({ pending: Keypair.generate().publicKey }), cfg())).toEqual([]);
  });
  it('without a configured admin only the signer and the cluster are checked', () => {
    expect(settlementProblems(state({ admin: Keypair.generate().publicKey }), cfg({ admin: undefined }))).toEqual([]);
  });
});

describe('alphaMintFor enforces it', () => {
  /** A one-account JSON-RPC endpoint: the settlement state of `c`, owned by `owner`. */
  async function rpcWith(data: Buffer, owner: (c: ChainConfig) => PublicKey) {
    const c = cfg();
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (x) => { body += x; });
      req.on('end', () => {
        const { id, params } = JSON.parse(body);
        const value = params[0] === statePda(c).toBase58()
          ? { data: [data.toString('base64'), 'base64'], executable: false, lamports: 1, owner: owner(c).toBase58(), rentEpoch: 0 }
          : null;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    c.rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { c, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
  }

  it('returns the mint of our own state', async () => {
    const { c, close } = await rpcWith(stateBytes(), (x) => x.programId);
    try { expect((await alphaMintFor(c)).equals(MINT)).toBe(true); } finally { await close(); }
  });
  it('throws on a state initialized with another signer, and keeps throwing', async () => {
    const { c, close } = await rpcWith(stateBytes({ signer: Keypair.generate().publicKey }), (x) => x.programId);
    try {
      await expect(alphaMintFor(c)).rejects.toThrow(/not this deployment's.*voucher signer/);
      await expect(alphaMintFor(c)).rejects.toThrow(/not this deployment's/); // nothing was cached
    } finally { await close(); }
  });
  it('throws when the account at the state address is not the program\'s', async () => {
    const { c, close } = await rpcWith(stateBytes(), () => PublicKey.default); // e.g. lamports sent there
    try { await expect(alphaMintFor(c)).rejects.toThrow(/not owned by the program/); } finally { await close(); }
  });
});
