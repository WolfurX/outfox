/** ALPHA on-chain units: SPL mint with 9 decimals. The game ledger stores ALPHA
 * amounts in these base units ("wei" columns predate the Solana migration). */
export const ALPHA_DECIMALS = 9;
export const ALPHA_BASE_UNITS = 10n ** 9n;

/**
 * @outfox/shared — the API contract and content catalog for the Phase-1 vertical slice.
 *
 * Money is integer Scrip cents (¢). The server owns every value decision; these types
 * describe what crosses the wire, never how outcomes are computed (GDD pillar #4).
 *
 * Player-facing vocabulary: DESIGN-SYSTEM-WEB.md Appendix A only.
 * Internal economic terms (Clean/Bound, w_cap, F3) never reach the client.
 */

// ----- economy constants (slice calibration; production values come from the sim) -----
export const REGEN = {
  focusMax: 100,
  riskMax: 100,
  focusPerSec: 0.2, // demo-paced: full bar in ~8min
  riskPerSec: 0.25,
} as const;

export const MARKET_FEE_BPS = 350; // phi_market 3.5% (sim-calibrated, safe [2%,10%])
export const DEMURRAGE = {
  ratePerDay: 0.0045, // delta (sim-calibrated, safe [0.35%, 0.8%])
  floor: 500, // ¢ exempt (small balances never decay)
} as const;

export const REFILL = {
  cost: 250, // ¢, spendable from Unsettled (a sink — allowed destination)
  amount: 50,
} as const;

/**
 * The Exchange (ECONOMY.md §2.2/§4/§8): the ONLY bridge between Scrip and ALPHA — a
 * floating, never-pegged, protocol-owned constant-product pool. Settled Scrip only
 * (the provenance firewall); ALPHA bought here is a fresh UNSEASONED lot (§13.C).
 * Constants mirror the sim's calibrated DEFAULT_PARAMS (sim/simulation.py).
 */
export const EXCHANGE = {
  /** phi_ex — fee per leg, charged on the input side. Buy-leg fee (Scrip) → treasury;
   * sell-leg fee (ALPHA) → ALPHA treasury. Both CAPTURE, never operator revenue (§3.4). */
  feeBps: 150, // 1.5%
  /** Circuit-breaker (§13.B): the fee multiplier grows with sustained fast-vs-slow
   * price deviation beyond the band — a cycling cartel pays escalating tolls; calm
   * trade never leaves 1x. Multiplier = min(1 + k·max(0, dev − band), max). */
  volFeeK: 8,
  volFeeMultMax: 4,
  volBand: 0.2, // twap_band — matches the treasury-op no-op band
  /** EMA windows (days) for the fast/slow price averages. Rolled once per day from the
   * previous close — trades never move the fee within the same day (no feedback loop). */
  emaFastDays: 14,
  emaSlowDays: 90,
  /** ex_flow_cap (§13.B(d), the batch-auction proxy): gross inflow per SIDE per rolling
   * 24h is capped at this fraction of that side's pool reserve. Bounds any cartel's or
   * panic's price impact per day without blocking exit — unfilled flow retries later. */
  flowCapBps: 200, // 2%
} as const;

/**
 * The $ALPHA carry (ECONOMY.md §13.A idle holding cost + §13.D progressive carry).
 * Idle liquid ALPHA decays daily at ≈ the Scrip demurrage rate, so neither liquid
 * currency is a superior hoard; there is NO exemption floor (the sim applies none to
 * ALPHA — sim/simulation.py §13.A block). Each identity's TOTAL position above the
 * published shelter pays the progressive rate on the excess, regardless of play
 * activity — dormancy is not a shelter. Proceeds → ALPHA treasury (CAPTURE).
 * Constants mirror the sim's calibrated DEFAULT_PARAMS (alpha_idle_decay_mult=1.0,
 * alpha_prog_thresh=250, alpha_prog_rate=0.045). Staked exemptions arrive with the
 * staking module; until then the whole position is liquid.
 */
export const ALPHA_CARRY = {
  /** §13.A idle rate — DEMURRAGE.ratePerDay × the sim's idle-decay multiplier (1.0). */
  idleRatePerDayBps: 45, // 0.45%/day
  /** §13.D progressive rate on the excess above the shelter. */
  progRatePerDayBps: 450, // 4.5%/day
  /** §13.D published per-identity shelter, in whole ALPHA. */
  progShelterAlpha: 250,
} as const;

/**
 * The cash-out valve (ECONOMY.md §9 — the only place internal value becomes real money).
 * Constants mirror the sim's calibrated DEFAULT_PARAMS; ALPHA amounts are always wei
 * (BigInt), matching the chain 1:1 — no scaling, no dust.
 */
export const VALVE = {
  /** phi_wd — withdrawal fee on the gross amount. */
  feeBps: 500, // 5%
  /** phi_wd_unseasoned — surcharge on the portion that has not aged (§13.C). */
  unseasonedSurchargeBps: 4000, // 40%
  /** seasoning_days — ANY newly acquired ALPHA (deposit, buy, transfer-in) is unseasoned
   * until it ages. Time cannot be wash-traded away. */
  seasoningDays: 60,
  /** vesting_days — withdrawals vest before the voucher can be claimed (damps
   * hot-potato dumping, gives anti-fraud a window). */
  vestingDays: 14,
  /** w_cap — per-identity gross withdrawal cap per rolling 7 days, in whole ALPHA. */
  weeklyCapAlpha: 58,
  /** Voucher validity once signed. */
  voucherTtlSec: 3600,
  /** Rung required to cash out: R3 (verified). ECONOMY.md §9 gate #1. */
  minRung: 3,
} as const;

/** The one fixed Unsettled explainer — DESIGN-SYSTEM-WEB.md §12, verbatim. Every surface
 * that explains Unsettled Scrip uses this constant; no local variants. */
export const UNSETTLED_EXPLAINER =
  'Unsettled Scrip covers the Street’s own services — refills, fees, upkeep, house goods, '
  + 'the Commons. It can’t be sent to another Fox, traded on the Open Market, or cashed out.';

// ----- content catalog -----
export interface CallDef {
  id: string;
  name: string;
  riskCost: number;
  successP: number; // shown to the player; the server rolls
  payout: [min: number, max: number]; // ¢, paid as UNSETTLED Scrip (chance origin)
  cooldownOkSec: number;
  cooldownNickedSec: number;
  flavor: string;
}

export const CALLS: CallDef[] = [
  {
    id: 'fade_open',
    name: 'Fade the Open',
    riskCost: 10,
    successP: 0.75,
    payout: [80, 140],
    cooldownOkSec: 15,
    cooldownNickedSec: 45,
    flavor: 'The Houses always overshoot at the bell. Take the other side.',
  },
  {
    id: 'front_rumor',
    name: 'Front the Rumor',
    riskCost: 20,
    successP: 0.55,
    payout: [180, 320],
    cooldownOkSec: 25,
    cooldownNickedSec: 60,
    flavor: 'Word is moving through the Pit. Be early or be exit liquidity.',
  },
  {
    id: 'squeeze_basket',
    name: 'Squeeze the Basket',
    riskCost: 35,
    successP: 0.4,
    payout: [400, 700],
    cooldownOkSec: 40,
    cooldownNickedSec: 90,
    flavor: 'A thin book and a heavy hand. The Sheriff watches this one.',
  },
];

export interface GigDef {
  id: string;
  name: string;
  focusCost: number;
  payout: number; // ¢, SETTLED (deterministic work, not chance)
  cooldownSec: number;
  toolEvery: number; // every Nth completion yields a tool (deterministic pity, not chance)
  flavor: string;
}

export const GIG: GigDef = {
  id: 'run_tape',
  name: 'Run the Tape',
  focusCost: 15,
  payout: 90,
  cooldownSec: 20,
  toolEvery: 5,
  flavor: 'Honest work on the Floor. Settles same day.',
};

export const ITEM_KINDS = {
  terminal_mk1: { name: 'Terminal Mk I', desc: 'A Fox’s first rig. Sturdy. Sellable.' },
  signal_booster: { name: 'Signal Booster', desc: 'Earned on the tape, not won. Traders pay for clean signal.' },
} as const;
export type ItemKind = keyof typeof ITEM_KINDS;

// ----- wire types -----
export type Provenance =
  | 'call' | 'gig' | 'market_sale' | 'market_buy' | 'fee'
  | 'refill' | 'starter' | 'carry' | 'exchange_buy' | 'exchange_sell';

export interface ItemView {
  id: number;
  kind: ItemKind;
  listed: boolean;
}

export interface LedgerRow {
  id: number;
  settled: number; // signed ¢
  unsettled: number; // signed ¢
  kind: Provenance;
  ref: string;
  at: number; // epoch ms
}

export interface PlayerView {
  handle: string;
  /** Identity ladder rung (DESIGN-SYSTEM-WEB §10.1): R0 guest, R1 registered, R2 linked
   * wallet, R3 verified. Each demanding surface triggers its own upgrade — Market writes
   * at R1, deposits at R2, cash-out at R3. Never a settings page. */
  rung: 0 | 1 | 2 | 3;
  email: string | null;
  focus: number;
  risk: number;
  focusMax: number;
  riskMax: number;
  scripSettled: number;
  scripUnsettled: number;
  items: ItemView[];
  cooldowns: Record<string, number>; // callId/gigId -> epoch ms ready-at
  gigCount: number;
  serverTime: number;
}

export interface ListingView {
  id: number;
  itemKind: ItemKind;
  price: number; // ¢
  seller: string;
  mine: boolean;
}

export interface CallResult {
  ok: boolean; // success or Nicked
  payout: number; // ¢ unsettled (0 on failure)
  nicked: boolean;
}

export interface BootstrapResponse {
  player: PlayerView;
  listings: ListingView[];
  catalog: { calls: CallDef[]; gig: GigDef };
  /** Which R1 adapter the client drives (§10.2): 'siws' is the production mode on
   * Solana (wallet sign-in), 'privy' when that app is configured server-side, 'dev'
   * for the email+code slice adapter (chainless worlds and tests). */
  auth: { mode: 'dev' | 'privy' | 'siws'; privyAppId?: string };
}

export interface ActionResponse {
  player: PlayerView;
  result?: CallResult;
  toolAwarded?: ItemKind;
  error?: string;
}

export interface MarketResponse {
  player: PlayerView;
  listings: ListingView[];
  error?: string;
}

export interface RegisterStartResponse {
  ok: true;
  /** Dev auth adapter only (OUTFOX_DEV_AUTH): the code is returned instead of emailed.
   * The production adapter (Privy) replaces this entire flow. */
  devCode?: string;
}

export interface RegisterVerifyResponse {
  player?: PlayerView;
  /** §10.1 credential collision: the email already belongs to another Fox. The client
   * must show the choose sheet — never silent overwrite, never silent merge. */
  collision?: { existingHandle: string };
}

export interface LedgerResponse {
  rows: LedgerRow[];
}

// ----- the chain edge (Settlement integration) --------------------------------
// ALPHA amounts cross the wire as decimal wei STRINGS (JSON has no BigInt, and
// 2,000,000e18 overflows both float64 and int64 — strings keep it exact end to end).

export type WithdrawalStatus = 'vesting' | 'claimable' | 'signed' | 'confirmed';

export interface WalletView {
  address: string;
  linkedAt: number;
}

export interface WithdrawalView {
  id: number;
  /** what leaves the player's in-game balance */
  grossWei: string;
  /** phi_wd + any unseasoned surcharge */
  feeWei: string;
  /** what the voucher actually pays out */
  netWei: string;
  to: string;
  status: WithdrawalStatus;
  requestedAt: number;
  vestsAt: number;
  /** present once claimed — everything the client needs to submit on-chain */
  voucher?: Voucher;
  txHash?: string;
}

export interface Voucher {
  to: string;
  amountWei: string;
  nonce: string;
  deadline: number;
  signature: string;
  /** so the client can never submit to the wrong chain/program */
  chainId: number;
  program: string;
}

export interface AlphaView {
  /** spendable in-game ALPHA */
  balanceWei: string;
  /** portion still inside the seasoning window (pays the surcharge if withdrawn now) */
  unseasonedWei: string;
  /** remaining gross withdrawal allowance this rolling week */
  weeklyRemainingWei: string;
  wallet: WalletView | null;
  withdrawals: WithdrawalView[];
}

// ----- the Exchange (Scrip ⇄ ALPHA) -------------------------------------------
// The pool is published: reserves, rate, fee, and remaining capacity are auditable
// pre-committed rules (ECONOMY.md §3), not hidden house edges.

export interface ExchangeView {
  /** spot mid: Scrip ¢ per 1 whole ALPHA, decimal string (display only — the swap
   * itself always prices through the pool math server-side) */
  rateCentsPerAlpha: string;
  /** effective fee right now (base × any volatility multiplier, capped) */
  effectiveFeeBps: number;
  baseFeeBps: number;
  poolScripCents: number;
  poolAlphaWei: string;
  /** remaining rolling-24h gross capacity, per side */
  buyCapacityCents: number;
  sellCapacityWei: string;
}

export interface ExchangeQuote {
  side: 'buy' | 'sell';
  /** what the player puts in: ¢ for buys, wei for sells (decimal string) */
  amountIn: string;
  /** fee taken from the input, same unit as amountIn */
  fee: string;
  /** what the player receives: wei for buys, ¢ for sells (decimal string) */
  amountOut: string;
  effectiveFeeBps: number;
}

export interface ExchangeResponse {
  player: PlayerView;
  exchange: ExchangeView;
  alpha?: AlphaView;
  quote?: ExchangeQuote;
  error?: string;
}

/** The G9 price series, bucketed roughly daily — feeds the rate spark. */
export interface ExchangeHistoryResponse {
  points: { at: number; rate: number }[];
}

export interface AlphaResponse {
  alpha: AlphaView;
  valve: {
    feeBps: number; unseasonedSurchargeBps: number; seasoningDays: number;
    vestingDays: number; weeklyCapAlpha: number; voucherTtlSec: number; minRung: number;
  };
}

/** Claim response: the voucher plus one ready-to-sign wallet transaction
 * ([compute budget, ed25519 verify, withdraw], base64) — the client carries no chain
 * code; it relays `redeemTx` to the wallet as-is. Fee payer is the voucher's `to`. */
export interface ClaimResponse {
  withdrawal: WithdrawalView;
  voucher: Voucher;
  redeemTx: string;
}

/** Deposit is ONE wallet transaction (no approve step on Solana), encoded server-side
 * for the requesting depositor. */
export interface DepositPrepareResponse {
  chainId: number;
  token: string;
  program: string;
  state: string;
  amountWei: string;
  depositTx: string;
}
