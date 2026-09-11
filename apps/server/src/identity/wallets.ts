/**
 * R2: the linked wallet. A purpose-bound nonce, a proven signature, one wallet per Fox
 * and one Fox per wallet. Linking claims any deposits that arrived at the address
 * before the link (held in unclaimed_deposits, never lost).
 */
import { randomBytes } from 'node:crypto';
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import { withTx } from '../core/tx.js';
import { DAY_MS } from '../core/time.js';
import { postAlpha, treasuryAlphaAdd } from '../ledger/alpha.js';
import { applyAlphaCarry, idleDecayCompound } from '../economy/carry.js';

export function issueLinkNonce(db: DB, playerId: number, now = Date.now()): string {
  const nonce = randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO wallet_nonces (nonce, player_id, expires_at) VALUES (?, ?, ?)`
  ).run(nonce, playerId, now + 10 * 60 * 1000);
  return nonce;
}

export function consumeLinkNonce(db: DB, playerId: number, nonce: string, now = Date.now()): void {
  const row = db.prepare(`SELECT player_id, expires_at FROM wallet_nonces WHERE nonce = ?`)
    .get(nonce) as { player_id: number; expires_at: number } | undefined;
  if (!row || row.player_id !== playerId) throw new EngineError('bad_nonce', 'link request not found');
  if (row.expires_at < now) throw new EngineError('bad_nonce', 'link request expired — try again');
  db.prepare(`DELETE FROM wallet_nonces WHERE nonce = ?`).run(nonce);
}

/** Link a proven-controlled wallet and promote to R2. Claims any deposits that arrived at
 * this address before it was linked. One wallet ↔ one player: an address already linked
 * elsewhere is rejected rather than silently re-pointed. */
export function linkWallet(db: DB, playerId: number, address: string, now = Date.now()): void {
  // base58 is case-sensitive: callers pass the canonical form (PublicKey.toBase58()),
  // and it is stored and compared verbatim.
  const addr = address;
  withTx(db, () => {
    const taken = db.prepare(`SELECT player_id FROM wallets WHERE address = ?`).get(addr) as
      { player_id: number } | undefined;
    if (taken && taken.player_id !== playerId) {
      throw new EngineError('wallet_taken', 'that wallet is already linked to another Fox');
    }
    const mine = db.prepare(`SELECT address FROM wallets WHERE player_id = ?`).get(playerId) as
      { address: string } | undefined;
    if (mine && mine.address !== addr) {
      throw new EngineError('already_linked', 'this account already has a linked wallet');
    }
    if (!taken) {
      db.prepare(`INSERT INTO wallets (address, player_id, linked_at) VALUES (?, ?, ?)`)
        .run(addr, playerId, now);
    }
    const p = db.prepare(`SELECT rung FROM players WHERE id = ?`).get(playerId) as { rung: number };
    if (p.rung < 2) db.prepare(`UPDATE players SET rung = 2 WHERE id = ?`).run(playerId);

    // claim deposits that landed before the link (held, not lost)
    applyAlphaCarry(db, playerId, now); // settle existing lots before new ones land
    const held = db.prepare(
      `SELECT tx_hash, log_index, amount_wei, at FROM unclaimed_deposits WHERE address = ?`
    ).all(addr) as { tx_hash: string; log_index: number; amount_wei: string; at: number }[];
    for (const h of held) {
      // The lot keeps its arrival clock for seasoning (§13.C), but the held wait pays
      // the §13.A idle decay — otherwise "deposit unlinked, link once seasoned" would
      // age out the surcharge while dodging the holding cost the sim charges for that
      // patience. Base rate only: unclaimed value belongs to no identity, and a
      // per-address progressive would be trivially split-dodged anyway.
      const amount = BigInt(h.amount_wei);
      const heldDays = Math.floor((now - h.at) / DAY_MS);
      const net = idleDecayCompound(amount, heldDays);
      const decay = amount - net;
      const lotId = postAlpha(db, playerId, amount, 'deposit', `${h.tx_hash}:${h.log_index}`, h.at, {
        credit: { wei: amount, acquiredAt: h.at, source: 'deposit' },
      })!;
      if (decay > 0n) {
        treasuryAlphaAdd(db, decay);
        postAlpha(db, playerId, -decay, 'carry', `carry:held:${heldDays}d`, now, {
          rebalance: [{ id: lotId, remainingWei: net }],
        });
      }
      db.prepare(`DELETE FROM unclaimed_deposits WHERE tx_hash = ? AND log_index = ?`)
        .run(h.tx_hash, h.log_index);
    }
  });
}
