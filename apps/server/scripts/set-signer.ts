/**
 * Rotate the settlement's voucher signer (docs/INFRASTRUCTURE.md §Rotate the signer).
 * Run from a machine that is NOT the box, with the cold admin key. The new seed was
 * generated on the box; only its PUBLIC key travels here.
 *
 *   OUTFOX_RPC_URL=…  OUTFOX_CHAIN_ID=…  OUTFOX_PROGRAM_ID=…
 *   SET_SIGNER_ADMIN=<admin keypair.json>  SET_SIGNER_PAYER=<fee payer keypair.json>
 *   NEW_SIGNER=<base58 pubkey>
 *   npx tsx scripts/set-signer.ts
 *
 * Reads the state before and after: refuses when the state's admin is not the given key,
 * when the new signer equals the admin (the program refuses that too), and fails loudly
 * when the read-back does not show the new signer.
 */
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chainConfigFromEnv, parseSettlementState, statePda } from '../src/chain/adapter.js';

const cfg = chainConfigFromEnv();
if (!cfg) throw new Error('set OUTFOX_RPC_URL / OUTFOX_CHAIN_ID / OUTFOX_PROGRAM_ID');
const loadKp = (env: string) => {
  const p = process.env[env];
  if (!p) throw new Error(`${env} not set`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, 'utf8'))));
};
const ADMIN = loadKp('SET_SIGNER_ADMIN');
const PAYER = loadKp('SET_SIGNER_PAYER');
if (!process.env.NEW_SIGNER) throw new Error('NEW_SIGNER not set');
const NEW_SIGNER = new PublicKey(process.env.NEW_SIGNER);
if (NEW_SIGNER.equals(ADMIN.publicKey)) throw new Error('the voucher signer must not be the admin');

const conn = new Connection(cfg.rpcUrl, 'confirmed');
const STATE = statePda(cfg);

async function readState() {
  const info = await conn.getAccountInfo(STATE);
  if (!info || !info.owner.equals(cfg!.programId)) throw new Error('settlement state not found for this program id');
  return parseSettlementState(info.data);
}

const before = await readState();
console.log(`state ${STATE.toBase58()}`);
console.log(`  admin   ${before.admin.toBase58()}`);
console.log(`  signer  ${before.signer.toBase58()}  (current)`);
if (!before.admin.equals(ADMIN.publicKey)) {
  throw new Error(`the state's admin is ${before.admin.toBase58()}, not the given key ${ADMIN.publicKey.toBase58()}`);
}
if (before.signer.equals(NEW_SIGNER)) {
  console.log('  the new signer is already the current signer; nothing to do');
  process.exit(0);
}

const data = Buffer.alloc(8 + 32);
createHash('sha256').update('global:set_signer').digest().copy(data, 0, 0, 8);
NEW_SIGNER.toBuffer().copy(data, 8);
const ix = new TransactionInstruction({
  programId: cfg.programId,
  keys: [
    { pubkey: STATE, isSigner: false, isWritable: true },
    { pubkey: ADMIN.publicKey, isSigner: true, isWritable: false },
  ],
  data,
});

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
const tx = new Transaction({ feePayer: PAYER.publicKey, blockhash, lastValidBlockHeight });
tx.add(ix);
tx.sign(PAYER, ...(ADMIN.publicKey.equals(PAYER.publicKey) ? [] : [ADMIN]));
const sig = await conn.sendRawTransaction(tx.serialize());
for (let i = 0; i < 60; i++) {
  const st = await conn.getSignatureStatus(sig);
  if (st.value?.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.value.err)}`);
  const c = st.value?.confirmationStatus;
  if (c === 'confirmed' || c === 'finalized') break;
  if (i === 59) throw new Error(`tx ${sig} not confirmed in time`);
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`set_signer tx ${sig}`);

const after = await readState();
if (!after.signer.equals(NEW_SIGNER)) {
  throw new Error(`read-back shows signer ${after.signer.toBase58()}, expected ${NEW_SIGNER.toBase58()}`);
}
console.log(`  signer  ${after.signer.toBase58()}  (new, read back and matches)`);
