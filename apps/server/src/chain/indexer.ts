/**
 * The indexer: pulls Deposited/Withdrawn events from the settlement program's
 * transactions and folds them into the game ledger through the valve.
 *
 * Every credited deposit is keyed by (signature, event index) — stored in the same
 * (tx_hash, log_index) columns the EVM era used — so re-indexing after a crash or
 * restart can never double-credit. Runs in-process at beta (ARCHITECTURE.md A8).
 */
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import type { DB } from '../core/db.js';
import { connectionFor, type ChainConfig } from './adapter.js';
import { creditDeposit, markWithdrawalConfirmed } from '../economy/valve.js';


const EVENT_DEPOSITED = createHash('sha256').update('event:Deposited').digest().subarray(0, 8);
const EVENT_WITHDRAWN = createHash('sha256').update('event:Withdrawn').digest().subarray(0, 8);

function getCursor(db: DB): string | null {
  const row = db.prepare(`SELECT last_sig FROM chain_cursor_sig WHERE id = 1`).get() as
    { last_sig: string } | undefined;
  return row?.last_sig ?? null;
}

function setCursor(db: DB, sig: string): void {
  db.prepare(
    `INSERT INTO chain_cursor_sig (id, last_sig) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET last_sig = excluded.last_sig`
  ).run(sig);
}

/** Records the raw event. Returns false if we have already seen it (idempotency). */
function recordEvent(
  db: DB, signature: string, eventIndex: number, slot: number, kind: string, payload: unknown,
): boolean {
  const existing = db.prepare(
    `SELECT 1 FROM chain_events WHERE tx_hash = ? AND log_index = ?`
  ).get(signature, eventIndex);
  if (existing) return false;
  db.prepare(
    `INSERT INTO chain_events (tx_hash, log_index, block, kind, payload, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(signature, eventIndex, slot, kind, JSON.stringify(payload), Date.now());
  return true;
}

/** Fold one transaction's events into the ledger. This IS the indexing logic — the
 * production indexer feeds it from RPC, and the M4 harness feeds it from an in-process
 * chain; the parse, idempotency, and blockTime seasoning-clock rules are shared.
 * A seasoning lot's clock starts when the deposit LANDED ON CHAIN, not when the
 * indexer happened to see it (M4 finding, carried over from the EVM edge). */
export function foldTransaction(
  db: DB, signature: string, slot: number, logs: string[], blockTimeMs: number | undefined,
  programId: PublicKey,
): { deposits: number; withdrawals: number } {
  let deposits = 0;
  let withdrawals = 0;
  parseEventsFromLogs(logs, programId).forEach((ev, i) => {
    const fresh = recordEvent(db, signature, i, slot, ev.kind, {
      address: ev.address, amount: ev.amount.toString(),
      ...(ev.nonce !== undefined ? { nonce: ev.nonce.toString() } : {}),
    });
    if (!fresh) return;
    if (ev.kind === 'Deposited') {
      creditDeposit(db, ev.address, ev.amount, signature, i, blockTimeMs);
      deposits++;
    } else {
      markWithdrawalConfirmed(db, ev.nonce!.toString(), signature);
      withdrawals++;
    }
  });
  return { deposits, withdrawals };
}

interface ParsedEvent {
  kind: 'Deposited' | 'Withdrawn';
  address: string;
  amount: bigint;
  nonce?: bigint;
}

/**
 * Anchor events ride in "Program data: <base64>" log lines: disc(8) ++ borsh fields.
 *
 * Only lines logged BY THE SETTLEMENT PROGRAM count. The log is a stack: every
 * "Program X invoke [n]" opens X's frame and "Program X success" or "Program X failed"
 * closes it, and a data line belongs to whichever frame is open. Any program can log
 * bytes shaped like our events (the discriminators are public), and any transaction can
 * name our program id as an account without invoking it, so a line outside our own
 * frame is noise, never a deposit (independent review, 2026-10-03). Inside our frame
 * the line is ours even when we were called by CPI: our program ran its own checks.
 */
export function parseEventsFromLogs(logs: string[], programId: PublicKey): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const ours = programId.toBase58();
  const stack: string[] = [];
  for (const line of logs) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) { stack.push(invoke[1]); continue; }
    const close = /^Program (\S+) (success|failed: .*)$/.exec(line);
    if (close) {
      // pop to the matching frame; a malformed log never leaves a foreign frame open as ours
      const at = stack.lastIndexOf(close[1]);
      stack.length = at < 0 ? 0 : at;
      continue;
    }
    if (!line.startsWith('Program data: ')) continue;
    if (stack[stack.length - 1] !== ours) continue;
    const raw = Buffer.from(line.slice('Program data: '.length), 'base64');
    if (raw.length < 8) continue;
    const d = raw.subarray(0, 8);
    if (d.equals(EVENT_DEPOSITED) && raw.length >= 48) {
      out.push({
        kind: 'Deposited',
        address: new PublicKey(raw.subarray(8, 40)).toBase58(),
        amount: raw.readBigUInt64LE(40),
      });
    } else if (d.equals(EVENT_WITHDRAWN) && raw.length >= 56) {
      out.push({
        kind: 'Withdrawn',
        address: new PublicKey(raw.subarray(8, 40)).toBase58(),
        amount: raw.readBigUInt64LE(40),
        nonce: raw.readBigUInt64LE(48),
      });
    }
  }
  return out;
}

/**
 * Pull one batch of program transactions (finalized) and fold their events in. Safe to
 * call repeatedly; safe to crash between calls — the cursor only advances after a batch
 * lands, and (signature, event index) keys make re-processing a no-op.
 */
export async function indexOnce(
  db: DB, cfg: ChainConfig,
): Promise<{ txs: number; deposits: number; withdrawals: number }> {
  const conn = connectionFor(cfg);
  const until = getCursor(db) ?? undefined;
  // newest-first page of finalized signatures back to the cursor
  const sigs = await conn.getSignaturesForAddress(
    cfg.programId, { until, limit: cfg.batchLimit ?? 100 }, 'finalized',
  );
  if (sigs.length === 0) return { txs: 0, deposits: 0, withdrawals: 0 };

  let deposits = 0;
  let withdrawals = 0;
  // fold oldest-first so the cursor is always behind everything processed
  for (const s of sigs.reverse()) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, {
      commitment: 'finalized', maxSupportedTransactionVersion: 0,
    });
    const r = foldTransaction(db, s.signature, s.slot, tx?.meta?.logMessages ?? [],
      tx?.blockTime ? tx.blockTime * 1000 : undefined, cfg.programId);
    deposits += r.deposits;
    withdrawals += r.withdrawals;
  }
  // cursor = newest signature in this batch (sigs was reversed; last item is newest)
  setCursor(db, sigs[sigs.length - 1].signature);
  return { txs: sigs.length, deposits, withdrawals };
}

/** Background loop. Errors are logged, never fatal — the cursor only advances on
 * success, so a transient RPC failure just retries the same window. */
export function startIndexer(
  db: DB, cfg: ChainConfig, intervalMs = 5_000,
  log: (msg: string) => void = () => {},
  onOk: () => void = () => {},
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const r = await indexOnce(db, cfg);
      onOk();
      if (r.deposits || r.withdrawals) {
        log(`indexed ${r.txs} tx(s): ${r.deposits} deposit(s), ${r.withdrawals} withdrawal(s)`);
      }
    } catch (e) {
      log(`indexer error (will retry): ${(e as Error).message}`);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  void tick();
  return () => { stopped = true; };
}
