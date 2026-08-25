/**
 * Persistence for the vertical slice: node:sqlite (built into Node 22).
 * Production target is PostgreSQL (PLAN.md §4) — schema and access stay portable:
 * plain SQL, integer money, no sqlite-isms beyond the driver import.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

// Runtime require keeps bundlers (vite/vitest) from trying to resolve the builtin —
// vite strips the node: prefix and fails to find "sqlite" (vite#17561-class issue).
const requireRuntime = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncImpl } =
  requireRuntime('node:sqlite') as typeof import('node:sqlite');

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  const db = new DatabaseSyncImpl(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      focus REAL NOT NULL,
      focus_at INTEGER NOT NULL,
      risk REAL NOT NULL,
      risk_at INTEGER NOT NULL,
      scrip_settled INTEGER NOT NULL DEFAULT 0,
      scrip_unsettled INTEGER NOT NULL DEFAULT 0,
      gig_count INTEGER NOT NULL DEFAULT 0,
      carry_at INTEGER NOT NULL,
      alpha_carry_at INTEGER NOT NULL DEFAULT 0,
      rung INTEGER NOT NULL DEFAULT 0,
      email TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS auth_codes (
      email TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES players(id),
      kind TEXT NOT NULL,
      origin TEXT NOT NULL,
      listed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id),
      seller_id INTEGER NOT NULL REFERENCES players(id),
      price INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id),
      d_settled INTEGER NOT NULL,
      d_unsettled INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cooldowns (
      player_id INTEGER NOT NULL REFERENCES players(id),
      action_id TEXT NOT NULL,
      ready_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, action_id)
    );
    CREATE TABLE IF NOT EXISTS treasury (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      scrip INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO treasury (id, scrip) VALUES (1, 0);
    CREATE INDEX IF NOT EXISTS idx_ledger_player ON ledger(player_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_items_owner ON items(owner_id);
    CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(active, id DESC);

    -- ===== the chain edge (Settlement integration) =============================
    -- ALPHA amounts are TEXT decimal WEI. int64 cannot hold 2,000,000e18 and float64
    -- cannot hold it exactly; BigInt + TEXT keeps the game ledger bit-exact with chain.

    -- R2: one wallet per player, one player per wallet (SIWE-proven control).
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,              -- lowercase 0x…
      player_id INTEGER NOT NULL UNIQUE REFERENCES players(id),
      linked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_nonces (
      nonce TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      expires_at INTEGER NOT NULL
    );

    -- Seasoning lots (§13.C): every acquisition is a lot with an acquisition time.
    -- Withdrawals consume SEASONED lots first; unseasoned remainder pays the surcharge.
    -- Time cannot be wash-traded away, so the lot's clock is the defense.
    CREATE TABLE IF NOT EXISTS alpha_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id),
      remaining_wei TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      source TEXT NOT NULL                   -- deposit | exchange | (later: primary)
    );
    CREATE INDEX IF NOT EXISTS idx_lots_player ON alpha_lots(player_id, acquired_at);

    -- Append-only ALPHA ledger (DATA-ARCHITECTURE.md: state is a fold over events).
    CREATE TABLE IF NOT EXISTS alpha_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id),
      delta_wei TEXT NOT NULL,               -- signed
      kind TEXT NOT NULL,                    -- deposit | withdraw_request | withdraw_fee
                                             --   | exchange_buy | exchange_sell
      ref TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alpha_ledger_player ON alpha_ledger(player_id, id DESC);

    -- Withdrawal lifecycle: requested → vesting → claimable → signed → confirmed.
    -- The voucher nonce is a RANDOM uint256, not the row id: the contract's nonce space
    -- is global and permanent, so a row id would collide with an already-burned nonce
    -- after any DB restore, or across two server instances on one deployment. Random
    -- 256-bit is collision-proof, non-enumerable, and still maps 1:1 to a row.
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nonce TEXT NOT NULL UNIQUE,
      player_id INTEGER NOT NULL REFERENCES players(id),
      to_address TEXT NOT NULL,
      gross_wei TEXT NOT NULL,
      fee_wei TEXT NOT NULL,
      net_wei TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at INTEGER NOT NULL,
      vests_at INTEGER NOT NULL,
      deadline INTEGER,                      -- voucher expiry (set at claim)
      signature TEXT,
      tx_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wd_player ON withdrawals(player_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_wd_nonce ON withdrawals(nonce);

    -- Raw chain events, immutable (the indexer's source of truth; replayable).
    CREATE TABLE IF NOT EXISTS chain_events (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block INTEGER NOT NULL,
      kind TEXT NOT NULL,                    -- Deposited | Withdrawn
      payload TEXT NOT NULL,                 -- JSON, verbatim
      at INTEGER NOT NULL,
      PRIMARY KEY (tx_hash, log_index)       -- idempotent: re-indexing never double-credits
    );
    CREATE TABLE IF NOT EXISTS chain_cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_block INTEGER NOT NULL
    );

    -- Deposits to an address with no linked player are held, not lost.
    CREATE TABLE IF NOT EXISTS unclaimed_deposits (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      address TEXT NOT NULL,
      amount_wei TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_unclaimed_addr ON unclaimed_deposits(address);

    -- ===== the Exchange (Scrip <-> ALPHA, ECONOMY.md §8) =======================
    -- Protocol-owned constant-product pool. The row is the fold; exchange_events is
    -- the append-only truth (DATA-ARCHITECTURE.md — the G9 price series lives there).
    CREATE TABLE IF NOT EXISTS exchange_pool (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      credit_cents INTEGER NOT NULL,
      alpha_wei TEXT NOT NULL
    );
    -- One row per trade (and one 'seed'). Money columns are exact integers; rate/fee
    -- multiplier are derived metrics (REAL is fine — estimators, not money).
    CREATE TABLE IF NOT EXISTS exchange_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER,                     -- NULL for 'seed'
      kind TEXT NOT NULL,                    -- buy | sell | seed
      credit_in INTEGER NOT NULL DEFAULT 0,  -- ¢ into the pool side (gross, pre-fee)
      credit_out INTEGER NOT NULL DEFAULT 0, -- ¢ paid out to the player
      alpha_in TEXT NOT NULL DEFAULT '0',    -- wei into the pool side (gross, pre-fee)
      alpha_out TEXT NOT NULL DEFAULT '0',   -- wei paid out to the player
      fee_credit INTEGER NOT NULL DEFAULT 0, -- buy-leg fee, ¢ -> treasury
      fee_alpha TEXT NOT NULL DEFAULT '0',   -- sell-leg fee, wei -> treasury_alpha
      fee_mult REAL NOT NULL DEFAULT 1,      -- circuit-breaker multiplier applied
      rate_after REAL NOT NULL,              -- ¢ per ALPHA after the trade (G9 series)
      ref TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exchange_events_at ON exchange_events(at);
    -- Daily EMA state for the circuit-breaker fee (§13.B): rolled once per elapsed
    -- day from the close; trades inside a day never move their own fee.
    CREATE TABLE IF NOT EXISTS exchange_ema (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      e_fast REAL NOT NULL,
      e_slow REAL NOT NULL,
      day INTEGER NOT NULL                   -- floor(gameTime / 1d) of the last roll
    );
    -- ALPHA captured in-loop (sell-leg fees; later §13.B ops, §13.D carry). Policy
    -- ammunition, never operator revenue (ECONOMY.md §3.4).
    CREATE TABLE IF NOT EXISTS treasury_alpha (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      wei TEXT NOT NULL
    );
    INSERT OR IGNORE INTO treasury_alpha (id, wei) VALUES (1, '0');
  `);
  // Migration: alpha_carry_at arrived with the §13.A/§13.D carry module. Pre-module
  // rows get the clock started at upgrade time — the carry is not retroactive.
  const cols = db.prepare(`PRAGMA table_info(players)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'alpha_carry_at')) {
    db.exec(`ALTER TABLE players ADD COLUMN alpha_carry_at INTEGER NOT NULL DEFAULT 0`);
    db.prepare(`UPDATE players SET alpha_carry_at = ?`).run(Date.now());
  }
  return db;
}
