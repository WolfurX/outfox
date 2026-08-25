"""
Outfox economy — agent-based Monte-Carlo engine (v2, post-audit remediation).

Implements docs/ECONOMY-SIM-SPEC.md (§3 state, §4 archetypes, §5 faucets, §6 sinks,
§7 Clean/Bound firewall, §8 $ALPHA token model, §9 tick loop + MV=PQ instrumentation,
§10 policy levers) plus the ECONOMY.md §13 adversarial-hardening decisions:
  §13.A idle-$ALPHA holding cost (staked/locked exempt)
  §13.B TWAP treasury market operations (non-telegraphed, window-capped)

v2 remediation (from the independent code audit in docs/ROBINHOOD-FEASIBILITY.md §1):
  - Full $ALPHA ledger with per-tick conservation check:
      liquid + staked + dormant + AMM pool + escrow + treasury + burned + exited == ALPHA_max
  - Full Credit ledger with per-tick conservation check (minted == held + captured +
    pool-delta + destroyed).
  - G10 has real detection power: a per-tick Bound-Credit ledger flags ANY unexplained
    Bound outflow (leak) instead of reading a constant.
  - Funnel mules are PoP-verified (spec §12.5) and re-designated when they churn; honest
    players verify normally in funnel scenarios, so sybil-share is a real ratio.
  - Staking, vesting queue, P2P transfer fee, and upkeep (S4) are implemented, not stubs.
  - Churned players' $ALPHA moves to a dormant bucket (they still own it on-chain) instead
    of being silently destroyed; churned Credits are destroyed (exit M) and counted.
  - Join grants and the gresham forcing count as faucet mints (symmetric accounting).
  - item inventory (inv_value) is formally DESCOPED (spec §16) — removed from net worth.

Chain-agnostic by construction: no TON/Telegram/EVM specifics anywhere.
Numéraire is Credits (¢); $ALPHA is a separate asset with a floating AMM rate `e`.
"""
from __future__ import annotations
import numpy as np
from dataclasses import dataclass, field

# Archetype codes
CASUAL, GRINDER, TRADER, WHALE, BOT = 0, 1, 2, 3, 4
ARCHETYPE_NAMES = ["casual", "grinder", "trader", "whale", "bot"]

# ----------------------------------------------------------------------------
# Parameters (§11). Calibrated v2 estimates — model inputs first, code second.
# ----------------------------------------------------------------------------
DEFAULT_PARAMS = dict(
    horizon=720,            # ticks (days) — 24 months
    n_max=9000,             # pre-allocated agent slots
    n_start=500,            # active agents at t=0
    join_rate=45,           # new agents/day during growth
    growth_until=300,       # day after which joins go to steady trickle
    steady_join=18,  # N* = 1500, reached inside horizon         # joins/day after growth (equilibrium N ≈ steady/churn_est)
    # population mix (§4)
    mix=(0.55, 0.20, 0.12, 0.05, 0.08),  # casual, grinder, trader, whale, bot
    # churn (retention) — tenure-dependent daily churn prob
    churn_new=0.10,
    churn_est=0.012,
    # resources
    compute_max=150.0, nerve_max=50.0,
    compute_regen=150.0, nerve_regen=50.0,   # ~full/day
    # faucets
    f1_yield=2.18,          # Bound credits per nerve point (variable-ratio mean)
    f1_var=0.9,             # lognormal sigma
    f2_yield=1.2,           # Clean credits per compute point
    f2_cap=112.0,           # max Clean credits/agent/day from F2
    join_grant_whale=1200.0,  # starting Clean grant (a real mint — counted as faucet)
    join_grant_base=250.0,
    # sinks
    delta=0.0045,           # demurrage/day (S1) baseline
    demurrage_floor=50.0,
    demurrage_prog_thresh=2000.0,
    demurrage_prog_rate=0.018,
    phi_market=0.035,       # Market fee (S3)
    phi_transfer=0.04,      # P2P transfer fee (applies to funnel $ALPHA moves)
    phi_ex=0.015,            # exchange fee (both legs)
    # §13.B ACTIVATED market defenses (round-3 full-seed re-judge: pump_dump broke
    # G1/G2/G9 and bank_run breached G9 against honest finite AMM depth — the reserve
    # options graduate to implemented mechanics; all three are §12 open params, swept):
    ex_flow_cap=0.02,        # (d) batch-auction proxy: max net flow per tick per side,
                             #     as fraction of that side's pool reserve (pro-rata
                             #     fills; unfilled flow re-queues on later ticks)
    vol_fee_k=8.0,           # circuit-breaker fee: phi_ex multiplier grows with
    vol_fee_mult_max=4.0,    #     sustained |fast-slow| deviation beyond twap_band —
                             #     cartel cycling pays escalating tolls; calm trade doesn't
    twap_jitter=0.30,        # (c) randomized op timing: prob a treasury-op tick is
                             #     skipped (non-telegraphed; breaks phase-locking)
    phi_wd=0.05,            # withdrawal fee (S8)
    # seasoning (audit-2: replaces the AMM-washable provenance surcharge). ANY newly
    # acquired $ALPHA (AMM buy, primary buy, transfer-in, unstake) is UNSEASONED and pays a
    # withdrawal surcharge until it ages; time cannot be wash-traded away.
    seasoning_days=60,   # longer seasoning = more idle-decay exposure for patient mules
    phi_wd_unseasoned=0.40,
    upkeep_rate=0.06,       # Operation upkeep: share of F2 output paid back (S4, CAPTURE)
    # behaviour
    base_spend_frac=0.35,
    demurrage_velocity_k=8.0,
    bound_spend_frac=0.56,  # Bound is sink-only: frac spent on sinks/day
    clean_sink_share=0.18,  # share of Clean "spend" that is a value-capturing sink
    # $ALPHA token (§8)
    alpha_max=2_000_000.0,
    amm_credit0=3_000_000.0,   # audit-2: protocol-owned liquidity at a REALISTIC depth
    amm_alpha0=30_000.0,         # (e0 = 100); funded in-ledger; depth is swept via amm_depth_mult
    amm_depth_mult=1.0,
    # §13.B TWAP treasury market operations (replaces telegraphed e-thresholds)
    twap_fast=14,            # fast EMA window (days)
    twap_slow=90,            # slow EMA window (anchor)
    twap_band=0.20,          # no-op band: act only if fast deviates >±20% from slow
    twap_tick_frac=0.015,     # max op per tick as fraction of AMM credit reserve
    twap_window_cap=0.15,    # max total op volume per rolling 30d, as frac of credit reserve
    # staking (§8; §13.A exemption). With the idle holding cost live, staking is the
    # RATIONAL response for anyone not about to sell/withdraw — rates reflect that.
    stake_prob=0.35,         # daily prob a holder stakes some liquid $ALPHA
    stake_frac=0.6,
    unstake_prob=0.02,       # daily prob a staker REQUESTS unstake (enters unbonding)
    unbond_days=7,           # audit-2: real unbonding period — unstaked $ALPHA is locked (and
                             # decaying, non-sellable) for ~unbond_days before it is liquid
    staking_yield_mode="non_monetary",  # status/convenience only — mints nothing (invariant)
    # §13.A idle-$ALPHA holding cost: idle liquid (and dormant) $ALPHA decays at the
    # effective Credit demurrage rate; STAKED $ALPHA is exempt (locking = decay-free store).
    alpha_idle_decay_mult=1.0,  # multiplier on delta_eff (1.0 = "≈ the Credit rate" per §13.A)
    # §13.D whale-tail carry (round-5): per-identity progressive holding cost on the
    # TOTAL $ALPHA position (liquid+staked+unbonding) above a published shelter. The
    # staked exemption applies to the BASE rate only — staked pays the progressive
    # component alone, so locking stays strictly cheaper than idle at every hoard size
    # (the §13.A ordering survives). Deducted staked-first; proceeds -> ALPHA treasury
    # (CAPTURE). The $ALPHA twin of demurrage_prog_thresh/rate. rate=0 = off (zero-point).
    alpha_prog_thresh=250.0,   # $ALPHA shelter per identity
    alpha_prog_rate=0.045,     # /day on the excess (= the Credit controller's prog_max)
    # §13.D companion lever: wealth-indexed primary issuance — the $ALPHA allocated per
    # F4 purchase declines with the buyer's existing total position (the primary PRICE
    # rises with wealth: second-degree price discrimination, the rule-based analogue of
    # the §2.3 auction prescription). Compresses the archetype INFLOW gap that sets the
    # wealth-plateau ratio the Hill tail_alpha reads. gamma=0 = off (zero-point).
    alpha_primary_gamma=2.0,   # exponent: alloc = buy_amt * (1 + H/href)^-gamma
    alpha_primary_href=750.0,  # $ALPHA scale at which the primary allocation has quartered (gamma=2)
    # $ALPHA-denominated Veblen/status sinks (ECONOMY §2.2 defense #2 / §2.3): premium
    # status goods priced in $ALPHA force token SPENDING and drain whale hoards without
    # selling power. Counterweights §13.A's wealth concentration in staked $ALPHA.
    alpha_status_prob=0.12,     # daily prob a holder buys $ALPHA-priced status goods
    alpha_status_frac=0.28,     # fraction of liquid $ALPHA spent when they do
    alpha_status_burn=0.65,      # share burned (rest -> $ALPHA treasury, CAPTURE)
    status_unstake_mult=3.0,  # whales unstake more readily to fund status purchases
    # withdrawal gate (§8/§9)
    withdraw_prob=0.06,
    w_cap=58.0,              # per-identity $ALPHA / rolling week cap
    wd_global_cap=0.0,       # GLOBAL $ALPHA released per tick at the valve — the deployed
                             # Settlement's leaky-bucket windowCap at daily granularity
                             # (M4/AUDIT-2 §10: once spent, even a valid voucher is
                             # refused regardless of identity; linear refill). Binds at
                             # RELEASE, deferring — never voiding — vetted vouchers.
                             # 0 = off (the pre-§10 engine, exactly).
    vesting_days=14,         # withdrawals vest before value exits (now a real queue)
    pop_verify_prob=0.05,
    bot_pass_rate=0.01,      # one-shot PoP false-accept for sybils (set at join)
    # real money
    realspend_amt=120.0,
    # operator take (round-6, ECONOMY §3): fraction of F3 real-money inflow diverted as
    # operator revenue BEFORE it enters the game treasury. The diverted share never
    # enters the ledger (only the retained share is booked as external inflow), so
    # conservation is exact. Round-6 finding: ZERO dynamic effect anywhere in [0, 0.9]
    # — the §13.B ops bind on their tick/window caps before the treasury balance ever
    # binds, so only the unspent buffer changes (F3 is ~2.9% of cumulative treasury;
    # equivalence check in v6_optake_probe.txt). Default 0 = the v5 record; the
    # production rate is an owner decision inside the proven interval (AUDIT-2 §8).
    # F4 primary-sale fiat is already fully outside the model (never booked): 100%
    # extractable with no economy-side effect. IN-LOOP captured value is never taken;
    # BOUNDARY fees (cash-out) are the round-6b operator channel below.
    op_take_f3=0.0,
    # operator take on cash-out fees (round-6b, ECONOMY §3): fraction of the
    # withdrawal fee + seasoning surcharge (charged in $ALPHA at the exit valve)
    # diverted as operator revenue instead of the $ALPHA treasury. The diverted $ALPHA
    # leaves the game system at the valve (booked to ALPHA_exited — conservation-exact;
    # the value was already exiting, so no counterfactual sell pressure is added).
    # Unlike F3, this CAN bind: ALPHA_treasury caps F4 issuance and funds §13.B
    # sell-side ops — the proven-safe interval is recorded in AUDIT-2 §8b.
    op_take_wdfee=0.0,
    alpha_buy_amt=150.0,   # emission schedule (ECONOMY §3): slower primary issuance
    # demand elasticity (audit-2: the GameFi death-spiral channel). F4/F3 demand is
    # PROCYCLICAL: multiplier = clip((e_fast/e_slow)^gamma, lo, hi).
    demand_gamma=1.2, demand_lo=0.25, demand_hi=2.5,
    # Commons donations (ECONOMY §2.3 / THEME-OUTFOX §4): voluntary charity-for-status
    # sink, whale-biased — the policy-side Gini lever.
    commons_prob=0.05, commons_credit_frac=0.15, commons_alpha_frac=0.10,
    # CPI / price model (§9)
    cpi_kappa=0.25,
    # §10 adaptive monetary policy
    inflation_target=0.005,   # ~price stability: +2% target made M-growth structurally exceed sinks (G1 tension)
    delta_min=0.0005, delta_max=0.020, delta_kp=0.03,
    prog_min=0.0, prog_max=0.045, prog_kp=0.12,
    # fiscal recycle: disabled (bursty injections read as spurious deflation under the
    # multiplicative CPI integrator — see README); re-enable only with a basket CPI.
    recycle_kp=0.0,
    recycle_max=0.030,
    seed=0,
)

# Per-archetype behaviour. [act_intensity, market_prop, realspend_prob, alphabuy_prob,
#                           ex_prop, hoard_bias, withdraw_mult]
# alphabuy_prob follows the Catizen-style retail-payer reality (~7% payer conversion:
# MANY small payers, whales biggest-but-not-monopoly). The old whale-only distribution
# (0.25 vs ~0) made $ALPHA Gini 0.86 by construction of the demand assumption.
ARCHETYPE_BEHAVIOUR = np.array([
    [0.55, 0.10, 0.03, 0.010, 0.02, 0.5, 0.3],   # casual
    [0.95, 0.30, 0.04, 0.015, 0.08, 0.4, 0.6],   # grinder
    [0.80, 0.70, 0.06, 0.030, 0.30, 0.6, 1.0],   # trader
    [0.50, 0.40, 0.30, 0.120, 0.20, 0.7, 1.0],   # whale
    [1.00, 0.20, 0.00, 0.000, 0.15, 0.2, 0.8],   # bot/sybil
], dtype=float)


@dataclass
class Scenario:
    name: str
    param_overrides: dict = field(default_factory=dict)
    joins_fn: callable = None
    bot_share: float = None
    whale_shock_tick: int = None
    gresham_force: bool = False
    funnel: bool = False
    adversary: str = None         # 'flight' | 'dump' | 'smart_sybil' | 'floor_split' | 'pump_dump'
    adversary_frac: float = 0.0
    dump_tick: int = None
    n_mules: int = 1
    alphabuy_override: tuple = None   # per-archetype alphabuy_prob override (whale_market)


def _plateau_joins(t, p):
    """plateau: growth stops to a thin organic trickle after t=180 (retained core;
    preserves the Axie/StepN stress — survive with minimal new money). Module-level
    so scenarios stay picklable for multiprocessing."""
    return p["join_rate"] if t < 180 else 8


def make_scenarios():
    return {
        "baseline": Scenario("baseline"),
        "whale_shock": Scenario("whale_shock", whale_shock_tick=90),
        "plateau": Scenario("plateau", joins_fn=_plateau_joins),
        "bot_attack": Scenario("bot_attack", bot_share=0.30),
        "gresham": Scenario("gresham", gresham_force=True),
        "funnel": Scenario("funnel", bot_share=0.25, funnel=True),
    }


def make_adversarial_scenarios():
    """Red-team scenarios, run against calibrated params with no re-tuning."""
    return {
        "demurrage_flight": Scenario("demurrage_flight", adversary="flight", adversary_frac=0.5),
        "bank_run": Scenario("bank_run", adversary="dump", adversary_frac=0.6, dump_tick=420),
        "smart_sybil": Scenario("smart_sybil", bot_share=0.30, funnel=True, n_mules=12,
                                adversary="smart_sybil"),
        "floor_split": Scenario("floor_split", adversary="floor_split", adversary_frac=0.5),
        "pump_dump": Scenario("pump_dump", adversary="pump_dump", adversary_frac=0.3),
        # Confidence crisis / death spiral (audit-2): demand is procyclical; at t=300 a
        # 60-day panic hits — external demand collapses to 20% and holders dump 3x. Does
        # the spiral self-reinforce, or do TWAP ops/burns/sinks break it?
        "confidence_crisis": Scenario("confidence_crisis", adversary="confidence",
                                      dump_tick=300),
        # Whale-dominant demand (audit-2): the OLD whale-only $ALPHA distribution that made
        # Gini 0.86 by construction — tests whether the Commons sink is a real policy
        # lever or Gini still rides on the retail-mix assumption.
        "whale_market": Scenario("whale_market",
                                 alphabuy_override=(0.0, 0.005, 0.02, 0.25, 0.0),
                                 param_overrides={"alpha_buy_amt": 300.0}),
    }


class Sim:
    def __init__(self, params: dict, scenario: Scenario, seed: int):
        self.p = dict(params)
        self.p.update(scenario.param_overrides or {})
        self.sc = scenario
        self.rng = np.random.default_rng(seed)
        p = self.p
        N = p["n_max"]
        mix = list(p["mix"])
        if scenario.bot_share is not None:
            others = sum(mix) - mix[BOT]
            scale = (1 - scenario.bot_share) / others
            mix = [m * scale for m in mix]
            mix[BOT] = scenario.bot_share
        self.mix = np.array(mix)

        # ---- per-agent state ----
        self.active = np.zeros(N, bool)
        self.arch = np.zeros(N, np.int8)
        self.tenure = np.zeros(N, np.int32)
        self.C_clean = np.zeros(N)
        self.C_bound = np.zeros(N)
        self.ALPHA_liquid = np.zeros(N)
        self.ALPHA_staked = np.zeros(N)
        self.compute = np.zeros(N)
        self.nerve = np.zeros(N)
        self.stats = np.ones(N)
        self.verified = np.zeros(N, bool)
        self.spent_real = np.zeros(N)
        self.withdrawn = np.zeros(N)      # realized (post-vesting) ¢ value per agent slot
        self.wd_window = np.zeros(N)
        self.is_mule = np.zeros(N, bool)
        self.can_cashout = np.zeros(N, bool)
        self.is_adv = np.zeros(N, bool)
        self.ALPHA_unseasoned = np.zeros(N)  # newly acquired $ALPHA (pays surcharge at exit)
        self.ALPHA_unbonding = np.zeros(N)   # unstake requests aging toward liquid

        # ---- $ALPHA ledger (all in $ALPHA units; must sum to alpha_max every tick) ----
        self.R_credit = p["amm_credit0"] * p["amm_depth_mult"]
        self.R_alpha = p["amm_alpha0"] * p["amm_depth_mult"]
        self.e0 = self.R_credit / self.R_alpha
        self.ALPHA_treasury = p["alpha_max"] - self.R_alpha  # unissued + reclaimed (pool $ALPHA funded from the cap)
        self.ALPHA_dormant = 0.0     # churned players' wallets — still exist on-chain
        self.ALPHA_escrow = 0.0      # withdrawal requests vesting (queue below)
        self.wd_released_tick = 0.0  # net $ALPHA released at the valve this tick (§10 cap sizing)
        self.ALPHA_burned = 0.0
        self.ALPHA_exited = 0.0      # net $ALPHA that left the game via cash-out
        self.vesting_q = []        # list of [release_tick, net_alpha, arch_at_request]

        # ---- Credit ledger (¢) ----
        self.treasury_credits = 0.0
        self.cum_credit_mint = 0.0      # join grants + F1 + F2 + gresham forcing
        self.cum_credit_external = 0.0  # F3 real-money inflow credited to treasury
        self.cum_credit_mint += self.R_credit  # audit-2: pool liquidity is protocol-minted, IN-ledger
        self.exited_hist = []           # withdrawn-value snapshots of churned identities (exit-Gini)
        self.C_dormant = 0.0            # churned players' credits (persist, demurrage-decay)
        self.cum_credit_destroyed = 0.0  # churn exits (credits leave the economy)

        # ---- integrity / gate accumulators ----
        self.chance_leak_total = 0.0     # G10: unexplained Bound outflow (must be 0)
        self.alpha_resid_max = 0.0         # G12: worst |$ALPHA conservation residual|
        self.credit_resid_max = 0.0      # G12: worst |Credit conservation residual|
        self.cashout_total = 0.0
        self.cashout_by_bot = 0.0
        self.sink_captured = 0.0         # cumulative CAPTURE-tagged sink volume (¢)
        self.sink_dead = 0.0             # cumulative dead/destroyed sink volume (¢)

        # ---- CPI / policy state ----
        self.P = 1.0
        self.Q_ema = None
        self.mq_ref = None
        self.Phist = [1.0]
        self.inflation = 0.0
        self.prev_M = None
        self.prev_Q = None
        self.delta_eff = p["delta"]
        # §13.B TWAP state
        self.e_fast = self.e0
        self.e_slow = self.e0
        self.op_window = 0.0             # rolling 30d treasury-op volume (¢-equivalent)

        # per-tick scratch
        self._join_mint = 0.0
        self._exfee_sink = 0.0
        self._alpha_volume = 0.0           # exchange $ALPHA volume this tick (G6)

        self._join(p["n_start"])

    # ----- helpers -------------------------------------------------------
    @property
    def e(self):
        return self.R_credit / self.R_alpha

    def _join(self, k):
        k = int(k)
        if k <= 0:
            return
        slots = np.where(~self.active)[0][:k]
        if slots.size == 0:
            return
        k = slots.size
        p = self.p
        arch = self.rng.choice(5, size=k, p=self.mix).astype(np.int8)
        self.active[slots] = True
        self.arch[slots] = arch
        self.tenure[slots] = 0
        grant = np.where(arch == WHALE, p["join_grant_whale"], p["join_grant_base"]) \
            * self.rng.uniform(0.5, 1.5, k)
        self.C_clean[slots] = grant
        self._join_mint += float(grant.sum())     # join grants ARE mints (audit fix)
        self.cum_credit_mint += float(grant.sum())
        self.C_bound[slots] = 0.0
        self.ALPHA_liquid[slots] = 0.0
        self.ALPHA_staked[slots] = 0.0
        self.withdrawn[slots] = 0.0
        self.wd_window[slots] = 0.0
        self.spent_real[slots] = 0.0
        self.is_mule[slots] = False
        self.is_adv[slots] = False
        self.ALPHA_unseasoned[slots] = 0.0
        self.ALPHA_unbonding[slots] = 0.0
        self.compute[slots] = p["compute_max"]
        self.nerve[slots] = p["nerve_max"]
        self.stats[slots] = self.rng.uniform(1.0, 3.0, k)
        self.verified[slots] = False
        # one-shot PoP eligibility: humans pass; sybils at bot_pass_rate
        self.can_cashout[slots] = np.where(
            arch == BOT, self.rng.random(k) < p["bot_pass_rate"], True)
        if self.sc.adversary_frac > 0:
            self.is_adv[slots] = (arch != BOT) & (self.rng.random(k) < self.sc.adversary_frac)
        self._designate_mules()

    def _designate_mules(self):
        """Keep n_mules ACTIVE, PoP-capable mules (spec §12.5: the mule is a verified
        identity the attacker controls). Re-designates after mule churn (audit fix)."""
        if not self.sc.funnel:
            return
        have = int((self.active & self.is_mule).sum())
        need = self.sc.n_mules - have
        if need <= 0:
            return
        cand = np.where(self.active & (self.arch == BOT) & (~self.is_mule))[0][:need]
        if cand.size:
            self.is_mule[cand] = True
            self.can_cashout[cand] = True   # the attacker's verified identities

    # ----- the per-tick update (§9) -------------------------------------
    def step(self, t):
        p = self.p
        beh = ARCHETYPE_BEHAVIOUR[self.arch]

        mint_bound = 0.0
        mint_clean = self._join_mint    # grants issued since last step (incl. t=0 seed pop)
        self._join_mint = 0.0
        self._alpha_volume = 0.0
        self._exfee_sink = 0.0
        self._trade_volume = 0.0
        sink_removed = 0.0
        bound_out_allowed = 0.0         # G10 ledger: legitimate Bound outflows this tick
        bound_prev = float(self.C_bound.sum())

        # --- population dynamics ---
        churn_p = np.where(self.tenure < 7, p["churn_new"], p["churn_est"])
        leaving = self.active & (self.rng.random(p["n_max"]) < churn_p)
        # Credits of leavers go DORMANT (accounts persist in reality); the dormant pool
        # decays to treasury at the demurrage rate below — a DESIGNED sink capturing the
        # value over time (audit-2 fix: designed sinks must cover faucets on their own).
        churn_credits = float(self.C_clean[leaving].sum() + self.C_bound[leaving].sum())
        self._churn_credits_tick = churn_credits
        churn_bound = float(self.C_bound[leaving].sum())
        self.C_dormant += churn_credits
        bound_out_allowed += churn_bound   # Bound leaving active play is an allowed outflow
        # $ALPHA of leavers is NOT destroyed — they still own it (dormant bucket)
        self.ALPHA_dormant += float(self.ALPHA_liquid[leaving].sum()
                                  + self.ALPHA_staked[leaving].sum()
                                  + self.ALPHA_unbonding[leaving].sum())
        # preserve churned identities' exit attribution (audit-2: exit-Gini history)
        wdl = self.withdrawn[leaving]
        self.exited_hist.extend(wdl[wdl > 0].tolist())
        self.active[leaving] = False
        for arr in (self.C_clean, self.C_bound, self.ALPHA_liquid, self.ALPHA_staked,
                    self.ALPHA_unseasoned, self.ALPHA_unbonding, self.compute, self.nerve):
            arr[leaving] = 0.0
        self.verified[leaving] = False
        self.is_mule[leaving] = False    # audit fix: stale mule flags blocked replacement

        joins = self.sc.joins_fn(t, p) if self.sc.joins_fn else \
            (p["join_rate"] if t < p["growth_until"] else p["steady_join"])
        self._join(joins)
        mint_clean += self._join_mint
        self._join_mint = 0.0
        self._designate_mules()
        a = self.active
        self.tenure[a] += 1
        beh = ARCHETYPE_BEHAVIOUR[self.arch]

        # --- regen ---
        self.compute = np.minimum(self.compute + p["compute_regen"], p["compute_max"])
        self.nerve = np.minimum(self.nerve + p["nerve_regen"], p["nerve_max"])
        self.compute[~a] = 0.0
        self.nerve[~a] = 0.0

        # --- F1: Exploits -> Bound Credits (variable-ratio) ---
        nerve_spent = self.nerve * beh[:, 0] * a
        vr = self.rng.lognormal(0.0, p["f1_var"], p["n_max"])
        bound_gain = np.where(a, nerve_spent * p["f1_yield"]
                              * (0.5 + 0.5 * np.tanh(self.stats / 5)) * vr, 0.0)
        self.C_bound += bound_gain
        self.nerve -= nerve_spent
        mint_bound += float(bound_gain.sum())
        self.cum_credit_mint += float(bound_gain.sum())
        self.stats += np.where(a, 0.01 * beh[:, 0], 0.0)

        # --- F2: Operations -> Clean Credits, minus upkeep S4 (audit fix: S4 is real) ---
        compute_spent = self.compute * beh[:, 0] * a
        clean_gain = np.where(a, np.minimum(compute_spent * p["f2_yield"], p["f2_cap"]), 0.0)
        upkeep = clean_gain * p["upkeep_rate"]          # operations pay upkeep from output
        self.C_clean += clean_gain - upkeep
        self.compute -= compute_spent
        mint_clean += float(clean_gain.sum())
        self.cum_credit_mint += float(clean_gain.sum())
        self.treasury_credits += float(upkeep.sum())
        sink_removed += float(upkeep.sum())
        self.sink_captured += float(upkeep.sum())

        # --- demand elasticity (audit-2): external demand is PROCYCLICAL in e ---
        dmult = float(np.clip((self.e_fast / max(self.e_slow, 1e-9)) ** p["demand_gamma"],
                              p["demand_lo"], p["demand_hi"]))
        if self.sc.adversary == "confidence" and self.sc.dump_tick is not None \
                and self.sc.dump_tick <= t < self.sc.dump_tick + 60:
            dmult *= 0.2   # 60-day confidence collapse
        # --- F3: real-money convenience spend (external value in; treasury captures) ---
        rs_agents = a & (self.rng.random(p["n_max"]) < (beh[:, 2] * dmult * a))
        self.spent_real[rs_agents] += p["realspend_amt"]
        # operator take (§3): the diverted share of F3 is operator revenue and never
        # enters the game ledger; only the retained share is booked (conservation-exact)
        f3_in = float(rs_agents.sum()) * p["realspend_amt"] * (1.0 - p["op_take_f3"])
        self.treasury_credits += f3_in
        self.cum_credit_external += f3_in   # ledger: external inflow, not a player faucet

        # --- F4: $ALPHA primary purchase (from treasury allocation, capped by ALPHA_max) ---
        shock = (self.sc.whale_shock_tick is not None and t == self.sc.whale_shock_tick)
        base_alphabuy = (np.array(self.sc.alphabuy_override)[self.arch]
                       if self.sc.alphabuy_override is not None else beh[:, 3])
        alphabuy_p = base_alphabuy * dmult * (5.0 if shock else 1.0)
        vb = a & (self.rng.random(p["n_max"]) < (alphabuy_p * a))
        buy_amt = p["alpha_buy_amt"] * (3.0 if shock else 1.0)
        if vb.any():
            # §13.D wealth-indexed primary issuance: allocation declines with the
            # buyer's existing position (primary price rises with wealth). gamma=0
            # reproduces the flat schedule exactly. Unissued $ALPHA never leaves the
            # treasury — strictly less is issued, nothing moves between buckets.
            idx = np.where(vb)[0]
            hold = (self.ALPHA_liquid[idx] + self.ALPHA_staked[idx]
                    + self.ALPHA_unbonding[idx])
            fac = (1.0 + hold / p["alpha_primary_href"]) ** (-p["alpha_primary_gamma"])
            alloc = buy_amt * fac
            tot = float(alloc.sum())
            if tot > self.ALPHA_treasury:
                alloc *= self.ALPHA_treasury / tot
                tot = self.ALPHA_treasury
            if tot > 0:
                self.ALPHA_liquid[idx] += alloc
                self.ALPHA_unseasoned[idx] += alloc
                self.ALPHA_treasury -= tot
                # the buyer pays the wealth-indexed PRICE e/fac on delivered tokens
                # (canon: the primary price rises with wealth — §13.D). spent_real is
                # a stat only; at gamma=0 fac==1.0 and this equals the v4 accounting.
                self.spent_real[idx] += (alloc / fac) * self.e
                self._alpha_volume += tot   # primary-sale volume counts toward velocity

        # --- Market / PvP transfers (zero-sum) + fee S3 ---
        trade_vol = (self.C_clean * beh[:, 1] * 0.5) * a
        self._trade_volume = float(trade_vol.sum())   # Market volume (G5 velocity input)
        fee = trade_vol * p["phi_market"]
        self.C_clean -= fee
        self.treasury_credits += float(fee.sum())
        sink_removed += float(fee.sum())
        self.sink_captured += float(fee.sum())
        winners = a & (self.rng.random(p["n_max"]) < 0.5)
        nwin = int(winners.sum())
        if nwin > 0:                                    # audit fix: no pot destruction
            pot = trade_vol * 0.2
            self.C_clean -= pot
            self.C_clean[winners] += float(pot.sum()) / nwin

        # --- Exchange (AMM) + funnel transfers ---
        self._exchange_step(t, beh, a)

        # fold the exchange buy-leg fee into sink accounting (captured; audit-2 fix)
        sink_removed += self._exfee_sink
        self.sink_captured += self._exfee_sink

        # --- staking (§8; audit fix: implemented). Staked = locked, exempt from decay,
        #     cannot be sold/dumped. Yield is non-monetary (status) — mints nothing. ---
        holders = a & (self.ALPHA_liquid > 1.0)
        stakers = holders & (self.rng.random(p["n_max"]) < p["stake_prob"] * (0.5 + beh[:, 5]))
        stake_amt = self.ALPHA_liquid[stakers] * p["stake_frac"]
        self.ALPHA_liquid[stakers] -= stake_amt
        self.ALPHA_staked[stakers] += stake_amt
        unstake_p = np.where(self.arch == WHALE,
                             p["unstake_prob"] * p["status_unstake_mult"], p["unstake_prob"])
        unstakers = a & (self.ALPHA_staked > 0) & (self.rng.random(p["n_max"]) < unstake_p)
        # audit-2: unstaking is a REQUEST — tokens enter a real unbonding period (locked,
        # non-sellable, decaying) instead of teleporting to liquid. "Locked can't dump" is
        # now a mechanism, not a parameter.
        self.ALPHA_unbonding[unstakers] += self.ALPHA_staked[unstakers]
        self.ALPHA_staked[unstakers] = 0.0
        matured = self.ALPHA_unbonding * (1.0 / p["unbond_days"])
        self.ALPHA_unbonding -= matured
        self.ALPHA_liquid += matured
        self.ALPHA_unseasoned += matured   # returning tokens are UNSEASONED (no stake-launder)

        # --- $ALPHA-denominated Veblen/status sinks (ECONOMY §2.2/§2.3) ---
        # Whales/traders spend $ALPHA on status goods: drains token hoards (Gini/tail_alpha
        # counterweight to §13.A) while selling zero power. Split burn / treasury-capture.
        status_p = p["alpha_status_prob"] * np.where(self.arch == WHALE, 2.0,
                                                   np.where(self.arch == TRADER, 1.0, 0.3))
        buyers = a & (self.ALPHA_liquid > 1.0) & (self.rng.random(p["n_max"]) < status_p)
        status_spend = self.ALPHA_liquid[buyers] * p["alpha_status_frac"]
        self.ALPHA_liquid[buyers] -= status_spend
        tot_status = float(status_spend.sum())
        self.ALPHA_burned += tot_status * p["alpha_status_burn"]
        self.ALPHA_treasury += tot_status * (1 - p["alpha_status_burn"])
        self._alpha_volume += tot_status   # token-USE volume counts toward velocity (Burniske)

        # --- Commons donations (ECONOMY §2.3 / THEME-OUTFOX §4): charity-for-status ---
        # Voluntary, whale-biased drain of Credits AND $ALPHA for non-transferable standing.
        # The policy-side Gini lever (audit-2). Bound Credits are donatable (allowed sink).
        com_p = p["commons_prob"] * np.where(self.arch == WHALE, 4.0,
                                             np.where(self.arch == TRADER, 1.5, 0.5))
        donors = a & (self.rng.random(p["n_max"]) < com_p)
        don_clean = self.C_clean[donors] * p["commons_credit_frac"]
        don_bound = self.C_bound[donors] * p["commons_credit_frac"]
        self.C_clean[donors] -= don_clean
        self.C_bound[donors] -= don_bound
        don_c = float(don_clean.sum() + don_bound.sum())
        self.treasury_credits += don_c
        sink_removed += don_c
        self.sink_captured += don_c
        bound_out_allowed += float(don_bound.sum())
        don_alpha = self.ALPHA_liquid[donors] * p["commons_alpha_frac"]
        self.ALPHA_liquid[donors] -= don_alpha
        self.ALPHA_unseasoned[donors] = np.minimum(self.ALPHA_unseasoned[donors],
                                                 self.ALPHA_liquid[donors])
        self.ALPHA_treasury += float(don_alpha.sum())
        self._alpha_volume += float(don_alpha.sum())

        # --- Bound Credits are sink-only: spent down each tick (S2/S5) ---
        bound_spend = self.C_bound * p["bound_spend_frac"] * a
        self.C_bound -= bound_spend
        self.treasury_credits += float(bound_spend.sum())
        sink_removed += float(bound_spend.sum())
        self.sink_captured += float(bound_spend.sum())
        bound_out_allowed += float(bound_spend.sum())

        # --- §10 adaptive monetary policy ---
        infl_gap = self.inflation - p["inflation_target"]
        delta_eff = float(np.clip(p["delta"] + p["delta_kp"] * infl_gap,
                                  p["delta_min"], p["delta_max"]))
        prog_eff = float(np.clip(p["demurrage_prog_rate"] + p["prog_kp"] * infl_gap,
                                 p["prog_min"], p["prog_max"]))
        self.delta_eff = delta_eff

        # --- S1 demurrage (dual channel), policy-responsive ---
        spend_frac = np.clip(p["base_spend_frac"]
                             + p["demurrage_velocity_k"] * delta_eff * (1 - beh[:, 5]), 0, 0.95)
        clean_sink = (self.C_clean * spend_frac * a) * p["clean_sink_share"]
        self.C_clean -= clean_sink
        self.treasury_credits += float(clean_sink.sum())
        sink_removed += float(clean_sink.sum())
        self.sink_captured += float(clean_sink.sum())
        dem_mask = a & (~self.is_adv) if self.sc.adversary == "floor_split" else a
        for arr, is_bound in ((self.C_clean, False), (self.C_bound, True)):
            taxable = np.maximum(arr - p["demurrage_floor"], 0.0) * dem_mask
            dem = taxable * delta_eff
            arr -= dem
            self.treasury_credits += float(dem.sum())
            sink_removed += float(dem.sum())
            self.sink_captured += float(dem.sum())
            if is_bound:
                bound_out_allowed += float(dem.sum())
        excess = np.maximum(self.C_clean - p["demurrage_prog_thresh"], 0.0) * a
        prog = excess * prog_eff
        self.C_clean -= prog
        self.treasury_credits += float(prog.sum())
        sink_removed += float(prog.sum())
        self.sink_captured += float(prog.sum())

        # dormant-credit demurrage: departed players' balances decay to treasury —
        # the designed capture of churn value (no instant wipe-out accounting)
        dorm_dec = self.C_dormant * delta_eff
        self.C_dormant -= dorm_dec
        self.treasury_credits += dorm_dec
        sink_removed += dorm_dec
        self.sink_captured += dorm_dec

        # --- §13.A idle-$ALPHA holding cost: idle liquid AND dormant decay at ~the Credit
        #     rate; STAKED is exempt (locking is the decay-free store). Decay -> treasury. ---
        alpha_decay_rate = delta_eff * p["alpha_idle_decay_mult"]
        idle_decay = self.ALPHA_liquid * alpha_decay_rate
        self.ALPHA_liquid -= idle_decay
        self.ALPHA_unseasoned *= (1 - alpha_decay_rate)      # decays proportionally
        unbond_decay = self.ALPHA_unbonding * alpha_decay_rate  # unbonding is NOT exempt (§13.A)
        self.ALPHA_unbonding -= unbond_decay
        dormant_decay = self.ALPHA_dormant * alpha_decay_rate
        self.ALPHA_dormant -= dormant_decay
        self.ALPHA_treasury += (float(idle_decay.sum()) + float(unbond_decay.sum())
                              + dormant_decay)
        # seasoning: unseasoned $ALPHA ages toward seasoned (time cannot be washed)
        self.ALPHA_unseasoned *= (1 - 1.0 / p["seasoning_days"])
        self.ALPHA_unseasoned = np.minimum(self.ALPHA_unseasoned, self.ALPHA_liquid)

        # --- §13.D whale-tail carry: progressive holding cost on the TOTAL $ALPHA
        #     position (liquid+staked+unbonding) above the published per-identity
        #     shelter. Staked pays ONLY this progressive component (never the base
        #     rate), so the §13.A ordering holds at every hoard size. Deduction is
        #     staked-first (the shelter is what is taxed; working liquid last).
        #     Proceeds -> $ALPHA treasury (CAPTURE). No RNG: rate=0 == v4 engine. ---
        if p["alpha_prog_rate"] > 0:
            H = self.ALPHA_liquid + self.ALPHA_staked + self.ALPHA_unbonding
            levy = np.maximum(H - p["alpha_prog_thresh"], 0.0) * p["alpha_prog_rate"] * a
            from_staked = np.minimum(levy, self.ALPHA_staked)
            self.ALPHA_staked -= from_staked
            rem = levy - from_staked
            from_unbond = np.minimum(rem, self.ALPHA_unbonding)
            self.ALPHA_unbonding -= from_unbond
            rem -= from_unbond
            from_liquid = np.minimum(rem, self.ALPHA_liquid)
            self.ALPHA_liquid -= from_liquid
            self.ALPHA_unseasoned = np.minimum(self.ALPHA_unseasoned, self.ALPHA_liquid)
            self.ALPHA_treasury += float(from_staked.sum() + from_unbond.sum()
                                       + from_liquid.sum())

        # --- fiscal recycle (disabled by default; see param note) ---
        recycle_gap = p["inflation_target"] - self.inflation
        if p["recycle_kp"] > 0 and recycle_gap > 0 and self.treasury_credits > 0 and a.any():
            M_now = float(self.C_clean[a].sum() + self.C_bound[a].sum())
            payout = min(M_now * min(p["recycle_kp"] * recycle_gap, p["recycle_max"]),
                         self.treasury_credits)
            self.treasury_credits -= payout
            self.C_clean[a] += payout / a.sum()
            sink_removed -= payout
            self.sink_captured -= payout

        # --- §13.B TWAP treasury market ops (non-telegraphed, window-capped) ---
        self._twap_ops()

        # --- withdrawals (cash-out gate) + vesting queue ---
        self._withdraw_step(t, beh, a)
        self._release_vesting(t)

        # --- Gresham forcing (scenario): forced credit mint + $ALPHA appreciation ---
        if self.sc.gresham_force:
            forced = float(self.C_clean[a].sum()) * 0.004
            self.C_clean[a] *= 1.004
            mint_clean += forced                       # audit fix: forcing IS a mint
            self.cum_credit_mint += forced
            # forced appreciation = pool $ALPHA removed; account it as burn (ledger-safe)
            shrink = self.R_alpha * 0.001
            self.R_alpha -= shrink
            self.ALPHA_burned += shrink

        # --- G10 Bound-Credit ledger: detect ANY unexplained Bound outflow ---
        bound_now = float(self.C_bound.sum())
        resid = (bound_prev + mint_bound - bound_out_allowed) - bound_now
        if resid > 1e-6 * max(bound_prev, 1.0):
            self.chance_leak_total += resid

        # --- conservation checks (G12 basis) ---
        self._conservation(t)

        return self._metrics(t, mint_bound, mint_clean, sink_removed)

    # ----- exchange, ops, withdrawals ------------------------------------
    def _exchange_step(self, t, beh, a):
        p = self.p
        cheap = self.e < self.e0
        buy_drive = beh[:, 4] * (1.3 if cheap else 0.7)
        sell_drive = beh[:, 4] * (0.7 if cheap else 1.3)
        buy_credits = (self.C_clean * 0.1 * buy_drive) * a
        sell_alpha = (self.ALPHA_liquid * 0.1 * sell_drive) * a

        if self.sc.adversary == "flight":
            adv = a & self.is_adv
            flee = adv & (self.e < 1.5 * self.e0)
            buy_credits = np.where(flee, self.C_clean * 0.7, buy_credits)
            sell_alpha = np.where(adv, 0.0, sell_alpha)
        # bank run = a sharp 30-day panic (a permanent every-tick exodus is a different
        # phenomenon — no economy holds price against a majority permanently exiting)
        if (self.sc.adversary == "dump" and self.sc.dump_tick is not None
                and self.sc.dump_tick <= t < self.sc.dump_tick + 30):
            adv = a & self.is_adv
            sell_alpha = np.where(adv, self.ALPHA_liquid * 0.9, sell_alpha)
            buy_credits = np.where(adv, 0.0, buy_credits)
        # confidence crisis: panic selling during the demand-collapse window
        if self.sc.adversary == "confidence" and self.sc.dump_tick is not None \
                and self.sc.dump_tick <= t < self.sc.dump_tick + 60:
            sell_alpha = np.minimum(sell_alpha * 3.0, self.ALPHA_liquid * 0.9)
        # smart sybil: mules actively WASH — recycle Clean into AMM $ALPHA buys (tests that
        # seasoning, not provenance, is the binding defense; fixes the dead adversary tag)
        if self.sc.adversary == "smart_sybil":
            mules_m = a & self.is_mule
            buy_credits = np.where(mules_m, self.C_clean * 0.5, buy_credits)
        if self.sc.adversary == "pump_dump":
            adv = a & self.is_adv
            if (t // 30) % 2 == 0:
                buy_credits = np.where(adv, self.C_clean * 0.8, buy_credits)
                sell_alpha = np.where(adv, 0.0, sell_alpha)
            else:
                sell_alpha = np.where(adv, self.ALPHA_liquid * 0.8, sell_alpha)
                buy_credits = np.where(adv, 0.0, buy_credits)

        # --- §13.B(d) batch-auction flow cap: per-tick net flow per side is bounded by
        #     a fraction of that side's reserve, filled pro-rata — the in-model proxy
        #     for a commit-reveal batch auction with per-window clearing. Bounds any
        #     cartel's or panic's price impact per tick (G9) without blocking exit:
        #     unfilled flow simply re-queues on later ticks (an orderly book, not a wall).
        cap_buy = p["ex_flow_cap"] * self.R_credit
        want_buy = float(buy_credits.sum())
        if want_buy > cap_buy > 0:
            buy_credits = buy_credits * (cap_buy / want_buy)
        cap_sell = p["ex_flow_cap"] * self.R_alpha
        want_sell = float(sell_alpha.sum())
        if want_sell > cap_sell > 0:
            sell_alpha = sell_alpha * (cap_sell / want_sell)
        # --- §13.B circuit-breaker fee: sustained fast-vs-slow price deviation beyond
        #     the no-op band escalates the exchange fee (capped). A cycling cartel pays
        #     rising tolls on every leg (restoring the Credit-side sink G1/G2 starves);
        #     calm trade never leaves the 1x multiplier. Uses last tick's EMAs — no
        #     intra-tick feedback loop.
        dev = abs(self.e_fast - self.e_slow) / max(self.e_slow, 1e-9)
        fee_mult = min(1.0 + p["vol_fee_k"] * max(0.0, dev - p["twap_band"]),
                       p["vol_fee_mult_max"])
        phi_ex_eff = p["phi_ex"] * fee_mult

        # BUY leg: fee in Credits -> treasury (CAPTURE); net enters pool. (Audit fix:
        # no phantom $ALPHA burn; fee is real and accounted once.)
        tot_buy = float(buy_credits.sum())
        if tot_buy > 0:
            fee_c = tot_buy * phi_ex_eff
            dc = tot_buy - fee_c
            k = self.R_credit * self.R_alpha
            self.R_credit += dc
            dalpha = self.R_alpha - k / self.R_credit
            self.R_alpha -= dalpha
            self.C_clean -= buy_credits
            self.treasury_credits += fee_c
            self._exfee_sink += fee_c   # audit-2 fix: count buy-leg fee as captured sink
            if dalpha > 0:
                got = (buy_credits / tot_buy) * dalpha
                self.ALPHA_liquid += got
                self.ALPHA_unseasoned += got   # AMM-bought $ALPHA is UNSEASONED (wash-proof)
            self._alpha_volume += max(dalpha, 0.0)
        # SELL leg: fee in $ALPHA -> ALPHA treasury (CAPTURE); net enters pool. (Audit fix:
        # sell-side fee no longer vanishes.)
        tot_sell = float(sell_alpha.sum())
        if tot_sell > 0:
            fee_v = tot_sell * phi_ex_eff
            dv = tot_sell - fee_v
            k = self.R_credit * self.R_alpha
            self.R_alpha += dv
            dcred = self.R_credit - k / self.R_alpha
            self.R_credit -= dcred
            self.ALPHA_liquid -= sell_alpha
            # attacker-optimal: sells consume UNSEASONED first (keep seasoned for exit)
            self.ALPHA_unseasoned = np.maximum(self.ALPHA_unseasoned - sell_alpha, 0.0)
            self.ALPHA_treasury += fee_v
            if dcred > 0:
                self.C_clean += (sell_alpha / tot_sell) * dcred
            self._alpha_volume += tot_sell

        # funnel: bots P2P-transfer $ALPHA to mule(s) — now pays the P2P transfer fee
        # (audit fix: phi_transfer implemented; fee -> ALPHA treasury).
        if self.sc.funnel and (a & self.is_mule).any():
            mules = np.where(a & self.is_mule)[0]
            bots = a & (self.arch == BOT) & (~self.is_mule)
            moved = float(self.ALPHA_liquid[bots].sum()) * 0.5
            if moved > 0:
                self.ALPHA_liquid[bots] *= 0.5
                fee_v = moved * p["phi_transfer"]
                self.ALPHA_treasury += fee_v
                per_mule = (moved - fee_v) / mules.size
                self.ALPHA_liquid[mules] += per_mule
                self.ALPHA_unseasoned[mules] += per_mule   # transfers-in are UNSEASONED

    def _twap_ops(self):
        """§13.B: gradual treasury market ops keyed to fast-vs-slow EMA of e, inside a
        no-op band, with a rolling per-window volume cap. No telegraphed thresholds.
        §13.B(c): op timing is jittered — a random share of op ticks is skipped, so an
        adversary cannot phase-lock a pump/dump cycle against the treasury's cadence."""
        p = self.p
        af = 2.0 / (p["twap_fast"] + 1)
        aslow = 2.0 / (p["twap_slow"] + 1)
        self.e_fast += af * (self.e - self.e_fast)
        self.e_slow += aslow * (self.e - self.e_slow)
        self.op_window *= (1 - 1 / 30)               # rolling 30d decay
        if self.rng.random() < p["twap_jitter"]:
            return  # EMAs and window decay updated; only the op itself skips this tick
        cap_left = p["twap_window_cap"] * self.R_credit - self.op_window
        if cap_left <= 0:
            return
        tick_cap = p["twap_tick_frac"] * self.R_credit
        dev = (self.e_fast - self.e_slow) / max(self.e_slow, 1e-9)
        if dev < -p["twap_band"] and self.treasury_credits > 0:
            # sustained weakness -> gradual buyback-burn
            spend = min(tick_cap, cap_left, self.treasury_credits)
            k = self.R_credit * self.R_alpha
            self.R_credit += spend
            dalpha = self.R_alpha - k / self.R_credit
            self.R_alpha -= dalpha
            self.treasury_credits -= spend
            self.ALPHA_burned += max(dalpha, 0.0)
            self.op_window += spend
        elif dev > p["twap_band"] and self.ALPHA_treasury > 0:
            # sustained spike -> gradual sell from the cap (earns Credits to treasury)
            sell_c_equiv = min(tick_cap, cap_left)
            sell_v = min(sell_c_equiv / max(self.e, 1e-9), self.ALPHA_treasury)
            if sell_v > 0:
                k = self.R_credit * self.R_alpha
                self.R_alpha += sell_v
                dcred = self.R_credit - k / self.R_alpha
                self.R_credit -= dcred
                self.ALPHA_treasury -= sell_v
                self.treasury_credits += dcred
                self.op_window += dcred

    def _withdraw_step(self, t, beh, a):
        p = self.p
        holders = a & (self.ALPHA_liquid > 1.0)
        # one-shot PoP: humans verify normally (INCLUDING in funnel scenarios — audit
        # fix: the old mule-only restriction made sybil-share meaningless); sybils only
        # if they passed at join; mules are attacker-controlled verified identities.
        to_verify = (holders & self.can_cashout & (~self.verified)
                     & (self.rng.random(p["n_max"]) < p["pop_verify_prob"]))
        self.verified[to_verify] = True
        wd = a & self.verified & (self.ALPHA_liquid > 1.0) \
            & (self.rng.random(p["n_max"]) < (p["withdraw_prob"] * beh[:, 6]))
        if wd.any():
            want = self.ALPHA_liquid[wd] * 0.5
            amt = np.minimum(want, np.maximum(p["w_cap"] - self.wd_window[wd], 0.0))
            # seasoning surcharge (ECONOMY §9, audit-2): withdrawals consume SEASONED
            # $ALPHA first; any unseasoned remainder pays the surcharge. Wash-proof by
            # construction — every acquisition path resets seasoning, and time can't be
            # laundered. (Replaces the AMM-washable provenance discount.)
            seasoned_bal = np.maximum(self.ALPHA_liquid[wd] - self.ALPHA_unseasoned[wd], 0.0)
            unseasoned_part = np.maximum(amt - seasoned_bal, 0.0)
            fee = amt * p["phi_wd"] + unseasoned_part * p["phi_wd_unseasoned"]
            net = amt - fee
            self.ALPHA_unseasoned[wd] = np.maximum(self.ALPHA_unseasoned[wd] - unseasoned_part, 0.0)
            self.ALPHA_liquid[wd] -= amt
            self.wd_window[wd] += amt
            # round-6b: boundary-fee split — the operator's share of the exit fee
            # leaves the game system at the valve (the value was exiting anyway);
            # the rest remains §13.B/$ALPHA-treasury ammunition
            fee_total = float(fee.sum())
            fee_take = fee_total * p["op_take_wdfee"]
            self.ALPHA_treasury += fee_total - fee_take
            self.ALPHA_exited += fee_take
            # per-identity exit attribution at REQUEST time (drives exit-Gini: who extracts);
            # totals (cashout_total / by_bot) realize at RELEASE via the vesting queue.
            self.withdrawn[wd] += net * self.e
            # vesting queue (audit fix: real queue; value realized at RELEASE)
            self.ALPHA_escrow += float(net.sum())
            rel = t + p["vesting_days"]
            for arch_i, net_i in zip(self.arch[wd], net):
                if net_i > 0:
                    self.vesting_q.append([rel, float(net_i), int(arch_i)])
        self.wd_window *= (1 - 1 / 7)

    def _release_vesting(self, t):
        self.wd_released_tick = 0.0
        if not self.vesting_q:
            return
        # Global rolling withdrawal cap (the Settlement leaky bucket, AUDIT-2 §10):
        # the contract refuses ANY voucher once the window is spent — regardless of
        # which identity presents it — and refills linearly, which at this model's
        # daily tick is a per-tick release budget. Queue order is preserved (first
        # come); a voucher too big for what remains waits for refill while smaller,
        # later ones still pass (vouchers are atomic and independent on-chain). A
        # deferred voucher stays in escrow: delayed, never voided — and it keeps
        # bearing price risk while it waits.
        budget = self.p["wd_global_cap"] if self.p["wd_global_cap"] > 0 else float("inf")
        remaining = []
        for rel, net_v, arch_i in self.vesting_q:
            if rel <= t and net_v <= budget:
                budget -= net_v
                val = net_v * self.e            # price risk borne through vesting
                self.ALPHA_escrow -= net_v
                self.ALPHA_exited += net_v
                self.cashout_total += val
                self.wd_released_tick += net_v
                if arch_i == BOT:
                    self.cashout_by_bot += val
            else:
                remaining.append([rel, net_v, arch_i])
        self.vesting_q = remaining

    # ----- integrity ------------------------------------------------------
    def _conservation(self, t):
        p = self.p
        alpha_total = (float(self.ALPHA_liquid.sum()) + float(self.ALPHA_staked.sum())
                     + float(self.ALPHA_unbonding.sum())
                     + self.ALPHA_dormant + self.R_alpha + self.ALPHA_escrow
                     + self.ALPHA_treasury + self.ALPHA_burned + self.ALPHA_exited)
        self.alpha_resid_max = max(self.alpha_resid_max, abs(alpha_total - p["alpha_max"]))
        credits_now = (float(self.C_clean.sum()) + float(self.C_bound.sum())
                       + self.C_dormant
                       + self.treasury_credits + self.R_credit
                       + self.cum_credit_destroyed)
        self.credit_resid_max = max(
            self.credit_resid_max,
            abs(credits_now - (self.cum_credit_mint + self.cum_credit_external)))

    # ----- metrics ---------------------------------------------------------
    def _metrics(self, t, mint_bound, mint_clean, sink_removed):
        churn_credits_tick = getattr(self, "_churn_credits_tick", 0.0)
        a = self.active
        n = int(a.sum())
        M = float(self.C_clean[a].sum() + self.C_bound[a].sum())
        networth = (self.C_clean + self.C_bound  # inv_value descoped
                    # round-5 audit fix: unbonding $ALPHA is owned wealth — excluding it
                    # hid ~25% of a mature whale's position from Gini/tail_alpha every tick
                    + self.e * (self.ALPHA_liquid + self.ALPHA_staked + self.ALPHA_unbonding))
        nw = networth[a]
        gini = _gini(nw)
        tail_alpha = _hill_tail_alpha(nw)
        # per-identity extraction attributed at request time, INCLUDING churned
        # identities' history (audit-2: slot recycling no longer erases lifetime exits)
        wdv = np.concatenate([self.withdrawn[self.withdrawn > 0],
                              np.array(self.exited_hist, dtype=float)])
        exit_gini = _gini(wdv) if wdv.size > 2 else 0.0
        sybil_share = self.cashout_by_bot / max(self.cashout_total, 1e-9)
        faucet = mint_bound + mint_clean
        sinks_total = self.sink_captured + self.sink_dead
        capture_share = self.sink_captured / max(sinks_total, 1e-9)
        # circulating supply = player-held (incl. dormant + unbonding — round-5 audit
        # fix, same omission as networth), excludes pool/treasury/burned
        alpha_circ = (float(self.ALPHA_liquid[a].sum()) + float(self.ALPHA_staked[a].sum())
                    + float(self.ALPHA_unbonding[a].sum()) + self.ALPHA_dormant)
        alpha_vel = self._alpha_volume / max(alpha_circ, 1e-9) * 30  # monthly turnover
        # CPI — LEVEL-BASED mean-reverting MV=PQ (spec §16 upgrade): P tracks the
        # smoothed money-per-output LEVEL, so a transient M swing moves P transiently
        # and mean-reverts, instead of ratcheting a growth integrator permanently.
        Qtot = max(mint_clean, 1e-6)
        aq = 2.0 / (14 + 1)
        self.Q_ema = Qtot if self.Q_ema is None else self.Q_ema + aq * (Qtot - self.Q_ema)
        mq_level = M / max(self.Q_ema, 1e-6)
        if t == 60:
            self.mq_ref = mq_level                    # reference set post-warmup
        if self.mq_ref is not None:
            ap = 2.0 / (30 + 1)
            self.P += ap * (mq_level / self.mq_ref - self.P)
        self.prev_M, self.prev_Q = M, Qtot
        self.Phist.append(self.P)
        w = 60
        if len(self.Phist) > w and self.Phist[-w - 1] > 0:
            self.inflation = (self.Phist[-1] / self.Phist[-w - 1]) ** (365 / w) - 1
        return dict(
            t=t, N=n, M=M, Mpc=M / max(n, 1), MQ=M / Qtot, e=self.e, P=self.P,
            inflation=self.inflation, delta_eff=self.delta_eff,
            V=(mint_clean + sink_removed + self._trade_volume) / max(M, 1e-9) * 30,
            q_real=mint_clean + self._trade_volume,
            mint_bound=mint_bound, mint_clean=mint_clean, sink=sink_removed,
            faucet_sink=faucet / max(sink_removed, 1e-9),
            faucet_sink_designed=faucet / max(sink_removed - churn_credits_tick, 1e-9),
            net_emission=faucet - sink_removed,
            gini=gini, tail_alpha=tail_alpha, exit_gini=exit_gini,
            alpha_circ=alpha_circ, alpha_staked=float(self.ALPHA_staked[a].sum()),
            alpha_dormant=self.ALPHA_dormant, alpha_burned=self.ALPHA_burned,
            alpha_exited=self.ALPHA_exited, alpha_velocity=alpha_vel,
            treasury=self.treasury_credits, capture_share=capture_share,
            cashout_total=self.cashout_total, cashout_by_bot=self.cashout_by_bot,
            wd_released=self.wd_released_tick, wd_escrow=self.ALPHA_escrow,
            sybil_share=sybil_share, chance_leak=self.chance_leak_total,
            alpha_resid=self.alpha_resid_max, credit_resid=self.credit_resid_max,
            reserve_ok=bool(self.alpha_resid_max < 1e-3 * self.p["alpha_max"]
                            and self.credit_resid_max < max(1e-3 * self.cum_credit_mint, 1.0)),
        )

    def run(self):
        rows = []
        for t in range(self.p["horizon"]):
            rows.append(self.step(t))
        return rows


# ----------------------------------------------------------------------------
# metric helpers
# ----------------------------------------------------------------------------
def _gini(x):
    x = np.asarray(x, float)
    x = x[x >= 0]
    if x.size < 2 or x.sum() == 0:
        return 0.0
    xs = np.sort(x)
    nn = xs.size
    cum = np.cumsum(xs)
    return float((nn + 1 - 2 * (cum / cum[-1]).sum()) / nn)


def _hill_tail_alpha(x):
    """Hill tail-index estimator of the upper wealth tail (Pareto tail_alpha).
    Mildly biased for small k; used as a directional gate (tail_alpha >= 2), not a point est."""
    x = np.asarray(x, float)
    x = x[x > 0]
    if x.size < 20:
        return float("nan")
    xs = np.sort(x)
    k = max(int(0.1 * xs.size), 10)
    tail = xs[-k:]
    xmin = tail[0]
    if xmin <= 0:
        return float("nan")
    # Hill estimator of the survival-function tail index tail_alpha (S(x) ~ x^-tail_alpha):
    # tail_alpha_hat = k / sum(log(x_i/xmin)). (audit-2 fix: the previous +1 conflated the
    # pdf exponent with the tail index, inflating tail_alpha and weakening the G7 gate.)
    return float(k / np.sum(np.log(tail / xmin) + 1e-12))
