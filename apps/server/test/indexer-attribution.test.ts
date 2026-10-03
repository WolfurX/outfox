/**
 * The indexer must credit only events the settlement program itself logged. Event
 * discriminators are public and any program can log identical bytes; any transaction
 * can name our program id without invoking it. Independent review 2026-10-03 forged a
 * 100,000 ALPHA deposit this way on a local validator against the previous parser.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { openDb } from '../src/core/db.js';
import { foldTransaction, parseEventsFromLogs } from '../src/chain/indexer.js';

const OURS = Keypair.generate().publicKey;
const ATTACKER = Keypair.generate().publicKey;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const WALLET = Keypair.generate().publicKey;

function deposited(address: PublicKey, amount: bigint): string {
  const buf = Buffer.alloc(48);
  createHash('sha256').update('event:Deposited').digest().copy(buf, 0, 0, 8);
  address.toBuffer().copy(buf, 8);
  buf.writeBigUInt64LE(amount, 40);
  return `Program data: ${buf.toString('base64')}`;
}
const inv = (p: PublicKey | string, n: number) => `Program ${p.toString()} invoke [${n}]`;
const ok = (p: PublicKey | string) => `Program ${p.toString()} success`;
const EV = deposited(WALLET, 100_000n * 10n ** 9n);

describe('event attribution', () => {
  it('counts an event logged inside our own frame, around an inner token CPI', () => {
    const logs = [inv(OURS, 1), 'Program log: Instruction: Deposit', inv(TOKEN, 2), 'Program log: Instruction: Transfer', ok(TOKEN), EV, ok(OURS)];
    const ev = parseEventsFromLogs(logs, OURS);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'Deposited', address: WALLET.toBase58(), amount: 100_000n * 10n ** 9n });
  });
  it('ignores the same bytes logged by another program, with ours merely named in the transaction', () => {
    expect(parseEventsFromLogs([inv(ATTACKER, 1), EV, ok(ATTACKER)], OURS)).toEqual([]);
  });
  it('ignores bytes logged after our frame closed inside an outer program', () => {
    expect(parseEventsFromLogs([inv(ATTACKER, 1), inv(OURS, 2), 'Program log: Instruction: Pause', ok(OURS), EV, ok(ATTACKER)], OURS)).toEqual([]);
  });
  it('still counts our event when we were invoked by CPI', () => {
    expect(parseEventsFromLogs([inv(ATTACKER, 1), inv(OURS, 2), EV, ok(OURS), ok(ATTACKER)], OURS)).toHaveLength(1);
  });
  it('a failed foreign frame cannot leave itself open as ours', () => {
    expect(parseEventsFromLogs([inv(ATTACKER, 1), `Program ${ATTACKER.toBase58()} failed: custom program error: 0x1`, EV], OURS)).toEqual([]);
  });
  it('with no frame at all (a malformed log) nothing counts', () => {
    expect(parseEventsFromLogs([EV], OURS)).toEqual([]);
  });
  it('the fold credits nothing from a forged transaction', () => {
    const db = openDb(':memory:');
    const forged = foldTransaction(db, 'sig1', 1, [inv(ATTACKER, 1), EV, ok(ATTACKER)], 1_800_000_000_000, OURS);
    expect(forged).toEqual({ deposits: 0, withdrawals: 0 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM chain_events').get() as { n: number }).n).toBe(0);
    const real = foldTransaction(db, 'sig2', 2, [inv(OURS, 1), EV, ok(OURS)], 1_800_000_000_000, OURS);
    expect(real.deposits).toBe(1);
  });
});
