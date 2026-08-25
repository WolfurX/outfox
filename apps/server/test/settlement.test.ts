import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { createPlayer, EngineError } from '../src/engine.js';
import {
  creditDeposit, linkWallet, alphaBalance, unseasonedBalance, requestWithdrawal,
  priceWithdrawal, prepareClaim, recordSignedVoucher, markWithdrawalConfirmed,
  weeklyRemaining, solvencyAudit, outstandingNet, alphaView, refreshVesting,
} from '../src/settlement.js';
import { ALPHA_BASE_UNITS, VALVE } from '@outfox/shared';

const DAY = 86_400_000;
const A = (n: number | bigint) => BigInt(n) * ALPHA_BASE_UNITS; // whole ALPHA → base units
const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';
const BIG_RESERVE = A(1_000_000);

let db: DB;
let p: number;

/** R3 = verified: the only rung that may cash out. */
function verify(id: number) {
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
}

beforeEach(() => {
  db = openDb(':memory:');
  p = createPlayer(db);
});

describe('deposits', () => {
  it('credits a linked wallet and starts an UNSEASONED lot', () => {
    linkWallet(db, p, W1);
    creditDeposit(db, W1, A(100), '0xtx1', 0);
    expect(alphaBalance(db, p)).toBe(A(100));
    expect(unseasonedBalance(db, p)).toBe(A(100)); // fresh acquisition (§13.C)
  });

  it('lots season with time', () => {
    linkWallet(db, p, W1);
    const old = Date.now() - (VALVE.seasoningDays + 1) * DAY;
    creditDeposit(db, W1, A(100), '0xtx1', 0, old);
    expect(alphaBalance(db, p)).toBe(A(100));
    expect(unseasonedBalance(db, p)).toBe(0n); // aged out
  });

  it('HOLDS deposits from unlinked addresses and pays them out on link (never lost)', () => {
    creditDeposit(db, W1, A(42), '0xtx1', 0);
    expect(alphaBalance(db, p)).toBe(0n);
    linkWallet(db, p, W1);
    expect(alphaBalance(db, p)).toBe(A(42));
  });

  it('rejects linking a wallet already owned by another Fox', () => {
    const q = createPlayer(db);
    linkWallet(db, p, W1);
    expect(() => linkWallet(db, q, W1)).toThrow(EngineError);
  });

  it('linking promotes R0/R1 to R2', () => {
    linkWallet(db, p, W1);
    const r = db.prepare(`SELECT rung FROM players WHERE id = ?`).get(p) as { rung: number };
    expect(r.rung).toBe(2);
  });
});

describe('the §9 gates', () => {
  beforeEach(() => {
    linkWallet(db, p, W1);
    creditDeposit(db, W1, A(100), '0xtx1', 0);
  });

  it('V1: an unverified Fox cannot cash out (R3 required)', () => {
    expect(() => requestWithdrawal(db, p, A(10), BIG_RESERVE))
      .toThrow(/verify your identity/);
  });

  it('V1: verified can', () => {
    verify(p);
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    expect(wd.status).toBe('vesting');
  });

  // NOTE: every amount here stays under VALVE.weeklyCapAlpha (58) — the cap is checked
  // before pricing, so a bigger figure would (correctly) trip V5 instead.

  it('V3: fee is 5% on seasoned value', () => {
    verify(p);
    const old = Date.now() - (VALVE.seasoningDays + 1) * DAY;
    db.prepare(`UPDATE alpha_lots SET acquired_at = ? WHERE player_id = ?`).run(old, p);
    const wd = requestWithdrawal(db, p, A(40), BIG_RESERVE);
    expect(BigInt(wd.feeWei)).toBe(A(2));         // 5% of 40
    expect(BigInt(wd.netWei)).toBe(A(38));
  });

  it('V2: unseasoned value pays fee + 40% surcharge', () => {
    verify(p);
    const wd = requestWithdrawal(db, p, A(40), BIG_RESERVE); // all fresh
    expect(BigInt(wd.feeWei)).toBe(A(18));        // 5% + 40% of 40
    expect(BigInt(wd.netWei)).toBe(A(22));
  });

  it('V2: seasoned lots are consumed FIRST, so the surcharge bites only fresh value', () => {
    verify(p);
    // 30 aged + 100 fresh
    const old = Date.now() - (VALVE.seasoningDays + 1) * DAY;
    db.prepare(`UPDATE alpha_lots SET acquired_at = ? WHERE player_id = ?`).run(old, p);
    db.prepare(`UPDATE alpha_lots SET remaining_wei = ? WHERE player_id = ?`).run(A(30).toString(), p);
    creditDeposit(db, W1, A(100), '0xtx2', 0);
    // withdraw 50: 30 seasoned + 20 unseasoned
    const wd = requestWithdrawal(db, p, A(50), BIG_RESERVE);
    const expected = (A(50) * 500n) / 10_000n + (A(20) * 4000n) / 10_000n;
    expect(BigInt(wd.feeWei)).toBe(expected);
  });

  it('V4: the voucher cannot be claimed while vesting, and can after', () => {
    verify(p);
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    expect(() => prepareClaim(db, p, wd.id)).toThrow(/vesting/);
    const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
    const c = prepareClaim(db, p, wd.id, later);
    expect(c.amountWei).toBe(BigInt(wd.netWei));
    expect(c.to.toLowerCase()).toBe(W1);
    // the nonce is a random uint256, NOT the row id: the contract's nonce space is
    // global and permanent, so row ids would collide after a DB restore (found by
    // driving the real chain — a fresh DB reused nonce 1, already burned on-chain).
    expect(c.nonce).toBeGreaterThan(2n ** 32n); // random u64 (the program's nonce space), not a row counter
  });

  it('nonces are unique and unguessable across withdrawals', () => {
    verify(p);
    const a = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    const b = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
    const na = prepareClaim(db, p, a.id, later).nonce;
    const nb = prepareClaim(db, p, b.id, later).nonce;
    expect(na).not.toBe(nb);
    expect(na).toBeGreaterThan(2n ** 32n); // random u64, not a counter
  });

  it('V5: the rolling weekly cap binds', () => {
    verify(p);
    creditDeposit(db, W1, A(1000), '0xtx2', 0);
    const cap = BigInt(VALVE.weeklyCapAlpha) * ALPHA_BASE_UNITS;
    requestWithdrawal(db, p, cap, BIG_RESERVE);
    expect(weeklyRemaining(db, p)).toBe(0n);
    expect(() => requestWithdrawal(db, p, A(1), BIG_RESERVE)).toThrow(/weekly cash-out limit/);
  });

  it('V5: the cap frees up after the week rolls', () => {
    verify(p);
    creditDeposit(db, W1, A(1000), '0xtx2', 0);
    const cap = BigInt(VALVE.weeklyCapAlpha) * ALPHA_BASE_UNITS;
    requestWithdrawal(db, p, cap, BIG_RESERVE);
    const nextWeek = Date.now() + 8 * DAY;
    expect(weeklyRemaining(db, p, nextWeek)).toBe(cap);
  });

  it('V6: cannot promise more than the reserve holds', () => {
    verify(p);
    expect(() => requestWithdrawal(db, p, A(50), A(1)))
      .toThrow(/temporarily unavailable/);
  });

  it('V6: a second request cannot oversubscribe what the first already owes', () => {
    verify(p);
    // fresh value: gross 25 → fee 11.25 → net 13.75. Two of those owe 27.5 > reserve 20.
    const reserve = A(20);
    requestWithdrawal(db, p, A(25), reserve);
    expect(outstandingNet(db)).toBe(A(25) - (A(25) * 4500n) / 10_000n);
    expect(() => requestWithdrawal(db, p, A(25), reserve)).toThrow(/temporarily unavailable/);
  });

  it('debits the balance at REQUEST time (no double-spend while vesting)', () => {
    verify(p);
    requestWithdrawal(db, p, A(50), BIG_RESERVE);
    expect(alphaBalance(db, p)).toBe(A(50)); // gone from the balance immediately
  });

  it('rejects a withdrawal larger than the balance', () => {
    const q = createPlayer(db);
    linkWallet(db, q, W2);
    verify(q);
    creditDeposit(db, W2, A(5), '0xtxq', 0);
    expect(() => requestWithdrawal(db, q, A(10), BIG_RESERVE)).toThrow(/not enough ALPHA/);
  });
});

describe('withdrawal lifecycle', () => {
  beforeEach(() => {
    linkWallet(db, p, W1);
    creditDeposit(db, W1, A(100), '0xtx1', 0);
    verify(p);
  });

  it('confirms on the chain event, matched by the voucher nonce', () => {
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
    const c = prepareClaim(db, p, wd.id, later);
    recordSignedVoucher(db, wd.id, '0xsig', 999n);
    expect(outstandingNet(db)).toBe(BigInt(wd.netWei));  // still owed
    markWithdrawalConfirmed(db, c.nonce.toString(), '0xhash');
    expect(outstandingNet(db)).toBe(0n);                 // settled
    const v = alphaView(db, p).withdrawals[0];
    expect(v.status).toBe('confirmed');
    expect(v.txHash).toBe('0xhash');
  });

  it('an unknown nonce (e.g. a prior deployment) confirms nothing', () => {
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    markWithdrawalConfirmed(db, '123456789', '0xhash');
    expect(alphaView(db, p).withdrawals[0].status).not.toBe('confirmed');
    expect(outstandingNet(db)).toBe(BigInt(wd.netWei));
  });

  it('an expired voucher can be re-signed — the nonce burns once on-chain', () => {
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
    const first = prepareClaim(db, p, wd.id, later);
    recordSignedVoucher(db, wd.id, '0xsig1', 1n);
    const again = prepareClaim(db, p, wd.id, later + 7200_000); // re-claim after expiry
    expect(again.nonce).toBe(first.nonce);                      // same nonce, fresh deadline
    expect(again.deadline).toBeGreaterThan(first.deadline);
  });

  it('a confirmed withdrawal cannot be re-claimed', () => {
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
    const c = prepareClaim(db, p, wd.id, later);
    markWithdrawalConfirmed(db, c.nonce.toString(), '0xhash');
    expect(() => prepareClaim(db, p, wd.id, later)).toThrow(/already cashed out/);
  });

  it("another Fox cannot claim someone else's withdrawal", () => {
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE);
    const q = createPlayer(db);
    const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
    expect(() => prepareClaim(db, q, wd.id, later)).toThrow(/not your withdrawal/);
  });
});

describe('solvency (V6 / proof of reserves)', () => {
  it('holds while the reserve covers balances + unconfirmed vouchers, and shows the fee surplus', () => {
    linkWallet(db, p, W1);
    creditDeposit(db, W1, A(100), '0xtx1', 0);
    verify(p);
    // reserve mirrors what was actually deposited on-chain
    let audit = solvencyAudit(db, A(100));
    expect(audit.holds).toBe(true);
    expect(BigInt(audit.liabilitiesWei)).toBe(A(100));

    const wd = requestWithdrawal(db, p, A(50), A(100));
    audit = solvencyAudit(db, A(100));
    // 50 left the balance; its net (27.5 after fresh-value fees) is still owed. The fee
    // stays in the contract as un-owed surplus — the boundary-fee revenue of §3.
    expect(BigInt(audit.liabilitiesWei)).toBe(A(50) + BigInt(wd.netWei));
    expect(audit.holds).toBe(true);
    expect(BigInt(audit.surplusWei)).toBe(A(100) - A(50) - BigInt(wd.netWei));
  });

  it('detects insolvency', () => {
    linkWallet(db, p, W1);
    creditDeposit(db, W1, A(100), '0xtx1', 0);
    expect(solvencyAudit(db, A(99)).holds).toBe(false); // reserve < balances
  });
});

describe('pricing is exact (BigInt, no float)', () => {
  it('never loses a wei across a huge split', () => {
    const now = Date.now();
    const lots = [
      { id: 1, remaining_wei: (10n ** 24n - 1n).toString(), acquired_at: now - 100 * DAY },
      { id: 2, remaining_wei: '1', acquired_at: now },
    ];
    const gross = 10n ** 24n;
    const { feeWei, unseasonedWei, plan } = priceWithdrawal(lots, gross, now);
    expect(plan.reduce((a, s) => a + s.take, 0n)).toBe(gross); // conserves exactly
    expect(unseasonedWei).toBe(1n);
    expect(feeWei).toBe((gross * 500n) / 10_000n + (1n * 4000n) / 10_000n);
  });
});
