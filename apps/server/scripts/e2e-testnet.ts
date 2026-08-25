/**
 * End-to-end proof against a LIVE Settlement deployment. Drives the real thing:
 *
 *   on-chain deposit → indexer credits the game → withdraw request (every §9 gate) →
 *   vest → claim (server signs the voucher) → redeem on-chain → indexer confirms →
 *   solvency audit holds.
 *
 * Only the clock is simulated (vesting is 14 days); every value movement is real.
 *
 *   OUTFOX_RPC_URL=… OUTFOX_CHAIN_ID=… OUTFOX_SETTLEMENT=… OUTFOX_ALPHA=… \
 *   OUTFOX_SIGNER_KEY=… E2E_PLAYER_KEY=… npx tsx scripts/e2e-testnet.ts
 */
import { createPublicClient, createWalletClient, http, parseAbi, getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { openDb } from '../src/db.js';
import { createPlayer } from '../src/engine.js';
import { chainConfigFromEnv, indexOnce, signVoucher } from '../src/chain.js';
import {
  linkWallet, alphaBalance, unseasonedBalance, requestWithdrawal, prepareClaim,
  recordSignedVoucher, alphaView, solvencyAudit,
} from '../src/settlement.js';
import { VALVE } from '@outfox/shared';

const DAY = 86_400_000;
const cfg = chainConfigFromEnv();
if (!cfg) throw new Error('chain env not configured');
const ALPHA = getAddress(process.env.OUTFOX_ALPHA!);
const player = privateKeyToAccount(process.env.E2E_PLAYER_KEY as Hex);

const ERC20 = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const SETTLEMENT = parseAbi([
  'function deposit(uint256)',
  'function withdraw(address,uint256,uint256,uint256,bytes)',
  'function reserve() view returns (uint256)',
]);

const pub = createPublicClient({ transport: http(cfg.rpcUrl) });
const wallet = createWalletClient({ account: player, transport: http(cfg.rpcUrl), chain: { id: cfg.chainId, name: 'rh', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } } as any });

const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });
const A = (n: bigint) => n * 10n ** 18n;
const fmt = (w: bigint) => `${(Number(w) / 1e18).toFixed(4)} ALPHA`;
const ok = (c: boolean, m: string) => { console.log(`${c ? '  OK  ' : ' FAIL '} ${m}`); if (!c) process.exitCode = 1; };

// fresh in-memory game DB, but a real chain
const db = openDb(':memory:');
const p = createPlayer(db);
linkWallet(db, p, player.address);                       // R2
db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(p); // R3 (World ID stands here)
console.log(`player ${p} linked to ${player.address}, verified (R3)\n`);

// index from the current head so we only see OUR events
const head = await pub.getBlockNumber();
db.prepare(`INSERT INTO chain_cursor (id, last_block) VALUES (1, ?)`).run(Number(head - 1n));

// ---- 1. deposit on-chain -----------------------------------------------------
const DEPOSIT = A(20n);
console.log(`1) depositing ${fmt(DEPOSIT)} on-chain…`);
await wait(await wallet.writeContract({ address: ALPHA, abi: ERC20, functionName: 'approve', args: [cfg.settlement, DEPOSIT] }));
await wait(await wallet.writeContract({ address: cfg.settlement, abi: SETTLEMENT, functionName: 'deposit', args: [DEPOSIT] }));

// ---- 2. the indexer credits the game ------------------------------------------
let credited = 0n;
for (let i = 0; i < 15 && credited === 0n; i++) {
  await indexOnce(db, cfg, 0n);
  credited = alphaBalance(db, p);
  if (credited === 0n) await new Promise((r) => setTimeout(r, 2000));
}
ok(credited === DEPOSIT, `indexer credited the game: ${fmt(credited)}`);
ok(unseasonedBalance(db, p) === DEPOSIT, 'the deposit lot is UNSEASONED (§13.C)');

// re-index the same range: must NOT double-credit
db.prepare(`UPDATE chain_cursor SET last_block = ? WHERE id = 1`).run(Number(head - 1n));
await indexOnce(db, cfg, 0n);
ok(alphaBalance(db, p) === DEPOSIT, 'replaying the same logs does not double-credit (idempotent)');

// ---- 3. withdraw request: the §9 gates ----------------------------------------
const reserve = await pub.readContract({ address: cfg.settlement, abi: SETTLEMENT, functionName: 'reserve' });
const GROSS = A(10n);
const wd = requestWithdrawal(db, p, GROSS, reserve);
console.log(`\n3) requested ${fmt(GROSS)} → fee ${fmt(BigInt(wd.feeWei))}, net ${fmt(BigInt(wd.netWei))}`);
// all fresh value: 5% fee + 40% surcharge
ok(BigInt(wd.feeWei) === (GROSS * 4500n) / 10_000n, 'fee = 5% + 40% unseasoned surcharge');
ok(wd.status === 'vesting', 'status is vesting (V4)');
let threw = '';
try { prepareClaim(db, p, wd.id); } catch (e) { threw = (e as Error).message; }
ok(/vesting/.test(threw), 'cannot claim while vesting');

// ---- 4. vest, claim, sign ------------------------------------------------------
const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
const claim = prepareClaim(db, p, wd.id, later);
const sig = await signVoucher(cfg, { to: claim.to as `0x${string}`, amount: claim.amountWei, nonce: claim.nonce, deadline: claim.deadline });
recordSignedVoucher(db, wd.id, sig, claim.deadline);
console.log(`4) vested → server signed voucher (nonce ${claim.nonce.toString().slice(0, 12)}…) for ${fmt(claim.amountWei)}`);

// ---- 5. redeem on-chain --------------------------------------------------------
const before = await pub.readContract({ address: ALPHA, abi: ERC20, functionName: 'balanceOf', args: [player.address] });
await wait(await wallet.writeContract({
  address: cfg.settlement, abi: SETTLEMENT, functionName: 'withdraw',
  args: [claim.to as `0x${string}`, claim.amountWei, claim.nonce, claim.deadline, sig as Hex],
}));
const after = await pub.readContract({ address: ALPHA, abi: ERC20, functionName: 'balanceOf', args: [player.address] });
ok(after - before === claim.amountWei, `on-chain payout matches the voucher: +${fmt(after - before)}`);

// ---- 6. indexer confirms + solvency --------------------------------------------
for (let i = 0; i < 15; i++) {
  await indexOnce(db, cfg, 0n);
  if (alphaView(db, p, later).withdrawals[0].status === 'confirmed') break;
  await new Promise((r) => setTimeout(r, 2000));
}
const v = alphaView(db, p, later).withdrawals[0];
ok(v.status === 'confirmed', `indexer marked it confirmed (tx ${v.txHash?.slice(0, 12)}…)`);

const finalReserve = await pub.readContract({ address: cfg.settlement, abi: SETTLEMENT, functionName: 'reserve' });
const audit = solvencyAudit(db, finalReserve);
console.log(`\n6) solvency: reserve ${fmt(BigInt(audit.reserveWei))} >= liabilities ${fmt(BigInt(audit.liabilitiesWei))}`);
ok(audit.holds, 'proof of reserves holds (chain covers every game-side claim)');
console.log(process.exitCode ? '\nFAILED' : '\nALL CHECKS PASSED');
