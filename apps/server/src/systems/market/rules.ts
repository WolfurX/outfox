/**
 * The Open Market (GDD §5.5): player listings at player prices, Settled Scrip only.
 * I1 lives here — the provenance firewall at the P2P boundary.
 */
import type { DB } from '../../core/db.js';
import { EngineError } from '../../core/errors.js';
import { withTx } from '../../core/tx.js';
import { getPlayer, postTx, treasuryAdd } from '../../ledger/scrip.js';
import { applyCarry } from '../../economy/carry.js';
import { requireRung } from '../../identity/players.js';
import { MARKET_FEE_BPS, type ItemKind, type ListingView } from '@outfox/shared';

export function listItem(db: DB, playerId: number, itemId: number, price: number, now = Date.now()): void {
  requireRung(db, playerId, 1); // §10.1: listing is the canonical demanding surface
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000) {
    // words, not glyphs: server strings render as plain text and carry no SVG marks
    throw new EngineError('bad_amount', 'price must be between 1 and 1,000,000 Scrip');
  }
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId) as
    { id: number; owner_id: number; listed: number; consumed_at: number | null } | undefined;
  if (!item || item.owner_id !== playerId) throw new EngineError('not_yours', 'not your item');
  if (item.consumed_at !== null) throw new EngineError('used_up', 'that item is used up');
  if (item.listed) throw new EngineError('already_listed', 'already on the book');
  withTx(db, () => {
    db.prepare(`UPDATE items SET listed = 1 WHERE id = ?`).run(itemId);
    db.prepare(`INSERT INTO listings (item_id, seller_id, price, created_at) VALUES (?, ?, ?, ?)`)
      .run(itemId, playerId, price, now);
  });
}

export function cancelListing(db: DB, playerId: number, listingId: number): void {
  const l = db.prepare(`SELECT * FROM listings WHERE id = ? AND active = 1`).get(listingId) as
    { id: number; item_id: number; seller_id: number } | undefined;
  if (!l || l.seller_id !== playerId) throw new EngineError('not_yours', 'not your listing');
  withTx(db, () => {
    db.prepare(`UPDATE listings SET active = 0 WHERE id = ?`).run(listingId);
    db.prepare(`UPDATE items SET listed = 0 WHERE id = ?`).run(l.item_id);
  });
}

/**
 * Buy: SETTLED SCRIP ONLY (I1 — the firewall at the P2P boundary). The UI never offers
 * Unsettled here; the engine enforces it regardless. Fee → treasury (CAPTURE).
 */
export function buyListing(db: DB, playerId: number, listingId: number, now = Date.now()): void {
  requireRung(db, playerId, 1); // P2P value transfer gates at R1 (§10.1)
  withTx(db, () => {
    applyCarry(db, playerId, now);
    const l = db.prepare(`SELECT * FROM listings WHERE id = ? AND active = 1`).get(listingId) as
      { id: number; item_id: number; seller_id: number; price: number } | undefined;
    if (!l) throw new EngineError('gone', 'listing is gone');
    if (l.seller_id === playerId) throw new EngineError('own_listing', 'that is your own listing');
    const buyer = getPlayer(db, playerId);
    if (buyer.scrip_settled < l.price) {
      // Deliberately NOT total-balance: Unsettled cannot fund a P2P purchase.
      throw new EngineError('insufficient_settled', 'not enough Settled Scrip');
    }
    // Settle the seller's carry clock BEFORE crediting — otherwise stale carry_at
    // decays the proceeds for idle days that preceded the sale (over-capture).
    applyCarry(db, l.seller_id, now);
    const fee = Math.ceil((l.price * MARKET_FEE_BPS) / 10_000);
    postTx(db, playerId, -l.price, 0, 'market_buy', `listing:${l.id}`, now);
    postTx(db, l.seller_id, l.price - fee, 0, 'market_sale', `listing:${l.id}`, now);
    treasuryAdd(db, fee);
    db.prepare(`UPDATE listings SET active = 0 WHERE id = ?`).run(l.id);
    db.prepare(`UPDATE items SET owner_id = ?, listed = 0 WHERE id = ?`).run(playerId, l.item_id);
  });
}

export function listingsView(db: DB, playerId: number): ListingView[] {
  const rows = db.prepare(
    `SELECT l.id, l.price, l.seller_id, i.kind, p.handle
     FROM listings l JOIN items i ON i.id = l.item_id JOIN players p ON p.id = l.seller_id
     WHERE l.active = 1 ORDER BY l.id DESC LIMIT 100`
  ).all() as { id: number; price: number; seller_id: number; kind: ItemKind; handle: string }[];
  return rows.map((r) => ({
    id: r.id, itemKind: r.kind, price: r.price, seller: r.handle, mine: r.seller_id === playerId,
  }));
}
